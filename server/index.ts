import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { setupWebSocket } from "./services/websocket";
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
if (process.env.NODE_ENV === "production") {
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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// HIPAA: Security headers including Content-Security-Policy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP: restrict resource loading to same-origin and trusted CDNs
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none';"
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

// HIPAA: Rate limiting on login endpoint (5 attempts per 15 minutes per IP)
app.post("/api/auth/login", rateLimit(15 * 60 * 1000, 5));

(async () => {
  // Authentication (must come before routes) - async to hash env var passwords on startup
  await setupAuth(app);

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
