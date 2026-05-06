/**
 * E2E coverage for MFA enrollment + verification + recovery flow.
 *
 * Scope: API-level only via Playwright's `request` fixture. The MFA setup
 * dialog UI is covered by the unit suite (client/src/components/mfa-setup-dialog
 * has no inline test, but the underlying useMutation flow is exercised
 * through `tests/auth.test.ts`); what's NOT covered anywhere except here
 * is the cross-layer flow:
 *   POST /api/auth/mfa/setup → POST /api/auth/mfa/enable → mfa-required
 *   login → TOTP submission → recovery-code consumption → 5-attempt
 *   lockout.
 *
 * These are the on-the-wire invariants behind INV-25/26/27 (MFA recovery
 * code hashing, timing-safe consumption, 5-attempt cap). The unit tests
 * verify each piece in isolation; this spec verifies they wire together
 * across HTTP, session, CSRF, and the in-memory mfaPendingTokens map.
 *
 * Why dedicated `testmfa` user instead of `testadmin`:
 *   The dev server's MemStorage persists for the whole Playwright run.
 *   Enrolling testadmin in MFA in this spec would make every other spec
 *   (auth, navigation, admin-workflow, ...) fail at the login step
 *   because their helpers don't handle the {mfaRequired, mfaToken}
 *   response. Using a dedicated user keeps mfa.spec self-contained;
 *   no afterAll cleanup needed. The user is added to AUTH_USERS in
 *   playwright.config.ts and .github/workflows/ci.yml.
 *
 * Why API-only instead of driving the dialog:
 *   - The MFA flow has 4 endpoints worth of state machine; UI covers a
 *     fraction.
 *   - TOTP-replay protection (server/services/totp.ts:117-121) caches
 *     `secret:timeStep` per use, so deterministic dialog tests have to
 *     manage time-window arithmetic regardless. Doing it in the request
 *     fixture is simpler than orchestrating the dialog.
 *   - Browser launch isn't required, so this spec runs even in
 *     environments where Playwright's chromium download is blocked.
 *
 * TOTP-replay sequencing in this spec:
 *   - Enrollment uses code at time T.
 *   - Login-with-valid-TOTP uses code at T+30 000 ms (next 30s step) to
 *     avoid colliding with enrollment in the per-secret replay cache.
 *   - Bad-attempt + recovery-code tests don't submit valid TOTP codes,
 *     so they can't collide. Recovery codes have their own single-use
 *     cache (DB-backed scrypt-hashed records, see consumeRecoveryCode).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHmac } from "crypto";

// ─────────────────────────────────────────────────────────────────────
// TOTP generator — mirrors server/services/totp.ts:generateTOTP exactly.
// Inlined rather than imported because totp.ts pulls in db/pool which
// has init side-effects we don't want in the test runner.
// ─────────────────────────────────────────────────────────────────────
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 char: ${ch}`);
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, atTimeMs: number = Date.now()): string {
  const time = Math.floor(atTimeMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(time), 0);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const USERNAME = "testmfa";
const PASSWORD = "MfaTestPass123!";

/**
 * Login + return CSRF token. Matches the pattern from full-pipeline.spec.ts.
 * The CSRF cookie is set on every response; mutation routes require the
 * same value echoed in the X-CSRF-Token header.
 */
