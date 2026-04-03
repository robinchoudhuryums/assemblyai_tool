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
 *
 * Integrity guarantee (HIPAA §164.312(b)):
 * - Each stdout log entry includes an HMAC-SHA256 integrity hash
 * - The hash is computed over the entry content + previous entry's hash (chain)
 * - If any entry is modified, deleted, or reordered, the chain breaks
 * - Verification: walk entries sequentially, recompute each hash from content + prev hash
 */
import { createHmac } from "crypto";
import { getPool } from "../db/pool";
import { redactPhi } from "./phi-redactor";

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

// --- HMAC Integrity Chain ---
// Each entry's hash = HMAC-SHA256(entry_content + previous_hash, secret).
// The chain makes it detectable if any log entry is modified, deleted, or reordered.
const AUDIT_HMAC_SECRET = process.env.SESSION_SECRET || "audit-log-integrity-key";
let previousHash = "genesis"; // seed value for the first entry in the chain

function computeIntegrityHash(content: string): string {
  const hmac = createHmac("sha256", AUDIT_HMAC_SECRET);
  hmac.update(content);
  hmac.update(previousHash);
  const hash = hmac.digest("hex").slice(0, 16); // truncate to 16 chars for readability
  previousHash = hash;
  return hash;
}

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
  // Redact PHI from the detail field before persisting (defense-in-depth)
  const redactedDetail = entry.detail ? redactPhi(entry.detail).text : entry.detail;

  const line = {
    ...entry,
    detail: redactedDetail,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Compute integrity hash (chained HMAC — detects tampering/deletion)
  const content = JSON.stringify(line);
  const integrity = computeIntegrityHash(content);

  // Always write to stdout with integrity hash (primary log sink)
  console.log(`${AUDIT_PREFIX} ${content} [h:${integrity}]`);

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
