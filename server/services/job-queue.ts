/**
 * Durable PostgreSQL-backed job queue.
 *
 * Jobs survive process restarts. Failed jobs are retried automatically.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */
import type pg from "pg";
import { randomUUID } from "crypto";
import { runWithCorrelationId } from "./correlation-id";

export interface Job {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  completedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  pending: number;
  running: number;
  completedToday: number;
  failedToday: number;
}

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

export class JobQueue {
  private running = false;
  private activeJobs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Optional callback invoked when a job moves to the dead-letter queue. */
  onDeadLetter?: (jobId: string, reason: string, attempts: number) => void;

  constructor(
    private db: pg.Pool,
    private concurrency: number = 5,
    private pollIntervalMs: number = 5000,
  ) {}

  /**
   * Enqueue a new job. Returns the job ID.
   */
  async enqueue(type: string, payload: Record<string, unknown>, priority = 0): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO jobs (id, type, status, payload, priority)
       VALUES ($1, $2, 'pending', $3, $4)`,
      [id, type, JSON.stringify(payload), priority],
    );
    return id;
  }

  /**
   * Claim the next available pending job using SKIP LOCKED.
   * Does NOT increment attempts — that's done by failJob only (A18/F22).
   * Stale running jobs are handled separately by reapStaleJobs().
   */
  private async claimJob(): Promise<Job | null> {
    const { rows } = await this.db.query(`
      UPDATE jobs SET
        status = 'running',
        locked_at = NOW(),
        locked_by = $1,
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
          AND (locked_at IS NULL OR locked_at <= NOW())
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `, [WORKER_ID]);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id, type: row.type, status: row.status,
      payload: row.payload, priority: row.priority,
      attempts: row.attempts, maxAttempts: row.max_attempts,
      lockedAt: row.locked_at?.toISOString?.() ?? row.locked_at,
      lockedBy: row.locked_by,
      completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
      failedReason: row.failed_reason,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    };
  }

  /**
   * Mark a job as completed.
   */
  async completeJob(jobId: string): Promise<void> {
    await this.db.query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
  }

  /**
   * Mark a job as failed. Re-queues with exponential backoff if under max attempts.
   * Backoff: attempt 1 → 10s, attempt 2 → 30s, attempt 3+ → 60s
   */
  async failJob(jobId: string, reason: string): Promise<void> {
    // Atomically increment attempts and read back (A18/F22 — was incremented
    // on claim, which meant crashes burned attempts; now the increment is
    // explicit on failure).
    const { rows } = await this.db.query(
      "UPDATE jobs SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1 RETURNING attempts, max_attempts",
      [jobId],
    );
    if (rows.length === 0) return;

    const { attempts, max_attempts } = rows[0];
    const isDead = attempts >= max_attempts;

    if (isDead) {
      await this.db.query(
        `UPDATE jobs SET status = 'dead', failed_reason = $2, locked_at = NULL, locked_by = NULL, updated_at = NOW()
         WHERE id = $1`,
        [jobId, reason],
      );
      console.error(`[JOB_QUEUE] Job ${jobId} moved to dead letter after ${attempts} attempts: ${reason}`);
      try {
        this.onDeadLetter?.(jobId, reason, attempts);
      } catch (callbackErr) {
        console.error(`[JOB_QUEUE] Dead-letter callback threw for job ${jobId}:`, (callbackErr as Error).message);
      }
    } else {
      // Exponential backoff: 10s, 30s, 60s (capped)
      const backoffSeconds = Math.min(10 * Math.pow(3, attempts - 1), 60);
      // Use locked_at as a "not before" timestamp — claimJob skips jobs with future locked_at
      await this.db.query(
        `UPDATE jobs SET status = 'pending', failed_reason = $2,
         locked_at = NOW() + ($3 || ' seconds')::interval,
         locked_by = NULL, updated_at = NOW()
         WHERE id = $1`,
        [jobId, reason, String(backoffSeconds)],
      );
      console.log(`[JOB_QUEUE] Job ${jobId} failed (attempt ${attempts}/${max_attempts}), retrying in ${backoffSeconds}s`);
    }
  }

  /**
   * Get all dead-letter jobs (failed after max attempts).
   */
  async getDeadJobs(limit = 50): Promise<Job[]> {
    const { rows } = await this.db.query(`
      SELECT * FROM jobs WHERE status = 'dead'
      ORDER BY updated_at DESC
      LIMIT $1
    `, [limit]);
    return rows.map((row: any) => ({
      id: row.id, type: row.type, status: row.status,
      payload: row.payload, priority: row.priority,
      attempts: row.attempts, maxAttempts: row.max_attempts,
      lockedAt: row.locked_at?.toISOString?.() ?? row.locked_at,
      lockedBy: row.locked_by,
      completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
      failedReason: row.failed_reason,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    }));
  }

  /**
   * Retry a dead job by resetting its status to pending.
   * Increments max_attempts instead of resetting attempts to 0,
   * preventing infinite retry loops while preserving attempt history.
   */
  async retryJob(jobId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE jobs SET status = 'pending', max_attempts = max_attempts + 1,
       failed_reason = NULL, locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $1 AND status = 'dead'`,
      [jobId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Get queue statistics.
   */
  async getStats(): Promise<QueueStats> {
    const { rows } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= CURRENT_DATE)::int AS completed_today,
        COUNT(*) FILTER (WHERE status IN ('dead', 'pending') AND failed_reason IS NOT NULL
                         AND updated_at >= CURRENT_DATE)::int AS failed_today
      FROM jobs
    `);
    return {
      pending: rows[0].pending,
      running: rows[0].running,
      completedToday: rows[0].completed_today,
      failedToday: rows[0].failed_today,
    };
  }

  /**
   * Reap jobs whose worker crashed mid-execution (A18/F23).
   * Any job in 'running' status whose heartbeat hasn't updated in
   * STALE_HEARTBEAT_MS is treated as crashed — failJob handles the attempts
   * increment and retry/dead-letter decision.
   */
  private static readonly STALE_HEARTBEAT_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly HEARTBEAT_INTERVAL_MS = 30 * 1000;  // 30 seconds
  private async reapStaleJobs(): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT id FROM jobs
       WHERE status = 'running'
         AND last_heartbeat_at < NOW() - ($1::int || ' milliseconds')::interval
       LIMIT 20`,
      [JobQueue.STALE_HEARTBEAT_MS],
    );
    for (const row of rows) {
      console.warn(`[JOB_QUEUE] Reaping stale job ${row.id} (no heartbeat for ${Math.round(JobQueue.STALE_HEARTBEAT_MS / 1000)}s)`);
      await this.failJob(row.id, "Worker crashed: no heartbeat");
    }
  }

  /** Update the heartbeat timestamp for a running job. */
  private async heartbeat(jobId: string): Promise<void> {
    await this.db.query(
      "UPDATE jobs SET last_heartbeat_at = NOW() WHERE id = $1 AND status = 'running'",
      [jobId],
    );
  }

  /**
   * Start the worker loop. Provide a handler that processes each job.
   */
  start(handler: (job: Job) => Promise<void>): void {
    if (this.running) return;
    this.running = true;
    console.log(`[JOB_QUEUE] Worker started (concurrency=${this.concurrency}, poll=${this.pollIntervalMs}ms)`);

    const poll = async () => {
      if (!this.running) return;

      // A18/F71: wrap everything in try/catch so a DB error doesn't kill the
      // worker loop. Errors are logged but polling continues.
      try {
        await this.reapStaleJobs();

        while (this.activeJobs < this.concurrency && this.running) {
          const job = await this.claimJob();
          if (!job) break;

          this.activeJobs++;
          this.processJob(job, handler).finally(() => {
            this.activeJobs--;
          });
        }
      } catch (err) {
        console.error("[JOB_QUEUE] Poll iteration error (continuing):", (err as Error).message);
      }

      if (this.running) {
        this.pollTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    poll().catch((err) => {
      console.error("[JOB_QUEUE] Fatal poll startup error:", err.message);
    });
  }

  private async processJob(job: Job, handler: (job: Job) => Promise<void>): Promise<void> {
    // Heartbeat ticker — refreshed every HEARTBEAT_INTERVAL_MS during job
    // execution. Cleared in finally to prevent leaked intervals.
    const heartbeatTimer = setInterval(() => {
      this.heartbeat(job.id).catch((err) => {
        console.warn(`[JOB_QUEUE] Heartbeat failed for ${job.id}:`, (err as Error).message);
      });
    }, JobQueue.HEARTBEAT_INTERVAL_MS);
    // A31/F66: wrap handler invocation in a correlation-id scope so all
    // structured logs emitted during processing carry the job id.
    try {
      await runWithCorrelationId(job.id, async () => handler(job));
      await this.completeJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JOB_QUEUE] Job ${job.id} failed (attempt ${job.attempts + 1}/${job.maxAttempts}): ${message}`);
      try {
        await this.failJob(job.id, message);
      } catch (failErr) {
        console.error(`[JOB_QUEUE] failJob threw for ${job.id}:`, (failErr as Error).message);
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  /**
   * Stop the worker loop gracefully. Waits for active jobs to finish.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active jobs to drain (up to 30 seconds)
    const deadline = Date.now() + 30_000;
    while (this.activeJobs > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (this.activeJobs > 0) {
      console.warn(`[JOB_QUEUE] Shutting down with ${this.activeJobs} active jobs`);
    }

    console.log("[JOB_QUEUE] Worker stopped");
  }
}
