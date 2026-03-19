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
import crypto from "crypto";

const app = express();

// HIPAA: Simple rate limiter for sensitive endpoints (login, search)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
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
  rateLimitMap.forEach((entry, key) => {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  });
}, 5 * 60 * 1000);

// Trust reverse proxy (Render, Heroku, etc.) so secure cookies and
// x-forwarded-proto work correctly behind their load balancer.
if (process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE) {
  app.set("trust proxy", 1);
}

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
    // In development, allow cross-origin (Vite proxy)
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  // CSP: restrict resource loading to same-origin and trusted CDNs
  // Note: script-src 'unsafe-inline' is required for the dark-mode flash-prevention script in index.html.
  // Vite also injects inline scripts during development. A nonce-based approach would be more
  // secure but requires server-side HTML templating; acceptable trade-off for now.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss:; frame-ancestors 'none';"
  );
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
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const user = req.user;
      const userId = user ? `${user.username}(${user.role})` : "anonymous";
      const logLine = `[AUDIT] ${new Date().toISOString()} ${userId} ${req.method} ${path} ${res.statusCode} ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

// CSRF protection: Require a custom header on state-changing requests.
// Browsers will not send custom headers on cross-origin requests without CORS preflight,
// so the presence of this header proves the request is same-origin.
app.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.path.startsWith("/api")) {
    // Exempt file uploads (Content-Type is multipart) and login/access-requests (unauthenticated)
    const exempt = ["/api/auth/login", "/api/auth/logout", "/api/access-requests"];
    const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
    if (!exempt.includes(req.path) && !isMultipart) {
      const hasJsonContent = (req.headers["content-type"] || "").includes("application/json");
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
  };

  // Check database connectivity
  const pool = getPool();
  if (pool) {
    try {
      await pool.query("SELECT 1");
      health.database = "connected";
    } catch {
      health.database = "error";
      health.status = "degraded";
    }
  } else {
    health.database = "not_configured";
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    if (status >= 500) {
      console.error(`[ERROR] ${status}: ${message}`);
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

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
  });
})();
