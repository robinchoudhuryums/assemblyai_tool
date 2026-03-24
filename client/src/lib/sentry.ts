/**
 * Client-side Sentry initialization.
 * Only activates if VITE_SENTRY_DSN is set at build time.
 * PHI-safe: scrubs potential PHI from error reports before sending.
 */
import * as Sentry from "@sentry/react";

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,          // SSN
  /\b\d{10,11}\b/g,                    // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
];

function scrubPHI(text: string): string {
  let scrubbed = text;
  for (const pattern of PHI_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[REDACTED]");
  }
  return scrubbed;
}

export function initClientSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      // HIPAA: Scrub potential PHI
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
      // Remove breadcrumb messages
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.message) {
            crumb.message = scrubPHI(crumb.message);
          }
        }
      }
      return event;
    },
  });
}

export { Sentry };
