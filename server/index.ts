import "dotenv/config";

// E2E mock server — activated only when `E2E_MOCKS=true` is set. Intercepts
// outbound fetch to AssemblyAI / Bedrock / S3 so Playwright tests can drive
// the full audio pipeline without live external services. Zero production
// effect: the import is gated behind the env flag and the whole module is
// tree-shaken / never loaded in normal runs.
if (process.env.E2E_MOCKS === "true") {
  // Dynamic import so the msw/node dependency tree isn't loaded in prod.
  const { startMockServer } = await import("./test-mocks/setup");
  startMockServer();
}

// OpenTelemetry must be initialized before any other imports so auto-instrumentation
// hooks are registered before Express, HTTP, and AWS SDK modules load.
import "./services/tracing";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { setupWebSocket } from "./services/websocket";
import { getPool, initializeDatabase } from "./db/pool";
import { userRateLimit } from "./middleware/rate-limit";
import { wafPreBody, wafPostBody } from "./middleware/waf";
import { globalErrorHandler } from "./middleware/error-handler";
import { startScheduledScans } from "./services/vulnerability-scanner";
import { captureException as sentryCaptureException } from "./services/sentry";
import crypto from "crypto";
import { logger, metrics } from "./services/logger";
import { runWithCorrelationId } from "./services/correlation-id";
import { flushAuditQueue, persistIntegrityChainHead, startIntegrityPersistScheduler, stopIntegrityPersistScheduler } from "./services/audit-log";
import { initWebhooks } from "./services/webhooks";

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
// Clean up expired rate limit entries every 5 minutes. .unref() so this
// background tick doesn't keep the event loop alive past graceful shutdown
// (INV-30).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000).unref();

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
    // Validate each IP in the chain is a plausible IP address (IPv4 or IPv6).
    // IPv4: four dot-separated octets, each 0-255. The prior regex `\d{1,3}`
    // accepted impossible values like 999.999.999.999 which would pass through
    // and pollute rate-limit keys, audit log IP fields, and WAF IP tracking.
    // Octet alternation: 250-255 | 200-249 | 100-199 | 10-99 | 0-9.
    const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)";
    const ipv4 = new RegExp(`^(?:${ipv4Octet}\\.){3}${ipv4Octet}$`);
    const ipv6 = /^[0-9a-fA-F:]{2,45}$/; // coarse IPv6 check (must contain colons, hex digits only)
    const validIPs = forwarded.filter(ip => ip.length <= 45 && (ipv4.test(ip) || (ip.includes(":") && ipv6.test(ip))));
    if (validIPs.length !== forwarded.length) {
      // Sanitize the header to only contain valid IPs
      req.headers["x-forwarded-for"] = validIPs.join(", ");
    }
  }
  next();
});

// Request correlation ID — unique per request, auto-injected into all structured log entries.
// Enables tracing a single request across all log lines in CloudWatch/Datadog/etc.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.use((req, res, next) => {
  // Accept caller-provided request id only if it's a well-formed UUID;
  // otherwise generate a fresh one. Cap raw header at 128 chars defensively.
  const raw = (req.headers["x-request-id"] as string | undefined)?.slice(0, 128);
  const correlationId = raw && UUID_RE.test(raw) ? raw : crypto.randomUUID();
  res.setHeader("X-Request-Id", correlationId);
  runWithCorrelationId(correlationId, () => next());
});

// HIPAA: Enforce HTTPS in production (redirect HTTP → HTTPS)
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https" &&
    !req.hostname?.startsWith("localhost") &&
    !req.hostname?.startsWith("127.0.0.1")
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
    const requestHost = req.hostname || "";
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

// WAF (pre-body): IP blocklist, UA, URL/query/path inspection. Runs BEFORE
// body parsing so oversized/malicious payloads never allocate JSON memory.
app.use(wafPreBody());

