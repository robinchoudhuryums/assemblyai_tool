/**
 * Unit tests for the pure helpers extracted from
 * /api/scoring-corrections/similar-uncorrected (Tier C #8).
 *
 * These are the grouping + matching building blocks that the route
 * composes against live storage. Tested in isolation because the logic
 * (mean centroid, category generalization, score proximity, edit-skip)
 * is the interesting part; the route handler is just plumbing.
 *
 * Run with: npx tsx --test tests/scoring-feedback-helpers.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupCorrectionsByCategoryDirection,
  findSimilarUncorrectedCalls,
  type SimilarCallCandidate,
} from "../server/services/scoring-feedback";

type CorrectionSeed = {
  callCategory?: string | null;
  direction: "upgraded" | "downgraded";
  originalScore: number;
};

describe("groupCorrectionsByCategoryDirection", () => {
  it("returns empty array on empty input", () => {
    assert.deepEqual(groupCorrectionsByCategoryDirection([]), []);
  });

  it("groups by (category, direction) and averages the originalScore centroid", () => {
    const corrections: CorrectionSeed[] = [
      { callCategory: "inbound", direction: "upgraded", originalScore: 3.0 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 4.0 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 5.0 },
    ];
    const groups = groupCorrectionsByCategoryDirection(corrections);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].category, "inbound");
    assert.equal(groups[0].direction, "upgraded");
    assert.equal(groups[0].count, 3);
    assert.equal(groups[0].centroid, 4); // (3+4+5)/3
  });

  it("treats null/undefined category as 'general' for grouping", () => {
    const groups = groupCorrectionsByCategoryDirection([
      { callCategory: null, direction: "upgraded", originalScore: 3 },
      { callCategory: undefined, direction: "upgraded", originalScore: 5 },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].category, "general");
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].centroid, 4);
  });

  it("splits same category into two groups when direction differs", () => {
    const groups = groupCorrectionsByCategoryDirection([
      { callCategory: "inbound", direction: "upgraded", originalScore: 3 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 4 },
      { callCategory: "inbound", direction: "downgraded", originalScore: 9 },
      { callCategory: "inbound", direction: "downgraded", originalScore: 8 },
    ]);
    assert.equal(groups.length, 2);
    const up = groups.find(g => g.direction === "upgraded");
    const down = groups.find(g => g.direction === "downgraded");
    assert.ok(up);
    assert.ok(down);
    assert.equal(up.count, 2);
    assert.equal(down.count, 2);
    assert.equal(up.centroid, 3.5);
    assert.equal(down.centroid, 8.5);
  });

  it("drops groups with fewer than minCount corrections (default 2)", () => {
    const groups = groupCorrectionsByCategoryDirection([
      { callCategory: "inbound", direction: "upgraded", originalScore: 3 },
      { callCategory: "outbound", direction: "upgraded", originalScore: 7 },
    ]);
    assert.equal(groups.length, 0, "single-correction groups should be filtered out");
  });

  it("respects a custom minCount threshold", () => {
    const corrections: CorrectionSeed[] = [
      { callCategory: "inbound", direction: "upgraded", originalScore: 3 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 4 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 5 },
      { callCategory: "outbound", direction: "upgraded", originalScore: 6 },
      { callCategory: "outbound", direction: "upgraded", originalScore: 6 },
    ];
    // minCount=3 → only inbound group qualifies
    const groups = groupCorrectionsByCategoryDirection(corrections, 3);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].category, "inbound");
  });

  it("sorts groups by count descending (biggest pattern first)", () => {
    const corrections: CorrectionSeed[] = [
      { callCategory: "outbound", direction: "upgraded", originalScore: 6 },
      { callCategory: "outbound", direction: "upgraded", originalScore: 6 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 3 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 4 },
      { callCategory: "inbound", direction: "upgraded", originalScore: 5 },
    ];
    const groups = groupCorrectionsByCategoryDirection(corrections);
    assert.equal(groups[0].category, "inbound", "inbound has 3 corrections, outbound has 2");
    assert.equal(groups[1].category, "outbound");
  });
});

describe("findSimilarUncorrectedCalls", () => {
  const mkCall = (
    id: string,
    score: number,
    category?: string,
    extras: Partial<SimilarCallCandidate> = {},
  ): SimilarCallCandidate => ({
    id,
    callCategory: category,
    uploadedAt: "2026-01-01T00:00:00Z",
    analysis: { performanceScore: score.toString() },
    ...extras,
  });

  it("returns empty suggestions when no groups qualify", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [],
      calls: [mkCall("c1", 5.0, "inbound")],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.deepEqual(out, []);
  });

  it("matches calls within windowScore of a group's centroid", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("close", 5.3, "inbound"),   // within 0.5
        mkCall("right-at", 5.5, "inbound"),  // at boundary
        mkCall("too-far", 5.6, "inbound"),  // just outside
        mkCall("low", 4.4, "inbound"),      // just outside
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(s => s.callId).sort(), ["close", "right-at"]);
  });

  it("requires exact category match when group.category != 'general'", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("inbound-hit", 5.1, "inbound"),
        mkCall("outbound-miss", 5.1, "outbound"),
        mkCall("internal-miss", 5.1, "internal"),
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].callId, "inbound-hit");
  });

  it("'general' category matches any call category", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "general", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("inbound", 5.1, "inbound"),
        mkCall("outbound", 5.1, "outbound"),
        mkCall("null-cat", 5.1, undefined),
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out.length, 3);
  });

  it("skips calls the user already corrected", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("already-edited", 5.1, "inbound"),
        mkCall("untouched", 5.1, "inbound"),
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(["already-edited"]),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].callId, "untouched");
  });

  it("skips calls this user already manually edited via manualEdits entry", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("edited-by-me", 5.1, "inbound", {
          analysis: {
            performanceScore: "5.1",
            manualEdits: [{ editedBy: "manager" }],
          },
        }),
        mkCall("edited-by-other", 5.1, "inbound", {
          analysis: {
            performanceScore: "5.1",
            manualEdits: [{ editedBy: "admin" }],
          },
        }),
        mkCall("no-edits", 5.1, "inbound"),
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    // "edited-by-me" is skipped; "edited-by-other" and "no-edits" are kept.
    const ids = out.map(s => s.callId).sort();
    assert.deepEqual(ids, ["edited-by-other", "no-edits"]);
  });

  it("skips calls whose performanceScore is missing / unparseable", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "general", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        mkCall("ok", 5.0),
        { id: "null-score", analysis: { performanceScore: null } },
        { id: "empty-score", analysis: { performanceScore: "" } },
        { id: "nan-score", analysis: { performanceScore: "not a number" } },
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].callId, "ok");
  });

  it("caps per-group results at perGroupLimit", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: Array.from({ length: 10 }, (_, i) => mkCall(`c${i}`, 5.0, "inbound")),
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
      perGroupLimit: 3,
    });
    assert.equal(out.length, 3);
  });

  it("caps total results at totalCap across multiple groups", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [
        { category: "inbound", direction: "upgraded", centroid: 5.0, count: 3 },
        { category: "outbound", direction: "downgraded", centroid: 8.0, count: 3 },
      ],
      calls: [
        ...Array.from({ length: 5 }, (_, i) => mkCall(`in${i}`, 5.0, "inbound")),
        ...Array.from({ length: 5 }, (_, i) => mkCall(`out${i}`, 8.0, "outbound")),
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
      totalCap: 4,
    });
    assert.equal(out.length, 4);
  });

  it("attaches group metadata (direction, centroid rounded to 1 decimal) to each suggestion", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "inbound", direction: "downgraded", centroid: 7.234, count: 3 }],
      calls: [mkCall("c1", 7.0, "inbound")],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].direction, "downgraded");
    assert.equal(out[0].centroid, 7.2);
    assert.equal(out[0].aiScore, 7.0);
  });

  it("copies employeeName from nested employee object when present", () => {
    const out = findSimilarUncorrectedCalls({
      groups: [{ category: "general", direction: "upgraded", centroid: 5.0, count: 3 }],
      calls: [
        {
          id: "c1",
          analysis: { performanceScore: "5.0" },
          employee: { name: "Jamie Agent" },
        },
      ],
      username: "manager",
      alreadyCorrectedCallIds: new Set(),
    });
    assert.equal(out[0].employeeName, "Jamie Agent");
  });
});
