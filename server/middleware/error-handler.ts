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
 */
export function globalErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.detail ? { detail: err.detail } : {}),
      },
    });
    return;
  }

  // Log unexpected errors
  console.error("[ERROR]", err.message, err.stack?.split("\n").slice(0, 3).join("\n"));

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
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
