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
