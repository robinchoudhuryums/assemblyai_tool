import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBeforeUnload } from "./use-before-unload";

describe("useBeforeUnload", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("adds exactly one beforeunload listener when isDirty is true", () => {
    renderHook(() => useBeforeUnload(true));
    const calls = addSpy.mock.calls.filter(([event]) => event === "beforeunload");
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toEqual(expect.any(Function));
  });

  it("does not add a beforeunload listener when isDirty is false", () => {
    renderHook(() => useBeforeUnload(false));
    const calls = addSpy.mock.calls.filter(([event]) => event === "beforeunload");
    expect(calls.length).toBe(0);
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useBeforeUnload(true));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("removes listener when isDirty changes to false", () => {
    const { rerender } = renderHook(({ dirty }) => useBeforeUnload(dirty), {
      initialProps: { dirty: true },
    });
    rerender({ dirty: false });
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});
