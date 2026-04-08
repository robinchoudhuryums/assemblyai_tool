import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SessionExpiredError,
  resetSessionExpired,
  getCsrfToken,
  _peekSessionState,
  _resetSessionStateForTests,
} from "./queryClient";
import { LOGIN_GRACE_MS } from "./constants";

describe("SessionExpiredError", () => {
  it("has the right name and is recognizable via instanceof", () => {
    const err = new SessionExpiredError();
    expect(err.name).toBe("SessionExpiredError");
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/expired/i);
  });
});

describe("getCsrfToken", () => {
  let originalCookie: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  });

  afterEach(() => {
    if (originalCookie) Object.defineProperty(Document.prototype, "cookie", originalCookie);
  });

  it("returns undefined when csrf_token cookie is absent", () => {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: () => "session=abc; flavor=mint",
    });
    expect(getCsrfToken()).toBeUndefined();
  });

  it("extracts csrf_token from a cookie string", () => {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: () => "session=abc; csrf_token=xyz123; theme=dark",
    });
    expect(getCsrfToken()).toBe("xyz123");
  });

  it("trims surrounding whitespace from cookie segments", () => {
    // Implementation calls .trim() on each ';'-separated segment before
    // matching, so leading/trailing whitespace inside the segment is gone
    // by the time .startsWith("csrf_token=") runs. Trailing whitespace
    // inside the value is part of the segment-trim, so it's also removed.
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: () => "  csrf_token=abc  ;  other=1",
    });
    expect(getCsrfToken()).toBe("abc");
  });
});

describe("resetSessionExpired", () => {
  beforeEach(() => {
    _resetSessionStateForTests();
  });

  it("can be called repeatedly without throwing", () => {
    expect(() => {
      resetSessionExpired();
      resetSessionExpired();
    }).not.toThrow();
  });

  it("clears sessionExpired and marks hadSession=true", () => {
    const before = _peekSessionState();
    expect(before.hadSession).toBe(false);
    resetSessionExpired();
    const after = _peekSessionState();
    expect(after.sessionExpired).toBe(false);
    expect(after.hadSession).toBe(true);
    expect(after.lastLoginAt).toBeGreaterThan(0);
  });

  it("stamps lastLoginAt within the grace window", () => {
    const t0 = Date.now();
    resetSessionExpired();
    const { lastLoginAt } = _peekSessionState();
    expect(lastLoginAt).toBeGreaterThanOrEqual(t0);
    expect(lastLoginAt).toBeLessThanOrEqual(Date.now());
    // Grace window covers the next LOGIN_GRACE_MS milliseconds.
    expect(Date.now() - lastLoginAt).toBeLessThan(LOGIN_GRACE_MS);
  });
});

describe("LOGIN_GRACE_MS", () => {
  it("is a positive number", () => {
    expect(typeof LOGIN_GRACE_MS).toBe("number");
    expect(LOGIN_GRACE_MS).toBeGreaterThan(0);
  });
});
