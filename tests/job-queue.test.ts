/**
 * Tests for the PostgreSQL-backed job queue.
 *
 * Requires DATABASE_URL to be set. Skip if not available.
 * Run with: DATABASE_URL=postgres://... npx tsx --test tests/job-queue.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  describe("JobQueue (skipped — no DATABASE_URL)", () => {
    it("skips when no database configured", () => {
      console.log("  Skipping JobQueue tests: DATABASE_URL not set");
    });
  });
} else {
  let pool: pg.Pool;
  let JobQueue: any;

  describe("JobQueue", () => {
    before(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const mod = await import("../server/services/job-queue.js");
      JobQueue = mod.JobQueue;

      // Ensure schema exists
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
      await pool.query("DELETE FROM jobs");
    });

    it("enqueues and retrieves a job", async () => {
      const queue = new JobQueue(pool);
      const jobId = await queue.enqueue("test_job", { key: "value" });
      assert.ok(jobId);

      const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].type, "test_job");
      assert.equal(rows[0].status, "pending");
      assert.deepEqual(rows[0].payload, { key: "value" });
    });

    it("reports correct queue stats", async () => {
      const queue = new JobQueue(pool);
      await queue.enqueue("test", { a: 1 });
      await queue.enqueue("test", { b: 2 });

      const stats = await queue.getStats();
      assert.equal(stats.pending, 2);
      assert.equal(stats.running, 0);
    });

    it("marks jobs as completed", async () => {
      const queue = new JobQueue(pool);
      const jobId = await queue.enqueue("test", { a: 1 });
      await queue.completeJob(jobId);

      const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
      assert.equal(rows[0].status, "completed");
      assert.ok(rows[0].completed_at);
    });

    it("marks jobs as dead after max attempts", async () => {
      const queue = new JobQueue(pool);
      const jobId = await queue.enqueue("test", { a: 1 });

      // Simulate max attempts reached
      await pool.query("UPDATE jobs SET attempts = 3, max_attempts = 3 WHERE id = $1", [jobId]);
      await queue.failJob(jobId, "test error");

      const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
      assert.equal(rows[0].status, "dead");
      assert.equal(rows[0].failed_reason, "test error");
    });

    it("re-queues jobs under max attempts", async () => {
      const queue = new JobQueue(pool);
      const jobId = await queue.enqueue("test", { a: 1 });

      // Set attempts to 1 of 3
      await pool.query("UPDATE jobs SET attempts = 1, max_attempts = 3 WHERE id = $1", [jobId]);
      await queue.failJob(jobId, "transient error");

      const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
      assert.equal(rows[0].status, "pending"); // Re-queued, not dead
    });

    it("processes jobs via start/stop", async () => {
      const queue = new JobQueue(pool, 2, 100); // Fast polling for test
      const jobId = await queue.enqueue("test", { value: 42 });

      const processed: string[] = [];
      queue.start(async (job: any) => {
        processed.push(job.id);
      });

      // Wait for processing
      await new Promise((r) => setTimeout(r, 500));
      await queue.stop();

      assert.equal(processed.length, 1);
      assert.equal(processed[0], jobId);

      // Verify completed in DB
      const { rows } = await pool.query("SELECT status FROM jobs WHERE id = $1", [jobId]);
      assert.equal(rows[0].status, "completed");
    });

    it("handles job failures in worker", async () => {
      const queue = new JobQueue(pool, 1, 100);
      const jobId = await queue.enqueue("test", { fail: true });

      queue.start(async (_job: any) => {
        throw new Error("Intentional test failure");
      });

      await new Promise((r) => setTimeout(r, 500));
      await queue.stop();

      const { rows } = await pool.query("SELECT status, failed_reason, attempts FROM jobs WHERE id = $1", [jobId]);
      // Should be re-queued (pending) since attempts < max_attempts
      assert.ok(rows[0].failed_reason?.includes("Intentional test failure"));
    });
  });
}
