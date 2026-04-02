import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { setupWebSocket } from "./services/websocket";
import { getPool, initializeDatabase } from "./db/pool";
import { userRateLimit } from "./middleware/rate-limit";
import { wafMiddleware } from "./middleware/waf";
import { startScheduledScans } from "./services/vulnerability-scanner";
import { initSentry, captureException as sentryCaptureException } from "./services/sentry";
import crypto from "crypto";
import { logger, metrics } from "./services/logger";
import { flushAuditQueue } from "./services/audit-log";

// Initialize Sentry early (before Express setup) so it catches startup errors
initSentry();

const app = express();

// HIPAA: Simple rate limiter for sensitive endpoints (login, search)
// Bounded to prevent memory exhaustion under distributed attacks.
const RATE_LIMIT_MAX_ENTRIES = 10_000;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
      // HIPAA: Evict expired entries first to prevent memory bloat from diverse IPs.
      // If still at capacity after cleanup, evict the oldest entry.
      if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
        let evicted = 0;
        for (const [k, v] of rateLimitMap) {
          if (now > v.resetTime) {
            rateLimitMap.delete(k);
            evicted++;
            if (rateLimitMap.size < RATE_LIMIT_MAX_ENTRIES) break;
          }
        }
        // If no expired entries to evict, remove the oldest by insertion order
        if (evicted === 0 && rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
          const firstKey = rateLimitMap.keys().next().value;
          if (firstKey) rateLimitMap.delete(firstKey);
        }
      }
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    return next();
  };
}
// Clean up expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// Trust reverse proxy (Caddy on EC2, or Render/Heroku load balancers).
// "trust proxy" = 1 means trust only the first hop — prevents attackers
// from spoofing X-Forwarded-For with arbitrary IPs to bypass rate limits.
if (process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE) {
  app.set("trust proxy", 1);
}
// SECURITY: Validate X-Forwarded-For when present — strip invalid entries
app.use((req, _res, next) => {
  // Only validate in production where trust proxy is set
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-for"]) {
    const forwarded = (req.headers["x-forwarded-for"] as string).split(",").map(s => s.trim());
    // Validate each IP in the chain is a plausible IP address (IPv4 or IPv6)
    const ipPattern = /^[\da-fA-F.:]+$/;
    const validIPs = forwarded.filter(ip => ipPattern.test(ip) && ip.length <= 45);
    if (validIPs.length !== forwarded.length) {
      // Sanitize the header to only contain valid IPs
      req.headers["x-forwarded-for"] = validIPs.join(", ");
    }
  }
  next();
});

// HIPAA: Enforce HTTPS in production (redirect HTTP → HTTPS)
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https" &&
    !req.hostname.startsWith("localhost") &&
    !req.hostname.startsWith("127.0.0.1")
  ) {
    return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
  }
  next();
});

// HIPAA: Explicit CORS policy — restrict to same-origin only
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    // Allow same-origin requests (browsers send Origin on fetch() even for same-origin)
    const requestHost = req.hostname;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      // Malformed Origin header — block it
    }

    if (originHost && originHost === requestHost) {
      // Same-origin: allow through without CORS headers (not needed)
      return next();
    }

    // Cross-origin request
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Cross-origin requests are not allowed" });
    }
    // In development, only allow cross-origin from localhost (Vite dev server)
    // This prevents accidental CORS exposure if NODE_ENV is misconfigured.
    if (!originHost || !["localhost", "127.0.0.1", "0.0.0.0"].includes(originHost)) {
      return res.status(403).json({ message: "Cross-origin requests are not allowed" });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// WAF: Application-level web application firewall (IP blocking, SQLi/XSS/path traversal detection)
app.use(wafMiddleware());

// HIPAA: Security headers including Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP for HTML pages is set per-request with nonce in vite.ts (injectCspNonce).
  // For API responses that don't go through vite.ts, set a restrictive fallback CSP.
  if (req.path.startsWith("/api")) {
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none';"
    );
  }
  // Only set no-cache on API routes — static assets need caching for performance
  if (req.path.startsWith("/api")) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// HIPAA: Audit logging middleware - logs all API access with user identity but never PHI
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      const user = req.user;
      const username = user ? user.username : "anonymous";
      const role = user ? user.role : undefined;

      // Structured JSON log for aggregators
      logger.info("api_request", {
        method: req.method,
        path: reqPath,
        status: res.statusCode,
        duration_ms: duration,
        username,
        role,
      });

      // Metrics: request count by method and status class
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      metrics.increment("http_requests_total", 1, { method: req.method, status: statusClass });
      metrics.observe("http_request_duration_ms", duration, { method: req.method });

      // Also write the human-readable log for pm2 console
      log(`[AUDIT] ${new Date().toISOString()} ${username}${role ? `(${role})` : ""} ${req.method} ${reqPath} ${res.statusCode} ${duration}ms`);
    }
  });

  next();
});

