/**
 * Sentry Error Tracking Service
 *
 * Provides server-side error tracking with PHI-safe scrubbing.
 * Only initializes if SENTRY_DSN is set — no-op otherwise.
 *
 * HIPAA: Scrubs potential PHI from error reports (names, phone numbers,
 * SSNs, email addresses, audio file names, transcript text).
 */
import * as Sentry from "@sentry/node";

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,          // SSN
  // Phone: require formatted shape (groups separated by space/dash/dot or
  // wrapped in parens). Bare 10-11 digit runs were too greedy and matched
  // job IDs, request counts, and timestamps.
  /\b(?:\+?1[\s.\-])?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b(?:patient|member|subscriber|caller|agent)\s*(?:name|id)?[\s:]+\S+/gi, // Patient/caller references
  /\b(?:MRN|mrn|acct|account)[:\s#]*[A-Z0-9]{4,20}\b/gi,    // Medical record / account numbers
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,                     // Date patterns (DOB, etc.)
  /\b\d{1,5}\s+\w+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Way)\b/gi, // Street addresses
  /\b(?:DOB|dob|date of birth)[:\s]+\S+/gi,                  // Explicit DOB references
];

function scrubPHI(text: string): string {
  if (text.length > 10_000) {
    // DoS guard: don't run 8 regexes on large blobs
    return text.slice(0, 200) + "...[truncated]";
  }
  let scrubbed = text;
  for (const pattern of PHI_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[REDACTED]");
  }
  return scrubbed;
}

/**
 * Recursively scrub PHI from arbitrary nested objects/arrays.
 * - Depth-limited to MAX_SCRUB_DEPTH (DoS guard against pathological nesting)
 * - WeakSet cycle detection (prevents infinite recursion on cyclic refs)
 * - String values run through scrubPHI; non-string primitives passed through
 */
const MAX_SCRUB_DEPTH = 6;
function scrubObject(input: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > MAX_SCRUB_DEPTH) return "[depth-limit]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return scrubPHI(input);
  if (typeof input !== "object") return input;
  if (seen.has(input as object)) return "[circular]";
  seen.add(input as object);
  if (Array.isArray(input)) {
    return input.map((v) => scrubObject(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = scrubObject(v, depth + 1, seen);
  }
  return out;
}

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[SENTRY] SENTRY_DSN not set — error tracking disabled.");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.npm_package_version || "unknown",
    tracesSampleRate: 0.1, // 10% of transactions
    beforeSend(event) {
      // Fail-open: any exception in scrubbing returns event unmodified rather
      // than dropping it. Observability is the priority on the observability path.
      try {
        // HIPAA: Scrub potential PHI from error messages
        if (event.message) {
          event.message = scrubPHI(event.message);
        }
        if (event.exception?.values) {
          for (const ex of event.exception.values) {
            if (ex.value) {
              ex.value = scrubPHI(ex.value);
            }
          }
        }
        // Remove request body data (may contain PHI)
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.query_string) {
            event.request.query_string = "[REDACTED]";
          }
        }
        // Scrub event-level extra/tags/user (A5)
        if (event.extra && typeof event.extra === "object") {
          event.extra = scrubObject(event.extra) as Record<string, unknown>;
        }
        if (event.tags && typeof event.tags === "object") {
          event.tags = scrubObject(event.tags) as Record<string, string>;
        }
        if (event.user && typeof event.user === "object") {
          // Only keep id; drop username/email/ip_address which may carry PHI
          event.user = { id: event.user.id };
        }
        // Remove breadcrumb messages and data that might contain PHI.
        // Guard with Array.isArray — some SDK versions/transport errors can
        // leave breadcrumbs as a non-iterable shape and crash the for..of.
        if (Array.isArray(event.breadcrumbs)) {
          for (const crumb of event.breadcrumbs) {
            if (crumb && crumb.message) {
              crumb.message = scrubPHI(crumb.message);
            }
            if (crumb && crumb.data && typeof crumb.data === "object") {
              crumb.data = scrubObject(crumb.data) as Record<string, unknown>;
            }
          }
        }
        // Scrub URL paths that may reference specific calls/patients
        if (event.request?.url) {
          event.request.url = event.request.url.replace(
            /\/api\/calls\/[0-9a-f-]+/gi, "/api/calls/[REDACTED]"
          );
        }
        return event;
      } catch (err) {
        console.error("[SENTRY] beforeSend scrub failed (returning event unmodified):", err);
        return event;
      }
    },
    // Ignore common non-actionable errors
    ignoreErrors: [
      "ECONNRESET",
      "EPIPE",
      "socket hang up",
      "aborted",
    ],
  });

  initialized = true;
  console.log("[SENTRY] Error tracking initialized.");
}

export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    // Recursively scrub nested context values (A5)
    const safeContext = scrubObject(context) as Record<string, unknown>;
    Sentry.captureException(error, { extra: safeContext });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!initialized) return;
  Sentry.captureMessage(scrubPHI(message), level);
}

// NOTE: The Sentry namespace export was removed (A5/F68). Importers should
// use the wrapped captureException / captureMessage functions which apply
// PHI scrubbing. Direct namespace access bypassed scrubbing.
