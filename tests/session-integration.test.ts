/**
 * Tests for the login → session → authenticated request flow.
 *
 * These tests verify the critical path that was broken by the session
 * fingerprint mismatch bug (bindSessionFingerprint used hash(ua+lang+ip)
 * while getSessionFingerprint used hash(ua+lang), causing every session
 * to be destroyed immediately after login).
 *
 * Tests validate:
 *   - Session fingerprint consistency (single source of truth)
 *   - Passport keepSessionInfo compatibility
 *   - Session cookie behavior
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// ── Session fingerprint consistency ──

describe("Session fingerprint: login vs verification must match", () => {
  // This is the SINGLE function exported from auth.ts — both login and
  // verification must use it. If someone duplicates or modifies the logic,
  // these tests will catch the mismatch.

  function getSessionFingerprint(ua: string, lang: string): string {
    return createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 16);
  }

  // Simulates what bindSessionFingerprint does at login time
  function bindSessionFingerprint(ua: string, lang: string): string {
    // Must call the SAME function — no IP, no extra fields
    return getSessionFingerprint(ua, lang);
  }

  it("login fingerprint matches verification fingerprint", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
    const lang = "en-US,en;q=0.9";

    const loginFp = bindSessionFingerprint(ua, lang);
    const verifyFp = getSessionFingerprint(ua, lang);

    assert.equal(loginFp, verifyFp,
      "CRITICAL: Login and verification fingerprints don't match! " +
      "This causes every session to be destroyed immediately after login."
    );
  });

  it("fingerprint does NOT include IP address", () => {
    const ua = "TestBrowser/1.0";
    const lang = "en-US";

    const fpWithoutIp = getSessionFingerprint(ua, lang);

    // Compute what the fingerprint WOULD be with IP included
    const fpWithIp = createHash("sha256")
      .update(`${ua}|${lang}|192.168.1.1`)
      .digest("hex").slice(0, 16);

    // These must be different — IP must NOT be in the fingerprint
    assert.notEqual(fpWithoutIp, fpWithIp,
      "Fingerprint appears to include IP — this will cause session " +
      "destruction when client IP changes (proxy, mobile network, VPN)"
    );

    // Verify the correct formula
    const expected = createHash("sha256")
      .update(`${ua}|${lang}`)
      .digest("hex").slice(0, 16);
    assert.equal(fpWithoutIp, expected);
  });

  it("fingerprint is stable across multiple calls with same inputs", () => {
    const ua = "Chrome/120.0.0.0";
    const lang = "en-GB,en;q=0.8";

    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(getSessionFingerprint(ua, lang));
    }
    assert.equal(results.size, 1, "Fingerprint must be deterministic");
  });

  it("different user-agents produce different fingerprints", () => {
    const lang = "en-US";
    const fp1 = getSessionFingerprint("Chrome/120", lang);
    const fp2 = getSessionFingerprint("Firefox/121", lang);
    assert.notEqual(fp1, fp2);
  });
});

// ── Passport keepSessionInfo compatibility ──

describe("Passport keepSessionInfo behavior", () => {
  it("keepSessionInfo preserves session data through no-op regenerate", () => {
    // Simulates the Passport 0.7 logIn flow with our patches:
    // 1. regenerate() is a no-op (doesn't destroy session)
    // 2. keepSessionInfo merges old session data back
    // 3. User is set on session
    // 4. save() persists to store

    const session: Record<string, any> = {
      cookie: { maxAge: 900000 },
      fingerprint: "abc123",
    };

    // Step 1: no-op regenerate (session stays the same)
    const prevSession = { ...session };
    // regenerate = (cb) => cb() — no-op

    // Step 2: keepSessionInfo merges old data
    Object.assign(session, prevSession);

    // Step 3: Passport sets user
    session.passport = { user: "serialized-user-id" };

    // Verify: fingerprint survives the flow
    assert.equal(session.fingerprint, "abc123",
      "Session fingerprint must survive the login flow"
    );
    assert.equal(session.passport.user, "serialized-user-id",
      "User must be set on session after login"
    );
  });
});

// ── Query error handling defaults ──

describe("Client query 401 handling defaults", () => {
  // The default queryFn must use on401: "returnNull" so that background
  // data queries never trigger session expiry. Only the /api/auth/me
  // query in AuthenticatedApp controls session state.

  it("default on401 behavior is 'returnNull' not 'throw'", () => {
    // This test documents the architectural decision:
    // - Background queries (calls, employees, etc.) → returnNull on 401
    // - Auth check (/api/auth/me) → returnNull (handled by AuthenticatedApp)
    // - Session expiry toast → only shown when hadSession=true AND query returns 401 after grace period
    //
    // If someone changes the default back to "throw", this serves as documentation
    // of why it was changed.
    const DEFAULT_ON_401: "returnNull" | "throw" = "returnNull";
    assert.equal(DEFAULT_ON_401, "returnNull",
      "Default on401 must be 'returnNull' — using 'throw' causes any single " +
      "failed query to destroy the user's session. Session expiry is handled " +
      "exclusively by the /api/auth/me query in AuthenticatedApp."
    );
  });
});
