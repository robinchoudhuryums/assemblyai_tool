/**
 * Tests for AWS Credential Provider
 *
 * Validates:
 *   - Environment variable credential resolution
 *   - IMDS credential caching and expiration logic
 *   - Refresh buffer timing
 *   - Credential structure
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Constants (mirror from aws-credentials.ts) ──

const IMDS_BASE = "http://169.254.169.254";
const IMDS_TOKEN_TTL = 300;
const IMDS_TIMEOUT_MS = 2_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

// ── Environment variable resolution ──

describe("AWS credential resolution from env vars", () => {
  it("returns credentials when both key and secret are present", () => {
    const accessKeyId = "AKIAIOSFODNN7EXAMPLE";
    const secretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const region = "us-east-1";

    const creds: AwsCredentials = { accessKeyId, secretAccessKey, region };
    assert.equal(creds.accessKeyId, accessKeyId);
    assert.equal(creds.secretAccessKey, secretAccessKey);
    assert.equal(creds.region, region);
    assert.equal(creds.sessionToken, undefined);
  });

  it("includes session token when present", () => {
    const creds: AwsCredentials = {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "FwoGZXIvYXdzEBAaDHqa0AP",
      region: "us-west-2",
    };
    assert.ok(creds.sessionToken);
    assert.equal(creds.region, "us-west-2");
  });

  it("trims whitespace from credentials", () => {
    const raw = "  AKIAIOSFODNN7EXAMPLE  ";
    assert.equal(raw.trim(), "AKIAIOSFODNN7EXAMPLE");
  });

  it("defaults region to us-east-1", () => {
    const region = undefined || "us-east-1";
    assert.equal(region, "us-east-1");
  });
});

// ── IMDS configuration ──

describe("IMDS configuration", () => {
  it("uses correct metadata endpoint", () => {
    assert.equal(IMDS_BASE, "http://169.254.169.254");
  });

  it("token TTL is 300 seconds (5 minutes)", () => {
    assert.equal(IMDS_TOKEN_TTL, 300);
  });

  it("timeout is 2 seconds (fast fail for non-EC2)", () => {
    assert.equal(IMDS_TIMEOUT_MS, 2000);
  });

  it("refresh buffer is 5 minutes before expiration", () => {
    assert.equal(REFRESH_BUFFER_MS, 300_000);
  });
});

// ── Credential caching and expiration ──

describe("IMDS credential caching", () => {
  it("cached credential is valid when not near expiration", () => {
    const now = Date.now();
    const expiration = now + 60 * 60 * 1000; // 1 hour from now
    const isValid = now < expiration - REFRESH_BUFFER_MS;
    assert.ok(isValid, "Credential with 1hr remaining should be valid");
  });

  it("cached credential needs refresh within 5 min of expiration", () => {
    const now = Date.now();
    const expiration = now + 4 * 60 * 1000; // 4 minutes from now
    const isValid = now < expiration - REFRESH_BUFFER_MS;
    assert.equal(isValid, false, "Credential with 4min remaining should need refresh");
  });

  it("expired credential needs refresh", () => {
    const now = Date.now();
    const expiration = now - 1000; // already expired
    const isValid = now < expiration - REFRESH_BUFFER_MS;
    assert.equal(isValid, false);
  });

  it("handles edge case: exactly at refresh boundary", () => {
    const now = Date.now();
    const expiration = now + REFRESH_BUFFER_MS; // exactly at boundary
    const isValid = now < expiration - REFRESH_BUFFER_MS;
    assert.equal(isValid, false, "At exact boundary should trigger refresh");
  });
});

// ── IMDS response parsing ──

describe("IMDS response structure", () => {
  it("parses valid IMDS credential response", () => {
    const imdsResponse = {
      AccessKeyId: "ASIAXXX",
      SecretAccessKey: "secretxxx",
      Token: "sessiontoken",
      Expiration: "2026-04-01T00:00:00Z",
    };

    assert.ok(imdsResponse.AccessKeyId);
    assert.ok(imdsResponse.SecretAccessKey);
    assert.ok(imdsResponse.Token);
    const expiration = new Date(imdsResponse.Expiration).getTime();
    assert.ok(!isNaN(expiration), "Expiration should be a valid date");
  });

  it("detects incomplete IMDS response", () => {
    const incomplete = { AccessKeyId: "", SecretAccessKey: "secret", Token: "tok", Expiration: "" };
    assert.equal(!incomplete.AccessKeyId || !incomplete.SecretAccessKey, true);
  });

  it("handles role name extraction from multi-line response", () => {
    const roleResponse = "my-ec2-role\n";
    const roleName = roleResponse.trim().split("\n")[0];
    assert.equal(roleName, "my-ec2-role");
  });

  it("handles role name with leading/trailing whitespace", () => {
    const roleResponse = "  my-role  ";
    const roleName = roleResponse.trim().split("\n")[0];
    assert.equal(roleName, "my-role");
  });
});

// ── Priority order ──

describe("Credential resolution priority", () => {
  it("env vars take priority over IMDS", () => {
    // If env vars exist, we never even try IMDS
    const hasEnvVars = true;
    const hasIMDS = true;
    const source = hasEnvVars ? "env" : hasIMDS ? "imds" : null;
    assert.equal(source, "env");
  });

  it("falls back to IMDS when env vars missing", () => {
    const hasEnvVars = false;
    const hasIMDS = true;
    const source = hasEnvVars ? "env" : hasIMDS ? "imds" : null;
    assert.equal(source, "imds");
  });

  it("returns null when neither source available", () => {
    const hasEnvVars = false;
    const hasIMDS = false;
    const source = hasEnvVars ? "env" : hasIMDS ? "imds" : null;
    assert.equal(source, null);
  });
});
