import { describe, it, expect } from "vitest";
import { computeSearchMatches, findGlobalMatchIndex } from "./transcript-search";

describe("computeSearchMatches", () => {
  it("returns empty array for empty/whitespace query", () => {
    const segments = [{ text: "hello world" }];
    expect(computeSearchMatches(segments, "")).toEqual([]);
    expect(computeSearchMatches(segments, "   ")).toEqual([]);
  });

  it("finds a single match in a single segment", () => {
    const segments = [{ text: "hello world" }];
    expect(computeSearchMatches(segments, "world")).toEqual([
      { segmentIndex: 0, charIndex: 6 },
    ]);
  });

  it("is case-insensitive", () => {
    const segments = [{ text: "Hello World" }];
    expect(computeSearchMatches(segments, "WORLD")).toEqual([
      { segmentIndex: 0, charIndex: 6 },
    ]);
  });

  it("finds multiple matches inside a single segment (the regression case)", () => {
    // Segment with three "test" hits at indices 0, 8, and 16.
    const segments = [{ text: "test and test and test ok" }];
    expect(computeSearchMatches(segments, "test")).toEqual([
      { segmentIndex: 0, charIndex: 0 },
      { segmentIndex: 0, charIndex: 9 },
      { segmentIndex: 0, charIndex: 18 },
    ]);
  });

  it("finds matches across multiple segments and preserves segment order", () => {
    const segments = [
      { text: "alpha beta" },
      { text: "beta gamma" },
      { text: "delta beta epsilon beta" },
    ];
    expect(computeSearchMatches(segments, "beta")).toEqual([
      { segmentIndex: 0, charIndex: 6 },
      { segmentIndex: 1, charIndex: 0 },
      { segmentIndex: 2, charIndex: 6 },
      { segmentIndex: 2, charIndex: 19 },
    ]);
  });

  it("handles overlapping matches via single-char step", () => {
    // "aaa" contains two overlapping "aa" matches at positions 0 and 1.
    const segments = [{ text: "aaa" }];
    expect(computeSearchMatches(segments, "aa")).toEqual([
      { segmentIndex: 0, charIndex: 0 },
      { segmentIndex: 0, charIndex: 1 },
    ]);
  });
});

describe("findGlobalMatchIndex", () => {
  it("maps a (segmentIndex, charIndex) part-start back to its global index", () => {
    const matches = [
      { segmentIndex: 0, charIndex: 0 },
      { segmentIndex: 0, charIndex: 9 },
      { segmentIndex: 0, charIndex: 18 },
      { segmentIndex: 1, charIndex: 4 },
    ];
    expect(findGlobalMatchIndex(matches, 0, 0)).toBe(0);
    expect(findGlobalMatchIndex(matches, 0, 9)).toBe(1);
    expect(findGlobalMatchIndex(matches, 0, 18)).toBe(2);
    expect(findGlobalMatchIndex(matches, 1, 4)).toBe(3);
  });

  it("returns -1 when no entry matches", () => {
    const matches = [{ segmentIndex: 0, charIndex: 0 }];
    expect(findGlobalMatchIndex(matches, 0, 5)).toBe(-1);
    expect(findGlobalMatchIndex(matches, 1, 0)).toBe(-1);
  });

  it("active-occurrence regression: each hit in a multi-hit segment maps uniquely", () => {
    // Reproduces the original bug: with three hits in one segment, the old
    // code computed the same active index for every occurrence. With the
    // fix, walking parts via running char position should produce three
    // distinct global indices.
    const segmentText = "test and test and test ok";
    const matches = computeSearchMatches([{ text: segmentText }], "test");

    // Simulate String.split(/(test)/i) → ["", "test", " and ", "test", " and ", "test", " ok"]
    // and walk parts tracking running position.
    const parts = segmentText.split(/(test)/i);
    let running = 0;
    const globalIndices: number[] = [];
    for (const part of parts) {
      const partStart = running;
      running += part.length;
      if (part.toLowerCase() === "test") {
        globalIndices.push(findGlobalMatchIndex(matches, 0, partStart));
      }
    }
    expect(globalIndices).toEqual([0, 1, 2]);
  });
});
