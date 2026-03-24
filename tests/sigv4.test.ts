/**
 * Tests for AWS Signature V4 signing utilities.
 * All tests are pure (deterministic crypto, no network, no mocks).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sha256,
  sha256Buffer,
  hmac,
  hmacHex,
  getSignatureKey,
  formatAmzDate,
  encodeCanonicalUri,
  signRequest,
  generatePresignedUrl,
  EMPTY_PAYLOAD_HASH,
} from "../server/services/sigv4.js";

describe("sha256", () => {
  it("computes correct hash for empty string", () => {
    assert.equal(sha256(""), EMPTY_PAYLOAD_HASH);
  });

  it("computes correct hash for known input", () => {
    // Known SHA-256 of "hello"
    assert.equal(
      sha256("hello"),
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("handles UTF-8 content", () => {
    const hash = sha256("日本語テスト");
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64); // SHA-256 hex is always 64 chars
  });
});

describe("sha256Buffer", () => {
  it("computes same hash as string version for ASCII", () => {
    const input = "test data";
    assert.equal(sha256Buffer(Buffer.from(input, "utf8")), sha256(input));
  });

  it("computes correct hash for empty buffer", () => {
    assert.equal(sha256Buffer(Buffer.alloc(0)), EMPTY_PAYLOAD_HASH);
  });

  it("handles binary content", () => {
    const buf = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
    const hash = sha256Buffer(buf);
    assert.equal(hash.length, 64);
  });
});

describe("hmac", () => {
  it("returns a Buffer", () => {
    const result = hmac("key", "data");
    assert.ok(Buffer.isBuffer(result));
  });

  it("produces 32-byte output (SHA-256)", () => {
    assert.equal(hmac("key", "data").length, 32);
  });

  it("is deterministic", () => {
    const a = hmac("secret", "message");
    const b = hmac("secret", "message");
    assert.deepEqual(a, b);
  });

  it("differs with different keys", () => {
    const a = hmac("key1", "data");
    const b = hmac("key2", "data");
    assert.notDeepEqual(a, b);
  });
});

describe("hmacHex", () => {
  it("returns hex string", () => {
    const result = hmacHex("key", "data");
    assert.match(result, /^[0-9a-f]{64}$/);
  });

  it("matches Buffer version as hex", () => {
    const hex = hmacHex("key", "data");
    const buf = hmac("key", "data");
    assert.equal(hex, buf.toString("hex"));
  });
});

describe("getSignatureKey", () => {
  it("returns a 32-byte Buffer", () => {
    const key = getSignatureKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20260319", "us-east-1", "s3");
    assert.ok(Buffer.isBuffer(key));
    assert.equal(key.length, 32);
  });

  it("produces different keys for different regions", () => {
    const k1 = getSignatureKey("secret", "20260319", "us-east-1", "s3");
    const k2 = getSignatureKey("secret", "20260319", "eu-west-1", "s3");
    assert.notDeepEqual(k1, k2);
  });

  it("produces different keys for different services", () => {
    const k1 = getSignatureKey("secret", "20260319", "us-east-1", "s3");
    const k2 = getSignatureKey("secret", "20260319", "us-east-1", "bedrock-runtime");
    assert.notDeepEqual(k1, k2);
  });

  it("produces different keys for different dates", () => {
    const k1 = getSignatureKey("secret", "20260319", "us-east-1", "s3");
    const k2 = getSignatureKey("secret", "20260320", "us-east-1", "s3");
    assert.notDeepEqual(k1, k2);
  });
});

describe("formatAmzDate", () => {
  it("formats a UTC date correctly", () => {
    const date = new Date("2026-03-19T12:30:45.123Z");
    const result = formatAmzDate(date);
    assert.equal(result, "20260319T123045Z");
  });

  it("handles midnight", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    assert.equal(formatAmzDate(date), "20260101T000000Z");
  });

  it("handles end of day", () => {
    const date = new Date("2026-12-31T23:59:59.999Z");
    assert.equal(formatAmzDate(date), "20261231T235959Z");
  });
});

describe("encodeCanonicalUri", () => {
  it("encodes simple path segments", () => {
    assert.equal(encodeCanonicalUri("/bucket/key"), "/bucket/key");
  });

  it("encodes special characters in segments", () => {
    const result = encodeCanonicalUri("/bucket/my file.txt");
    assert.equal(result, "/bucket/my%20file.txt");
  });

  it("preserves slashes as separators", () => {
    const result = encodeCanonicalUri("/a/b/c/d");
    assert.equal(result, "/a/b/c/d");
  });

  it("handles empty path", () => {
    assert.equal(encodeCanonicalUri("/"), "/");
  });

  it("encodes unicode in path segments", () => {
    const result = encodeCanonicalUri("/bucket/日本語");
    assert.ok(result.startsWith("/bucket/"));
    assert.ok(result.includes("%"));
  });
});

describe("EMPTY_PAYLOAD_HASH", () => {
  it("equals SHA-256 of empty string", () => {
    assert.equal(EMPTY_PAYLOAD_HASH, sha256(""));
  });
});

describe("signRequest", () => {
  const baseCreds = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
  };

  it("returns required headers", () => {
    const headers = signRequest({
      method: "GET",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/my-bucket/my-key",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
    });

    assert.ok(headers.Host);
    assert.ok(headers["X-Amz-Date"]);
    assert.ok(headers.Authorization);
    assert.ok(headers.Authorization.startsWith("AWS4-HMAC-SHA256"));
  });

  it("includes credential scope in Authorization", () => {
    const headers = signRequest({
      method: "GET",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
    });

    assert.ok(headers.Authorization.includes("Credential=AKIAIOSFODNN7EXAMPLE/"));
    assert.ok(headers.Authorization.includes("/us-east-1/s3/aws4_request"));
    assert.ok(headers.Authorization.includes("SignedHeaders="));
    assert.ok(headers.Authorization.includes("Signature="));
  });

  it("includes session token when provided", () => {
    const headers = signRequest({
      method: "GET",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/",
      service: "s3",
      region: "us-east-1",
      creds: { ...baseCreds, sessionToken: "FwoGZXIvYXdzEBY" },
    });

    assert.equal(headers["X-Amz-Security-Token"], "FwoGZXIvYXdzEBY");
    assert.ok(headers.Authorization.includes("x-amz-security-token"));
  });

  it("omits session token header when not provided", () => {
    const headers = signRequest({
      method: "GET",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
    });

    assert.equal(headers["X-Amz-Security-Token"], undefined);
  });

  it("includes extra headers in signature and output", () => {
    const headers = signRequest({
      method: "POST",
      host: "bedrock-runtime.us-east-1.amazonaws.com",
      rawPath: "/model/invoke",
      service: "bedrock",
      region: "us-east-1",
      creds: baseCreds,
      extraHeaders: [["content-type", "application/json"]],
    });

    assert.ok(headers.Authorization.includes("content-type"));
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("computes payload hash from body when not provided", () => {
    const headers1 = signRequest({
      method: "POST",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/bucket/key",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
      body: '{"hello":"world"}',
    });

    const headers2 = signRequest({
      method: "POST",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/bucket/key",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
      body: '{"different":"body"}',
    });

    // Different bodies should produce different signatures
    assert.notEqual(
      headers1.Authorization.split("Signature=")[1],
      headers2.Authorization.split("Signature=")[1]
    );
  });

  it("uses EMPTY_PAYLOAD_HASH for requests without body", () => {
    // This should not throw — empty payload hash is used for bodiless requests
    const headers = signRequest({
      method: "GET",
      host: "s3.us-east-1.amazonaws.com",
      rawPath: "/bucket/key",
      service: "s3",
      region: "us-east-1",
      creds: baseCreds,
    });

    assert.ok(headers.Authorization);
  });
});

describe("generatePresignedUrl", () => {
  const creds = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
  };

  it("generates a valid HTTPS URL", () => {
    const url = generatePresignedUrl({
      host: "my-bucket.s3.us-east-1.amazonaws.com",
      objectName: "calls/audio-123.mp3",
      region: "us-east-1",
      creds,
    });

    assert.ok(url.startsWith("https://my-bucket.s3.us-east-1.amazonaws.com/"));
    assert.ok(url.includes("calls/audio-123.mp3"));
  });

  it("includes all required query parameters", () => {
    const url = generatePresignedUrl({
      host: "my-bucket.s3.us-east-1.amazonaws.com",
      objectName: "test.json",
      region: "us-east-1",
      creds,
    });

    assert.ok(url.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
    assert.ok(url.includes("X-Amz-Credential="));
    assert.ok(url.includes("X-Amz-Date="));
    assert.ok(url.includes("X-Amz-Expires="));
    assert.ok(url.includes("X-Amz-SignedHeaders=host"));
    assert.ok(url.includes("X-Amz-Signature="));
  });

  it("respects custom expiration", () => {
    const url = generatePresignedUrl({
      host: "bucket.s3.us-east-1.amazonaws.com",
      objectName: "test.json",
      region: "us-east-1",
      creds,
      expiresInSeconds: 300,
    });

    assert.ok(url.includes("X-Amz-Expires=300"));
  });

  it("defaults to 3600 second expiration", () => {
    const url = generatePresignedUrl({
      host: "bucket.s3.us-east-1.amazonaws.com",
      objectName: "test.json",
      region: "us-east-1",
      creds,
    });

    assert.ok(url.includes("X-Amz-Expires=3600"));
  });

  it("includes session token in query when present", () => {
    const url = generatePresignedUrl({
      host: "bucket.s3.us-east-1.amazonaws.com",
      objectName: "test.json",
      region: "us-east-1",
      creds: { ...creds, sessionToken: "FwoGZXIvYXdzEBY" },
    });

    assert.ok(url.includes("X-Amz-Security-Token="));
  });

  it("encodes special characters in object name", () => {
    const url = generatePresignedUrl({
      host: "bucket.s3.us-east-1.amazonaws.com",
      objectName: "calls/my audio file (1).mp3",
      region: "us-east-1",
      creds,
    });

    assert.ok(url.includes("my%20audio%20file"));
  });
});
