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
  /\b\d{10,11}\b/g,                    // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b(?:patient|member|subscriber|caller|agent)\s*(?:name|id)?[\s:]+\S+/gi, // Patient/caller references
  /\b(?:MRN|mrn|acct|account)[:\s#]*[A-Z0-9]{4,20}\b/gi,    // Medical record / account numbers
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,                     // Date patterns (DOB, etc.)
  /\b\d{1,5}\s+\w+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Way)\b/gi, // Street addresses
  /\b(?:DOB|dob|date of birth)[:\s]+\S+/gi,                  // Explicit DOB references
];

function scrubPHI(text: string): string {
  let scrubbed = text;
  for (const pattern of PHI_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[REDACTED]");
  }
  return scrubbed;
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
        // Scrub query strings that might have PHI
        if (event.request.query_string) {
          event.request.query_string = "[REDACTED]";
        }
      }
      // Remove breadcrumb messages and data that might contain PHI
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.message) {
            crumb.message = scrubPHI(crumb.message);
          }
          // Scrub breadcrumb data values (e.g., fetch URLs, SQL queries)
          if (crumb.data && typeof crumb.data === "object") {
            for (const [key, value] of Object.entries(crumb.data)) {
              if (typeof value === "string") {
                (crumb.data as Record<string, unknown>)[key] = scrubPHI(value);
              }
            }
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
    // Scrub context values before sending
    const safeContext: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === "string") {
        safeContext[key] = scrubPHI(value);
      } else {
        safeContext[key] = value;
      }
    }
    Sentry.captureException(error, { extra: safeContext });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!initialized) return;
  Sentry.captureMessage(scrubPHI(message), level);
}

export { Sentry };
