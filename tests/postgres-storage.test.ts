/**
 * Tests for PostgresStorage — verifies that the SQL-backed implementation
 * correctly implements the IStorage interface.
 *
 * These tests run against a real PostgreSQL instance. Skip if DATABASE_URL is not set.
 * Run with: DATABASE_URL=postgres://... npx tsx --test tests/postgres-storage.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

// Only run if DATABASE_URL is set
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  describe("PostgresStorage (skipped — no DATABASE_URL)", () => {
    it("skips when no database configured", () => {
      console.log("  Skipping PostgresStorage tests: DATABASE_URL not set");
    });
  });
} else {
  // Dynamic import to avoid errors when pg isn't connected
  let pool: pg.Pool;
  let PostgresStorage: any;

  describe("PostgresStorage", () => {
    before(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const mod = await import("../server/storage-postgres.js");
      PostgresStorage = mod.PostgresStorage;

      // Run schema
      const fs = await import("fs");
      const path = await import("path");
      const schemaPath = path.join(import.meta.dirname, "../server/db/schema.sql");
      const sql = fs.readFileSync(schemaPath, "utf-8");
      await pool.query(sql);
    });

    after(async () => {
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      // Clean tables in dependency order
      await pool.query("DELETE FROM coaching_sessions");
      await pool.query("DELETE FROM usage_records");
      await pool.query("DELETE FROM ab_tests");
      await pool.query("DELETE FROM call_analyses");
      await pool.query("DELETE FROM sentiment_analyses");
      await pool.query("DELETE FROM transcripts");
      await pool.query("DELETE FROM calls");
      await pool.query("DELETE FROM employees");
      await pool.query("DELETE FROM access_requests");
      await pool.query("DELETE FROM prompt_templates");
      await pool.query("DELETE FROM jobs");
      await pool.query("DELETE FROM audit_log");
    });

    it("creates and retrieves an employee", async () => {
      const storage = new PostgresStorage(pool);
      const emp = await storage.createEmployee({ name: "John Doe", email: "john@co.com" });
      assert.ok(emp.id);
      assert.equal(emp.name, "John Doe");

      const found = await storage.getEmployee(emp.id);
      assert.equal(found?.name, "John Doe");
    });

    it("finds employee by email", async () => {
      const storage = new PostgresStorage(pool);
      await storage.createEmployee({ name: "Jane", email: "jane@co.com" });
      const found = await storage.getEmployeeByEmail("jane@co.com");
      assert.equal(found?.name, "Jane");
    });

    it("creates and retrieves a call with details", async () => {
      const storage = new PostgresStorage(pool);
      const emp = await storage.createEmployee({ name: "Agent", email: "agent@co.com" });
      const call = await storage.createCall({ status: "completed", employeeId: emp.id });
      await storage.createTranscript({ callId: call.id, text: "Hello world" });
      await storage.createSentimentAnalysis({ callId: call.id, overallSentiment: "positive", overallScore: "0.9" });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "8.5", summary: "Good call" });

      const details = await storage.getCallsWithDetails();
      assert.equal(details.length, 1);
      assert.equal(details[0].employee?.name, "Agent");
      assert.equal(details[0].transcript?.text, "Hello world");
      assert.equal(details[0].sentiment?.overallSentiment, "positive");
      assert.equal(details[0].analysis?.performanceScore, "8.5");
    });

    it("filters calls by status", async () => {
      const storage = new PostgresStorage(pool);
      await storage.createCall({ status: "completed" });
      await storage.createCall({ status: "processing" });
      const completed = await storage.getCallsWithDetails({ status: "completed" });
      assert.equal(completed.length, 1);
    });

    it("deletes a call and cascades", async () => {
      const storage = new PostgresStorage(pool);
      const call = await storage.createCall({ status: "completed" });
      await storage.createTranscript({ callId: call.id, text: "Hello" });
      await storage.createSentimentAnalysis({ callId: call.id, overallSentiment: "positive" });
      await storage.createCallAnalysis({ callId: call.id, performanceScore: "8.0" });

      await storage.deleteCall(call.id);
      assert.equal(await storage.getCall(call.id), undefined);
      assert.equal(await storage.getTranscript(call.id), undefined);
      assert.equal(await storage.getSentimentAnalysis(call.id), undefined);
      assert.equal(await storage.getCallAnalysis(call.id), undefined);
    });

    it("computes dashboard metrics", async () => {
      const storage = new PostgresStorage(pool);
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
      const storage = new PostgresStorage(pool);
      const c1 = await storage.createCall({ status: "completed" });
      const c2 = await storage.createCall({ status: "completed" });
      const c3 = await storage.createCall({ status: "completed" });
      await storage.createSentimentAnalysis({ callId: c1.id, overallSentiment: "positive" });
      await storage.createSentimentAnalysis({ callId: c2.id, overallSentiment: "positive" });
      await storage.createSentimentAnalysis({ callId: c3.id, overallSentiment: "negative" });

      const dist = await storage.getSentimentDistribution();
      assert.equal(dist.positive, 2);
      assert.equal(dist.negative, 1);
      assert.equal(dist.neutral, 0);
    });

    it("searches calls by transcript text", async () => {
      const storage = new PostgresStorage(pool);
      const c1 = await storage.createCall({ status: "completed" });
      const c2 = await storage.createCall({ status: "completed" });
      await storage.createTranscript({ callId: c1.id, text: "I need help with billing" });
      await storage.createTranscript({ callId: c2.id, text: "Thank you for calling" });

      const results = await storage.searchCalls("billing");
      assert.equal(results.length, 1);
    });

    it("CRUD prompt templates", async () => {
      const storage = new PostgresStorage(pool);
      const tmpl = await storage.createPromptTemplate({
        callCategory: "inbound", name: "Test Template",
        evaluationCriteria: "Be polite", isActive: true,
      });
      assert.ok(tmpl.id);

      const found = await storage.getPromptTemplateByCategory("inbound");
      assert.equal(found?.name, "Test Template");

      const updated = await storage.updatePromptTemplate(tmpl.id, { name: "Updated" });
      assert.equal(updated?.name, "Updated");

      await storage.deletePromptTemplate(tmpl.id);
      assert.equal(await storage.getPromptTemplate(tmpl.id), undefined);
    });

    it("CRUD coaching sessions", async () => {
      const storage = new PostgresStorage(pool);
      const emp = await storage.createEmployee({ name: "Agent", email: "a@co.com" });
      const session = await storage.createCoachingSession({
        employeeId: emp.id, assignedBy: "manager", title: "Improve", category: "communication",
      });
      assert.ok(session.id);

      const byEmployee = await storage.getCoachingSessionsByEmployee(emp.id);
      assert.equal(byEmployee.length, 1);

      const updated = await storage.updateCoachingSession(session.id, { status: "completed" });
      assert.equal(updated?.status, "completed");
      assert.ok(updated?.completedAt);
    });

    it("creates and retrieves usage records", async () => {
      const storage = new PostgresStorage(pool);
      const c = await storage.createCall({ status: "completed" });
      await storage.createUsageRecord({
        id: "u1", callId: c.id, type: "call", timestamp: new Date().toISOString(),
        user: "admin", services: { assemblyai: { durationSeconds: 60, estimatedCost: 0.003 } },
        totalEstimatedCost: 0.003,
      });

      const records = await storage.getAllUsageRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].id, "u1");
    });

    it("purges expired calls", async () => {
      const storage = new PostgresStorage(pool);
      const call = await storage.createCall({ status: "completed" });
      // Set date to 100 days ago
      await pool.query("UPDATE calls SET uploaded_at = NOW() - INTERVAL '100 days' WHERE id = $1", [call.id]);
      await storage.createCall({ status: "completed" }); // Recent call

      const purged = await storage.purgeExpiredCalls(90);
      assert.equal(purged, 1);

      const remaining = await storage.getAllCalls();
      assert.equal(remaining.length, 1);
    });
  });
}
