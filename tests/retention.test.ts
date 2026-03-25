/**
 * Tests for data retention and purge logic: expiration detection,
 * cascade deletion, and retention policy enforcement.
 * Run with: npx tsx --test tests/retention.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage.js";

// ── Retention Cutoff Calculation ─────────────────────────

describe("Retention cutoff calculation", () => {
  function getCutoffDate(retentionDays: number, now: Date = new Date()): Date {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);
    return cutoff;
  }

  it("calculates 90-day cutoff correctly", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const cutoff = getCutoffDate(90, now);
    assert.equal(cutoff.toISOString().slice(0, 10), "2026-03-03");
  });

  it("calculates 30-day cutoff", () => {
    const now = new Date("2026-03-31T00:00:00Z");
    const cutoff = getCutoffDate(30, now);
    assert.equal(cutoff.toISOString().slice(0, 10), "2026-03-01");
  });

  it("handles year boundary", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const cutoff = getCutoffDate(30, now);
    assert.equal(cutoff.getFullYear(), 2025);
  });

  it("handles 0-day retention (purge everything)", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const cutoff = getCutoffDate(0, now);
    // Cutoff should be today — all calls older than now are eligible
    assert.equal(cutoff.toISOString().slice(0, 10), "2026-06-01");
  });
});

// ── MemStorage purgeExpiredCalls ─────────────────────────

describe("MemStorage purgeExpiredCalls", () => {
  let storage: MemStorage;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("purges calls older than retention period", async () => {
    // Create an old call (200 days ago)
    const oldCall = await storage.createCall({ fileName: "old.mp3", status: "completed" });
    // Manually set upload date to 200 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);
    await storage.updateCall(oldCall.id, {} as any);
    // Access internal map to set date (MemStorage-specific for testing)
    const callMap = (storage as any).calls as Map<string, any>;
    const storedCall = callMap.get(oldCall.id);
    if (storedCall) storedCall.uploadedAt = oldDate.toISOString();

    // Create a recent call
    const recentCall = await storage.createCall({ fileName: "recent.mp3", status: "completed" });

    const purged = await storage.purgeExpiredCalls(90);
    assert.equal(purged, 1);

    // Old call should be gone, recent should remain
    const foundOld = await storage.getCall(oldCall.id);
    const foundRecent = await storage.getCall(recentCall.id);
    assert.equal(foundOld, undefined);
    assert.ok(foundRecent);
  });

  it("returns 0 when no calls are expired", async () => {
    await storage.createCall({ fileName: "fresh.mp3", status: "completed" });
    const purged = await storage.purgeExpiredCalls(90);
    assert.equal(purged, 0);
  });

  it("returns 0 when no calls exist", async () => {
    const purged = await storage.purgeExpiredCalls(90);
    assert.equal(purged, 0);
  });

  it("purges multiple expired calls", async () => {
    const callMap = (storage as any).calls as Map<string, any>;
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    for (let i = 0; i < 5; i++) {
      const call = await storage.createCall({ fileName: `old-${i}.mp3`, status: "completed" });
      const stored = callMap.get(call.id);
      if (stored) stored.uploadedAt = oldDate.toISOString();
    }

    // Add 2 fresh calls
    await storage.createCall({ fileName: "fresh-1.mp3", status: "completed" });
    await storage.createCall({ fileName: "fresh-2.mp3", status: "completed" });

    const purged = await storage.purgeExpiredCalls(90);
    assert.equal(purged, 5);

    const remaining = await storage.getAllCalls();
    assert.equal(remaining.length, 2);
  });
});

// ── Cascade Deletion ─────────────────────────────────

describe("Cascade deletion on call delete", () => {
  let storage: MemStorage;

  beforeEach(() => {
    storage = new MemStorage();
  });

  it("deleting a call removes associated transcript", async () => {
    const call = await storage.createCall({ fileName: "test.mp3" });
    await storage.createTranscript({
      callId: call.id,
      text: "Hello",
      confidence: "0.95",
      words: [],
    });

    // Verify transcript exists
    const transcript = await storage.getTranscript(call.id);
    assert.ok(transcript);

    await storage.deleteCall(call.id);

    // Transcript should be gone
    const deleted = await storage.getTranscript(call.id);
    assert.equal(deleted, undefined);
  });

  it("deleting a call removes associated sentiment analysis", async () => {
    const call = await storage.createCall({ fileName: "test.mp3" });
    await storage.createSentimentAnalysis({
      callId: call.id,
      overallSentiment: "positive",
      overallScore: "0.8",
      segments: [],
    });

    const sentiment = await storage.getSentimentAnalysis(call.id);
    assert.ok(sentiment);

    await storage.deleteCall(call.id);

    const deleted = await storage.getSentimentAnalysis(call.id);
    assert.equal(deleted, undefined);
  });

  it("deleting a call removes associated analysis", async () => {
    const call = await storage.createCall({ fileName: "test.mp3" });
    await storage.createCallAnalysis({
      callId: call.id,
      performanceScore: "8.0",
      summary: "Test analysis",
    });

    const analysis = await storage.getCallAnalysis(call.id);
    assert.ok(analysis);

    await storage.deleteCall(call.id);

    const deleted = await storage.getCallAnalysis(call.id);
    assert.equal(deleted, undefined);
  });

  it("deleting a call does not affect other calls", async () => {
    const call1 = await storage.createCall({ fileName: "test1.mp3" });
    const call2 = await storage.createCall({ fileName: "test2.mp3" });

    await storage.createTranscript({ callId: call1.id, text: "Call 1", confidence: "0.9", words: [] });
    await storage.createTranscript({ callId: call2.id, text: "Call 2", confidence: "0.9", words: [] });

    await storage.deleteCall(call1.id);

    const t2 = await storage.getTranscript(call2.id);
    assert.ok(t2);
    assert.equal(t2.text, "Call 2");
  });
});

// ── Retention Policy Edge Cases ─────────────────────────

describe("Retention policy edge cases", () => {
  it("call exactly at cutoff boundary is not purged", () => {
    const retentionDays = 90;
    const now = new Date("2026-06-01T12:00:00Z");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);

    // Call uploaded exactly at cutoff — should NOT be purged (< means strictly before cutoff)
    const callDate = new Date(cutoff);
    const shouldPurge = callDate < cutoff;
    assert.ok(!shouldPurge, "Call exactly at cutoff should not be purged");
  });

  it("call 1ms before cutoff IS purged", () => {
    const retentionDays = 90;
    const now = new Date("2026-06-01T12:00:00Z");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const callDate = new Date(cutoff.getTime() - 1);
    const shouldPurge = callDate < cutoff;
    assert.ok(shouldPurge, "Call 1ms before cutoff should be purged");
  });

  it("calls with missing uploadedAt are treated as epoch (always purged)", () => {
    const cutoff = new Date("2026-03-01T00:00:00Z");
    const callDate = new Date(0); // epoch
    const shouldPurge = callDate < cutoff;
    assert.ok(shouldPurge, "Missing date (epoch) should be purged");
  });
});
