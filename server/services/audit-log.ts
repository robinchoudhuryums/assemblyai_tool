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
import { logger } from "./logger";

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
// Dedicated secret for audit log integrity. Falls back to SESSION_SECRET in dev for
// convenience, but production MUST set AUDIT_HMAC_SECRET explicitly — sharing the secret
// with sessions means a session-secret rotation silently breaks the audit chain.
const AUDIT_HMAC_SECRET = (() => {
  const dedicated = process.env.AUDIT_HMAC_SECRET;
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUDIT_HMAC_SECRET is required in production (HIPAA §164.312(b))");
  }
  return process.env.SESSION_SECRET || "audit-log-integrity-key";
})();
let previousHash = "genesis"; // seed value for the first entry in the chain

function computeIntegrityHash(content: string): string {
  const hmac = createHmac("sha256", AUDIT_HMAC_SECRET);
  hmac.update(content);
  hmac.update(previousHash);
  const hash = hmac.digest("hex").slice(0, 16); // truncate to 16 chars for readability
  previousHash = hash;
  // Fire-and-forget persist so a process restart picks up the chain head.
  // Errors are non-fatal: stdout still has the entry + hash.
  persistPreviousHash(hash).catch((err) => {
    logger.error("audit-log: failed to persist integrity chain head", { error: (err as Error).message });
  });
  return hash;
}

