/**
 * Centralized error reporting utility.
 * Currently logs to console with structured metadata.
 * To integrate a service like Sentry, replace reportError internals.
 */

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const timestamp = new Date().toISOString();

  // Structured error log
  console.error("[APP_ERROR]", {
    timestamp,
    message: errorObj.message,
    stack: errorObj.stack,
    ...context,
  });

  // Integration point: uncomment to send to an external service
  // Sentry.captureException(errorObj, { extra: context });
}

/**
 * Wrap an async function to catch and report errors automatically.
 */
export function withErrorReporting<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: ErrorContext
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      reportError(error, context);
      throw error;
    }
  }) as T;
}
