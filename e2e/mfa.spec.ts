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

    // First: a wrong-code-on-enable attempt is rejected with 401. The
    // server's enable handler runs verifyTOTP and returns 401 + "Invalid
    // verification code" without enabling. Important to check on the
    // wire: a bug here that flipped enabling on for any input would be
    // a critical security regression and the unit test
    // (tests/totp.test.ts:verifyTOTP rejects wrong codes) only proves
    // the building block works in isolation.
    const wrongRes = await request.post("/api/auth/mfa/enable", {
      data: { code: "000000" },
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    });
    expect(wrongRes.status()).toBe(401);
    expect(((await wrongRes.json()) as { message?: string }).message).toMatch(/invalid/i);

    // Now: a correct code enables MFA and returns recovery codes.
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

  // ─────────────────────────────────────────────────────────────────
  // State-machine round-trip: regenerate-recovery-codes → disable →
  // re-enroll. These build on the enrollment + login work above and
  // share the testmfa session via closure variables. After test 6
  // burned recoveryCodes[0], indices [1..N-1] are still consumable.
  //
  // Helper-style: each authenticated test does the full
  // login → mfaToken → recovery-code → CSRF dance inline. Could DRY
  // into a helper but that would obscure which recovery-code index
  // each test consumes — explicitness is more valuable here.
  // ─────────────────────────────────────────────────────────────────

  // The new set returned by regenerate. Captured in test 7, consumed
  // by test 8 (because regenerate invalidates the original set).
  let recoveryCodesAfterRegen: string[] = [];

  test("regenerate-recovery-codes returns a fresh non-empty set", async ({ request }) => {
    expect(recoveryCodes.length).toBeGreaterThan(1);

    // Authenticate via recovery code [1] (recoveryCodes[0] was burned
    // in test 6). Each recovery-code use is single-use server-side.
    const step1 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(step1.ok()).toBeTruthy();
    const { mfaToken } = (await step1.json()) as { mfaToken: string };

    const step2 = await request.post("/api/auth/login", {
      data: {
        username: USERNAME,
        password: PASSWORD,
        mfaToken,
        totpCode: recoveryCodes[1],
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(step2.ok(), await step2.text()).toBeTruthy();

    // Pull CSRF cookie from the now-authenticated request context.
    const cookies = await request.storageState();
    const csrf = cookies.cookies.find((c) => c.name === "csrf_token");
    expect(csrf).toBeTruthy();

    const regen = await request.post("/api/auth/mfa/recovery-codes/regenerate", {
      headers: { "X-CSRF-Token": csrf!.value, "Content-Type": "application/json" },
    });
    expect(regen.ok(), await regen.text()).toBeTruthy();
    const body = (await regen.json()) as { recoveryCodes: string[] };
    expect(Array.isArray(body.recoveryCodes)).toBeTruthy();
    expect(body.recoveryCodes.length).toBeGreaterThanOrEqual(8);
    for (const rc of body.recoveryCodes) {
      expect(rc).toMatch(/^[A-Z0-9]{10}$/i);
    }
    // Sanity: at least one code in the new set must differ from the
    // original. Server contract says ALL old codes are invalidated, but
    // we don't probe that on the wire — covered by tests/totp.test.ts.
    const overlap = body.recoveryCodes.filter((c) => recoveryCodes.includes(c));
    expect(overlap.length).toBeLessThan(body.recoveryCodes.length);

    recoveryCodesAfterRegen = body.recoveryCodes;
  });

  test("disable removes MFA requirement: subsequent login is single-step", async ({ request }) => {
    expect(recoveryCodesAfterRegen.length).toBeGreaterThan(0);

    // Authenticate via a code from the regenerated set. Old codes are
    // server-side-invalid after the previous test's regenerate.
    const step1 = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    const { mfaToken } = (await step1.json()) as { mfaToken: string };

    const step2 = await request.post("/api/auth/login", {
      data: {
        username: USERNAME,
        password: PASSWORD,
        mfaToken,
        totpCode: recoveryCodesAfterRegen[0],
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(step2.ok(), await step2.text()).toBeTruthy();

    // Disable.
    const cookies = await request.storageState();
    const csrf = cookies.cookies.find((c) => c.name === "csrf_token");
    const disable = await request.post("/api/auth/mfa/disable", {
      headers: { "X-CSRF-Token": csrf!.value, "Content-Type": "application/json" },
    });
    expect(disable.ok(), await disable.text()).toBeTruthy();
    expect(((await disable.json()) as { message?: string }).message).toMatch(/disabled/i);

    // Now: a fresh login MUST be single-step (no mfaRequired). This is
    // the round-trip assertion — verifies the disable actually flipped
    // the user's MFA state, not just returned a 200 cosmetic.
    // Use a new `request` shape via a clean login so cookies don't
    // carry the prior session.
    const reLogin = await request.post("/api/auth/login", {
      data: { username: USERNAME, password: PASSWORD },
      headers: { "Content-Type": "application/json" },
    });
    expect(reLogin.ok(), await reLogin.text()).toBeTruthy();
    const reBody = (await reLogin.json()) as { mfaRequired?: boolean; username?: string };
    expect(reBody.mfaRequired).toBeUndefined();
    expect(reBody.username).toBe(USERNAME);
  });

  test("setup after disable returns a different secret (re-enrollment)", async ({ request }) => {
    expect(mfaSecret).not.toBe("");
    // MFA is now disabled (previous test). Regular single-step login.
    const csrf = await loginAndGetCsrf(request, USERNAME, PASSWORD);

    // Setup again — server should generate a fresh secret, not reuse
    // the disabled one. Important: the setup endpoint upserts the
    // mfa_secrets row with `enabled: false`, so a fresh secret is
    // expected. If this test ever fails because the secret matches the
    // original, that means the server is leaking disabled-state
    // material and the disable flow isn't truly clearing the row.
    const setupRes = await request.post("/api/auth/mfa/setup", {
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    });
    expect(setupRes.ok()).toBeTruthy();
    const { secret: newSecret } = (await setupRes.json()) as { secret: string };
    expect(newSecret).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret).not.toBe(mfaSecret);

    // Round-trip the enable to confirm the new secret works end-to-end.
    const code = generateTOTP(newSecret);
    const enableRes = await request.post("/api/auth/mfa/enable", {
      data: { code },
      headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    });
    expect(enableRes.ok(), await enableRes.text()).toBeTruthy();
  });
});
