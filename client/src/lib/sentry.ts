/**
 * Client-side error capture (no-op stubs)
 *
 * Sentry was removed in favor of AWS CloudWatch Logs + Alarms
 * (server-side). Client errors that reach the error boundary are
 * logged to console.error and propagate to server logs via the
 * existing error reporting path.
 *
 * These stubs preserve the function signatures so existing callsites
 * (error-boundary.tsx, etc.) continue to compile without changes.
 */

/** @deprecated Sentry removed — no-op. */
export function initClientSentry(): void {}

/** @deprecated Sentry removed — no-op. */
export function captureException(_error: unknown, _context?: Record<string, unknown>): void {}

/** @deprecated Sentry removed — no-op. */
export function captureMessage(_message: string, _context?: Record<string, unknown>): void {}
