/**
 * Tests for the gamification service: points computation, streak logic.
 *
 * A1/F04: imports computePoints from production code rather than re-implementing
 * it in the test file. Re-implementing meant the tests passed even when production
 * code drifted (the production version was never executed by the test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePoints } from "../server/services/gamification.js";

// --- Helpers ---

type CallLike = { analysis?: { performanceScore?: string } | null };

function makeCall(score: string): CallLike {
  return { analysis: { performanceScore: score } };
}

function makeCalls(scores: string[]): CallLike[] {
  return scores.map(makeCall);
}

// --- Tests ---

describe("computePoints", () => {
  it("returns 0 for empty calls and no badges", () => {
    assert.equal(computePoints([], 0), 0);
  });

  it("awards base 10 points for a call scored at 5.0 (no bonus)", () => {
    assert.equal(computePoints(makeCalls(["5.0"]), 0), 10);
  });

  it("awards score bonus for high scores with streak multiplier", () => {
    // score=8.0: base 10 + (8-5)*5 = 25 points. Streak of 1 → 25 * 1.5 = 37.5 → round = 38
    const pts = computePoints(makeCalls(["8.0"]), 0);
    assert.equal(pts, 38);
  });

  it("awards score bonus without streak for scores below 8.0", () => {
    // score=7.0: base 10 + (7-5)*5 = 20 points. No streak (7.0 < 8.0). No multiplier.
    assert.equal(computePoints(makeCalls(["7.0"]), 0), 20);
  });

  it("awards only base points for low scores", () => {
    assert.equal(computePoints(makeCalls(["3.0"]), 0), 10);
  });

  it("awards badge bonus", () => {
    // 1 call at 5.0 = 10 pts + 3 badges * 50 = 160
    assert.equal(computePoints(makeCalls(["5.0"]), 3), 160);
  });

  it("applies streak multiplier to consecutive high-score calls", () => {
    // Three calls all 9.0: streak = 3
    // Each: base 10 + (9-5)*5 = 30, multiplied by 1.5 = 45
    // Total: 45 * 3 = 135
    const pts = computePoints(makeCalls(["9.0", "9.0", "9.0"]), 0);
    assert.equal(pts, 135);
  });

  it("streak breaks at low score — only recent streak gets multiplier", () => {
    // Calls (most recent first): [9.0, 9.0, 5.0, 9.0]
    // Streak = 2 (first two >= 8.0, third breaks)
    // Index 0: 30 * 1.5 = 45, Index 1: 30 * 1.5 = 45, Index 2: 10, Index 3: 30
    // Total: 45 + 45 + 10 + 30 = 130
    const pts = computePoints(makeCalls(["9.0", "9.0", "5.0", "9.0"]), 0);
    assert.equal(pts, 130);
  });

  it("handles missing performanceScore gracefully", () => {
    const calls: CallLike[] = [
      { analysis: { performanceScore: "8.0" } },
      { analysis: {} },
      { analysis: null },
    ];
    // Streak = 1 (8.0 >= 8.0, then 0 < 8.0)
    // Index 0: 25 * 1.5 = 37.5, Index 1: 10, Index 2: 10
    // Total: 57.5 → round = 58
    const pts = computePoints(calls, 0);
    assert.equal(pts, 58);
  });

  it("combines call points and badge bonus", () => {
    // 2 calls at 10.0: streak = 2
    // Each: 10 + (10-5)*5 = 35, * 1.5 = 52.5
    // Total calls: 105 + 2 badges * 50 = 205
    const pts = computePoints(makeCalls(["10.0", "10.0"]), 2);
    assert.equal(pts, 205);
  });

  it("handles zero-score calls", () => {
    assert.equal(computePoints(makeCalls(["0"]), 0), 10);
  });

  it("handles large number of calls", () => {
    const scores = Array.from({ length: 100 }, () => "7.5");
    const pts = computePoints(makeCalls(scores), 0);
    // score=7.5: 10 + (7.5-5)*5 = 22.5 per call. No streak (7.5 < 8.0).
    assert.equal(pts, 2250);
  });
});