// 1MB JSON body limit (F27). Routes that legitimately need more must mount
// their own express.json({limit:...}) per-route.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// WAF (post-body): inspects parsed req.body for SQLi/XSS. No-ops on multipart
// uploads (req.body undefined / multer-handled per route).
app.use(wafPostBody());

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

// HIPAA: Audit logging middleware - logs all API access with user identity but never PHI.
// F-15: also hook `close` to catch aborted/errored requests that never reach `finish`.
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let audited = false;

  const emitAudit = (aborted: boolean) => {
    if (audited) return;
    audited = true;
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
        ...(aborted ? { aborted: true } : {}),
      });

      // Metrics: request count by method and status class
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      metrics.increment("http_requests_total", 1, { method: req.method, status: statusClass });
      metrics.observe("http_request_duration_ms", duration, { method: req.method });
      // F-15: the previous `[AUDIT] ...` pm2-console line was removed. It
      // duplicated the structured `api_request` entry above and — because
      // it routed through `vite.ts:log()` → console.log — bypassed the
      // logger's PHI redaction path. Every bracket-prefixed literal except
      // the canonical `[HIPAA_AUDIT]` stdout line is now gone.
    }
  };

  res.on("finish", () => emitAudit(false));
  res.on("close", () => emitAudit(!res.writableFinished));

  next();
});

// CSRF protection: Double-submit cookie pattern (defense-in-depth).
// On every response, set a random CSRF token cookie. State-changing requests
// must echo the token in the X-CSRF-Token header. Since the cookie uses
// SameSite=Strict, cross-origin attackers cannot read it to include in headers.
// This supplements the existing Content-Type/X-Requested-With checks below.
const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
// Single source of truth for CSRF-exempt paths (used by both the double-submit
// and the legacy Content-Type CSRF checks below).
const CSRF_EXEMPT = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/access-requests",
  "/api/health",
  "/api/webhooks/assemblyai",
];

function isCsrfExempt(reqPath: string): boolean {
  return CSRF_EXEMPT.some(p => reqPath === p || reqPath.startsWith(p + "/"));
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Hash to fixed length so length mismatch isn't observable via early-return.
  const ah = crypto.createHash("sha256").update(ab).digest();
  const bh = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function getCookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const match = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : undefined;
}

app.use((req, res, next) => {
  let csrfToken = getCookieValue(req, CSRF_COOKIE);
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString("hex");
  }
  // SHARED_COOKIE_DOMAIN (e.g. ".umscallanalyzer.com") scopes the CSRF cookie
  // to the parent domain so it rides along with the shared session cookie
  // across subdomains. sameSite:strict still allows same-site cross-subdomain
  // travel because strict is about cross-SITE (registrable domain), not
  // cross-ORIGIN. Unset = exact host (current behavior).
  const sharedCookieDomain = process.env.SHARED_COOKIE_DOMAIN;
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,  // Frontend JS needs to read this
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
    ...(sharedCookieDomain ? { domain: sharedCookieDomain } : {}),
  });

  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method) && req.path.startsWith("/api")) {
    if (!isCsrfExempt(req.path)) {
      const headerToken = req.headers[CSRF_HEADER] as string | undefined;
      if (!headerToken || !timingSafeStringEqual(headerToken, csrfToken)) {
        return res.status(403).json({ message: "CSRF token missing or invalid" });
      }
    }
  }
  next();
});

