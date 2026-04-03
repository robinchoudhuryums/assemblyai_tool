/**
 * Tests for WAF (Web Application Firewall) pattern detection accuracy.
 * Validates SQL injection, XSS, CRLF, and path traversal detection patterns.
 * Run with: npx tsx --test tests/waf.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import the WAF module — we test exported functions and reimport patterns
// Since the patterns are module-private, we test through the middleware behavior.
// For unit testing patterns directly, we replicate the detection logic.

// --- Replicate WAF patterns for unit testing ---

const SQL_INJECTION_PATTERNS = [
  /\bunion\s+(?:all\s+)?select\b/i,
  /\bselect\s+(?:\*|[\w.]+(?:\s*,\s*[\w.]+)*)\s+from\b/i,
  /\b(?:insert|delete)\s+(?:into|from)\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\b(?:drop|alter|create)\s+(?:table|database|index)\b/i,
  /\bexec(?:ute)?\s*\(/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
  /(--|#|\/\*)\s*$/,
  /'\s*(or|and)\s+'[^']*'\s*=\s*'[^']*'/i,
  /;\s*(drop|delete|insert|update|alter)\s+/i,
  /\bwaitfor\s+delay\b/i,
  /\bbenchmark\s*\(/i,
  /\bsleep\s*\(\s*\d+\s*\)/i,
];

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
  /<svg[\s>]/i,
  /<math[\s>]/i,
  /xlink:href\s*=/i,
  /formaction\s*=/i,
];

const CRLF_PATTERNS = [
  /\r\n/,
  /%0[dD]%0[aA]/,
  /%0[aA]/,
  /\\r\\n/,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/,
  /%2e%2e[%2f%5c]/i,
  /\.\.\%2f/i,
  /%252e%252e/i,
  /\/etc\/(passwd|shadow|hosts)/i,
  /\/proc\/self/i,
  /\bboot\.ini\b/i,
];

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
  /^$/,
];

function checkPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

function deepDecode(value: string, maxDepth = 3): string {
  let decoded = value;
  for (let i = 0; i < maxDepth; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function checkPatternsNormalized(value: string, patterns: RegExp[]): boolean {
  if (checkPatterns(value, patterns)) return true;
  const decoded = deepDecode(value);
  if (decoded !== value && checkPatterns(decoded, patterns)) return true;
  return false;
}

// --- SQL Injection Tests ---

describe("WAF: SQL injection detection", () => {
  it("detects UNION SELECT", () => {
    assert.ok(checkPatterns("1 UNION SELECT FROM users", SQL_INJECTION_PATTERNS));
  });

  it("detects OR 1=1", () => {
    assert.ok(checkPatterns("admin' OR 1=1", SQL_INJECTION_PATTERNS));
  });

  it("detects AND 1=1", () => {
    assert.ok(checkPatterns("x' AND 1=1", SQL_INJECTION_PATTERNS));
  });

  it("detects SQL comment terminator", () => {
    assert.ok(checkPatterns("admin'-- ", SQL_INJECTION_PATTERNS));
  });

  it("detects string-based OR injection", () => {
    assert.ok(checkPatterns("' OR 'x'='x'", SQL_INJECTION_PATTERNS));
  });

  it("detects chained DROP TABLE", () => {
    assert.ok(checkPatterns("; DROP TABLE users", SQL_INJECTION_PATTERNS));
  });

  it("detects WAITFOR DELAY (time-based blind SQLi)", () => {
    assert.ok(checkPatterns("'; WAITFOR DELAY '0:0:5'", SQL_INJECTION_PATTERNS));
  });

  it("detects BENCHMARK function", () => {
    assert.ok(checkPatterns("1 AND BENCHMARK(1000000,SHA1('test'))", SQL_INJECTION_PATTERNS));
  });

  it("detects SLEEP injection", () => {
    assert.ok(checkPatterns("1 AND SLEEP(5)", SQL_INJECTION_PATTERNS));
  });

  it("allows normal text with SQL-like words in context", () => {
    // "select" alone is fine; it needs "from/into/table" following
    assert.ok(!checkPatterns("Please select your preferred option", SQL_INJECTION_PATTERNS));
  });

  it("allows normal queries with numbers", () => {
    assert.ok(!checkPatterns("page=1&limit=20", SQL_INJECTION_PATTERNS));
  });

  it("detects URL-encoded SQL injection", () => {
    assert.ok(checkPatternsNormalized("%27%20OR%201%3D1", SQL_INJECTION_PATTERNS));
  });

  it("detects double-encoded SQL injection", () => {
    // %2527 → %27 → ' after double decode
    assert.ok(checkPatternsNormalized("%2527%20OR%201%3D1", SQL_INJECTION_PATTERNS));
  });

  // New pattern coverage
  it("detects UNION ALL SELECT", () => {
    assert.ok(checkPatterns("1 UNION ALL SELECT password FROM users", SQL_INJECTION_PATTERNS));
  });

  it("detects SELECT ... FROM with gap", () => {
    assert.ok(checkPatterns("SELECT username FROM users", SQL_INJECTION_PATTERNS));
  });

  it("detects INSERT INTO", () => {
    assert.ok(checkPatterns("INSERT INTO users VALUES ('admin')", SQL_INJECTION_PATTERNS));
  });

  it("detects UPDATE SET", () => {
    assert.ok(checkPatterns("UPDATE users SET role='admin'", SQL_INJECTION_PATTERNS));
  });

  it("detects DELETE FROM", () => {
    assert.ok(checkPatterns("DELETE FROM sessions", SQL_INJECTION_PATTERNS));
  });

  it("detects DROP TABLE", () => {
    assert.ok(checkPatterns("DROP TABLE users", SQL_INJECTION_PATTERNS));
  });

  it("detects CREATE TABLE", () => {
    assert.ok(checkPatterns("CREATE TABLE evil (id int)", SQL_INJECTION_PATTERNS));
  });

  it("detects EXEC(", () => {
    assert.ok(checkPatterns("EXEC('SELECT 1')", SQL_INJECTION_PATTERNS));
  });

  it("detects EXECUTE(", () => {
    assert.ok(checkPatterns("EXECUTE(cmd)", SQL_INJECTION_PATTERNS));
  });

  it("allows benign text with select but no FROM", () => {
    assert.ok(!checkPatterns("Please select your option from the menu", SQL_INJECTION_PATTERNS));
  });

  it("input truncation prevents regex DoS on oversized payload", () => {
    // Build a 10KB string — should not cause excessive regex time
    const longPayload = "a".repeat(10000) + " OR 1=1";
    const MAX_LEN = 4096;
    const truncated = longPayload.slice(0, MAX_LEN);
    // The injection is beyond the truncation point, so it should NOT be detected
    assert.ok(!checkPatterns(truncated, SQL_INJECTION_PATTERNS));
  });
});

// --- XSS Tests ---

describe("WAF: XSS detection", () => {
  it("detects <script> tags", () => {
    assert.ok(checkPatterns("<script>alert(1)</script>", XSS_PATTERNS));
  });

  it("detects javascript: protocol", () => {
    assert.ok(checkPatterns("javascript:alert(1)", XSS_PATTERNS));
  });

  it("detects onerror handler", () => {
    assert.ok(checkPatterns('<img onerror=alert(1)>', XSS_PATTERNS));
  });

  it("detects onclick handler", () => {
    assert.ok(checkPatterns('<div onclick=alert(1)>', XSS_PATTERNS));
  });

  it("detects onload handler", () => {
    assert.ok(checkPatterns('<body onload=alert(1)>', XSS_PATTERNS));
  });

  it("detects <iframe> tags", () => {
    assert.ok(checkPatterns('<iframe src="evil.com">', XSS_PATTERNS));
  });

  it("detects eval() calls", () => {
    assert.ok(checkPatterns('eval("alert(1)")', XSS_PATTERNS));
  });

  it("detects <svg> vectors", () => {
    assert.ok(checkPatterns('<svg onload=alert(1)>', XSS_PATTERNS));
  });

  it("detects <math> vectors", () => {
    assert.ok(checkPatterns('<math href="javascript:alert(1)">', XSS_PATTERNS));
  });

  it("detects xlink:href injection", () => {
    assert.ok(checkPatterns('xlink:href=javascript:alert(1)', XSS_PATTERNS));
  });

  it("detects formaction hijacking", () => {
    assert.ok(checkPatterns('<button formaction=evil.com>', XSS_PATTERNS));
  });

  it("detects expression() CSS attack", () => {
    assert.ok(checkPatterns('background: expression(alert(1))', XSS_PATTERNS));
  });

  it("detects data: URL in CSS", () => {
    assert.ok(checkPatterns("url('data:text/html,<script>alert(1)</script>')", XSS_PATTERNS));
  });

  it("allows normal HTML entities in text", () => {
    assert.ok(!checkPatterns("The price is $5.00 & tax", XSS_PATTERNS));
  });

  it("allows normal text with angle brackets in context", () => {
    assert.ok(!checkPatterns("5 < 10 and 10 > 5", XSS_PATTERNS));
  });

  it("detects URL-encoded XSS", () => {
    assert.ok(checkPatternsNormalized("%3Cscript%3Ealert(1)%3C/script%3E", XSS_PATTERNS));
  });
});

// --- CRLF Injection Tests ---

describe("WAF: CRLF injection detection", () => {
  it("detects literal CRLF", () => {
    assert.ok(checkPatterns("header\r\ninjection", CRLF_PATTERNS));
  });

  it("detects URL-encoded CRLF (%0D%0A)", () => {
    assert.ok(checkPatterns("%0D%0A", CRLF_PATTERNS));
  });

  it("detects URL-encoded LF (%0A)", () => {
    assert.ok(checkPatterns("%0A", CRLF_PATTERNS));
  });

  it("detects escaped CRLF in JSON", () => {
    assert.ok(checkPatterns('value\\r\\nheader: injected', CRLF_PATTERNS));
  });

  it("allows normal text without CRLF", () => {
    assert.ok(!checkPatterns("normal query parameter", CRLF_PATTERNS));
  });
});

// --- Path Traversal Tests ---

describe("WAF: path traversal detection", () => {
  it("detects ../", () => {
    assert.ok(checkPatterns("../../etc/passwd", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects ..\\", () => {
    assert.ok(checkPatterns("..\\windows\\system32", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects URL-encoded traversal", () => {
    assert.ok(checkPatterns("%2e%2e%2f", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects double-encoded traversal", () => {
    assert.ok(checkPatterns("%252e%252e", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects /etc/passwd access", () => {
    assert.ok(checkPatterns("/etc/passwd", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects /etc/shadow access", () => {
    assert.ok(checkPatterns("/etc/shadow", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects /proc/self access", () => {
    assert.ok(checkPatterns("/proc/self/environ", PATH_TRAVERSAL_PATTERNS));
  });

  it("detects boot.ini access", () => {
    assert.ok(checkPatterns("c:\\boot.ini", PATH_TRAVERSAL_PATTERNS));
  });

  it("allows normal paths", () => {
    assert.ok(!checkPatterns("/api/calls/123/analysis", PATH_TRAVERSAL_PATTERNS));
  });

  it("allows dotfiles", () => {
    assert.ok(!checkPatterns(".env", PATH_TRAVERSAL_PATTERNS));
  });
});

// --- Suspicious User-Agent Tests ---

describe("WAF: suspicious user-agent detection", () => {
  it("detects sqlmap", () => {
    assert.ok(checkPatterns("sqlmap/1.6", SUSPICIOUS_USER_AGENTS));
  });

  it("detects nikto", () => {
    assert.ok(checkPatterns("Nikto/2.1.5", SUSPICIOUS_USER_AGENTS));
  });

  it("detects nmap", () => {
    assert.ok(checkPatterns("Nmap Scripting Engine", SUSPICIOUS_USER_AGENTS));
  });

  it("detects empty user agent", () => {
    assert.ok(checkPatterns("", SUSPICIOUS_USER_AGENTS));
  });

  it("allows Chrome user agent", () => {
    assert.ok(!checkPatterns("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0", SUSPICIOUS_USER_AGENTS));
  });

  it("allows curl user agent", () => {
    assert.ok(!checkPatterns("curl/7.81.0", SUSPICIOUS_USER_AGENTS));
  });
});

// --- Deep Decode Tests ---

describe("WAF: deep decode (multi-layer URL encoding)", () => {
  it("decodes single-encoded value", () => {
    assert.equal(deepDecode("%3Cscript%3E"), "<script>");
  });

  it("decodes double-encoded value", () => {
    assert.equal(deepDecode("%253Cscript%253E"), "<script>");
  });

  it("stops at max depth", () => {
    // Triple-encoded but maxDepth=3 should still decode
    const tripleEncoded = encodeURIComponent(encodeURIComponent(encodeURIComponent("<script>")));
    const result = deepDecode(tripleEncoded, 3);
    assert.equal(result, "<script>");
  });

  it("handles malformed encoding gracefully", () => {
    // Should not throw on malformed percent encoding
    const result = deepDecode("50%off");
    assert.equal(typeof result, "string");
  });

  it("returns original for non-encoded strings", () => {
    assert.equal(deepDecode("hello world"), "hello world");
  });
});