async function loginAndGetCsrf(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post("/api/auth/login", {
    data: { username, password },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
  const cookies = await request.storageState();
  const csrf = cookies.cookies.find((c) => c.name === "csrf_token");
  if (!csrf) throw new Error("CSRF cookie not set after login");
  return csrf.value;
}

// describe.serial — these tests share state via closure variables. Each
// builds on the previous: enrollment → reuse secret in subsequent login
// tests. Playwright runs serial blocks in declaration order.
test.describe.serial("MFA enrollment + verification (testmfa user)", () => {
  // Captured during the first test; reused by all downstream login tests.
  let mfaSecret = "";
  let recoveryCodes: string[] = [];

  test("setup endpoint returns base32 secret + otpauth URI", async ({ request }) => {
    const csrf = await loginAndGetCsrf(request, USERNAME, PASSWORD);
    const res = await request.post("/api/auth/mfa/setup", {
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { secret: string; uri: string };
    // Standard 20-byte secret base32-encoded → 32 chars (no padding).
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.uri).toMatch(/^otpauth:\/\/totp\/CallAnalyzer:testmfa\?secret=/);
    expect(body.uri).toContain("algorithm=SHA1");
    expect(body.uri).toContain("digits=6");
    expect(body.uri).toContain("period=30");
    mfaSecret = body.secret;
  });

  test("enable endpoint accepts current TOTP and returns recovery codes", async ({ request }) => {
    expect(mfaSecret, "first test must have populated mfaSecret").not.toBe("");
    const csrf = await loginAndGetCsrf(request, USERNAME, PASSWORD);
    const code = generateTOTP(mfaSecret);
    const res = await request.post("/api/auth/mfa/enable", {
      data: { code },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { message: string; recoveryCodes: string[] };
    expect(Array.isArray(body.recoveryCodes)).toBeTruthy();
    expect(body.recoveryCodes.length).toBeGreaterThanOrEqual(8);
    // Recovery codes are 10-char alphanumeric per server contract
    // (server/services/totp.ts:generateRecoveryCodes + the regex used at
    // the login route's recovery-code branch /^[A-Z0-9]{10}$/i).
    for (const rc of body.recoveryCodes) {
      expect(rc).toMatch(/^[A-Z0-9]{10}$/i);
    }
    recoveryCodes = body.recoveryCodes;
  });

  test("login surfaces mfaRequired + mfaToken for enrolled user", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { mfaRequired?: boolean; mfaToken?: string };
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.mfaToken).toBe("string");
    expect(body.mfaToken!.length).toBeGreaterThan(10);
  });

  test("login completes when valid TOTP is submitted with mfaToken", async ({ request }) => {
    expect(mfaSecret).not.toBe("");
    // Step 1: password → mfaToken
    const step1 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(step1.ok()).toBeTruthy();
    const { mfaToken } = (await step1.json()) as { mfaToken: string };
    expect(mfaToken).toBeTruthy();

    // Step 2: token + TOTP at the *next* 30s step. This avoids colliding
    // with the enrollment test's entry in the per-secret replay cache
    // (server/services/totp.ts:117-121 keys on `secret:timeStep`).
    const code = generateTOTP(mfaSecret, Date.now() + 30_000);
    const step2 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD, mfaToken, totpCode: code },
      headers: { "Content-Type": "application/json" },
    });
    expect(step2.ok(), await step2.text()).toBeTruthy();
    const body = (await step2.json()) as { username?: string; mfaRequired?: boolean };
    expect(body.username).toBe(USERNAME);
    expect(body.mfaRequired).toBeUndefined();
  });

  test("5 wrong TOTP attempts invalidates the mfaToken (lockout)", async ({ request }) => {
    // Get a fresh mfaToken — each login issues a new one.
    const step1 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(step1.ok()).toBeTruthy();
    const { mfaToken } = (await step1.json()) as { mfaToken: string };
    expect(mfaToken).toBeTruthy();

    // Submit 4 wrong codes — each returns 401 with no `code` field.
    // Use a clearly-bad value that doesn't match the recovery-code regex
    // (otherwise the server tries the recovery-code branch instead and
    // we're testing a different path). "111111" is numeric 6-digit so it
    // routes to the TOTP branch and almost-certainly won't match.
    for (let i = 1; i <= 4; i++) {
      const res = await request.post("/api/auth/login", {
        data: { username: USERNAME, password: PASSWORD, mfaToken, totpCode: "111111" },
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { code?: string; message?: string };
      // Pre-lockout failures don't carry a `code` field.
      expect(body.code).toBeUndefined();
      expect(body.message).toMatch(/invalid/i);
    }

    // 5th wrong attempt → token deleted, response carries
    // code: "mfa_session_expired". This is the boundary that
    // INV-27 enforces.
    const fifth = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD, mfaToken, totpCode: "111111" },
      headers: { "Content-Type": "application/json" },
    });
    expect(fifth.status()).toBe(401);
    const fifthBody = (await fifth.json()) as { code?: string };
    expect(fifthBody.code).toBe("mfa_session_expired");

    // 6th attempt with the same (now-deleted) token → still
    // mfa_session_expired, via the "no pending token" path. Confirms the
    // token was actually evicted, not just flagged.
    const sixth = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD, mfaToken, totpCode: "111111" },
      headers: { "Content-Type": "application/json" },
    });
    expect(sixth.status()).toBe(401);
    expect(((await sixth.json()) as { code?: string }).code).toBe("mfa_session_expired");
  });

  test("recovery code logs in successfully and is single-use", async ({ request }) => {
    expect(recoveryCodes.length).toBeGreaterThan(0);
    const code = recoveryCodes[0];

    // First use — succeeds.
    const step1 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(step1.ok()).toBeTruthy();
    const { mfaToken: token1 } = (await step1.json()) as { mfaToken: string };

    const useFirst = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD, mfaToken: token1, totpCode: code },
      headers: { "Content-Type": "application/json" },
    });
    expect(useFirst.ok(), await useFirst.text()).toBeTruthy();

    // Second use of the SAME code — must fail. New mfaToken (the
    // previous succeeded and was deleted), same recovery code.
    const step2 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(step2.ok()).toBeTruthy();
    const { mfaToken: token2 } = (await step2.json()) as { mfaToken: string };

    const useSecond = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD, mfaToken: token2, totpCode: code },
      headers: { "Content-Type": "application/json" },
    });
    expect(useSecond.status()).toBe(401);
  });
});
