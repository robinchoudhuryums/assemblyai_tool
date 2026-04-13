/**
 * Error Tracking Service (no-op stubs)
 *
 * Sentry was removed in favor of AWS CloudWatch Logs + Alarms.
 * These stubs preserve the function signatures so existing callsites
 * continue to compile without changes.
 *
 * Server-side errors are captured by the structured logger
 * (server/services/logger.ts) which outputs JSON to stdout, picked up
 * by the CloudWatch Logs agent on EC2.
 */

/** @deprecated Sentry removed — no-op. */
export function initSentry(): void {}

/** @deprecated Sentry removed — no-op. Errors are logged via logger.error(). */
export function captureException(_error: Error, _context?: Record<string, unknown>): void {}

/** @deprecated Sentry removed — no-op. Messages are logged via logger.warn/error(). */
export function captureMessage(_message: string, _level?: "info" | "warning" | "error"): void {}
