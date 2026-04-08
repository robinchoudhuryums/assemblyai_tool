/**
 * Tests for authentication and authorization logic.
 *
 * Run with: npx tsx --test tests/auth.test.ts
 *
 * NOTE: prior versions of this file contained ~5 describe blocks that
 * re-implemented production logic locally (Role hierarchy, Account
 * lockout, CSRF check, Session secret validation, Session fingerprinting)
 * and tested the local copies. They passed even when production was
 * broken. The Role hierarchy + CSRF + Session secret blocks were
 * removed because they were tautological. Session fingerprinting was
 * rewritten to call the exported `getSessionFingerprint` directly.
 * Account lockout was left in place pending a fixture-based rewrite —
 * see follow-on audit items.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getSessionFingerprint } from "../server/auth.js";

// Helper: build a minimal Express Request shape with the headers
// getSessionFingerprint actually reads. The function only touches
// req.headers["user-agent"] and req.headers["accept-language"].
function makeReq(ua: string, lang: string) {
  return { headers: { "user-agent": ua, "accept-language": lang } } as any;
}

describe("Account lockout logic", () => {
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  let loginAttempts: Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>;

  beforeEach(() => {
    loginAttempts = new Map();
  });

  function isAccountLocked(username: string): boolean {
    const record = loginAttempts.get(username);
    if (!record?.lockedUntil) return false;
    if (Date.now() > record.lockedUntil) {
      loginAttempts.delete(username);
      return false;
    }
    return true;
  }

  function recordFailedAttempt(username: string): void {
    const record = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    loginAttempts.set(username, record);
  }

  function clearFailedAttempts(username: string): void {
    loginAttempts.delete(username);
  }

  it("does not lock account after fewer than 5 attempts", () => {
    for (let i = 0; i < 4; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(!isAccountLocked("user1"));
  });

  it("locks account after 5 failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(isAccountLocked("user1"));
  });

  it("clears lockout on successful login", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(isAccountLocked("user1"));
    clearFailedAttempts("user1");
    assert.ok(!isAccountLocked("user1"));
  });

  it("unlocks after lockout duration expires", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    // Manually expire the lockout
    const record = loginAttempts.get("user1")!;
    record.lockedUntil = Date.now() - 1000; // 1 second in the past
    assert.ok(!isAccountLocked("user1"));
  });

  it("tracks different users independently", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    recordFailedAttempt("user2");
    assert.ok(isAccountLocked("user1"));
    assert.ok(!isAccountLocked("user2"));
  });
});

// ── Session fingerprinting (production function) ──
//
// These tests now exercise the exported `getSessionFingerprint` directly
// (see helper `makeReq` at the top of this file). The previous version
// re-implemented the algorithm in a local `computeFingerprint` and tested
// that copy — so a regression in `getSessionFingerprint` would not have
// been caught.

describe("Session fingerprinting", () => {
  it("produces deterministic fingerprint from user-agent and accept-language", () => {
    const fp1 = getSessionFingerprint(makeReq("Mozilla/5.0", "en-US,en;q=0.9"));
    const fp2 = getSessionFingerprint(makeReq("Mozilla/5.0", "en-US,en;q=0.9"));
    assert.equal(fp1, fp2);
  });

  it("produces different fingerprints for different user-agents", () => {
    const fp1 = getSessionFingerprint(makeReq("Mozilla/5.0", "en-US"));
    const fp2 = getSessionFingerprint(makeReq("Chrome/120", "en-US"));
    assert.notEqual(fp1, fp2);
  });

  it("produces different fingerprints for different accept-language values", () => {
    const fp1 = getSessionFingerprint(makeReq("Mozilla/5.0", "en-US"));
    const fp2 = getSessionFingerprint(makeReq("Mozilla/5.0", "es-ES"));
    assert.notEqual(fp1, fp2);
  });

  it("does NOT include IP in the fingerprint", () => {
    // Regression guard: IP was accidentally included in bindSessionFingerprint
    // (routes/auth.ts) at one point, while getSessionFingerprint did not include
    // it, causing every session to be destroyed after login. Both call sites
    // must use the same exported function.
    const fp = getSessionFingerprint(makeReq("Mozilla/5.0", "en-US"));
    assert.equal(fp.length, 16, "Fingerprint should be 16 hex chars");
    // Compute the expected hash purely from `${ua}|${lang}` and verify it
    // matches — no IP, no other inputs.
    const expected = createHash("sha256").update("Mozilla/5.0|en-US").digest("hex").slice(0, 16);
    assert.equal(fp, expected, "Fingerprint must be hash of 'ua|lang' only — no IP");
  });

  it("handles missing user-agent and accept-language headers", () => {
    // Empty/missing headers should still produce a valid 16-char hex fingerprint
    // (the function defaults to empty string for both).
    const fp = getSessionFingerprint({ headers: {} } as any);
    assert.equal(fp.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(fp));
  });
});
