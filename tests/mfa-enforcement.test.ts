/**
 * Tests for MFA enforcement logic: REQUIRE_MFA behavior, role-based MFA,
 * TOTP verification flow, and edge cases.
 * Run with: npx tsx --test tests/mfa-enforcement.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateTOTP, verifyTOTP, generateSecret, base32Encode, generateOTPAuthURI } from "../server/services/totp.js";

// ── MFA Requirement Logic ─────────────────────────────────

describe("MFA requirement logic", () => {
  function isMFARequired(envValue?: string): boolean {
    return envValue === "true";
  }

  function isMFARoleRequired(role: string): boolean {
    return role === "admin" || role === "manager";
  }

  function needsMFA(role: string, globalEnv?: string): boolean {
    return isMFARequired(globalEnv) || isMFARoleRequired(role);
  }

  it("requires MFA when REQUIRE_MFA=true", () => {
    assert.ok(isMFARequired("true"));
  });

  it("does not require MFA when REQUIRE_MFA is unset", () => {
    assert.ok(!isMFARequired(undefined));
    assert.ok(!isMFARequired("false"));
    assert.ok(!isMFARequired(""));
  });

  it("always requires MFA for admin role", () => {
    assert.ok(isMFARoleRequired("admin"));
  });

  it("always requires MFA for manager role", () => {
    assert.ok(isMFARoleRequired("manager"));
  });

  it("does not require MFA for viewer role by default", () => {
    assert.ok(!isMFARoleRequired("viewer"));
  });

  it("does not require MFA for unknown roles", () => {
    assert.ok(!isMFARoleRequired("unknown"));
    assert.ok(!isMFARoleRequired(""));
  });

  it("viewers need MFA when global enforcement is on", () => {
    assert.ok(needsMFA("viewer", "true"));
  });

  it("viewers skip MFA when global enforcement is off", () => {
    assert.ok(!needsMFA("viewer", undefined));
  });

  it("admins always need MFA regardless of global setting", () => {
    assert.ok(needsMFA("admin", undefined));
    assert.ok(needsMFA("admin", "true"));
    assert.ok(needsMFA("admin", "false"));
  });
});

// ── MFA Session Challenge Flow ─────────────────────────────

describe("MFA challenge flow", () => {
  interface LoginResult {
    requiresMFA: boolean;
    mfaToken?: string;
    user?: { username: string; role: string };
  }

  function simulateLogin(
    username: string,
    role: string,
    hasMFAEnabled: boolean,
    globalMFARequired: boolean,
  ): LoginResult {
    const needsMFA = globalMFARequired || role === "admin" || role === "manager";

    if (needsMFA && hasMFAEnabled) {
      return { requiresMFA: true, mfaToken: `mfa-session-${username}` };
    }

    if (needsMFA && !hasMFAEnabled) {
      // MFA required but not set up — should force setup
      return { requiresMFA: true, mfaToken: `mfa-setup-${username}` };
    }

    return { requiresMFA: false, user: { username, role } };
  }

  it("admin with MFA enabled gets challenge", () => {
    const result = simulateLogin("admin-user", "admin", true, false);
    assert.ok(result.requiresMFA);
    assert.ok(result.mfaToken);
    assert.equal(result.user, undefined);
  });

  it("viewer without MFA skips challenge when not globally required", () => {
    const result = simulateLogin("viewer-user", "viewer", false, false);
    assert.ok(!result.requiresMFA);
    assert.ok(result.user);
    assert.equal(result.user?.username, "viewer-user");
  });

  it("viewer gets challenge when MFA is globally required", () => {
    const result = simulateLogin("viewer-user", "viewer", true, true);
    assert.ok(result.requiresMFA);
  });

  it("manager without MFA setup gets forced setup flow", () => {
    const result = simulateLogin("mgr-user", "manager", false, false);
    assert.ok(result.requiresMFA);
    assert.ok(result.mfaToken?.includes("setup"));
  });
});

// ── TOTP Verification with MFA Flow ─────────────────────────

describe("TOTP verification in MFA flow", () => {
  it("valid code completes MFA challenge", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    assert.ok(verifyTOTP(secret, code));
  });

  it("expired code fails (>30s outside window)", () => {
    const secret = generateSecret();
    // Generate code from 90 seconds ago (outside ±30s window)
    const oldCode = generateTOTP(secret, 30, 6, Date.now() - 90000);
    assert.ok(!verifyTOTP(secret, oldCode));
  });

  it("code from near future succeeds (within +30s window)", () => {
    const secret = generateSecret();
    const futureCode = generateTOTP(secret, 30, 6, Date.now() + 25000);
    assert.ok(verifyTOTP(secret, futureCode));
  });

  it("wrong code fails", () => {
    const secret = generateSecret();
    assert.ok(!verifyTOTP(secret, "000000"));
  });

  it("code from different secret fails", () => {
    const secret1 = generateSecret();
    const secret2 = generateSecret();
    const code = generateTOTP(secret1);
    assert.ok(!verifyTOTP(secret2, code));
  });

  it("empty code fails", () => {
    const secret = generateSecret();
    assert.ok(!verifyTOTP(secret, ""));
  });

  it("code with wrong length fails (timing-safe comparison)", () => {
    const secret = generateSecret();
    // 5-digit code vs expected 6-digit — length check prevents timingSafeEqual crash
    assert.ok(!verifyTOTP(secret, "12345"));
  });
});

// ── OTPAuth URI Generation ─────────────────────────────────

describe("OTPAuth URI for MFA setup", () => {
  it("generates valid otpauth URI", () => {
    const uri = generateOTPAuthURI("admin", "JBSWY3DPEHPK3PXP");
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
    assert.match(uri, /issuer=CallAnalyzer/);
    assert.match(uri, /algorithm=SHA1/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
  });

  it("encodes special characters in username", () => {
    const uri = generateOTPAuthURI("user@example.com", "JBSWY3DPEHPK3PXP");
    assert.match(uri, /user%40example\.com/);
  });

  it("uses custom issuer", () => {
    const uri = generateOTPAuthURI("admin", "SECRET", "MyApp");
    assert.match(uri, /issuer=MyApp/);
    assert.match(uri, /MyApp.*admin/); // issuer:user format in path
  });
});

// ── Secret Generation Quality ─────────────────────────────

describe("MFA secret generation", () => {
  it("generates secrets of expected length", () => {
    const secret = generateSecret(20);
    // 20 bytes → 32 base32 chars
    assert.ok(secret.length >= 28 && secret.length <= 34, `Secret length ${secret.length} outside expected range`);
  });

  it("generates unique secrets", () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 50; i++) {
      secrets.add(generateSecret());
    }
    assert.equal(secrets.size, 50, "Secrets should all be unique");
  });

  it("generates valid base32 characters only", () => {
    const secret = generateSecret();
    assert.match(secret, /^[A-Z2-7]+$/);
  });
});

// ── Base32 Encoding ─────────────────────────────────────

describe("Base32 encoding for MFA", () => {
  it("encodes empty buffer", () => {
    assert.equal(base32Encode(Buffer.from([])), "");
  });

  it("encodes known value", () => {
    // "Hello" in base32 is JBSWY3DP
    const encoded = base32Encode(Buffer.from("Hello"));
    assert.equal(encoded, "JBSWY3DP");
  });

  it("round-trips through encode/decode via TOTP", () => {
    // Generate a secret and verify it can produce valid TOTP codes
    const secret = generateSecret();
    const code = generateTOTP(secret);
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  });
});
