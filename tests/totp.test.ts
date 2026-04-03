/**
 * Tests for TOTP (Time-based One-Time Password) implementation.
 * Tests base32 encoding, RFC 6238 compliance, verification window, and URI generation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateSecret,
  base32Encode,
  generateTOTP,
  verifyTOTP,
  generateOTPAuthURI,
  isMFARequired,
  isMFARoleRequired,
  _resetReplayCache,
} from "../server/services/totp.js";

describe("base32Encode", () => {
  it("encodes empty buffer", () => {
    assert.equal(base32Encode(Buffer.alloc(0)), "");
  });

  it("encodes single byte", () => {
    // 0x00 → 00000 000 → "AA" (5 bits = A, 3 bits padded = A)
    const result = base32Encode(Buffer.from([0x00]));
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("encodes known values correctly", () => {
    // RFC 4648 test vectors: "f" → "MY"
    const result = base32Encode(Buffer.from("f"));
    assert.equal(result, "MY");
  });

  it("encodes multi-byte values", () => {
    // RFC 4648: "fo" → "MZXQ"
    assert.equal(base32Encode(Buffer.from("fo")), "MZXQ");
    // "foo" → "MZXW6"
    assert.equal(base32Encode(Buffer.from("foo")), "MZXW6");
    // "foob" → "MZXW6YQ"
    assert.equal(base32Encode(Buffer.from("foob")), "MZXW6YQ");
    // "fooba" → "MZXW6YTB"
    assert.equal(base32Encode(Buffer.from("fooba")), "MZXW6YTB");
    // "foobar" → "MZXW6YTBOI"
    assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  });

  it("only uses valid base32 characters", () => {
    const result = base32Encode(Buffer.from("test data for encoding"));
    assert.match(result, /^[A-Z2-7]+$/);
  });
});

describe("generateSecret", () => {
  it("generates a non-empty string", () => {
    const secret = generateSecret();
    assert.ok(secret.length > 0);
  });

  it("generates valid base32", () => {
    const secret = generateSecret();
    assert.match(secret, /^[A-Z2-7]+$/);
  });

  it("generates unique values", () => {
    const a = generateSecret();
    const b = generateSecret();
    assert.notEqual(a, b);
  });

  it("respects custom length", () => {
    const short = generateSecret(10);
    const long = generateSecret(32);
    // Longer input = longer base32 output
    assert.ok(long.length > short.length);
  });

  it("default length produces sufficient entropy (20 bytes = 160 bits)", () => {
    const secret = generateSecret();
    // 20 bytes → ceil(20*8/5) = 32 base32 chars
    assert.ok(secret.length >= 32);
  });
});

describe("generateTOTP", () => {
  const testSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("generates a 6-digit string", () => {
    const code = generateTOTP(testSecret, 30, 6, Date.now());
    assert.match(code, /^\d{6}$/);
  });

  it("pads short codes with leading zeros", () => {
    // Run multiple times to increase chance of hitting a code < 100000
    let foundShort = false;
    for (let i = 0; i < 100; i++) {
      const code = generateTOTP(testSecret, 30, 6, i * 30000);
      assert.equal(code.length, 6);
      if (code.startsWith("0")) foundShort = true;
    }
    // Not guaranteed but very likely over 100 iterations
  });

  it("produces same code within same time step", () => {
    const t = 1700000000000; // fixed timestamp
    const code1 = generateTOTP(testSecret, 30, 6, t);
    const code2 = generateTOTP(testSecret, 30, 6, t + 5000); // 5 sec later, same step
    assert.equal(code1, code2);
  });

  it("produces different code in different time steps", () => {
    const t = 1700000000000;
    const code1 = generateTOTP(testSecret, 30, 6, t);
    const code2 = generateTOTP(testSecret, 30, 6, t + 30000); // next step
    assert.notEqual(code1, code2);
  });

  it("produces different codes for different secrets", () => {
    const t = 1700000000000;
    const secret2 = base32Encode(Buffer.from("09876543210987654321"));
    const code1 = generateTOTP(testSecret, 30, 6, t);
    const code2 = generateTOTP(secret2, 30, 6, t);
    assert.notEqual(code1, code2);
  });

  it("handles custom time step", () => {
    const t = 1700000000000;
    const code60a = generateTOTP(testSecret, 60, 6, t);
    const code60b = generateTOTP(testSecret, 60, 6, t + 50000); // 50s later, still same 60s step
    // Both should be within the same 60-second window
    // Math.floor(t/1000/60) should equal Math.floor((t+50000)/1000/60)
    const stepA = Math.floor(t / 1000 / 60);
    const stepB = Math.floor((t + 50000) / 1000 / 60);
    if (stepA === stepB) {
      assert.equal(code60a, code60b);
    }
    // Regardless, codes should be 6-digit strings
    assert.match(code60a, /^\d{6}$/);
    assert.match(code60b, /^\d{6}$/);
  });
});

describe("verifyTOTP", () => {
  it("accepts current valid code", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret, 30, 6, Date.now());
    assert.ok(verifyTOTP(secret, code));
  });

  it("accepts code from previous time step (window=1)", () => {
    const secret = generateSecret();
    const now = Date.now();
    const pastCode = generateTOTP(secret, 30, 6, now - 30000); // 1 step ago
    assert.ok(verifyTOTP(secret, pastCode, 1));
  });

  it("accepts code from next time step (window=1)", () => {
    const secret = generateSecret();
    const now = Date.now();
    const futureCode = generateTOTP(secret, 30, 6, now + 30000); // 1 step ahead
    assert.ok(verifyTOTP(secret, futureCode, 1));
  });

  it("rejects code from too far in the past", () => {
    const secret = generateSecret();
    const now = Date.now();
    const oldCode = generateTOTP(secret, 30, 6, now - 90000); // 3 steps ago
    assert.ok(!verifyTOTP(secret, oldCode, 1));
  });

  it("rejects invalid code", () => {
    const secret = generateSecret();
    assert.ok(!verifyTOTP(secret, "000000"));
    assert.ok(!verifyTOTP(secret, "999999"));
  });

  it("rejects code for wrong secret", () => {
    const secret1 = generateSecret();
    const secret2 = generateSecret();
    const code = generateTOTP(secret1, 30, 6, Date.now());
    assert.ok(!verifyTOTP(secret2, code));
  });

  it("respects window=0 (exact match only)", () => {
    const secret = generateSecret();
    const now = Date.now();
    const currentCode = generateTOTP(secret, 30, 6, now);
    assert.ok(verifyTOTP(secret, currentCode, 0));

    // Code from adjacent step should fail with window=0 (if we're not at a boundary)
    const pastCode = generateTOTP(secret, 30, 6, now - 30000);
    if (currentCode !== pastCode) {
      assert.ok(!verifyTOTP(secret, pastCode, 0));
    }
  });
});

describe("TOTP replay protection", () => {
  it("rejects the same code used twice with the same secret", () => {
    _resetReplayCache();
    const secret = generateSecret();
    const code = generateTOTP(secret, 30, 6, Date.now());
    assert.ok(verifyTOTP(secret, code), "first use should succeed");
    assert.ok(!verifyTOTP(secret, code), "replay should be rejected");
  });

  it("allows the same code with a different secret", () => {
    _resetReplayCache();
    const secret1 = generateSecret();
    const secret2 = generateSecret();
    const now = Date.now();
    const code1 = generateTOTP(secret1, 30, 6, now);
    const code2 = generateTOTP(secret2, 30, 6, now);
    assert.ok(verifyTOTP(secret1, code1), "first secret should work");
    // code2 is different from code1 (different secrets), so it's not a replay
    if (code1 !== code2) {
      assert.ok(verifyTOTP(secret2, code2), "different secret should work");
    }
  });

  it("allows code from a different time step (same secret)", () => {
    _resetReplayCache();
    const secret = generateSecret();
    const now = Date.now();
    // Use current step and the previous step — both within window=1 but different time steps
    const currentCode = generateTOTP(secret, 30, 6, now);
    const pastCode = generateTOTP(secret, 30, 6, now - 30000);
    assert.ok(verifyTOTP(secret, currentCode), "current code should work");
    // Past code is a different time step, so replay cache shouldn't block it
    if (currentCode !== pastCode) {
      assert.ok(verifyTOTP(secret, pastCode), "code from different step should work");
    }
  });
});

describe("generateOTPAuthURI", () => {
  it("generates valid otpauth URI", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const uri = generateOTPAuthURI("testuser", secret);
    assert.ok(uri.startsWith("otpauth://totp/"));
    assert.ok(uri.includes(secret));
    assert.ok(uri.includes("testuser"));
  });

  it("includes default issuer", () => {
    const uri = generateOTPAuthURI("user", "SECRET");
    assert.ok(uri.includes("CallAnalyzer"));
    assert.ok(uri.includes("issuer=CallAnalyzer"));
  });

  it("includes custom issuer", () => {
    const uri = generateOTPAuthURI("user", "SECRET", "MyApp");
    assert.ok(uri.includes("MyApp"));
    assert.ok(uri.includes("issuer=MyApp"));
  });

  it("encodes special characters in username", () => {
    const uri = generateOTPAuthURI("user@example.com", "SECRET");
    assert.ok(uri.includes("user%40example.com"));
  });

  it("includes required parameters", () => {
    const uri = generateOTPAuthURI("user", "SECRET");
    assert.ok(uri.includes("algorithm=SHA1"));
    assert.ok(uri.includes("digits=6"));
    assert.ok(uri.includes("period=30"));
  });
});

describe("isMFARequired", () => {
  it("returns false when REQUIRE_MFA is not set", () => {
    const orig = process.env.REQUIRE_MFA;
    delete process.env.REQUIRE_MFA;
    assert.equal(isMFARequired(), false);
    if (orig !== undefined) process.env.REQUIRE_MFA = orig;
  });

  it("returns true when REQUIRE_MFA is 'true'", () => {
    const orig = process.env.REQUIRE_MFA;
    process.env.REQUIRE_MFA = "true";
    assert.equal(isMFARequired(), true);
    process.env.REQUIRE_MFA = orig || "";
    if (!orig) delete process.env.REQUIRE_MFA;
  });

  it("returns false for other values", () => {
    const orig = process.env.REQUIRE_MFA;
    process.env.REQUIRE_MFA = "yes";
    assert.equal(isMFARequired(), false);
    process.env.REQUIRE_MFA = "1";
    assert.equal(isMFARequired(), false);
    if (orig !== undefined) process.env.REQUIRE_MFA = orig;
    else delete process.env.REQUIRE_MFA;
  });
});

describe("isMFARoleRequired", () => {
  it("returns true for admin", () => {
    assert.ok(isMFARoleRequired("admin"));
  });

  it("returns true for manager", () => {
    assert.ok(isMFARoleRequired("manager"));
  });

  it("returns false for viewer", () => {
    assert.ok(!isMFARoleRequired("viewer"));
  });

  it("returns false for unknown roles", () => {
    assert.ok(!isMFARoleRequired("unknown"));
    assert.ok(!isMFARoleRequired(""));
  });
});
