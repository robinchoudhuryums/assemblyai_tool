import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  it("returns null on null / undefined / empty", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
  });

  it("returns null on malformed URLs", () => {
    expect(sanitizeReturnTo("not a url")).toBeNull();
    expect(sanitizeReturnTo("://broken")).toBeNull();
    expect(sanitizeReturnTo("/just/a/path")).toBeNull();
  });

  it("rejects javascript:, data:, file:, ftp:", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnTo("data:text/html,foo")).toBeNull();
    expect(sanitizeReturnTo("file:///etc/passwd")).toBeNull();
    expect(sanitizeReturnTo("ftp://umscallanalyzer.com/")).toBeNull();
  });

  it("rejects hosts outside the umscallanalyzer.com zone", () => {
    expect(sanitizeReturnTo("https://evil.com/")).toBeNull();
    expect(sanitizeReturnTo("https://example.org/")).toBeNull();
    // Classic subdomain confusion — "umscallanalyzer.com.evil.com" is NOT
    // a subdomain of umscallanalyzer.com, and hostname comparison must
    // catch that.
    expect(sanitizeReturnTo("https://umscallanalyzer.com.evil.com/")).toBeNull();
    // Leading chars that don't form a proper subdomain boundary
    expect(sanitizeReturnTo("https://fakeumscallanalyzer.com/")).toBeNull();
  });

  it("accepts the root apex and explicit subdomains", () => {
    expect(sanitizeReturnTo("https://umscallanalyzer.com/")).toBe(
      "https://umscallanalyzer.com/",
    );
    expect(
      sanitizeReturnTo("https://knowledge.umscallanalyzer.com/chat"),
    ).toBe("https://knowledge.umscallanalyzer.com/chat");
    expect(
      sanitizeReturnTo("https://reports.staging.umscallanalyzer.com/"),
    ).toBe("https://reports.staging.umscallanalyzer.com/");
  });

  it("accepts http:// (dev convenience; prod uses https via HSTS)", () => {
    expect(
      sanitizeReturnTo("http://knowledge.umscallanalyzer.com/"),
    ).toBe("http://knowledge.umscallanalyzer.com/");
  });

  it("normalizes via URL constructor (preserves path + query, strips fragment re-encoding)", () => {
    const raw = "https://knowledge.umscallanalyzer.com/chat?thread=42";
    expect(sanitizeReturnTo(raw)).toBe(raw);
  });

  it("is hostname-case-insensitive", () => {
    expect(
      sanitizeReturnTo("https://KNOWLEDGE.UmsCallAnalyzer.com/"),
    ).not.toBeNull();
  });
});
