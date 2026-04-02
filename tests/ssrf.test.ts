/**
 * Tests for SSRF (Server-Side Request Forgery) protection.
 *
 * Validates the URL validator blocks:
 *   - Localhost and loopback addresses
 *   - Cloud metadata endpoints (AWS, GCP, Azure, Alibaba)
 *   - Private IP ranges (RFC 1918, RFC 6598)
 *   - Reserved/special-purpose addresses
 *   - Internal hostname suffixes (.local, .internal, .localhost)
 *   - Non-HTTP protocols (file://, javascript://, data://)
 *   - DNS resolution to private IPs (rebinding attack)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateUrlForSSRF, isUrlSafe } from "../server/services/url-validator.js";

// --- Synchronous checks (isUrlSafe) ---

describe("isUrlSafe — blocked hostnames", () => {
  const blocked = [
    "http://localhost/hook",
    "http://127.0.0.1/hook",
    "http://0.0.0.0/hook",
    "http://[::1]/hook",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.250/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://100.100.100.200/latest/meta-data/",
  ];

  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      assert.equal(isUrlSafe(url), false, `Expected ${url} to be blocked`);
    });
  }
});

describe("isUrlSafe — blocked suffixes", () => {
  const blocked = [
    "http://myservice.local/webhook",
    "http://api.internal/webhook",
    "http://app.localhost/webhook",
    "http://test.example/webhook",
  ];

  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      assert.equal(isUrlSafe(url), false);
    });
  }
});

describe("isUrlSafe — private IP ranges", () => {
  const privateIPs = [
    "http://10.0.0.1/hook",           // RFC 1918 class A
    "http://10.255.255.255/hook",
    "http://172.16.0.1/hook",          // RFC 1918 class B
    "http://172.31.255.255/hook",
    "http://192.168.0.1/hook",         // RFC 1918 class C
    "http://192.168.255.255/hook",
    "http://100.64.0.1/hook",          // RFC 6598 shared address
    "http://100.127.255.255/hook",
    "http://169.254.1.1/hook",         // Link-local
    "http://127.0.0.2/hook",           // Loopback range
    "http://0.0.0.0/hook",             // "This" network
    "http://224.0.0.1/hook",           // Multicast
  ];

  for (const url of privateIPs) {
    it(`blocks private IP: ${url}`, () => {
      assert.equal(isUrlSafe(url), false);
    });
  }
});

describe("isUrlSafe — allowed URLs", () => {
  const allowed = [
    "https://hooks.slack.com/services/T00/B00/xxx",
    "https://api.example.com/webhook",
    "http://webhook.site/test",
    "https://203.0.114.1/hook",  // Just outside TEST-NET-3 range (203.0.113.0/24)
  ];

  for (const url of allowed) {
    it(`allows ${url}`, () => {
      assert.equal(isUrlSafe(url), true);
    });
  }
});

describe("isUrlSafe — protocol enforcement", () => {
  it("blocks javascript: protocol", () => {
    assert.equal(isUrlSafe("javascript:alert(1)"), false);
  });

  it("blocks file: protocol", () => {
    assert.equal(isUrlSafe("file:///etc/passwd"), false);
  });

  it("blocks data: protocol", () => {
    assert.equal(isUrlSafe("data:text/html,<h1>hi</h1>"), false);
  });

  it("blocks ftp: protocol", () => {
    assert.equal(isUrlSafe("ftp://evil.com/file"), false);
  });
});

// --- Async checks with DNS resolution (validateUrlForSSRF) ---

describe("validateUrlForSSRF — basic validation", () => {
  it("rejects invalid URL format", async () => {
    const result = await validateUrlForSSRF("not-a-url", { skipDnsCheck: true });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("Invalid URL"));
  });

  it("rejects localhost", async () => {
    const result = await validateUrlForSSRF("http://localhost/hook", { skipDnsCheck: true });
    assert.equal(result.valid, false);
  });

  it("rejects AWS metadata endpoint", async () => {
    const result = await validateUrlForSSRF("http://169.254.169.254/latest/meta-data/", { skipDnsCheck: true });
    assert.equal(result.valid, false);
  });

  it("rejects private IP", async () => {
    const result = await validateUrlForSSRF("http://10.0.0.1/hook", { skipDnsCheck: true });
    assert.equal(result.valid, false);
  });

  it("accepts valid HTTPS URL", async () => {
    const result = await validateUrlForSSRF("https://hooks.slack.com/test", { skipDnsCheck: true, requireHttps: false });
    assert.equal(result.valid, true);
  });
});

describe("validateUrlForSSRF — HTTPS enforcement", () => {
  it("rejects HTTP when requireHttps is true", async () => {
    const result = await validateUrlForSSRF("http://example.com/hook", { requireHttps: true, skipDnsCheck: true });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("HTTPS"));
  });

  it("allows HTTP when requireHttps is false", async () => {
    const result = await validateUrlForSSRF("http://example.com/hook", { requireHttps: false, skipDnsCheck: true });
    assert.equal(result.valid, true);
  });
});

describe("validateUrlForSSRF — DNS resolution", () => {
  it("rejects URLs where hostname resolves to private IP", async () => {
    // localhost always resolves to 127.0.0.1
    const result = await validateUrlForSSRF("http://localhost/hook");
    assert.equal(result.valid, false);
  });

  it("rejects URLs where hostname cannot be resolved", async () => {
    const result = await validateUrlForSSRF("https://this-domain-definitely-does-not-exist-xyz123.com/hook");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("could not be resolved"));
  });
});

// --- Edge cases ---

describe("SSRF edge cases", () => {
  it("handles IPv6-mapped IPv4 addresses", () => {
    // ::ffff:127.0.0.1 is IPv6-mapped localhost
    assert.equal(isUrlSafe("http://[::ffff:127.0.0.1]/hook"), false);
  });

  it("handles URL with port number", () => {
    assert.equal(isUrlSafe("http://127.0.0.1:8080/hook"), false);
    assert.equal(isUrlSafe("https://example.com:443/hook"), true);
  });

  it("handles URL with authentication", () => {
    assert.equal(isUrlSafe("http://user:pass@127.0.0.1/hook"), false);
    assert.equal(isUrlSafe("https://user:pass@example.com/hook"), true);
  });

  it("blocks all TEST-NET ranges", () => {
    assert.equal(isUrlSafe("http://198.51.100.1/hook"), false);  // TEST-NET-2
    assert.equal(isUrlSafe("http://203.0.113.1/hook"), false);   // TEST-NET-3
  });
});
