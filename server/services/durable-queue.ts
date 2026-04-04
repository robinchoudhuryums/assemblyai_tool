/**
 * Durable Job Queue Service — Redis-backed with in-memory fallback.
 *
 * Adapted from Observatory QA's BullMQ infrastructure pattern.
 * Provides crash-safe async job processing with retry logic,
 * dead-letter queue for permanently failed jobs, and job status tracking.
 *
 * When REDIS_URL is set, jobs survive server restarts.
 * Without Redis, falls back to in-memory processing (current behavior).
 *
 * Queues:
 * - audio-processing: Transcription + AI analysis pipeline
 * - batch-inference: Bedrock batch job lifecycle
 * - data-retention: Purge expired calls
 *
 * Prerequisites: npm install bullmq ioredis
 */

export interface JobDefinition {
  id: string;
  queue: string;
  data: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  status: "pending" | "active" | "completed" | "failed" | "dead";
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// In-memory job store (fallback when Redis unavailable)
const jobStore = new Map<string, JobDefinition>();
const deadLetterStore: JobDefinition[] = [];

/**
 * Check if Redis-backed queues are available.
 */
export function isRedisAvailable(): boolean {
  return !!process.env.REDIS_URL;
}

/**
 * Enqueue a job for async processing.
 * Returns the job ID for status tracking.
 */
export async function enqueueJob(
  queue: string,
  data: Record<string, unknown>,
  options?: { maxAttempts?: number },
): Promise<string> {
  const id = `${queue}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxAttempts = options?.maxAttempts ?? 3;

  if (isRedisAvailable()) {
    // BullMQ path — dynamic import to avoid hard dependency.
    // If bullmq is not installed, the import throws and we fall through to in-memory.
    try {
      const bullmq: any = await import("bullmq" as string);
      const QueueClass = bullmq.Queue;
      const redisUrl = process.env.REDIS_URL!;
      const q = new QueueClass(queue, { connection: { url: redisUrl } });
      const job = await q.add(queue, data, {
        jobId: id,
        attempts: maxAttempts,
        backoff: { type: "exponential", delay: 2000 },
      });
      await q.close();
      console.log(`[QUEUE] Enqueued job ${job.id} to ${queue} (Redis-backed)`);
      return job.id || id;
    } catch (err) {
      console.warn(`[QUEUE] Redis enqueue failed, falling back to in-memory: ${(err as Error).message}`);
    }
  }

  // In-memory fallback
  const job: JobDefinition = {
    id,
    queue,
    data,
    attempts: 0,
    maxAttempts,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  jobStore.set(id, job);
  console.log(`[QUEUE] Enqueued job ${id} to ${queue} (in-memory)`);
  return id;
}

/**
 * Get job status.
 */
export function getJobStatus(jobId: string): JobDefinition | undefined {
  return jobStore.get(jobId);
}

/**
 * Mark a job as completed.
 */
export function completeJob(jobId: string): void {
  const job = jobStore.get(jobId);
  if (job) {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  }
}

/**
 * Mark a job as failed. Moves to dead-letter after max attempts.
 */
export function failJob(jobId: string, error: string): void {
  const job = jobStore.get(jobId);
  if (!job) return;

  job.attempts++;
  job.error = error;

  if (job.attempts >= job.maxAttempts) {
    job.status = "dead";
    deadLetterStore.push({ ...job });
    jobStore.delete(jobId);
    console.warn(`[QUEUE] Job ${jobId} moved to dead-letter after ${job.attempts} attempts: ${error}`);
  } else {
    job.status = "pending"; // Will be retried
    console.warn(`[QUEUE] Job ${jobId} failed (attempt ${job.attempts}/${job.maxAttempts}): ${error}`);
  }
}

/**
 * Get all dead-letter queue entries.
 */
export function getDeadLetterJobs(): JobDefinition[] {
  return [...deadLetterStore];
}

/**
 * Retry a dead-letter job by re-enqueueing it.
 */
export async function retryDeadLetterJob(jobId: string): Promise<string | null> {
  const idx = deadLetterStore.findIndex((j) => j.id === jobId);
  if (idx === -1) return null;

  const [job] = deadLetterStore.splice(idx, 1);
  return enqueueJob(job.queue, job.data, { maxAttempts: job.maxAttempts });
}

/**
 * Get pending job count per queue (for admin dashboard).
 */
export function getQueueStats(): Record<string, { pending: number; active: number; failed: number; dead: number }> {
  const stats: Record<string, { pending: number; active: number; failed: number; dead: number }> = {};

  for (const job of jobStore.values()) {
    if (!stats[job.queue]) stats[job.queue] = { pending: 0, active: 0, failed: 0, dead: 0 };
    if (job.status === "pending") stats[job.queue].pending++;
    else if (job.status === "active") stats[job.queue].active++;
    else if (job.status === "failed") stats[job.queue].failed++;
  }

  // Dead letter counts
  for (const job of deadLetterStore) {
    if (!stats[job.queue]) stats[job.queue] = { pending: 0, active: 0, failed: 0, dead: 0 };
    stats[job.queue].dead++;
  }

  return stats;
}
