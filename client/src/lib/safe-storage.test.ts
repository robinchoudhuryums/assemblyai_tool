import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { safeSet, safeGet, safeRemove } from "./safe-storage";

describe("safe-storage", () => {
  // The Vitest jsdom environment provides a real localStorage. We restore
  // the original Storage prototype methods after each test so a single
  // throwing mock doesn't bleed into subsequent cases.
  let originalSetItem: typeof Storage.prototype.setItem;
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalRemoveItem: typeof Storage.prototype.removeItem;

  beforeEach(() => {
    originalSetItem = Storage.prototype.setItem;
    originalGetItem = Storage.prototype.getItem;
    originalRemoveItem = Storage.prototype.removeItem;
    localStorage.clear();
  });

  afterEach(() => {
    Storage.prototype.setItem = originalSetItem;
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.removeItem = originalRemoveItem;
    vi.restoreAllMocks();
  });

  describe("safeSet", () => {
    it("returns true and persists the value on success", () => {
      const ok = safeSet("test-key", "test-value");
      expect(ok).toBe(true);
      expect(localStorage.getItem("test-key")).toBe("test-value");
    });

    it("returns false and warns on QuotaExceededError", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
      Storage.prototype.setItem = () => {
        const err = new DOMException("Quota exceeded", "QuotaExceededError");
        throw err;
      };

      const ok = safeSet("k", "v");
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      // The warn message should reference the key for debuggability
      const warnArgs = warnSpy.mock.calls[0];
      expect(String(warnArgs[0])).toContain("k");
    });

    it("returns false and warns on SecurityError (Safari private mode)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
      Storage.prototype.setItem = () => {
        throw new DOMException("The operation is insecure", "SecurityError");
      };

      const ok = safeSet("k", "v");
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns false and warns on a generic Error from setItem", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
      Storage.prototype.setItem = () => {
        throw new Error("storage disabled");
      };

      const ok = safeSet("k", "v");
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("does not throw to the caller under any failure", () => {
      Storage.prototype.setItem = () => { throw new Error("boom"); };
      expect(() => safeSet("k", "v")).not.toThrow();
    });
  });

  describe("safeGet", () => {
    it("returns the persisted value on success", () => {
      localStorage.setItem("k", "v");
      expect(safeGet("k")).toBe("v");
    });

    it("returns null when the key is absent", () => {
      expect(safeGet("missing")).toBe(null);
    });

    it("returns null on getItem exception (does not throw)", () => {
      Storage.prototype.getItem = () => { throw new Error("blocked"); };
      expect(() => safeGet("k")).not.toThrow();
      expect(safeGet("k")).toBe(null);
    });
  });

  describe("safeRemove", () => {
    it("returns true and removes the key on success", () => {
      localStorage.setItem("k", "v");
      const ok = safeRemove("k");
      expect(ok).toBe(true);
      expect(localStorage.getItem("k")).toBe(null);
    });

    it("returns false and warns on removeItem exception", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
      Storage.prototype.removeItem = () => { throw new Error("blocked"); };

      const ok = safeRemove("k");
      expect(ok).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("does not throw to the caller under any failure", () => {
      Storage.prototype.removeItem = () => { throw new Error("boom"); };
      expect(() => safeRemove("k")).not.toThrow();
    });
  });

  describe("isStorageAvailable guard (no window / SSR-like)", () => {
    // We can't fully delete `window` in jsdom, but we can simulate the
    // pattern by hiding `window.localStorage` and verifying the wrappers
    // gracefully no-op instead of throwing.
    it("safeSet returns false when localStorage is missing entirely", () => {
      const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
      Object.defineProperty(window, "localStorage", { configurable: true, value: undefined });
      try {
        expect(safeSet("k", "v")).toBe(false);
      } finally {
        if (originalLocalStorage) {
          Object.defineProperty(window, "localStorage", originalLocalStorage);
        }
      }
    });

    it("safeGet returns null when localStorage is missing entirely", () => {
      const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
      Object.defineProperty(window, "localStorage", { configurable: true, value: undefined });
      try {
        expect(safeGet("k")).toBe(null);
      } finally {
        if (originalLocalStorage) {
          Object.defineProperty(window, "localStorage", originalLocalStorage);
        }
      }
    });
  });
});
