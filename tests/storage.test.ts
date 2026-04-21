/**
 * Tests for the MemStorage implementation — verifies all storage operations.
 * Run with: npx tsx --test tests/storage.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage.js";

let storage: MemStorage;

beforeEach(() => {
  storage = new MemStorage();
});

describe("MemStorage — Employee operations", () => {
  it("creates and retrieves an employee", async () => {
    const emp = await storage.createEmployee({ name: "John Doe", email: "john@co.com" });
    assert.ok(emp.id);
    assert.equal(emp.name, "John Doe");

    const found = await storage.getEmployee(emp.id);
    assert.deepEqual(found, emp);
  });

  it("finds employee by email", async () => {
    await storage.createEmployee({ name: "Jane", email: "jane@co.com" });
    const found = await storage.getEmployeeByEmail("jane@co.com");
    assert.equal(found?.name, "Jane");
  });

  it("returns undefined for non-existent employee", async () => {
    const found = await storage.getEmployee("non-existent");
    assert.equal(found, undefined);
  });

  it("updates an employee", async () => {
    const emp = await storage.createEmployee({ name: "Bob", email: "bob@co.com" });
    const updated = await storage.updateEmployee(emp.id, { name: "Robert" });
    assert.equal(updated?.name, "Robert");
    assert.equal(updated?.email, "bob@co.com");
  });

  it("lists all employees", async () => {
    await storage.createEmployee({ name: "A", email: "a@co.com" });
    await storage.createEmployee({ name: "B", email: "b@co.com" });
    const all = await storage.getAllEmployees();
    assert.equal(all.length, 2);
  });
});

describe("MemStorage — Call operations", () => {
  it("creates and retrieves a call", async () => {
    const call = await storage.createCall({ fileName: "test.mp3", status: "processing" });
    assert.ok(call.id);
    assert.ok(call.uploadedAt);

    const found = await storage.getCall(call.id);
    assert.deepEqual(found, call);
  });

  it("updates a call", async () => {
    const call = await storage.createCall({ status: "processing" });
    const updated = await storage.updateCall(call.id, { status: "completed", duration: 120 });
    assert.equal(updated?.status, "completed");
    assert.equal(updated?.duration, 120);
  });

  it("deletes a call and all related data", async () => {
    const call = await storage.createCall({ status: "processing" });
    await storage.createTranscript({ callId: call.id, text: "Hello" });
    await storage.createSentimentAnalysis({ callId: call.id, overallSentiment: "positive" });
    await storage.createCallAnalysis({ callId: call.id, performanceScore: "8.0" });

    await storage.deleteCall(call.id);

    assert.equal(await storage.getCall(call.id), undefined);
    assert.equal(await storage.getTranscript(call.id), undefined);
    assert.equal(await storage.getSentimentAnalysis(call.id), undefined);
    assert.equal(await storage.getCallAnalysis(call.id), undefined);
  });

  it("lists calls sorted by upload date descending", async () => {
    const c1 = await storage.createCall({ status: "completed" });
    // Set distinct timestamps
    await storage.updateCall(c1.id, { uploadedAt: "2024-01-01T00:00:00Z" });
    const c2 = await storage.createCall({ status: "completed" });
    await storage.updateCall(c2.id, { uploadedAt: "2024-06-01T00:00:00Z" });
    const all = await storage.getAllCalls();
    assert.equal(all[0].id, c2.id); // Most recent first
  });
});

describe("MemStorage — Transcript, Sentiment, Analysis", () => {
  it("creates and retrieves transcript by callId", async () => {
    const transcript = await storage.createTranscript({ callId: "c1", text: "Hello world" });
    assert.ok(transcript.id);
    const found = await storage.getTranscript("c1");
    assert.equal(found?.text, "Hello world");
  });

  it("creates and retrieves sentiment by callId", async () => {
    const sentiment = await storage.createSentimentAnalysis({
      callId: "c1",
      overallSentiment: "positive",
      overallScore: "0.85",
    });
    assert.ok(sentiment.id);
    const found = await storage.getSentimentAnalysis("c1");
    assert.equal(found?.overallSentiment, "positive");
  });

  it("creates and retrieves analysis by callId", async () => {
    const analysis = await storage.createCallAnalysis({
      callId: "c1",
      performanceScore: "7.5",
      summary: "Good call",
    });
    assert.ok(analysis.id);
    const found = await storage.getCallAnalysis("c1");
    assert.equal(found?.performanceScore, "7.5");
  });

  it("getCallAnalysesBulk returns map of analyses for given IDs (F03)", async () => {
    await storage.createCallAnalysis({ callId: "bulk-1", performanceScore: "8.0", summary: "Call 1" });
    await storage.createCallAnalysis({ callId: "bulk-2", performanceScore: "6.5", summary: "Call 2" });
    await storage.createCallAnalysis({ callId: "bulk-3", performanceScore: "9.0", summary: "Call 3" });
    const result = await storage.getCallAnalysesBulk(["bulk-1", "bulk-2", "bulk-3"]);
    assert.equal(result.size, 3);
    assert.equal(result.get("bulk-1")?.performanceScore, "8.0");
    assert.equal(result.get("bulk-2")?.performanceScore, "6.5");
    assert.equal(result.get("bulk-3")?.performanceScore, "9.0");
  });

  it("getCallAnalysesBulk omits missing IDs from result map (F03)", async () => {
    await storage.createCallAnalysis({ callId: "exists-1", performanceScore: "7.0", summary: "Exists" });
    const result = await storage.getCallAnalysesBulk(["exists-1", "nonexistent-id"]);
    assert.equal(result.size, 1);
    assert.ok(result.has("exists-1"));
    assert.ok(!result.has("nonexistent-id"));
  });

  it("getCallAnalysesBulk returns empty map for empty input (F03)", async () => {
    const result = await storage.getCallAnalysesBulk([]);
    assert.equal(result.size, 0);
  });

  // Semantic search hydration fast path. Exercised indirectly by the
  // /api/search/semantic pgvector path; these tests pin the IStorage
  // contract (empty input, ID filter, synthetic exclusion).
  it("getCallsWithDetailsByIds returns empty array for empty input", async () => {
    const storage = new MemStorage();
    const result = await storage.getCallsWithDetailsByIds([]);
    assert.equal(result.length, 0);
  });

  it("getCallsWithDetailsByIds filters to the provided IDs only", async () => {
    const storage = new MemStorage();
    const c1 = await storage.createCall({ fileName: "a.mp3", mimeType: "audio/mp3", fileSize: 1, status: "completed", contentHash: "hidsa-1" });
    const c2 = await storage.createCall({ fileName: "b.mp3", mimeType: "audio/mp3", fileSize: 1, status: "completed", contentHash: "hidsa-2" });
    const c3 = await storage.createCall({ fileName: "c.mp3", mimeType: "audio/mp3", fileSize: 1, status: "completed", contentHash: "hidsa-3" });
    const result = await storage.getCallsWithDetailsByIds([c1.id, c3.id]);
    assert.equal(result.length, 2);
    const ids = new Set(result.map(c => c.id));
    assert.ok(ids.has(c1.id));
    assert.ok(ids.has(c3.id));
    assert.ok(!ids.has(c2.id));
  });

  it("getCallsWithDetailsByIds omits synthetic calls even when explicitly requested (INV-34)", async () => {
    const storage = new MemStorage();
    const real = await storage.createCall({ fileName: "real.mp3", mimeType: "audio/mp3", fileSize: 1, status: "completed", contentHash: "hidsa-s-real" });
    const syn = await storage.createCall({ fileName: "syn.mp3", mimeType: "audio/mp3", fileSize: 1, status: "completed", contentHash: "hidsa-s-syn", synthetic: true });
    const result = await storage.getCallsWithDetailsByIds([real.id, syn.id]);
    // Synthetic excluded — only the real call is hydrated.
    assert.equal(result.length, 1);
    assert.equal(result[0].id, real.id);
  });
});

describe("MemStorage — Dashboard metrics", () => {
  it("returns zero metrics when empty", async () => {
    const metrics = await storage.getDashboardMetrics();
    assert.equal(metrics.totalCalls, 0);
    assert.equal(metrics.avgSentiment, 0);
    assert.equal(metrics.avgPerformanceScore, 0);
  });

  it("computes correct metrics", async () => {
    const c1 = await storage.createCall({ status: "completed" });
    const c2 = await storage.createCall({ status: "completed" });
    await storage.createSentimentAnalysis({ callId: c1.id, overallScore: "0.8" });
    await storage.createSentimentAnalysis({ callId: c2.id, overallScore: "0.6" });
    await storage.createCallAnalysis({ callId: c1.id, performanceScore: "8.0" });
    await storage.createCallAnalysis({ callId: c2.id, performanceScore: "6.0" });

    const metrics = await storage.getDashboardMetrics();
    assert.equal(metrics.totalCalls, 2);
    assert.equal(metrics.avgPerformanceScore, 7);
  });

  it("returns correct sentiment distribution", async () => {
    await storage.createSentimentAnalysis({ callId: "a", overallSentiment: "positive" });
    await storage.createSentimentAnalysis({ callId: "b", overallSentiment: "positive" });
    await storage.createSentimentAnalysis({ callId: "c", overallSentiment: "negative" });

    const dist = await storage.getSentimentDistribution();
    assert.equal(dist.positive, 2);
    assert.equal(dist.negative, 1);
    assert.equal(dist.neutral, 0);
  });
});

describe("MemStorage — Search", () => {
  it("finds calls by transcript text", async () => {
    const c1 = await storage.createCall({ status: "completed" });
    const c2 = await storage.createCall({ status: "completed" });
    await storage.createTranscript({ callId: c1.id, text: "Hello, I need help with billing" });
    await storage.createTranscript({ callId: c2.id, text: "Thank you for calling" });

    const results = await storage.searchCalls("billing");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, c1.id);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      const c = await storage.createCall({ status: "completed" });
      await storage.createTranscript({ callId: c.id, text: "common search term" });
    }

    const results = await storage.searchCalls("common", 3);
    assert.equal(results.length, 3);
  });

  it("returns empty for no matches", async () => {
    const c1 = await storage.createCall({ status: "completed" });
    await storage.createTranscript({ callId: c1.id, text: "nothing relevant" });

    const results = await storage.searchCalls("billing");
    assert.equal(results.length, 0);
  });
});

describe("MemStorage — Access requests", () => {
  it("creates and lists access requests", async () => {
    const req = await storage.createAccessRequest({
      name: "Test User",
      email: "test@example.com",
      reason: "Need access",
      requestedRole: "viewer",
    });
    assert.equal(req.status, "pending");

    const all = await storage.getAllAccessRequests();
    assert.equal(all.length, 1);
  });

  it("updates access request status", async () => {
    const req = await storage.createAccessRequest({
      name: "Test User",
      email: "test@example.com",
    });
    const updated = await storage.updateAccessRequest(req.id, {
      status: "approved",
      reviewedBy: "admin",
    });
    assert.equal(updated?.status, "approved");
    assert.equal(updated?.reviewedBy, "admin");
  });
});

describe("MemStorage — Prompt templates", () => {
  it("CRUD operations", async () => {
    const tmpl = await storage.createPromptTemplate({
      callCategory: "inbound",
      name: "Inbound Template",
      evaluationCriteria: "Be polite",
      isActive: true,
    });
    assert.ok(tmpl.id);

    const found = await storage.getPromptTemplate(tmpl.id);
    assert.equal(found?.name, "Inbound Template");

    const byCategory = await storage.getPromptTemplateByCategory("inbound");
    assert.equal(byCategory?.id, tmpl.id);

    const updated = await storage.updatePromptTemplate(tmpl.id, { name: "Updated" });
    assert.equal(updated?.name, "Updated");

    await storage.deletePromptTemplate(tmpl.id);
    const deleted = await storage.getPromptTemplate(tmpl.id);
    assert.equal(deleted, undefined);
  });
});

describe("MemStorage — Coaching sessions", () => {
  it("creates and lists coaching sessions", async () => {
    const session = await storage.createCoachingSession({
      employeeId: "emp1",
      assignedBy: "manager",
      title: "Improve communication",
      category: "communication",
    });
    assert.ok(session.id);

    const all = await storage.getAllCoachingSessions();
    assert.equal(all.length, 1);

    const byEmployee = await storage.getCoachingSessionsByEmployee("emp1");
    assert.equal(byEmployee.length, 1);
  });

  it("updates coaching session", async () => {
    const session = await storage.createCoachingSession({
      employeeId: "emp1",
      assignedBy: "manager",
      title: "Test",
    });
    const updated = await storage.updateCoachingSession(session.id, { status: "completed" });
    assert.equal(updated?.status, "completed");
  });

  it("persists effectiveness rating + note across update round-trip", async () => {
    // Tier 2 #8: manager-supplied effectiveness rating captured at session
    // close. Covers the new effectiveness_rating + effectiveness_note fields
    // for MemStorage (Postgres uses a dedicated UPDATE statement exercised
    // only in integration tests).
    const session = await storage.createCoachingSession({
      employeeId: "emp-eff",
      assignedBy: "manager",
      title: "Effectiveness test",
    });
    assert.equal(session.effectivenessRating, undefined);
    assert.equal(session.effectivenessNote, undefined);

    const rated = await storage.updateCoachingSession(session.id, {
      status: "completed",
      effectivenessRating: "helpful",
      effectivenessNote: "Clearly improved customer-handling confidence.",
    });
    assert.equal(rated?.effectivenessRating, "helpful");
    assert.equal(rated?.effectivenessNote, "Clearly improved customer-handling confidence.");

    // Round-trip through getCoachingSession to prove persistence.
    const fetched = await storage.getCoachingSession(session.id);
    assert.equal(fetched?.effectivenessRating, "helpful");
    assert.equal(fetched?.effectivenessNote, "Clearly improved customer-handling confidence.");

    // Overwriting to a different rating should stick.
    const changed = await storage.updateCoachingSession(session.id, {
      effectivenessRating: "not_helpful",
    });
    assert.equal(changed?.effectivenessRating, "not_helpful");
  });

  // getCoachingOutcomes — the MemStorage path uses the shared
  // computeCoachingOutcomesInMemory helper. These tests lock its contract
  // end-to-end (empty, no-calls, before/after split).
  it("getCoachingOutcomes returns empty array when no sessions in window", async () => {
    const rows = await storage.getCoachingOutcomes(new Date());
    assert.equal(rows.length, 0);
  });

  it("getCoachingOutcomes returns sessions with before=null / after=null when the employee has no calls", async () => {
    const session = await storage.createCoachingSession({
      employeeId: "emp-no-calls",
      assignedBy: "manager",
      title: "Session without calls",
    });
    const rows = await storage.getCoachingOutcomes(new Date(Date.now() - 86400000));
    const target = rows.find(r => r.sessionId === session.id);
    assert.ok(target);
    assert.equal(target.before, null);
    assert.equal(target.after, null);
    assert.equal(target.employeeId, "emp-no-calls");
    assert.equal(target.assignedBy, "manager");
  });

  it("getCoachingOutcomes splits before/after around session creation time", async () => {
    // Seed 3 "before" calls and 3 "after" calls for an employee, then a
    // session created between them. The outcomes should partition correctly.
    const empId = "emp-split";
    const now = Date.now();
    const earlier = new Date(now - 10 * 86400000);
    const later = new Date(now - 3 * 86400000);

    for (let i = 0; i < 3; i++) {
      const call = await storage.createCall({
        fileName: `before-${i}.mp3`,
        mimeType: "audio/mp3",
        fileSize: 1,
        status: "completed",
        contentHash: `gco-before-${i}`,
      });
      // Force uploadedAt + employeeId via setCallEmployee + updateCall.
      await storage.setCallEmployee(call.id, empId);
      await storage.updateCall(call.id, { uploadedAt: new Date(earlier.getTime() + i * 86400000).toISOString() });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "6.0" });
    }
    for (let i = 0; i < 3; i++) {
      const call = await storage.createCall({
        fileName: `after-${i}.mp3`,
        mimeType: "audio/mp3",
        fileSize: 1,
        status: "completed",
        contentHash: `gco-after-${i}`,
      });
      await storage.setCallEmployee(call.id, empId);
      await storage.updateCall(call.id, { uploadedAt: new Date(later.getTime() + i * 86400000).toISOString() });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "8.0" });
    }
    // Session created in between.
    const session = await storage.createCoachingSession({
      employeeId: empId,
      assignedBy: "manager",
      title: "Midpoint session",
    });
    // Manually set session.createdAt to 5 days ago so the 3 earlier calls
    // are "before" and the 3 later calls are "after".
    const midpoint = new Date(now - 5 * 86400000);
    await storage.updateCoachingSession(session.id, { createdAt: midpoint.toISOString() });

    const rows = await storage.getCoachingOutcomes(new Date(now - 30 * 86400000), 10);
    const target = rows.find(r => r.sessionId === session.id);
    assert.ok(target);
    assert.equal(target.before?.count, 3);
    assert.equal(target.after?.count, 3);
    assert.equal(target.before?.avgScore, 6.0);
    assert.equal(target.after?.avgScore, 8.0);
  });

  it("getCoachingOutcomes excludes manager-flagged calls from before/after windows", async () => {
    // Regression guard for the excludedFromMetrics filter in
    // computeCoachingOutcomesInMemory. If a manager flags a noisy call as
    // excluded_from_metrics AFTER a coaching session has completed, the
    // outcome delta must not be distorted by that noisy score.
    const empId = "emp-excluded";
    const now = Date.now();
    const earlier = new Date(now - 10 * 86400000);
    const later = new Date(now - 3 * 86400000);

    // 2 normal "before" calls at score 5.0
    for (let i = 0; i < 2; i++) {
      const call = await storage.createCall({
        fileName: `exb-before-${i}.mp3`,
        mimeType: "audio/mp3",
        fileSize: 1,
        status: "completed",
        contentHash: `exb-before-${i}`,
      });
      await storage.setCallEmployee(call.id, empId);
      await storage.updateCall(call.id, { uploadedAt: new Date(earlier.getTime() + i * 86400000).toISOString() });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "5.0" });
    }
    // 1 "before" call that's flagged as excluded — high score that would
    // otherwise boost the before-window average.
    const flaggedBefore = await storage.createCall({
      fileName: "exb-before-flagged.mp3",
      mimeType: "audio/mp3",
      fileSize: 1,
      status: "completed",
      contentHash: "exb-before-flagged",
      excludedFromMetrics: true,
    });
    await storage.setCallEmployee(flaggedBefore.id, empId);
    await storage.updateCall(flaggedBefore.id, { uploadedAt: new Date(earlier.getTime() + 2 * 86400000).toISOString() });
    await storage.createCallAnalysis({ callId: flaggedBefore.id, performanceScore: "10.0" });

    // 2 normal "after" calls at score 8.0
    for (let i = 0; i < 2; i++) {
      const call = await storage.createCall({
        fileName: `exb-after-${i}.mp3`,
        mimeType: "audio/mp3",
        fileSize: 1,
        status: "completed",
        contentHash: `exb-after-${i}`,
      });
      await storage.setCallEmployee(call.id, empId);
      await storage.updateCall(call.id, { uploadedAt: new Date(later.getTime() + i * 86400000).toISOString() });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "8.0" });
    }
    // 1 "after" call that's flagged — low score that would otherwise drag
    // the after-window average down.
    const flaggedAfter = await storage.createCall({
      fileName: "exb-after-flagged.mp3",
      mimeType: "audio/mp3",
      fileSize: 1,
      status: "completed",
      contentHash: "exb-after-flagged",
      excludedFromMetrics: true,
    });
    await storage.setCallEmployee(flaggedAfter.id, empId);
    await storage.updateCall(flaggedAfter.id, { uploadedAt: new Date(later.getTime() + 2 * 86400000).toISOString() });
    await storage.createCallAnalysis({ callId: flaggedAfter.id, performanceScore: "1.0" });

    const session = await storage.createCoachingSession({
      employeeId: empId,
      assignedBy: "manager",
      title: "Midpoint session",
    });
    const midpoint = new Date(now - 5 * 86400000);
    await storage.updateCoachingSession(session.id, { createdAt: midpoint.toISOString() });

    const rows = await storage.getCoachingOutcomes(new Date(now - 30 * 86400000), 10);
    const target = rows.find(r => r.sessionId === session.id);
    assert.ok(target);
    // Flagged calls must NOT appear in either window.
    assert.equal(target.before?.count, 2, "before-window should exclude flagged call");
    assert.equal(target.after?.count, 2, "after-window should exclude flagged call");
    assert.equal(target.before?.avgScore, 5.0, "flagged 10.0 must not inflate before-avg");
    assert.equal(target.after?.avgScore, 8.0, "flagged 1.0 must not drag after-avg down");
  });
});

describe("MemStorage — A/B tests", () => {
  it("CRUD operations", async () => {
    const test = await storage.createABTest({
      fileName: "test.mp3",
      baselineModel: "model-a",
      testModel: "model-b",
      createdBy: "admin",
    });
    assert.ok(test.id);

    const found = await storage.getABTest(test.id);
    assert.equal(found?.fileName, "test.mp3");

    const updated = await storage.updateABTest(test.id, { status: "completed" });
    assert.equal(updated?.status, "completed");

    await storage.deleteABTest(test.id);
    const deleted = await storage.getABTest(test.id);
    assert.equal(deleted, undefined);
  });
});

describe("MemStorage — Usage records", () => {
  it("creates and lists usage records", async () => {
    await storage.createUsageRecord({
      id: "u1",
      callId: "c1",
      type: "call",
      timestamp: new Date().toISOString(),
      user: "admin",
      services: {
        assemblyai: { durationSeconds: 60, estimatedCost: 0.37 },
      },
      totalEstimatedCost: 0.37,
    });

    const records = await storage.getAllUsageRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "u1");
  });
});

describe("MemStorage — Data retention", () => {
  it("purges calls older than retention period", async () => {
    // Create a call with an old date
    const call = await storage.createCall({ status: "completed" });
    // Manually set the date to 100 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    await storage.updateCall(call.id, { uploadedAt: oldDate.toISOString() });

    // Create a recent call
    await storage.createCall({ status: "completed" });

    const purged = await storage.purgeExpiredCalls(90);
    assert.equal(purged, 1);

    const remaining = await storage.getAllCalls();
    assert.equal(remaining.length, 1);
  });
});

describe("MemStorage — findEmployeeByName", () => {
  it("finds employee by exact name (case-insensitive)", async () => {
    await storage.createEmployee({ name: "Sarah Johnson", email: "sarah@co.com" });
    const found = await storage.findEmployeeByName("sarah johnson");
    assert.equal(found?.name, "Sarah Johnson");
  });

  it("finds employee by first name when unambiguous", async () => {
    await storage.createEmployee({ name: "Sarah Johnson", email: "sarah@co.com" });
    await storage.createEmployee({ name: "Mike Smith", email: "mike@co.com" });
    const found = await storage.findEmployeeByName("Sarah");
    assert.equal(found?.name, "Sarah Johnson");
  });

  it("returns undefined for ambiguous first name", async () => {
    await storage.createEmployee({ name: "Sarah Johnson", email: "sarah1@co.com" });
    await storage.createEmployee({ name: "Sarah Williams", email: "sarah2@co.com" });
    const found = await storage.findEmployeeByName("Sarah");
    assert.equal(found, undefined);
  });

  it("returns undefined when no match", async () => {
    await storage.createEmployee({ name: "Mike Smith", email: "mike@co.com" });
    const found = await storage.findEmployeeByName("Unknown Person");
    assert.equal(found, undefined);
  });

  it("prefers exact match over first-name match", async () => {
    await storage.createEmployee({ name: "Sarah", email: "sarah@co.com" });
    await storage.createEmployee({ name: "Sarah Johnson", email: "sarah2@co.com" });
    const found = await storage.findEmployeeByName("Sarah");
    assert.equal(found?.email, "sarah@co.com");
  });
});

describe("MemStorage — searchCalls", () => {
  it("searches transcripts by text", async () => {
    const call = await storage.createCall({ status: "completed" });
    await storage.createTranscript({ callId: call.id, text: "Hello how can I help you today" });
    const results = await storage.searchCalls("help you");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, call.id);
  });

  it("returns empty for no match", async () => {
    const call = await storage.createCall({ status: "completed" });
    await storage.createTranscript({ callId: call.id, text: "Hello world" });
    const results = await storage.searchCalls("nonexistent phrase xyz");
    assert.equal(results.length, 0);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      const call = await storage.createCall({ status: "completed" });
      await storage.createTranscript({ callId: call.id, text: `test call number ${i}` });
    }
    const results = await storage.searchCalls("test call", 2);
    assert.equal(results.length, 2);
  });
});
