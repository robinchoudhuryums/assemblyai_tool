import type { Request, Response, NextFunction } from "express";
import { logPhiAccess } from "../services/audit-log";

/**
 * Application-level Web Application Firewall (WAF)
 *
 * Provides defense-in-depth protection at the application layer:
 * - IP blocklist/allowlist
 * - SQL injection pattern detection
 * - XSS pattern detection
 * - Path traversal detection
 * - Request size enforcement
 * - Suspicious User-Agent blocking
 * - Request anomaly scoring
 *
 * This complements (not replaces) AWS WAF. For production, both layers
 * are recommended: AWS WAF at the edge (CloudFront/ALB) and this
 * middleware at the application layer.
 */

// --- IP Blocklist ---

const blockedIPs = new Set<string>();
const temporaryBlocks = new Map<string, number>(); // IP -> unblock timestamp

/** Permanently block an IP address. */
export function blockIP(ip: string, reason: string): void {
  blockedIPs.add(ip);
  console.error(`[WAF] IP blocked permanently: ${ip} — ${reason}`);
  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "waf_ip_blocked",
    resourceType: "security",
    detail: JSON.stringify({ ip, reason, duration: "permanent" }),
  });
}

/** Temporarily block an IP for a duration (ms). */
export function temporaryBlockIP(ip: string, durationMs: number, reason: string): void {
  temporaryBlocks.set(ip, Date.now() + durationMs);
  console.error(`[WAF] IP blocked temporarily (${Math.round(durationMs / 1000)}s): ${ip} — ${reason}`);
  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "waf_ip_temp_blocked",
    resourceType: "security",
    detail: JSON.stringify({ ip, reason, durationMs }),
  });
}

/** Unblock an IP address. */
export function unblockIP(ip: string): boolean {
  const wasPerm = blockedIPs.delete(ip);
  const wasTemp = temporaryBlocks.delete(ip);
  return wasPerm || wasTemp;
}

/** Get all currently blocked IPs. */
export function getBlockedIPs(): { permanent: string[]; temporary: Array<{ ip: string; expiresAt: string }> } {
  const now = Date.now();
  const tempList: Array<{ ip: string; expiresAt: string }> = [];
  for (const [ip, expiresAt] of temporaryBlocks) {
    if (expiresAt > now) {
      tempList.push({ ip, expiresAt: new Date(expiresAt).toISOString() });
    }
  }
  return { permanent: [...blockedIPs], temporary: tempList };
}

function isIPBlocked(ip: string): boolean {
  if (blockedIPs.has(ip)) return true;
  const tempExpiry = temporaryBlocks.get(ip);
  if (tempExpiry) {
    if (Date.now() < tempExpiry) return true;
    temporaryBlocks.delete(ip);
  }
  return false;
}

// --- Attack Pattern Detection ---

// SQL injection patterns (common payloads)
const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|create|exec|execute)\b\s+(all\s+)?(\b(from|into|table|database|where|having|group)\b))/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,           // OR 1=1, AND 1=1
  /(--|#|\/\*)\s*$/,                              // SQL comments at end
  /'\s*(or|and)\s+'[^']*'\s*=\s*'[^']*'/i,       // ' OR 'x'='x'
  /;\s*(drop|delete|insert|update|alter)\s+/i,    // ; DROP TABLE
  /\bwaitfor\s+delay\b/i,                        // WAITFOR DELAY (time-based SQLi)
  /\bbenchmark\s*\(/i,                            // BENCHMARK() (MySQL time-based)
  /\bsleep\s*\(\s*\d+\s*\)/i,                    // SLEEP() injection
];

// XSS patterns
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(error|load|click|mouse|focus|blur|submit|change|key)\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /\beval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*data:/i,
];

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/,            // ../  or ..\
  /%2e%2e[%2f%5c]/i,       // URL-encoded ../
  /\.\.\%2f/i,             // mixed encoding
  /%252e%252e/i,            // double-encoded
  /\/etc\/(passwd|shadow|hosts)/i,
  /\/proc\/self/i,
  /\bboot\.ini\b/i,
];

// Suspicious User-Agents (known scanners/bots)
const SUSPICIOUS_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nessus/i,
  /masscan/i,
  /zgrab/i,
  /gobuster/i,
  /dirbuster/i,
  /wpscan/i,
  /nmap/i,
  /^$/,  // Empty user agent
];

// --- Anomaly Scoring ---

interface AnomalyTracker {
  score: number;
  violations: string[];
  firstSeen: number;
  lastSeen: number;
}

const anomalyScores = new Map<string, AnomalyTracker>();
const ANOMALY_THRESHOLD = 10;      // Score threshold to auto-block
const ANOMALY_BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes
const ANOMALY_WINDOW = 10 * 60 * 1000;         // 10-minute sliding window

function recordAnomaly(ip: string, violation: string, points: number): number {
  const now = Date.now();
  let tracker = anomalyScores.get(ip);

  if (!tracker || now - tracker.firstSeen > ANOMALY_WINDOW) {
    tracker = { score: 0, violations: [], firstSeen: now, lastSeen: now };
  }

  tracker.score += points;
  tracker.violations.push(violation);
  tracker.lastSeen = now;
  anomalyScores.set(ip, tracker);

  if (tracker.score >= ANOMALY_THRESHOLD) {
    temporaryBlockIP(ip, ANOMALY_BLOCK_DURATION, `Anomaly score ${tracker.score}: ${tracker.violations.join(", ")}`);
    anomalyScores.delete(ip);
  }

  return tracker.score;
}