// CSRF protection: Require proof that the request originates from our app.
// For JSON requests: Content-Type: application/json (browsers won't send this cross-origin without CORS preflight).
// For multipart uploads: Require a custom X-Requested-With header (same CORS protection mechanism).
// Exempt: login, logout, access-requests (unauthenticated public endpoints).
app.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.path.startsWith("/api")) {
    const exempt = ["/api/auth/login", "/api/auth/logout", "/api/access-requests"];
    if (exempt.includes(req.path)) return next();

    const contentType = req.headers["content-type"] || "";
    const isMultipart = contentType.includes("multipart/form-data");

    if (isMultipart) {
      // HIPAA: Multipart uploads must include X-Requested-With header to prove same-origin.
      // Cross-origin forms cannot set custom headers without CORS preflight approval.
      const hasCustomHeader = !!req.headers["x-requested-with"];
      if (!hasCustomHeader) {
        return res.status(403).json({ message: "CSRF check failed: X-Requested-With header required for file uploads" });
      }
    } else {
      const hasJsonContent = contentType.includes("application/json");
      if (!hasJsonContent) {
        return res.status(403).json({ message: "CSRF check failed: Content-Type must be application/json" });
      }
    }
  }
  next();
});

// Health check endpoint (no auth required — used for uptime monitoring)
app.get("/api/health", async (_req, res) => {
  const health: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version || "unknown",
  };

  // Check database connectivity
  const pool = getPool();
  if (pool) {
    try {
      const dbStart = Date.now();
      await pool.query("SELECT 1");
      health.database = "connected";
      health.db_latency_ms = Date.now() - dbStart;
    } catch {
      health.database = "error";
      health.status = "degraded";
    }
  } else {
    health.database = "not_configured";
  }

  // Process memory snapshot
  const mem = process.memoryUsage();
  health.memory = {
    rss_mb: Math.round(mem.rss / 1048576),
    heap_used_mb: Math.round(mem.heapUsed / 1048576),
  };

  // HIPAA: Surface audit log queue health
  const { getDroppedAuditEntryCount, getPendingAuditEntryCount } = await import("./services/audit-log");
  const droppedAudit = getDroppedAuditEntryCount();
  const pendingAudit = getPendingAuditEntryCount();
  if (droppedAudit > 0 || pendingAudit > 0) {
    health.audit_log = { pending: pendingAudit, dropped: droppedAudit };
    if (droppedAudit > 0) health.status = "degraded";
  }

  res.json(health);
});

// HIPAA: Rate limiting on login endpoint (5 attempts per 15 minutes per IP)
app.post("/api/auth/login", rateLimit(15 * 60 * 1000, 5));

// Rate limiting on expensive endpoints (prevent abuse)
const expensiveRateLimit = rateLimit(60 * 1000, 10); // 10 per minute
app.post("/api/calls/upload", expensiveRateLimit);
app.post("/api/ab-tests/upload", expensiveRateLimit);
app.get("/api/search", rateLimit(60 * 1000, 20)); // 20 searches per minute
app.post("/api/reports/agent-summary/:employeeId", rateLimit(60 * 1000, 5)); // 5 AI summaries per minute
app.post("/api/access-requests", rateLimit(15 * 60 * 1000, 3)); // 3 access requests per 15 min

// Rate limiting on mutation routes (prevent spam)
const mutationRateLimit = rateLimit(60 * 1000, 15); // 15 per minute
app.post("/api/employees", mutationRateLimit);
app.patch("/api/employees/:id", mutationRateLimit);
app.post("/api/coaching", mutationRateLimit);
app.patch("/api/coaching/:id", mutationRateLimit);
app.post("/api/employees/import-csv", rateLimit(60 * 1000, 3)); // 3 CSV imports per minute

