import type { Request, Response, NextFunction } from "express";

/**
 * Per-user API rate limiter (in-memory).
 *
 * Tracks requests by authenticated username. Unauthenticated requests are
 * skipped (the existing IP-based rate limiter in index.ts still applies).
 *
 * Suggested defaults (applied in index.ts):
 *   - 120 req/min for general authenticated API access
 *   - 10 req/min for export endpoints
 *   - 30 req/min for write operations (POST/PATCH/DELETE)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const USER_BUCKETS_MAX = 10_000;
const userBuckets = new Map<string, RateLimitEntry>();

function evictOldestUserBucket(): void {
  const firstKey = userBuckets.keys().next().value;
  if (firstKey !== undefined) userBuckets.delete(firstKey);
}

// Clean up expired entries every 5 minutes (TTL correctness — LRU is the
// hard memory bound below). .unref() per INV-30 so this doesn't block
// graceful shutdown.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userBuckets) {
    if (now >= entry.resetAt) {
      userBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Factory that returns Express middleware enforcing per-user rate limiting.
 *
 * @param maxRequests  Maximum number of requests allowed within the window.
 * @param windowMs     Window duration in milliseconds (default: 60 000 — one minute).
 */
export function userRateLimit(maxRequests: number, windowMs: number = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip unauthenticated requests — IP-based limits still apply
    if (!req.isAuthenticated?.() || !req.user) {
      return next();
    }

    const username = req.user.username;
    // Include the rate-limit tier in the key so different limits for the same
    // user (e.g. general vs export) use separate buckets.
    const bucketKey = `${username}:${maxRequests}:${windowMs}`;
    const now = Date.now();

    let entry = userBuckets.get(bucketKey);

    if (!entry || now >= entry.resetAt) {
      // Hard LRU bound: evict oldest insertion-order entry on overflow.
      while (userBuckets.size >= USER_BUCKETS_MAX) {
        evictOldestUserBucket();
      }
      entry = { count: 0, resetAt: now + windowMs };
      userBuckets.set(bucketKey, entry);
    } else {
      // Touch: re-insert to move to end (LRU recency)
      userBuckets.delete(bucketKey);
      userBuckets.set(bucketKey, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetEpochSeconds = Math.ceil(entry.resetAt / 1000);

    // Always set informational headers
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetEpochSeconds));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: "Too many requests. Please try again later.",
        retryAfter,
      });
    }

    return next();
  };
}
