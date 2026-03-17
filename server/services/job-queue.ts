/**
 * Durable PostgreSQL-backed job queue.
 *
 * Jobs survive process restarts. Failed jobs are retried automatically.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */
import type pg from "pg";
import { randomUUID } from "crypto";

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
   * Claim the next available job using SKIP LOCKED.
   */
  private async claimJob(): Promise<Job | null> {
    const { rows } = await this.db.query(`
      UPDATE jobs SET
        status = 'running',
        locked_at = NOW(),
        locked_by = $1,
        attempts = attempts + 1,
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
          OR (status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes')
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
   * Mark a job as failed. Re-queues if under max attempts.
   */
  async failJob(jobId: string, reason: string): Promise<void> {
    // Check current attempt count
    const { rows } = await this.db.query("SELECT attempts, max_attempts FROM jobs WHERE id = $1", [jobId]);
    if (rows.length === 0) return;

    const { attempts, max_attempts } = rows[0];
    const newStatus = attempts >= max_attempts ? "dead" : "pending";

    await this.db.query(
      `UPDATE jobs SET status = $2, failed_reason = $3, locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $1`,
      [jobId, newStatus, reason],
    );

    if (newStatus === "dead") {
      console.error(`[JOB_QUEUE] Job ${jobId} moved to dead letter after ${attempts} attempts: ${reason}`);
    }
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
   * Start the worker loop. Provide a handler that processes each job.
   */
  start(handler: (job: Job) => Promise<void>): void {
    if (this.running) return;
    this.running = true;
    console.log(`[JOB_QUEUE] Worker started (concurrency=${this.concurrency}, poll=${this.pollIntervalMs}ms)`);

    const poll = async () => {
      if (!this.running) return;

      while (this.activeJobs < this.concurrency && this.running) {
        const job = await this.claimJob();
        if (!job) break; // No more jobs available

        this.activeJobs++;
        // Process in background (don't await)
        this.processJob(job, handler).finally(() => {
          this.activeJobs--;
        });
      }

      // Schedule next poll
      if (this.running) {
        this.pollTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    // Start polling
    poll().catch((err) => {
      console.error("[JOB_QUEUE] Fatal poll error:", err.message);
    });
  }

  private async processJob(job: Job, handler: (job: Job) => Promise<void>): Promise<void> {
    try {
      await handler(job);
      await this.completeJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[JOB_QUEUE] Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`);
      await this.failJob(job.id, message);
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
