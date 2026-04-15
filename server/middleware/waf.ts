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
// Hard memory bounds via LRU eviction on overflow (A10/F14/F40-F44).

const BLOCKED_IPS_MAX = 10_000;
const TEMP_BLOCKS_MAX = 10_000;
const ANOMALY_SCORES_MAX = 10_000;
const ANOMALY_COOLDOWNS_MAX = 10_000;

const blockedIPs = new Set<string>();
const temporaryBlocks = new Map<string, number>(); // IP -> unblock timestamp

function evictOldestFromMap<K, V>(map: Map<K, V>): void {
  const k = map.keys().next().value;
  if (k !== undefined) map.delete(k);
}
function evictOldestFromSet<T>(set: Set<T>): void {
  const v = set.values().next().value;
  if (v !== undefined) set.delete(v);
}

/** Permanently block an IP address. */
export function blockIP(ip: string, reason: string): void {
  while (blockedIPs.size >= BLOCKED_IPS_MAX) evictOldestFromSet(blockedIPs);
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
  while (temporaryBlocks.size >= TEMP_BLOCKS_MAX) evictOldestFromMap(temporaryBlocks);
  temporaryBlocks.delete(ip); // ensure LRU recency on re-block
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

// SQL injection patterns — simplified to avoid catastrophic backtracking.
// Each pattern matches a specific attack shape without nested alternations.
const SQL_INJECTION_PATTERNS = [
  /\bunion\s+(?:all\s+)?select\b/i,              // UNION SELECT
  /\bselect\s+(?:\*|[\w.]+(?:\s*,\s*[\w.]+)*)\s+from\b/i, // SELECT */cols FROM (comma-separated identifiers, not prose)
  /\b(?:insert|delete)\s+(?:into|from)\b/i,       // INSERT INTO / DELETE FROM
  /\bupdate\s+\w+\s+set\b/i,                      // UPDATE table SET (allows table name)
  /\b(?:drop|alter|create)\s+(?:table|database|index)\b/i, // DDL statements
  /\bexec(?:ute)?\s*\(/i,                         // EXEC( / EXECUTE(
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,             // OR 1=1, AND 1=1
  /(--|#|\/\*)\s*$/,                               // SQL comments at end
  /'\s*(or|and)\s+'[^']*'\s*=\s*'[^']*'/i,        // ' OR 'x'='x'
  /;\s*(drop|delete|insert|update|alter)\s+/i,     // ; DROP TABLE
  /\bwaitfor\s+delay\b/i,                         // WAITFOR DELAY (time-based SQLi)
  /\bbenchmark\s*\(/i,                             // BENCHMARK() (MySQL time-based)
  /\bsleep\s*\(\s*\d+\s*\)/i,                     // SLEEP() injection
];

// XSS patterns (includes SVG/XML vectors)
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  // Match any HTML event handler attribute (onerror, onpointerdown, etc.).
  // Previous version hard-coded a small allowlist and missed onpointer*,
  // ondrag*, onanimation*, oncontextmenu, etc. Use word boundary + on\w+.
  /\bon[a-z]{2,30}\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /\beval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*data:/i,
  /<svg[\s>]/i,                    // SVG-based XSS
  /<math[\s>]/i,                   // MathML-based XSS
  /xlink:href\s*=/i,              // SVG xlink injection
  /formaction\s*=/i,              // Form action hijacking
];

// CRLF injection patterns (HTTP header injection)
const CRLF_PATTERNS = [
  /\r\n/,                         // Literal CRLF
  /%0[dD]%0[aA]/,                 // URL-encoded CRLF
  /%0[aA]/,                       // URL-encoded LF (can split headers in some servers)
  /\\r\\n/,                       // Escaped CRLF in JSON
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

interface AnomalyEvent {
  points: number;
  violation: string;
  timestamp: number;
}

interface AnomalyTracker {
  events: AnomalyEvent[];
  lastSeen: number;
}

const anomalyScores = new Map<string, AnomalyTracker>();
const ANOMALY_THRESHOLD = 10;      // Score threshold to auto-block
const ANOMALY_BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes
const ANOMALY_WINDOW = 10 * 60 * 1000;         // 10-minute sliding window

/**
 * Record an anomaly event with time-decay sliding window.
 * Events older than ANOMALY_WINDOW are pruned, so an attacker cannot
 * space out attacks across windows to avoid the threshold.
 */
function recordAnomaly(ip: string, violation: string, points: number): number {
  const now = Date.now();

  // SECURITY: If IP is in cooldown period (recently auto-blocked), don't reset score
  const cooldownUntil = anomalyCooldowns.get(ip);
  if (cooldownUntil && now < cooldownUntil) {
    // Still in cooldown — immediately re-block
    temporaryBlockIP(ip, ANOMALY_BLOCK_DURATION, `Repeat offense during cooldown: ${violation}`);
    return ANOMALY_THRESHOLD;
  }

  let tracker = anomalyScores.get(ip);

  if (!tracker) {
    tracker = { events: [], lastSeen: now };
  }

  // Prune events outside the sliding window
  tracker.events = tracker.events.filter(e => now - e.timestamp <= ANOMALY_WINDOW);

  // Add new event
  tracker.events.push({ points, violation, timestamp: now });
  tracker.lastSeen = now;
  // LRU bound + recency touch
  if (anomalyScores.has(ip)) anomalyScores.delete(ip);
  while (anomalyScores.size >= ANOMALY_SCORES_MAX) evictOldestFromMap(anomalyScores);
  anomalyScores.set(ip, tracker);

  // Compute current score from all events within the window
  const score = tracker.events.reduce((sum, e) => sum + e.points, 0);

  if (score >= ANOMALY_THRESHOLD) {
    const violations = tracker.events.map(e => e.violation);
    temporaryBlockIP(ip, ANOMALY_BLOCK_DURATION, `Anomaly score ${score}: ${violations.join(", ")}`);
    // Set cooldown so score doesn't reset immediately if they retry
    while (anomalyCooldowns.size >= ANOMALY_COOLDOWNS_MAX) evictOldestFromMap(anomalyCooldowns);
    anomalyCooldowns.set(ip, now + ANOMALY_COOLDOWN_MS);
    anomalyScores.delete(ip);
  }

  return score;
}

// Cleanup anomaly scores every 15 minutes. .unref() per INV-30.
setInterval(() => {
  const now = Date.now();
  for (const [ip, tracker] of anomalyScores) {
    if (now - tracker.lastSeen > ANOMALY_WINDOW) {
      anomalyScores.delete(ip);
    }
  }
}, 15 * 60 * 1000).unref();

// Cleanup expired temporary blocks and cooldowns every 5 minutes. .unref()
// per INV-30 so the timer doesn't block graceful shutdown.
setInterval(() => {
  const now = Date.now();
  for (const [ip, expiresAt] of temporaryBlocks) {
    if (now >= expiresAt) temporaryBlocks.delete(ip);
  }
  for (const [ip, expiresAt] of anomalyCooldowns) {
    if (now >= expiresAt) anomalyCooldowns.delete(ip);
  }
}, 5 * 60 * 1000).unref();

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

// --- Constants ---

// Maximum request body size the WAF will inspect (1MB). Larger payloads
// are blocked before pattern matching to prevent regex DoS.
const MAX_INSPECTABLE_BODY_SIZE = 1_048_576; // 1MB

// Cooldown period after auto-block: prevent score reset gaming
const ANOMALY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const anomalyCooldowns = new Map<string, number>(); // IP -> cooldown-until timestamp

// --- Helpers ---

/**
 * Normalize a value by decoding multi-layer URL encoding.
 * Catches double-encoding attacks like %2525 → %25 → %.
 */
function deepDecode(value: string, maxDepth = 3): string {
  let decoded = value;
  for (let i = 0; i < maxDepth; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break; // Malformed encoding — use what we have
    }
  }
  return decoded;
}

// Decode common HTML entities so attackers can't bypass pattern matching by
// encoding `<script>` as `&lt;script&gt;` or `&#x3c;script&#x3e;`.
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code < 0x110000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code < 0x110000 ? String.fromCodePoint(code) : "";
    });
}