// HIPAA: Rate limiting on read endpoints (prevent bulk data exfiltration)
const readRateLimit = rateLimit(60 * 1000, 60); // 60 per minute
app.get("/api/calls", readRateLimit);
app.get("/api/calls/:id", readRateLimit);
app.get("/api/calls/:id/transcript", readRateLimit);
app.get("/api/calls/:id/audio", readRateLimit);
app.get("/api/calls/:id/analysis", readRateLimit);
app.get("/api/export/calls", rateLimit(60 * 1000, 5)); // 5 exports per minute
app.get("/api/export/team-analytics", rateLimit(60 * 1000, 5));

(async () => {
  // Startup validation: warn about missing critical configuration
  const isProduction = process.env.NODE_ENV === "production";
  if (!process.env.SESSION_SECRET) {
    console.error("[STARTUP] SESSION_SECRET is not set — sessions will use an insecure default.");
    if (isProduction) throw new Error("SESSION_SECRET is required in production");
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    console.warn("[STARTUP] ASSEMBLYAI_API_KEY is not set — transcription will be unavailable.");
  }
  if (isProduction && !process.env.DATABASE_URL) {
    console.warn("[STARTUP] DATABASE_URL is not set in production — using in-memory storage (data will be lost on restart).");
  }
  if (isProduction && process.env.APP_BASE_URL && !process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
    console.error("[STARTUP] APP_BASE_URL is set but ASSEMBLYAI_WEBHOOK_SECRET is missing — webhooks will be rejected.");
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn("[STARTUP] AWS credentials not set — Bedrock AI analysis and S3 storage will be unavailable.");
  }

  // Initialize database schema if PostgreSQL is configured
  await initializeDatabase();

  // Authentication (must come before routes) - async to hash env var passwords on startup
  await setupAuth(app);

  // Per-user rate limiting (applied AFTER auth so req.user is available)
  // General: 120 req/min for all authenticated API access
  app.use("/api", userRateLimit(120, 60_000));
  // Stricter: 10 req/min on export endpoints (prevent bulk data exfiltration)
  app.use("/api/export", userRateLimit(10, 60_000));

  const server = await registerRoutes(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Error handler MUST be the last middleware — after routes AND static serving
  // so it catches errors from all sources (API routes, Vite middleware, etc.)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    if (status >= 500) {
      logger.error("unhandled_error", { status, message });
      metrics.increment("http_errors_total", 1, { status: String(status) });
      sentryCaptureException(err instanceof Error ? err : new Error(message), {
        status,
        path: _req.path,
        method: _req.method,
      });
    }
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // WebSocket: real-time call processing notifications
    setupWebSocket(server);

    // SECURITY: Start automated vulnerability scanning (runs daily, first scan after 60s)
    startScheduledScans();

    // HIPAA: Data retention — purge calls older than configured days
    // Default 90 days, configurable via RETENTION_DAYS env var
    const retentionDays = parseInt(process.env.RETENTION_DAYS || "90", 10);
    const runRetention = async () => {
      try {
        const purged = await storage.purgeExpiredCalls(retentionDays);
        if (purged > 0) {
          log(`[RETENTION] Purged ${purged} call(s) older than ${retentionDays} days`);
        }
      } catch (error) {
        console.error("[RETENTION] Error during purge:", error);
      }
    };

    // Run once on startup (after 30s delay to let GCS auth settle)
    setTimeout(runRetention, 30_000);
    // Then run daily (every 24 hours)
    setInterval(runRetention, 24 * 60 * 60 * 1000);

    // HIPAA: Flush audit log queue on graceful shutdown (pm2 sends SIGINT)
    const gracefulShutdown = async (signal: string) => {
      log(`${signal} received — flushing audit log queue...`);
      try {
        await flushAuditQueue();
        log("Audit log queue flushed successfully.");
      } catch (err) {
        console.error("[HIPAA_AUDIT] Failed to flush audit queue on shutdown:", (err as Error).message);
      }
      process.exit(0);
    };
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  });
})();