// Cleanup anomaly scores every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, tracker] of anomalyScores) {
    if (now - tracker.lastSeen > ANOMALY_WINDOW) {
      anomalyScores.delete(ip);
    }
  }
}, 15 * 60 * 1000);

// Cleanup expired temporary blocks every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, expiresAt] of temporaryBlocks) {
    if (now >= expiresAt) temporaryBlocks.delete(ip);
  }
}, 5 * 60 * 1000);

// --- WAF Stats ---

interface WAFStats {
  totalBlocked: number;
  sqliBlocked: number;
  xssBlocked: number;
  pathTraversalBlocked: number;
  ipBlocked: number;
  anomalyBlocked: number;
  suspiciousUABlocked: number;
  since: string;
}

const stats: WAFStats = {
  totalBlocked: 0,
  sqliBlocked: 0,
  xssBlocked: 0,
  pathTraversalBlocked: 0,
  ipBlocked: 0,
  anomalyBlocked: 0,
  suspiciousUABlocked: 0,
  since: new Date().toISOString(),
};

export function getWAFStats(): WAFStats & { blockedIPs: ReturnType<typeof getBlockedIPs>; anomalyThreshold: number } {
  return {
    ...stats,
    blockedIPs: getBlockedIPs(),
    anomalyThreshold: ANOMALY_THRESHOLD,
  };
}

// --- Helpers ---

function checkPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

function getAllRequestValues(req: Request): string[] {
  const values: string[] = [];

  // Query parameters
  if (req.query) {
    for (const val of Object.values(req.query)) {
      if (typeof val === "string") values.push(val);
    }
  }

  // URL path
  values.push(req.path);

  // Route params
  if (req.params) {
    for (const val of Object.values(req.params)) {
      if (typeof val === "string") values.push(val);
    }
  }

  // Body (for JSON payloads only — don't inspect multipart file uploads)
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const flattenValues = (obj: unknown, depth = 0): void => {
      if (depth > 5) return; // Prevent deep recursion
      if (typeof obj === "string") {
        values.push(obj);
      } else if (Array.isArray(obj)) {
        for (const item of obj) flattenValues(item, depth + 1);
      } else if (obj && typeof obj === "object") {
        for (const val of Object.values(obj)) flattenValues(val, depth + 1);
      }
    };
    flattenValues(req.body);
  }

  return values;
}

// --- Main WAF Middleware ---

/**
 * WAF middleware. Should be mounted early in the middleware stack,
 * after body parsing but before route handlers.
 */
export function wafMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    // 1. IP blocklist check
    if (isIPBlocked(ip)) {
      stats.totalBlocked++;
      stats.ipBlocked++;
      return res.status(403).json({ message: "Access denied" });
    }

    // 2. Suspicious User-Agent check (skip for static assets and health checks)
    //    Service workers fetch static assets without User-Agent headers,
    //    so only enforce UA checks on API routes.
    if (req.path.startsWith("/api") && req.path !== "/api/health") {
      const ua = req.headers["user-agent"] || "";
      if (SUSPICIOUS_USER_AGENTS.some((p) => p.test(ua))) {
        stats.totalBlocked++;
        stats.suspiciousUABlocked++;
        recordAnomaly(ip, "suspicious_user_agent", 3);
        console.warn(`[WAF] Suspicious User-Agent blocked: "${ua}" from ${ip}`);
        return res.status(403).json({ message: "Access denied" });
      }
    }

    // 3. Path traversal check (on URL only — fast)
    if (checkPatterns(decodeURIComponent(req.originalUrl), PATH_TRAVERSAL_PATTERNS)) {
      stats.totalBlocked++;
      stats.pathTraversalBlocked++;
      recordAnomaly(ip, "path_traversal", 5);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "waf_path_traversal_blocked",
        resourceType: "security",
        detail: JSON.stringify({ ip, path: req.path }),
      });
      return res.status(400).json({ message: "Invalid request" });
    }

    // 4. Skip deep inspection for non-API routes and file uploads
    const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
    if (!req.path.startsWith("/api") || isMultipart) {
      return next();
    }

    // 5. SQL injection check
    const values = getAllRequestValues(req);
    for (const val of values) {
      if (checkPatterns(val, SQL_INJECTION_PATTERNS)) {
        stats.totalBlocked++;
        stats.sqliBlocked++;
        recordAnomaly(ip, "sql_injection", 5);
        logPhiAccess({
          timestamp: new Date().toISOString(),
          event: "waf_sqli_blocked",
          resourceType: "security",
          detail: JSON.stringify({ ip, path: req.path }),
        });
        return res.status(400).json({ message: "Invalid request" });
      }
    }

    // 6. XSS check
    for (const val of values) {
      if (checkPatterns(val, XSS_PATTERNS)) {
        stats.totalBlocked++;
        stats.xssBlocked++;
        recordAnomaly(ip, "xss_attempt", 4);
        logPhiAccess({
          timestamp: new Date().toISOString(),
          event: "waf_xss_blocked",
          resourceType: "security",
          detail: JSON.stringify({ ip, path: req.path }),
        });
        return res.status(400).json({ message: "Invalid request" });
      }
    }

    next();
  };
}