// CSRF protection (legacy): Require proof that the request originates from our app.
// For JSON requests: Content-Type: application/json (browsers won't send this cross-origin without CORS preflight).
// For multipart uploads: Require a custom X-Requested-With header (same CORS protection mechanism).
// Exempt: login, logout, access-requests (unauthenticated public endpoints).
app.use((req, res, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.path.startsWith("/api")) {
    if (isCsrfExempt(req.path)) return next();

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

// A36/F45: Generic per-IP rate-limit fallback for every /api/* endpoint.
// Higher-cardinality caps on specific routes below still apply; this is a
// catch-all safety net for endpoints without explicit per-user limits.
app.use("/api", rateLimit(60 * 1000, 300));

// HIPAA: Rate limiting on login endpoint (5 attempts per 15 minutes per IP).
// In CI/Playwright runs we bypass — `E2E_MOCKS=true` is the test-only signal
// already used to activate MSW interception (see server/test-mocks/setup.ts),
// and the e2e suite has ~27 specs that each login in beforeEach from a
// single CI runner IP, which exhausts the 5/15min cap after the 5th spec.
// `E2E_MOCKS` is documented as NEVER-set-in-production and gates other
// crash-on-prod behaviors, so trusting it here is consistent. The
// limiter logic itself is unit-tested at tests/auth.test.ts:32-72.
app.post("/api/auth/login", (req, res, next) => {
  if (process.env.E2E_MOCKS === "true") return next();
  return rateLimit(15 * 60 * 1000, 5)(req, res, next);
});

// Rate limiting on expensive endpoints (prevent abuse). The audio upload
// limit is env-tunable because batch upload is a real workflow — manager
// uploads 10–20 call recordings at once is normal usage. Default 30/min
// per IP (was 10/min before, which rejected legitimate batch uploads
// after 10 + cumulative window). Tighten via `UPLOAD_RATE_LIMIT_PER_MIN`
// if abuse becomes a concern.
const UPLOAD_RATE_LIMIT_PER_MIN = (() => {
  const raw = Number(process.env.UPLOAD_RATE_LIMIT_PER_MIN);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
})();
const expensiveRateLimit = rateLimit(60 * 1000, 10); // 10 per minute (kept for non-upload uses)
app.post("/api/calls/upload", rateLimit(60 * 1000, UPLOAD_RATE_LIMIT_PER_MIN));
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
    logger.error("SESSION_SECRET is not set — sessions will use an insecure default");
    if (isProduction) throw new Error("SESSION_SECRET is required in production");
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    logger.warn("ASSEMBLYAI_API_KEY is not set — transcription will be unavailable");
  }
  if (isProduction && !process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL is not set in production — using in-memory storage (data will be lost on restart)");
  }
  if (isProduction && process.env.APP_BASE_URL && !process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
    logger.error("APP_BASE_URL is set but ASSEMBLYAI_WEBHOOK_SECRET is missing — webhooks will be rejected");
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    logger.warn("AWS credentials not set — Bedrock AI analysis and S3 storage will be unavailable");
  }
  // Validate BEDROCK_MODEL against the pricing whitelist so a typo doesn't
  // silently record $0 cost for every analyzed call while AWS still bills.
  if (process.env.BEDROCK_MODEL) {
    try {
      const { isKnownBedrockModel, getKnownBedrockModels } = await import("./routes/utils");
      if (!isKnownBedrockModel(process.env.BEDROCK_MODEL)) {
        logger.warn("BEDROCK_MODEL is not in the pricing table — usage records will show $0", {
          model: process.env.BEDROCK_MODEL,
          knownModels: getKnownBedrockModels().join(", "),
        });
      }
    } catch { /* non-critical — runtime warnOnUnknownBedrockModel is the backstop */ }
  }

  // Initialize database schema if PostgreSQL is configured
  await initializeDatabase();

  // A6: Restore audit-log HMAC chain head from persistent storage so a restart
  // doesn't reset to 'genesis' and break sequential chain verification.
  await (await import("./services/audit-log")).loadAuditIntegrityChain();

  // F-06: Start the periodic chain-head persist scheduler. Bounds the
  // "in-flight vs durable" window between fire-and-forget per-entry writes
  // and the on-disk head, closing the crash-mid-burst chain-drift gap.
  startIntegrityPersistScheduler();

  // A7/F09: explicit startup wiring of webhook service. Previously this ran
  // as a side effect of importing storage.ts; moved here so module load order
  // is no longer load-bearing.
  initWebhooks(() => storage.getObjectStorageClient());

  // A2/F11: Hydrate scoring-feedback corrections from S3 (fire-and-forget; non-critical)
  void import("./services/scoring-feedback")
    .then(m => m.loadPersistedCorrections())
    .catch(err => {
      logger.warn("startup: failed to hydrate scoring-feedback corrections from S3", {
        error: (err as Error).message,
      });
    });

  // Active-model override: if an admin previously promoted a model via
  // POST /api/ab-tests/promote, rehydrate it now so the aiProvider singleton
  // reflects the last promotion decision. Non-critical; the env var
  // BEDROCK_MODEL is the fallback.
  void import("./services/active-model")
    .then(m => m.loadActiveModelOverride())
    .catch(err => {
      logger.warn("startup: failed to hydrate active-model override from S3", {
        error: (err as Error).message,
      });
    });

  // Hydrate pipeline quality-gate settings from S3 so an admin's tuning
  // (via PATCH /api/admin/pipeline-settings) survives restart. Fire-and-
  // forget — the in-memory defaults from env vars remain effective if
  // S3 is unreachable.
  void import("./services/pipeline-settings")
    .then(m => m.loadPipelineSettings())
    .catch(err => {
      logger.warn("startup: failed to hydrate pipeline settings from S3", {
        error: (err as Error).message,
      });
    });

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
  // Logs/metrics/Sentry first, then delegates to globalErrorHandler for the
  // structured response shape (AppError-aware, prod-sanitized, transitional).
  app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, next: NextFunction) => {
    const status = err.statusCode || err.status || 500;
    if (status >= 500) {
      logger.error("unhandled_error", { status, message: err.message });
      metrics.increment("http_errors_total", 1, { status: String(status) });
      sentryCaptureException(err instanceof Error ? err : new Error(String(err)), {
        status,
        path: req.path,
        method: req.method,
      });
    }
    return globalErrorHandler(err, req, res, next);
  });

  // RAG Knowledge Base integration
  if (process.env.RAG_ENABLED === "true") {
    if (!process.env.RAG_SERVICE_URL) {
      logger.warn("RAG_ENABLED is true but RAG_SERVICE_URL is not set — RAG context injection disabled");
    } else if (!process.env.RAG_API_KEY) {
      logger.warn("RAG_ENABLED is true but RAG_API_KEY is not set — RAG context injection disabled");
    } else {
      logger.info("RAG enabled", { serviceUrl: process.env.RAG_SERVICE_URL });
    }
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
          logger.info("retention purged old calls", { purged, retentionDays });
        }
      } catch (error) {
        logger.error("Retention purge error", { error: (error as Error).message });
      }
    };

    // Run once on startup (after 30s delay to let GCS auth settle)
    // A34/F77: unref() so cleanup timers don't keep the event loop alive
    // during shutdown.
    setTimeout(runRetention, 30_000).unref();
    setInterval(runRetention, 24 * 60 * 60 * 1000).unref();

    // HIPAA: Graceful shutdown — A34/F46/F72/F73 coordinate:
    //   1. stop accepting new HTTP connections
    //   2. stop the job queue worker (drains active jobs)
    //   3. stop schedulers (batch, calibration, telephony, reports)
    //   4. flush audit log queue
    //   5. close DB pool
    let shuttingDown = false;
    const gracefulShutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log(`${signal} received — beginning graceful shutdown`);
      // Hard deadline so a hanging drain doesn't strand pm2
      const hardExit = setTimeout(() => {
        logger.error("Hard exit after 30s timeout");
        process.exit(1);
      }, 30_000);
      hardExit.unref();
      try {
        // 1. Stop accepting new connections (server.close waits for active requests)
        server.close();
        // 2. Stop schedulers (batch, calibration, telephony, reports). Each
        //    stop is wrapped independently so one failure doesn't skip the
        //    others. All four have .unref() on their timers as defense in
        //    depth — the explicit stop is still preferred so running async
        //    work completes before the DB pool closes.
        try {
          const mod = await import("./services/batch-scheduler");
          mod.stopBatchScheduler?.();
        } catch (err) {
          logger.error("Failed to stop batch scheduler", { error: (err as Error).message });
        }
        try {
          const mod = await import("./services/auto-calibration");
          mod.stopCalibrationScheduler?.();
        } catch (err) {
          logger.error("Failed to stop calibration scheduler", { error: (err as Error).message });
        }
        try {
          const mod = await import("./services/telephony-8x8");
          mod.stopTelephonyScheduler?.();
        } catch (err) {
          logger.error("Failed to stop telephony scheduler", { error: (err as Error).message });
        }
        try {
          const mod = await import("./services/scheduled-reports");
          mod.stopReportScheduler?.();
        } catch (err) {
          logger.error("Failed to stop report scheduler", { error: (err as Error).message });
        }
        try {
          const mod = await import("./services/transcribing-reaper");
          mod.stopTranscribingReaper?.();
        } catch (err) {
          logger.error("Failed to stop transcribing reaper", { error: (err as Error).message });
        }
        try {
          const mod = await import("./services/agent-decline-alert");
          mod.stopAgentDeclineScheduler?.();
        } catch (err) {
          logger.error("Failed to stop agent-decline scheduler", { error: (err as Error).message });
        }
        // F-06: Stop the periodic audit integrity chain persist scheduler.
        // The final persist happens in step 3a via persistIntegrityChainHead()
        // below, which is awaited. Stopping the timer here prevents a late
        // interval-triggered write from racing the DB pool close.
        try {
          stopIntegrityPersistScheduler();
        } catch (err) {
          logger.error("Failed to stop audit integrity persist scheduler", { error: (err as Error).message });
        }
        // 2b. Stop the durable job queue so in-flight audio pipeline jobs drain
        //     gracefully before the DB pool closes. Bounded by JobQueue.stop()'s
        //     internal 30s drain deadline; the outer hard-exit timer (30s) also
        //     backstops this. Without this step, workers crash mid-pipeline when
        //     the pool closes under them and the reaper burns a retry attempt
        //     2 minutes later.
        try {
          const { getJobQueue } = await import("./routes");
          const jq = getJobQueue();
          if (jq) {
            // 20s gives in-flight audio pipeline jobs more drain time than the
            // prior 15s cap. Scheduler stops preceding this are all synchronous
            // clearInterval calls so they consume ~no budget; the 30s outer
            // hard-exit backstops the worst case.
            await Promise.race([
              jq.stop(),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error("jobQueue.stop timed out after 20s")), 20_000)
              ),
            ]);
            log("Job queue stopped.");
          }
        } catch (err) {
          logger.error("Failed to stop job queue", { error: (err as Error).message });
        }
        // 3a. #6: Persist the HMAC integrity chain head so the next boot picks up
        //     the correct chain position. Must run before flushAuditQueue because
        //     the flush may generate additional audit entries that advance the chain.
        try {
          await persistIntegrityChainHead();
          log("Audit integrity chain head persisted.");
        } catch (err) {
          logger.error("Failed to persist integrity chain head", { error: (err as Error).message });
        }
        // 3b. Flush audit log queue (bounded to 10s — if DB is hung, don't waste
        //     the full 30s hard-exit budget; remaining entries are in stdout via HMAC chain)
        try {
          await Promise.race([
            flushAuditQueue(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("flush timed out after 10s")), 10_000)
            ),
          ]);
          log("Audit log queue flushed.");
        } catch (err) {
          logger.error("Failed to flush audit queue", { error: (err as Error).message });
        }
        // 4. Close DB pool
        try {
          const { closePool } = await import("./db/pool");
          await closePool();
        } catch (err) {
          logger.error("Failed to close DB pool", { error: (err as Error).message });
        }
      } finally {
        clearTimeout(hardExit);
        process.exit(0);
      }
    };
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  });
})();
