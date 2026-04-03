import { describe, it, expect } from "vitest";
import { toDisplayString, extractErrorMessage } from "./display-utils";

describe("toDisplayString", () => {
  it("returns empty string for null/undefined", () => {
    expect(toDisplayString(null)).toBe("");
    expect(toDisplayString(undefined)).toBe("");
  });

  it("returns string values directly", () => {
    expect(toDisplayString("hello")).toBe("hello");
  });

  it("converts numbers and booleans", () => {
    expect(toDisplayString(42)).toBe("42");
    expect(toDisplayString(true)).toBe("true");
    expect(toDisplayString(0)).toBe("0");
  });

  it("extracts .text from objects", () => {
    expect(toDisplayString({ text: "from text" })).toBe("from text");
  });

  it("extracts .name from objects", () => {
    expect(toDisplayString({ name: "from name" })).toBe("from name");
  });

  it("extracts .task from objects", () => {
    expect(toDisplayString({ task: "do something" })).toBe("do something");
  });

  it("extracts .label from objects", () => {
    expect(toDisplayString({ label: "my label" })).toBe("my label");
  });

  it("extracts .description from objects", () => {
    expect(toDisplayString({ description: "desc" })).toBe("desc");
  });

  it("falls back to JSON.stringify for unknown objects", () => {
    const result = toDisplayString({ foo: "bar" });
    expect(result).toBe('{"foo":"bar"}');
  });

  it("prefers .text over other properties", () => {
    expect(toDisplayString({ text: "win", name: "lose" })).toBe("win");
  });

  // XSS sanitization
  it("strips HTML tags from strings", () => {
    expect(toDisplayString("<script>alert('xss')</script>")).toBe("alert('xss')");
  });

  it("strips encoded HTML entities", () => {
    const result = toDisplayString("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("&lt;script");
  });

  it("removes javascript: URIs", () => {
    expect(toDisplayString("javascript:alert(1)")).toBe("alert(1)");
  });

  it("removes event handlers", () => {
    expect(toDisplayString('onerror=alert(1)')).toBe("alert(1)");
    expect(toDisplayString('onclick=steal()')).toBe("steal()");
  });

  it("removes null bytes", () => {
    expect(toDisplayString("hello\x00world")).toBe("helloworld");
  });
});

describe("extractErrorMessage", () => {
  it("returns default for null/undefined", () => {
    expect(extractErrorMessage(null)).toBe("An unexpected error occurred.");
    expect(extractErrorMessage(undefined)).toBe("An unexpected error occurred.");
  });

  it("strips HTTP status prefix", () => {
    expect(extractErrorMessage(new Error("401: Session expired"))).toBe("Session expired");
    expect(extractErrorMessage(new Error("500: Internal error"))).toBe("Internal error");
  });

  it("passes through messages without prefix", () => {
    expect(extractErrorMessage(new Error("Something failed"))).toBe("Something failed");
  });

  it("handles non-Error values", () => {
    expect(extractErrorMessage("raw string error")).toBe("raw string error");
    expect(extractErrorMessage(42)).toBe("42");
  });
});
