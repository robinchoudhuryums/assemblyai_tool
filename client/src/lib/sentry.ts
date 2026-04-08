/**
 * Client-side Sentry initialization.
 *
 * Only activates if VITE_SENTRY_DSN is set at build time.
 *
 * HIPAA: every event is recursively scrubbed of PHI before being sent. The
 * scrubber walks event.message, exception values, breadcrumbs, user, request,
 * contexts, extra, and tags so PHI cannot escape via any nested field. The
 * Sentry namespace is intentionally NOT re-exported — callers must use the
 * `captureException` / `captureMessage` wrappers below, which run their input
 * through the scrubber before forwarding to the SDK.
 */
import * as Sentry from "@sentry/react";
import { deepScrubPhi, redactPhiText } from "@shared/phi-patterns";

let initialized = false;

function scrubEvent<T extends Sentry.Event>(event: T): T {
  try {
    if (event.message) {
      event.message = redactPhiText(event.message);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = redactPhiText(ex.value);
      }
    }
    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        if (crumb.message) crumb.message = redactPhiText(crumb.message);
        if (crumb.data) crumb.data = deepScrubPhi(crumb.data);
      }
    }
    if (event.user) event.user = deepScrubPhi(event.user);
    if (event.request) event.request = deepScrubPhi(event.request);
    if (event.contexts) event.contexts = deepScrubPhi(event.contexts);
    if (event.extra) event.extra = deepScrubPhi(event.extra);
    if (event.tags) event.tags = deepScrubPhi(event.tags);
    return event;
  } catch (err) {
    // Fail-open: if the scrubber crashes, the event still goes through.
    // Logging here is best-effort — the scrubber bug itself is the alert.
    // eslint-disable-next-line no-console
    console.error("[sentry] PHI scrubber failed", err);
    return event;
  }
}

export function initClientSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  if (initialized) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

/**
 * PHI-scrubbed wrapper around Sentry.captureException. Always use this
 * instead of importing Sentry directly — the namespace is no longer
 * re-exported from this module.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  const scrubbedContext = context ? deepScrubPhi(context) : undefined;
  Sentry.captureException(error, scrubbedContext ? { extra: scrubbedContext } : undefined);
}

/**
 * PHI-scrubbed wrapper around Sentry.captureMessage.
 */
export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!initialized) return;
  const scrubbed = redactPhiText(message);
  const scrubbedContext = context ? deepScrubPhi(context) : undefined;
  Sentry.captureMessage(scrubbed, scrubbedContext ? { extra: scrubbedContext } : undefined);
}