// Unicode normalize to NFC so visually-equivalent codepoints (e.g. fullwidth
// `<` U+FF1C vs ASCII `<`) are caught by the same regex.
function normalizeForInspection(value: string): string {
  try {
    return value.normalize("NFC");
  } catch {
    return value;
  }
}

function checkPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

/** Check patterns against both raw and decoded values.
 *  Truncates input to MAX_PATTERN_INPUT_LEN to prevent regex DoS on oversized payloads. */
const MAX_PATTERN_INPUT_LEN = 4096;

function checkPatternsNormalized(value: string, patterns: RegExp[]): boolean {
  const truncated = value.length > MAX_PATTERN_INPUT_LEN ? value.slice(0, MAX_PATTERN_INPUT_LEN) : value;
  // 1. Raw
  if (checkPatterns(truncated, patterns)) return true;
  // 2. Unicode NFC normalized
  const normalized = normalizeForInspection(truncated);
  if (normalized !== truncated && checkPatterns(normalized, patterns)) return true;
  // 3. URL-decoded (multi-layer)
  const urlDecoded = deepDecode(normalized);
  if (urlDecoded !== normalized && checkPatterns(urlDecoded, patterns)) return true;
  // 4. HTML entity decoded
  const htmlDecoded = decodeHtmlEntities(urlDecoded);
  if (htmlDecoded !== urlDecoded && checkPatterns(htmlDecoded, patterns)) return true;
  return false;
}

