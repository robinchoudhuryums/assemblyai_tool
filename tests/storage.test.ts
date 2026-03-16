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
