import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIdleTimeout, IDLE_TIMEOUT_MS } from "./use-idle-timeout";

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing while disabled", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, false));
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1000); });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("fires onIdle after IDLE_TIMEOUT_MS of inactivity", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, true));
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS); });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("shows warning before timeout", () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, true));
    expect(result.current.showWarning).toBe(false);
    // 13 minutes in (warning fires at 15-2 = 13 minutes)
    act(() => { vi.advanceTimersByTime(13 * 60 * 1000); });
    expect(result.current.showWarning).toBe(true);
    expect(result.current.remainingSeconds).toBeGreaterThan(0);
  });

  it("resets the timer on user activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, true));
    // Almost timed out
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000); });
    expect(onIdle).not.toHaveBeenCalled();
    // User activity resets the deadline
    act(() => { window.dispatchEvent(new Event("keydown")); });
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000); });
    expect(onIdle).not.toHaveBeenCalled();
    // Eventually fires again from the new deadline
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("hard-redirects to /auth if onIdle throws (fail-closed)", () => {
    const onIdle = vi.fn(() => { throw new Error("logout failed"); });
    // Stub window.location.href via assigning to a writable replacement
    const originalLocation = window.location;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        get href() { return originalLocation.href; },
        set href(v: string) { hrefSpy(v); },
      },
    });
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    renderHook(() => useIdleTimeout(onIdle, true));
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS); });

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(hrefSpy).toHaveBeenCalledWith("/auth");
    expect(consoleErrSpy).toHaveBeenCalled();

    consoleErrSpy.mockRestore();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("clears timers on unmount", () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleTimeout(onIdle, true));
    unmount();
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 5000); });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
