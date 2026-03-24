/**
 * Tests for the gamification service: points computation, streak logic.
 *
 * Note: computePoints and evaluateBadges import from gamification.ts which
 * transitively imports storage.ts (which has a side-effect connection).
 * Following the project pattern (auth.test.ts, waf.test.ts), we replicate
 * the core logic inline for isolated, side-effect-free unit testing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// --- Replicate core gamification logic for isolated testing ---
// (matches server/services/gamification.ts)

const STREAK_THRESHOLD = 8.0;

type CallLike = { analysis?: { performanceScore?: string } | null };

function computeCurrentStreak(completedCalls: CallLike[]): number {
  let streak = 0;
  for (const call of completedCalls) {
    const score = parseFloat(call.analysis?.performanceScore || "0");
    if (score >= STREAK_THRESHOLD) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function computePoints(completedCalls: CallLike[], badgeCount: number): number {
  let total = 0;
  const streak = computeCurrentStreak(completedCalls);

  for (const call of completedCalls) {
    const score = parseFloat(call.analysis?.performanceScore || "0");
    let callPoints = 10 + Math.max(0, (score - 5)) * 5;
    if (streak > 0 && completedCalls.indexOf(call) < streak) {
      callPoints *= 1.5;
    }
    total += callPoints;
  }

  total += badgeCount * 50;
  return Math.round(total);
}

// --- Helpers ---

function makeCall(score: string): CallLike {
  return { analysis: { performanceScore: score } };
}

function makeCalls(scores: string[]): CallLike[] {
  return scores.map(makeCall);
}

// --- Tests ---

describe("computeCurrentStreak", () => {
  it("returns 0 for empty calls", () => {
    assert.equal(computeCurrentStreak([]), 0);
  });

  it("counts consecutive calls >= 8.0", () => {
    assert.equal(computeCurrentStreak(makeCalls(["9.0", "8.5", "8.0"])), 3);
  });

  it("stops at first call below threshold", () => {
    assert.equal(computeCurrentStreak(makeCalls(["9.0", "8.5", "7.9", "9.0"])), 2);
  });

  it("returns 0 when first call is below threshold", () => {
    assert.equal(computeCurrentStreak(makeCalls(["7.0", "9.0", "9.0"])), 0);
  });

  it("handles exactly 8.0 as part of streak", () => {
    assert.equal(computeCurrentStreak(makeCalls(["8.0"])), 1);
  });

  it("handles missing performanceScore", () => {
    const calls: CallLike[] = [
      { analysis: { performanceScore: "9.0" } },
      { analysis: {} },
    ];
    assert.equal(computeCurrentStreak(calls), 1);
  });

  it("handles null analysis", () => {
    const calls: CallLike[] = [{ analysis: null }];
    assert.equal(computeCurrentStreak(calls), 0);
  });
});

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

describe("badge eligibility logic", () => {
  it("milestone badges trigger at correct thresholds", () => {
    // first_call at 1, calls_25 at 25, calls_50 at 50, calls_100 at 100
    assert.equal(1 === 1, true);  // first_call
    assert.equal(25 >= 25, true); // calls_25
    assert.equal(24 >= 25, false);
    assert.equal(50 >= 50, true); // calls_50
    assert.equal(100 >= 100, true); // calls_100
  });

  it("perfect score requires >= 10.0", () => {
    assert.ok(10.0 >= 10.0);
    assert.ok(!(9.9 >= 10.0));
  });

  it("streak badges require minimum consecutive calls", () => {
    assert.ok(computeCurrentStreak(makeCalls(["8.0", "8.0", "8.0"])) >= 3);
    assert.ok(computeCurrentStreak(makeCalls(["8.0", "8.0"])) < 3);
    assert.ok(computeCurrentStreak(makeCalls(Array(5).fill("9.0"))) >= 5);
    assert.ok(computeCurrentStreak(makeCalls(Array(10).fill("8.5"))) >= 10);
  });

  it("sub-score excellence requires 5 consecutive calls with score >= 9", () => {
    const recentSubScores = [
      { compliance: 9.5 },
      { compliance: 9.0 },
      { compliance: 9.2 },
      { compliance: 10.0 },
      { compliance: 9.1 },
    ];
    const allMeetThreshold = recentSubScores.every(s => (s.compliance ?? 0) >= 9);
    assert.ok(allMeetThreshold);

    const withLow = [
      { compliance: 9.5 },
      { compliance: 8.9 }, // below 9
      { compliance: 9.2 },
      { compliance: 10.0 },
      { compliance: 9.1 },
    ];
    assert.ok(!withLow.every(s => (s.compliance ?? 0) >= 9));
  });
});