let integrityLoaded = false;
async function persistPreviousHash(hash: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO audit_log_integrity (id, previous_hash, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET previous_hash = EXCLUDED.previous_hash, updated_at = NOW()`,
    [hash]
  );
}

/**
 * Load the persisted integrity chain head from PostgreSQL. Idempotent.
 *
 * F01: This function retries on transient DB failure (up to 3 attempts with
 * exponential backoff) and throws if all attempts fail. A failed load would
 * fork the HMAC chain from "genesis", silently breaking tamper detection
 * (HIPAA §164.312(b)). Throwing prevents the server from starting with a
 * broken integrity chain.
 */
export async function loadAuditIntegrityChain(): Promise<void> {
  if (integrityLoaded) return;
  const pool = getPool();
  if (!pool) {
    integrityLoaded = true;
    return;
  }

  const MAX_LOAD_RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= MAX_LOAD_RETRIES; attempt++) {
    try {
      const r = await pool.query<{ previous_hash: string }>(
        `SELECT previous_hash FROM audit_log_integrity WHERE id = 1`
      );
      if (r.rows[0]?.previous_hash) {
        previousHash = r.rows[0].previous_hash;
      }
      integrityLoaded = true;
      return;
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < MAX_LOAD_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn("audit-log: integrity chain load failed, retrying", {
          attempt,
          maxAttempts: MAX_LOAD_RETRIES,
          nextRetryMs: delayMs,
          error: msg,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        // All retries exhausted — throw to prevent server startup with a forked chain.
        // The server must not run with a broken integrity trail (HIPAA §164.312(b)).
        throw new Error(
          `CRITICAL: audit-log HMAC integrity chain could not be loaded after ${MAX_LOAD_RETRIES} attempts. ` +
          `Last error: ${msg}. Server refusing to start to prevent integrity chain fork.`
        );
      }
    }
  }
}

const MAX_AUDIT_RETRIES = 3;
const FLUSH_INTERVAL_MS = 2_000;  // flush every 2 seconds
// Cap to prevent unbounded memory growth. At ~1KB/entry this is 20MB of runway
// under sustained DB outage — enough to absorb several minutes of worst-case
// write bursts before overflow. When full, the OLDEST entry is dropped from
// the DB write path; the canonical non-repudiable record is still in stdout
// via the HMAC chain (see computeIntegrityHash), so operators can reconstruct
// the missing rows from pm2/CloudWatch logs. The first drop per process emits
// a Sentry alert to escalate to on-call.
const MAX_QUEUE_SIZE = 20_000;

// --- Write-ahead queue ---

interface QueuedEntry {
  params: (string | undefined)[];
  attempt: number;
  nextRetryAt: number; // timestamp (ms) — 0 means "ready now"
  enqueuedAt: number;  // for observability: how long the dropped entry sat in the queue
}

const queue: QueuedEntry[] = [];
let droppedEntries = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

// One-shot Sentry escalation: we want on-call paged on the FIRST drop in a
// process lifetime, but we don't want every subsequent drop during the same
// outage to spam Sentry and bury the signal. Reset by process restart.
let alertedQueueFull = false;

/** Number of audit entries that failed all retry attempts (for health checks). */
export function getDroppedAuditEntryCount(): number {
  return droppedEntries;
}

/** Number of entries waiting to be written to the database. */
export function getPendingAuditEntryCount(): number {
  return queue.length;
}

function enqueue(params: (string | undefined)[]): void {
  const now = Date.now();
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Shed OLDEST entry. Under sustained DB outage, oldest-drop is preferable
    // to newest-drop because the head of the queue has typically accumulated
    // failed retry attempts and is more likely already toxic. The canonical
    // record remains in stdout via the HMAC chain — operators can reconstruct
    // dropped rows from captured stdout logs. See MAX_QUEUE_SIZE comment.
    const shed = queue.shift();
    droppedEntries++;
    const ageMs = shed ? now - shed.enqueuedAt : 0;
    logger.error("audit-log: queue full, dropping oldest entry (HMAC chain in stdout remains canonical)", {
      maxQueueSize: MAX_QUEUE_SIZE,
      totalDropped: droppedEntries,
      shedEntryAgeMs: ageMs,
      shedEntryAttempts: shed?.attempt ?? 0,
    });
    // One-shot Sentry escalation — first drop per process pages on-call.
    // Non-blocking dynamic import so a Sentry crash can't cascade into the
    // audit path. We do NOT await; audit logging must stay fire-and-forget.
    if (!alertedQueueFull) {
      alertedQueueFull = true;
      import("./sentry").then(({ captureMessage }) => {
        captureMessage(
          `HIPAA audit queue overflow: oldest entry dropped from DB write path (${MAX_QUEUE_SIZE} entries). ` +
          `Stdout HMAC chain retains canonical record. Investigate DB write latency or increase MAX_QUEUE_SIZE.`,
          "error"
        );
      }).catch(() => { /* noop — Sentry is optional */ });
    }
  }
  queue.push({ params, attempt: 0, nextRetryAt: 0, enqueuedAt: now });
  ensureFlushTimer();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushAuditQueue().catch((err) => {
      logger.error("audit-log: flush error", { error: (err as Error).message });
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
  // Drain ready entries strictly from the head of the queue (FIFO).
  // We stop at the first entry that isn't ready so retry-backoff entries don't
  // jump ahead of fresh entries waiting behind them.
  const toProcess: QueuedEntry[] = [];
  while (queue.length > 0 && toProcess.length < 100) {
    const head = queue[0];
    if (head.nextRetryAt > now) break;
    toProcess.push(queue.shift()!);
  }
  if (toProcess.length === 0) return;

  // Batch INSERT: one query for the whole drained chunk. Builds a parameterized
  // VALUES list (10 cols × N rows). On batch failure we fall back per-row so a
  // single bad entry can't poison the whole batch.
  try {
    const cols = 10;
    const valuesSql = toProcess
      .map((_, i) => `(${Array.from({ length: cols }, (_, c) => `$${i * cols + c + 1}`).join(",")})`)
      .join(",");
    const params: (string | undefined)[] = [];
    for (const e of toProcess) params.push(...e.params);
    await pool.query(
      `INSERT INTO audit_log (timestamp, event, user_id, username, role, resource_type, resource_id, ip, user_agent, detail) VALUES ${valuesSql}`,
      params
    );
  } catch (batchErr) {
    logger.warn("audit-log: batch insert failed, falling back to per-row", { error: (batchErr as Error).message });
    for (const entry of toProcess) {
      try {
        await pool.query(INSERT_SQL, entry.params);
      } catch (err) {
        entry.attempt++;
        if (entry.attempt < MAX_AUDIT_RETRIES) {
          entry.nextRetryAt = Date.now() + 500 * Math.pow(2, entry.attempt - 1);
          queue.push(entry);
        } else {
          droppedEntries++;
          logger.error("audit-log: failed to write entry after max retries — preserved in stdout, manual reconciliation required", { maxRetries: MAX_AUDIT_RETRIES, error: (err as Error).message });
        }
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
  alertedQueueFull = false;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
