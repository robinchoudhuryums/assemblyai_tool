/**
 * Synthetic-call isolation regression test.
 *
 * The Simulated Call Generator feature creates rows in the `calls` table with
 * `synthetic = TRUE`. These rows MUST be excluded from every aggregate /
 * learning / reporting read path — otherwise simulated QA data poisons
 * dashboards, leaderboards, performance snapshots, auto-calibration, and the
 * RAG knowledge base.
 *
 * This test is the canonical regression guard for that invariant. If you add
 * a new storage query that reads `calls`, add a corresponding assertion here.
 *
 * Run with: npx tsx --test tests/synthetic-call-isolation.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage.js";

let storage: MemStorage;
let realEmpId: string;

async function seedTwoCallsOneReal() {
  const emp = await storage.createEmployee({
    name: "Alice Real",
    email: "alice@real.com",
  });
  realEmpId = emp.id;

  // One real call, one synthetic call, both "completed", both with analyses.
  const realCall = await storage.createCall({
    employeeId: emp.id,
    fileName: "real.mp3",
    status: "completed",
    contentHash: "real-hash",
  });
  await storage.createCallAnalysis({
    callId: realCall.id,
    performanceScore: "8.0",
    subScores: { compliance: 8, customerExperience: 8, communication: 8, resolution: 8 } as any,
  } as any);
  await storage.createSentimentAnalysis({
    callId: realCall.id,
    overallSentiment: "positive",
    overallScore: "0.8",
  } as any);

  const synthCall = await storage.createCall({
    employeeId: emp.id,
    fileName: "simulated.mp3",
    status: "completed",
    contentHash: "synth-hash",
    synthetic: true,
  });
  await storage.createCallAnalysis({
    callId: synthCall.id,
    performanceScore: "10.0",
    subScores: { compliance: 10, customerExperience: 10, communication: 10, resolution: 10 } as any,
  } as any);
  await storage.createSentimentAnalysis({
    callId: synthCall.id,
    overallSentiment: "positive",
    overallScore: "1.0",
  } as any);
  return { realCall, synthCall };
}

beforeEach(() => {
  storage = new MemStorage();
});

describe("Synthetic call isolation — createCall + getCall", () => {
  it("stores synthetic = true when requested", async () => {
    const call = await storage.createCall({
      fileName: "sim.mp3",
      status: "processing",
      synthetic: true,
    });
    assert.equal(call.synthetic, true);
    const found = await storage.getCall(call.id);
    assert.equal(found?.synthetic, true);
  });

  it("defaults synthetic to false when omitted", async () => {
    const call = await storage.createCall({
      fileName: "real.mp3",
      status: "processing",
    });
    assert.equal(call.synthetic, false);
  });

  it("getCall returns synthetic calls (single-row lookups still work)", async () => {
    const call = await storage.createCall({
      fileName: "sim.mp3",
      status: "processing",
      synthetic: true,
    });
    const found = await storage.getCall(call.id);
    assert.ok(found);
    assert.equal(found.id, call.id);
  });
});

describe("Synthetic call isolation — list / aggregate queries", () => {
  it("getAllCalls excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const all = await storage.getAllCalls();
    assert.equal(all.length, 1);
    assert.equal(all[0].fileName, "real.mp3");
  });

  it("getCallsSince excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const yesterday = new Date(Date.now() - 86_400_000);
    const since = await storage.getCallsSince(yesterday);
    assert.equal(since.length, 1);
    assert.equal(since[0].fileName, "real.mp3");
  });

  it("getCallsByStatus INCLUDES synthetic calls (orphan recovery path)", async () => {
    await seedTwoCallsOneReal();
    const completed = await storage.getCallsByStatus("completed");
    assert.equal(completed.length, 2);
  });

  it("getCallsWithDetails excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const calls = await storage.getCallsWithDetails();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fileName, "real.mp3");
  });

  it("getCallsPaginated excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const page = await storage.getCallsPaginated({});
    assert.equal(page.total, 1);
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].fileName, "real.mp3");
  });

  it("getCallsSinceWithDetails excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const yesterday = new Date(Date.now() - 86_400_000);
    const results = await storage.getCallsSinceWithDetails(yesterday);
    assert.equal(results.length, 1);
    assert.equal(results[0].fileName, "real.mp3");
  });

  it("searchCalls excludes synthetic calls", async () => {
    const { realCall, synthCall } = await seedTwoCallsOneReal();
    await storage.createTranscript({ callId: realCall.id, text: "I need help with oxygen" } as any);
    await storage.createTranscript({ callId: synthCall.id, text: "I need help with oxygen" } as any);

    const results = await storage.searchCalls("oxygen");
    assert.equal(results.length, 1);
    assert.equal(results[0].fileName, "real.mp3");
  });
});

describe("Synthetic call isolation — gamification / badges", () => {
  it("countCompletedCallsByEmployee does NOT count synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const count = await storage.countCompletedCallsByEmployee(realEmpId);
    assert.equal(count, 1, "synthetic calls should not pad the milestone counter");
  });

  it("getRecentCallsForBadgeEval excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const recent = await storage.getRecentCallsForBadgeEval(realEmpId, 25);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].fileName, "real.mp3");
  });

  it("getLeaderboardData excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const rows = await storage.getLeaderboardData({});
    assert.equal(rows.length, 1);
    // Real call scored 8.0; the synthetic 10.0 must NOT contribute.
    assert.equal(rows[0].scoreSum, 8);
    assert.equal(rows[0].scoreCount, 1);
    assert.deepEqual(rows[0].recentScores, [8]);
  });
});

describe("Synthetic call isolation — dashboards / reports / insights", () => {
  it("getDashboardMetrics excludes synthetic calls from total + averages", async () => {
    await seedTwoCallsOneReal();
    const m = await storage.getDashboardMetrics();
    assert.equal(m.totalCalls, 1, "synthetic calls must not inflate totalCalls");
    // Real perf score was 8.0; sentiment 0.8 → 8.0 average.
    assert.equal(m.avgPerformanceScore, 8);
    assert.equal(m.avgSentiment, 8);
  });

  it("getSentimentDistribution excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const dist = await storage.getSentimentDistribution();
    assert.equal(dist.positive, 1, "only the real call's sentiment should count");
  });

  it("getTopPerformers avg score excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const top = await storage.getTopPerformers(10);
    assert.equal(top.length, 1);
    assert.equal(top[0].totalCalls, 1);
    assert.equal(top[0].avgPerformanceScore, 8, "synthetic perfect-10 must not pull average up");
  });

  it("getInsightsData excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const yesterday = new Date(Date.now() - 86_400_000);
    const rows = await storage.getInsightsData(yesterday);
    assert.equal(rows.length, 1);
  });

  it("getFilteredReportMetrics excludes synthetic calls", async () => {
    await seedTwoCallsOneReal();
    const r = await storage.getFilteredReportMetrics({});
    assert.equal(r.metrics.totalCalls, 1);
    assert.equal(r.metrics.avgPerformanceScore, 8);
    assert.equal(r.sentiment.positive, 1);
    // The performers list should reflect the real call only.
    assert.equal(r.performers[0].totalCalls, 1);
    assert.equal(r.performers[0].avgPerformanceScore, 8);
  });
});

// ──────────────────────────────────────────────────────────────
// excludedFromMetrics isolation regression test.
//
// Manager-set flag that omits a real call from aggregate metrics
// (leaderboards, dashboards, filtered reports, badge evaluation,
// coaching outcomes) without hiding it from lists / search / detail.
// Follows the same pattern as synthetic but diverges in one important
// way: excluded calls MUST still appear in list/search views so users
// can see they're flagged and optionally un-flag them.
// ──────────────────────────────────────────────────────────────

let flaggedEmpId: string;

async function seedTwoCallsOneExcluded() {
  const emp = await storage.createEmployee({
    name: "Bob Flagged",
    email: "bob@flagged.com",
  });
  flaggedEmpId = emp.id;

  // One normal call, one manager-flagged-excluded call, both real (non-synthetic).
  const normalCall = await storage.createCall({
    employeeId: emp.id,
    fileName: "normal.mp3",
    status: "completed",
    contentHash: "normal-hash",
  });
  await storage.createCallAnalysis({
    callId: normalCall.id,
    performanceScore: "7.0",
    subScores: { compliance: 7, customerExperience: 7, communication: 7, resolution: 7 } as any,
  } as any);
  await storage.createSentimentAnalysis({
    callId: normalCall.id,
    overallSentiment: "positive",
    overallScore: "0.7",
  } as any);

  const excludedCall = await storage.createCall({
    employeeId: emp.id,
    fileName: "excluded.mp3",
    status: "completed",
    contentHash: "excluded-hash",
    excludedFromMetrics: true,
  });
  await storage.createCallAnalysis({
    callId: excludedCall.id,
    performanceScore: "2.0",
    subScores: { compliance: 2, customerExperience: 2, communication: 2, resolution: 2 } as any,
  } as any);
  await storage.createSentimentAnalysis({
    callId: excludedCall.id,
    overallSentiment: "negative",
    overallScore: "0.1",
  } as any);
  return { normalCall, excludedCall };
}

describe("excludedFromMetrics isolation — createCall + getCall", () => {
  it("stores excludedFromMetrics = true when requested", async () => {
    const call = await storage.createCall({
      fileName: "x.mp3",
      status: "processing",
      excludedFromMetrics: true,
    });
    assert.equal(call.excludedFromMetrics, true);
    const found = await storage.getCall(call.id);
    assert.equal(found?.excludedFromMetrics, true);
  });

  it("defaults excludedFromMetrics to false when omitted", async () => {
    const call = await storage.createCall({
      fileName: "y.mp3",
      status: "processing",
    });
    assert.equal(call.excludedFromMetrics, false);
  });

  it("getCall returns excluded calls (single-row lookups still work)", async () => {
    const call = await storage.createCall({
      fileName: "x.mp3",
      status: "processing",
      excludedFromMetrics: true,
    });
    const found = await storage.getCall(call.id);
    assert.ok(found);
    assert.equal(found.id, call.id);
  });

  it("updateCall can toggle excludedFromMetrics", async () => {
    const call = await storage.createCall({
      fileName: "z.mp3",
      status: "processing",
    });
    assert.equal(call.excludedFromMetrics, false);
    const updated = await storage.updateCall(call.id, { excludedFromMetrics: true });
    assert.equal(updated?.excludedFromMetrics, true);
    const reverted = await storage.updateCall(call.id, { excludedFromMetrics: false });
    assert.equal(reverted?.excludedFromMetrics, false);
  });
});

describe("excludedFromMetrics — list / search queries still include flagged calls", () => {
  // Contract: excluded calls MUST remain visible to users so they can see the
  // flag and un-exclude. Divergence from synthetic's "hidden everywhere"
  // pattern is deliberate — see server/storage-postgres.ts comments near
  // getCallsWithDetails / getCallsPaginated / searchCalls.

  it("getCallsWithDetails INCLUDES excluded calls (list visibility)", async () => {
    await seedTwoCallsOneExcluded();
    const calls = await storage.getCallsWithDetails();
    assert.equal(calls.length, 2, "excluded calls must stay visible in the list view");
  });

  it("getCallsPaginated INCLUDES excluded calls (list visibility)", async () => {
    await seedTwoCallsOneExcluded();
    const page = await storage.getCallsPaginated({});
    assert.equal(page.total, 2);
    assert.equal(page.calls.length, 2);
  });

  it("getCallsByStatus INCLUDES excluded calls", async () => {
    await seedTwoCallsOneExcluded();
    const completed = await storage.getCallsByStatus("completed");
    assert.equal(completed.length, 2);
  });

  it("searchCalls INCLUDES excluded calls", async () => {
    const { normalCall, excludedCall } = await seedTwoCallsOneExcluded();
    await storage.createTranscript({ callId: normalCall.id, text: "billing dispute" } as any);
    await storage.createTranscript({ callId: excludedCall.id, text: "billing dispute" } as any);

    const results = await storage.searchCalls("billing");
    assert.equal(results.length, 2, "excluded calls must remain searchable");
  });
});

describe("excludedFromMetrics — aggregate queries exclude flagged calls", () => {
  it("getCallsSince excludes flagged calls (calibration + scoring-regression feed)", async () => {
    await seedTwoCallsOneExcluded();
    const yesterday = new Date(Date.now() - 86_400_000);
    const since = await storage.getCallsSince(yesterday);
    assert.equal(since.length, 1);
    assert.equal(since[0].fileName, "normal.mp3");
  });

  it("getCallsSinceWithDetails excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const yesterday = new Date(Date.now() - 86_400_000);
    const results = await storage.getCallsSinceWithDetails(yesterday);
    assert.equal(results.length, 1);
    assert.equal(results[0].fileName, "normal.mp3");
  });
});

describe("excludedFromMetrics — gamification / badges", () => {
  it("countCompletedCallsByEmployee does NOT count flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const count = await storage.countCompletedCallsByEmployee(flaggedEmpId);
    assert.equal(count, 1, "manager-flagged calls must not trigger milestone badges");
  });

  it("getRecentCallsForBadgeEval excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const recent = await storage.getRecentCallsForBadgeEval(flaggedEmpId, 25);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].fileName, "normal.mp3");
  });

  it("getLeaderboardData excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const rows = await storage.getLeaderboardData({});
    assert.equal(rows.length, 1);
    // Normal call scored 7.0; the flagged 2.0 must NOT pull the average down.
    assert.equal(rows[0].scoreSum, 7);
    assert.equal(rows[0].scoreCount, 1);
    assert.deepEqual(rows[0].recentScores, [7]);
  });
});

describe("excludedFromMetrics — dashboards / reports / insights", () => {
  it("getDashboardMetrics excludes flagged calls from total + averages", async () => {
    await seedTwoCallsOneExcluded();
    const m = await storage.getDashboardMetrics();
    assert.equal(m.totalCalls, 1, "flagged calls must not inflate totalCalls");
    // Normal perf score was 7.0; sentiment 0.7 → 7.0 average.
    assert.equal(m.avgPerformanceScore, 7);
    assert.equal(m.avgSentiment, 7);
  });

  it("getSentimentDistribution excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const dist = await storage.getSentimentDistribution();
    assert.equal(dist.positive, 1);
    assert.equal(dist.negative, 0, "flagged-call negative sentiment must not count");
  });

  it("getTopPerformers avg score excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const top = await storage.getTopPerformers(10);
    assert.equal(top.length, 1);
    assert.equal(top[0].totalCalls, 1);
    assert.equal(top[0].avgPerformanceScore, 7, "flagged low-score must not pull average down");
  });

  it("getInsightsData excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const yesterday = new Date(Date.now() - 86_400_000);
    const rows = await storage.getInsightsData(yesterday);
    assert.equal(rows.length, 1);
  });

  it("getFilteredReportMetrics excludes flagged calls", async () => {
    await seedTwoCallsOneExcluded();
    const r = await storage.getFilteredReportMetrics({});
    assert.equal(r.metrics.totalCalls, 1);
    assert.equal(r.metrics.avgPerformanceScore, 7);
    assert.equal(r.sentiment.positive, 1);
    assert.equal(r.performers[0].totalCalls, 1);
    assert.equal(r.performers[0].avgPerformanceScore, 7);
  });
});

describe("excludedFromMetrics + synthetic — both filters compose correctly", () => {
  it("aggregate queries filter both flags independently", async () => {
    // Seed: 1 normal, 1 synthetic, 1 manager-excluded. Only the normal one
    // should appear in aggregate views.
    const emp = await storage.createEmployee({ name: "Carol", email: "carol@ex.com" });
    const normal = await storage.createCall({
      employeeId: emp.id,
      fileName: "n.mp3",
      status: "completed",
      contentHash: "n",
    });
    await storage.createCallAnalysis({ callId: normal.id, performanceScore: "6.0" } as any);

    const synth = await storage.createCall({
      employeeId: emp.id,
      fileName: "s.mp3",
      status: "completed",
      contentHash: "s",
      synthetic: true,
    });
    await storage.createCallAnalysis({ callId: synth.id, performanceScore: "10.0" } as any);

    const flagged = await storage.createCall({
      employeeId: emp.id,
      fileName: "f.mp3",
      status: "completed",
      contentHash: "f",
      excludedFromMetrics: true,
    });
    await storage.createCallAnalysis({ callId: flagged.id, performanceScore: "1.0" } as any);

    const metrics = await storage.getDashboardMetrics();
    assert.equal(metrics.totalCalls, 1);
    assert.equal(metrics.avgPerformanceScore, 6);

    const leaderboard = await storage.getLeaderboardData({});
    assert.equal(leaderboard[0].scoreCount, 1);
    assert.equal(leaderboard[0].scoreSum, 6);

    const count = await storage.countCompletedCallsByEmployee(emp.id);
    assert.equal(count, 1);
  });
});
