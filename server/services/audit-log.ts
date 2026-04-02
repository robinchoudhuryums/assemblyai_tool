/**
 * HIPAA PHI Access Audit Logger
 *
 * Logs access to Protected Health Information (PHI) — call recordings,
 * transcripts, analysis data — for compliance and incident response.
 *
 * Dual-write strategy:
 * 1. Always writes to stdout (captured by pm2/CloudWatch/log aggregators)
 * 2. If PostgreSQL is available, also writes to the audit_log table for
 *    durable, queryable 6-year retention (HIPAA requirement)
 *
 * Durability guarantee:
 * - DB writes are buffered in a write-ahead queue and flushed in batches
 * - Failed writes are retried with exponential backoff (up to 3 attempts per entry)
 * - Entries that exhaust retries remain in stdout logs (manual reconciliation)
 * - A dropped entry counter is exposed for health check monitoring
 * - flushAuditQueue() can be called on graceful shutdown to drain pending entries
 */
import { getPool } from "../db/pool";

export interface AuditEntry {
  timestamp: string;
  event: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}

const AUDIT_PREFIX = "[HIPAA_AUDIT]";

const MAX_AUDIT_RETRIES = 3;
const FLUSH_INTERVAL_MS = 2_000;  // flush every 2 seconds
const MAX_QUEUE_SIZE = 5_000;     // cap to prevent unbounded memory growth

// --- Write-ahead queue ---

interface QueuedEntry {
  params: (string | undefined)[];
  attempt: number;
  nextRetryAt: number; // timestamp (ms) — 0 means "ready now"
}

const queue: QueuedEntry[] = [];
let droppedEntries = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Number of audit entries that failed all retry attempts (for health checks). */
export function getDroppedAuditEntryCount(): number {
  return droppedEntries;
}

/** Number of entries waiting to be written to the database. */
export function getPendingAuditEntryCount(): number {
  return queue.length;
}

function enqueue(params: (string | undefined)[]): void {
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Shed oldest entry to prevent unbounded memory growth
    queue.shift();
    droppedEntries++;
    console.error(`${AUDIT_PREFIX} CRITICAL: Audit queue full (${MAX_QUEUE_SIZE}), dropping oldest entry`);
  }
  queue.push({ params, attempt: 0, nextRetryAt: 0 });
  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushAuditQueue().catch((err) => {
      console.error(`${AUDIT_PREFIX} Flush error:`, (err as Error).message);
    });
  }, FLUSH_INTERVAL_MS);
  // Don't prevent process exit
  if (flushTimer && typeof flushTimer === "object" && "unref" in flushTimer) {
    flushTimer.unref();
  }
}

const INSERT_SQL = `INSERT INTO audit_log (timestamp, event, user_id, username, role, resource_type, resource_id, ip, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

/**
 * Flush pending audit entries to the database.
 * Called automatically on a timer; can also be called manually on shutdown.
 */
export async function flushAuditQueue(): Promise<void> {
  const pool = getPool();
  if (!pool || queue.length === 0) return;

  const now = Date.now();
  // Process entries that are ready (not waiting for retry backoff)
  const readyCount = queue.filter(e => e.nextRetryAt <= now).length;
  if (readyCount === 0) return;

  // Drain ready entries from the front of the queue
  const toProcess: QueuedEntry[] = [];
  const remaining: QueuedEntry[] = [];
  for (const entry of queue) {
    if (entry.nextRetryAt <= now && toProcess.length < 100) {
      toProcess.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  // Replace queue contents (keep entries not yet ready + overflow)
  queue.length = 0;
  queue.push(...remaining);

  for (const entry of toProcess) {
    try {
      await pool.query(INSERT_SQL, entry.params);
    } catch (err) {
      entry.attempt++;
      if (entry.attempt < MAX_AUDIT_RETRIES) {
        // Exponential backoff: 500ms, 1s, 2s
        entry.nextRetryAt = Date.now() + 500 * Math.pow(2, entry.attempt - 1);
        queue.push(entry);
      } else {
        droppedEntries++;
        console.error(`${AUDIT_PREFIX} CRITICAL: Failed to write audit entry to database after ${MAX_AUDIT_RETRIES} attempts:`, (err as Error).message);
        console.error(`${AUDIT_PREFIX} Entry preserved in stdout log above — manual reconciliation required.`);
      }
    }
  }

  // Stop timer if queue is empty
  if (queue.length === 0 && flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export function logPhiAccess(entry: AuditEntry): void {
  const line = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Always write to stdout (primary log sink)
  console.log(`${AUDIT_PREFIX} ${JSON.stringify(line)}`);

  // Queue DB write if PostgreSQL is available
  const pool = getPool();
  if (pool) {
    const params = [line.timestamp, line.event, line.userId, line.username, line.role,
      line.resourceType, line.resourceId, line.ip, line.userAgent, line.detail];
    enqueue(params);
  }
}

/**
 * Helper to extract audit-relevant fields from an Express request.
 */
export function auditContext(req: any): Pick<AuditEntry, "userId" | "username" | "role" | "ip" | "userAgent"> {
  const user = req.user as { id?: string; username?: string; role?: string } | undefined;
  return {
    userId: user?.id,
    username: user?.username,
    role: user?.role,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
}

/** Reset internal state — for testing only. */
export function _resetAuditQueue(): void {
  queue.length = 0;
  droppedEntries = 0;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
