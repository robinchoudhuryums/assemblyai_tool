import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backoffWithJitter } from "./use-websocket";

describe("backoffWithJitter", () => {
  beforeEach(() => {
    // Make Math.random deterministic so the ±30% jitter is predictable.
    vi.spyOn(Math, "random").mockReturnValue(0.5); // 0.5 → jitter contribution = 0
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at 1000ms (initial backoff)", () => {
    expect(backoffWithJitter(0)).toBe(1000);
  });

  it("doubles per attempt (exponential)", () => {
    expect(backoffWithJitter(0)).toBe(1000);
    expect(backoffWithJitter(1)).toBe(2000);
    expect(backoffWithJitter(2)).toBe(4000);
    expect(backoffWithJitter(3)).toBe(8000);
    expect(backoffWithJitter(4)).toBe(16000);
  });

  it("caps at MAX_BACKOFF_MS=30000", () => {
    expect(backoffWithJitter(5)).toBe(30000); // 32000 → capped
    expect(backoffWithJitter(10)).toBe(30000);
    expect(backoffWithJitter(20)).toBe(30000);
  });

  it("applies positive jitter when random > 0.5", () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // jitter = +30%
    // base=1000, jitter=300 → 1300
    expect(backoffWithJitter(0)).toBe(1300);
  });

  it("applies negative jitter when random = 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter = -30%
    // base=1000, jitter=-300 → 700
    expect(backoffWithJitter(0)).toBe(700);
  });

  it("never returns a negative delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // worst-case negative jitter
    for (let i = 0; i < 20; i++) {
      expect(backoffWithJitter(i)).toBeGreaterThan(0);
    }
  });

  it("jitter still applies after the cap, but cap+jitter stays bounded", () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // +30% jitter
    // base=30000 (capped), jitter=+9000 → 39000
    // Cap is on the base, not the final result — this is documented behavior.
    expect(backoffWithJitter(10)).toBe(39000);
  });
});