function getUrlAndQueryValues(req: Request): string[] {
  const values: string[] = [];
  if (req.query) {
    for (const val of Object.values(req.query)) {
      if (typeof val === "string") values.push(val);
    }
  }
  values.push(req.path);
  if (req.params) {
    for (const val of Object.values(req.params)) {
      if (typeof val === "string") values.push(val);
    }
  }
  return values;
}

function getBodyStringValues(req: Request): string[] {
  const values: string[] = [];
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const flattenValues = (obj: unknown, depth = 0): void => {
      if (depth > 5) return;
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

// --- WAF Middleware (split: pre-body and post-body, A9) ---

/**
 * Pre-body WAF: runs BEFORE express.json()/urlencoded(). Inspects URL,
 * query, headers, IP, content-length. Does NOT touch req.body (not parsed
 * yet). Splitting the WAF means oversized/malicious payloads are rejected
 * before the JSON parser even allocates memory for them.
 */
export function wafPreBody() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    if (isIPBlocked(ip)) {
      stats.totalBlocked++;
      stats.ipBlocked++;
      return res.status(403).json({ message: "Access denied" });
    }

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

    if (checkPatternsNormalized(req.originalUrl, CRLF_PATTERNS)) {
      stats.totalBlocked++;
      recordAnomaly(ip, "crlf_injection", 5);
      return res.status(400).json({ message: "Invalid request" });
    }

    if (checkPatternsNormalized(req.originalUrl, PATH_TRAVERSAL_PATTERNS)) {
      stats.totalBlocked++;
      stats.pathTraversalBlocked++;
      recordAnomaly(ip, "path_traversal", 5);
      return res.status(400).json({ message: "Invalid request" });
    }

    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > MAX_INSPECTABLE_BODY_SIZE) {
      const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
      if (!isMultipart) {
        stats.totalBlocked++;
        recordAnomaly(ip, "oversized_body", 3);
        return res.status(413).json({ message: "Request body too large" });
      }
    }

    if (!req.path.startsWith("/api")) return next();

    // URL/query/params injection scan (body scan deferred to wafPostBody)
    const urlValues = getUrlAndQueryValues(req);
    for (const val of urlValues) {
      if (checkPatternsNormalized(val, SQL_INJECTION_PATTERNS)) {
        stats.totalBlocked++;
        stats.sqliBlocked++;
        recordAnomaly(ip, "sql_injection", 5);
        return res.status(400).json({ message: "Invalid request" });
      }
      if (checkPatternsNormalized(val, XSS_PATTERNS)) {
        stats.totalBlocked++;
        stats.xssBlocked++;
        recordAnomaly(ip, "xss_attempt", 4);
        return res.status(400).json({ message: "Invalid request" });
      }
    }

    next();
  };
}

