/**
 * Structured Error Handling Middleware.
 *
 * Adapted from Observatory QA's error handling pattern.
 * Provides:
 * - AppError class for typed, code-bearing errors
 * - asyncHandler wrapper to eliminate try/catch boilerplate in routes
 * - Global error handler middleware for consistent JSON error responses
 *
 * Usage in routes:
 *   app.get("/api/foo", asyncHandler(async (req, res) => {
 *     const item = await db.find(req.params.id);
 *     if (!item) throw new AppError(404, "NOT_FOUND", "Item not found");
 *     res.json(item);
 *   }));
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Wraps an async route handler to automatically catch errors and forward
 * them to Express error handling. Eliminates try/catch boilerplate.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler — mount as the last middleware.
 * Converts AppError instances to structured JSON responses.
 * Catches unhandled errors as 500 Internal Server Error.
 *
 * RESPONSE SHAPE (transitional, see A4/AD3): emits BOTH the legacy
 *   { message }
 * field AND the new
 *   { error: { code, message, detail? } }
 * field for one release. Existing frontend handlers (queryClient.ts,
 * error-boundary.tsx) continue to read top-level `message`. New code should
 * read from `error`. The top-level `message` field will be removed in batch 2.
 *
 * In production, raw error messages from non-AppError instances are sanitized
 * to avoid leaking stack traces / DB error details / library internals.
 */
const isProduction = () => process.env.NODE_ENV === "production";

export function globalErrorHandler(err: Error & { statusCode?: number; status?: number }, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    // Express requires we delegate if a response has already started streaming
    return _next(err);
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message, // legacy field — drop in batch 2
      error: {
        code: err.code,
        message: err.message,
        ...(err.detail ? { detail: err.detail } : {}),
      },
    });
    return;
  }

  // Unexpected error → log full server-side, sanitize client message in prod
  console.error("[ERROR]", err.message, err.stack?.split("\n").slice(0, 3).join("\n"));

  const status = err.statusCode || err.status || 500;
  const sanitizedMessage = isProduction() && status >= 500
    ? "An unexpected error occurred"
    : (err.message || "An unexpected error occurred");

  res.status(status).json({
    message: sanitizedMessage, // legacy field — drop in batch 2
    error: {
      code: "INTERNAL_ERROR",
      message: sanitizedMessage,
    },
  });
}

/**
 * Common error codes for consistent API responses.
 */
export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  DUPLICATE: "DUPLICATE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  AI_UNAVAILABLE: "AI_UNAVAILABLE",
  STORAGE_ERROR: "STORAGE_ERROR",
} as const;