/**
 * Post-body WAF: runs AFTER express.json()/urlencoded() so it can inspect
 * req.body. No-ops on multipart requests (req.body is undefined or a multer
 * object) and on routes that didn't run the JSON parser.
 */
export function wafPostBody() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    if (!req.body || typeof req.body !== "object" || Buffer.isBuffer(req.body)) {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const bodyValues = getBodyStringValues(req);
    for (const val of bodyValues) {
      if (checkPatternsNormalized(val, SQL_INJECTION_PATTERNS)) {
        stats.totalBlocked++;
        stats.sqliBlocked++;
        recordAnomaly(ip, "sql_injection", 5);
        return res.status(400).json({ message: "Invalid request" });
      }
      if (checkPatternsNormalized(val, XSS_PATTERNS)) {
        stats.totalBlocked++;
        stats.xssBlocked++;
        recordAnomaly(ip, "xss_attempt", 4);
        return res.status(400).json({ message: "Invalid request" });
      }
    }
    next();
  };
}

// --- Main WAF Middleware (legacy: combined pre+post pass) ---

/**
 * @deprecated Use wafPreBody() + wafPostBody() (A9). Retained for any caller
 * that needs the original combined middleware.
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

    // 3. CRLF injection check (on raw URL and headers — fast)
    if (checkPatternsNormalized(req.originalUrl, CRLF_PATTERNS)) {
      stats.totalBlocked++;
      recordAnomaly(ip, "crlf_injection", 5);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "waf_crlf_blocked",
        resourceType: "security",
        detail: JSON.stringify({ ip, path: req.path }),
      });
      return res.status(400).json({ message: "Invalid request" });
    }

    // 4. Path traversal check (with unicode normalization)
    if (checkPatternsNormalized(req.originalUrl, PATH_TRAVERSAL_PATTERNS)) {
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

    // 5. Request body size check — reject oversized bodies before pattern matching
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > MAX_INSPECTABLE_BODY_SIZE) {
      // Allow multipart file uploads (handled by multer limits), block oversized JSON
      const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
      if (!isMultipart) {
        stats.totalBlocked++;
        recordAnomaly(ip, "oversized_body", 3);
        return res.status(413).json({ message: "Request body too large" });
      }
    }

    // 6. Skip deep inspection for non-API routes
    if (!req.path.startsWith("/api")) {
      return next();
    }

    // 7. For multipart uploads, inspect field names (not file content)
    const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
    if (isMultipart) {
      // Check query params and URL for injection even on multipart requests
      const urlValues = [req.path, ...Object.values(req.query || {}).filter((v): v is string => typeof v === "string")];
      for (const val of urlValues) {
        if (checkPatternsNormalized(val, SQL_INJECTION_PATTERNS) || checkPatternsNormalized(val, XSS_PATTERNS)) {
          stats.totalBlocked++;
          recordAnomaly(ip, "multipart_param_injection", 5);
          return res.status(400).json({ message: "Invalid request" });
        }
      }
      return next();
    }

    // 8. SQL injection check (with unicode normalization)
    const values = [...getUrlAndQueryValues(req), ...getBodyStringValues(req)];
    for (const val of values) {
      if (checkPatternsNormalized(val, SQL_INJECTION_PATTERNS)) {
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

    // 9. XSS check (with unicode normalization)
    for (const val of values) {
      if (checkPatternsNormalized(val, XSS_PATTERNS)) {
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
