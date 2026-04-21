/**
 * Agent decline alert scheduler (Tier 2 #6, Tier A #2 persistence).
 *
 * Periodically computes a health pulse for every active employee — the same
 * current-window-vs-prior-window comparison used by
 * /api/analytics/health-pulse/:employeeId — and fires a webhook event when
 * an agent's overall performance trend drops below a configurable threshold.
 *
 * Turns the dashboard-only health-pulse signal into an active, proactive
 * notification stream. Without this scheduler, a manager only knows an agent
 * is declining if they happen to open the health-pulse widget.
 *
 * Env vars:
 *   AGENT_DECLINE_CHECK_ENABLED      — "true" to enable (default: disabled)
 *   AGENT_DECLINE_CHECK_INTERVAL_HOURS — how often to run (default: 24)
 *   AGENT_DECLINE_WINDOW_DAYS        — window size for both halves (default: 14)
 *   AGENT_DECLINE_THRESHOLD          — min negative overall delta to fire alert (default: 1.0)
 *
 * Event shape (webhook event `agent.decline_alert`):
 *   {
 *     employeeId, employeeName,
 *     currentAvg, priorAvg, delta,
 *     currentCount, priorCount,
 *     windowDays, severity ("warning" | "critical")
 *   }
 *
 * Dedup: Tier A #2 added DB persistence. When DATABASE_URL is set, the
 * `agent_decline_alert_history` table records every fire with a timestamp;
 * new cycles skip employees whose last alert was within a cool-off window
 * (2× the scheduler interval, default 48h). A process restart no longer
 * re-fires alerts for every currently-declining agent. Without DATABASE_URL,
 * falls back to the prior in-memory-only dedup (one-cycle cooldown).
 */
import { storage } from "../storage";
import { triggerWebhook } from "./webhooks";
import { logger } from "./logger";
import { getPool } from "../db/pool";

// Same thresholds used by /api/analytics/health-pulse so the alert and
// dashboard widget agree on what "declining" means.
const MIN_CALLS = 3;
const DEFAULT_THRESHOLD = 1.0;      // overall delta magnitude that triggers an alert
const CRITICAL_THRESHOLD = 1.5;     // delta magnitude that escalates severity

let checkInterval: ReturnType<typeof setInterval> | null = null;
let checkTimeout: ReturnType<typeof setTimeout> | null = null;

// In-memory dedup — used both as the authoritative store when DATABASE_URL
// is unset AND as a per-cycle scratchpad when DB-backed dedup is available.
// Rebuilt each cycle so a stable-then-declining agent is re-eligible after
// stability.
const previouslyAlerted = new Set<string>();

export function isAgentDeclineCheckEnabled(): boolean {
  return process.env.AGENT_DECLINE_CHECK_ENABLED === "true";
}

/**
 * Load the set of employees whose last alert was within the cool-off window
 * (2× scheduler interval, default 48h). Returns null when DATABASE_URL is
 * unset — callers fall back to the in-memory `previouslyAlerted` set.
 */
async function loadDedupSetFromDb(coolOffMs: number): Promise<Set<string> | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const cutoff = new Date(Date.now() - coolOffMs);
    const { rows } = await pool.query<{ employee_id: string }>(
      `SELECT employee_id FROM agent_decline_alert_history WHERE last_alerted_at >= $1`,
      [cutoff],
    );
    return new Set(rows.map(r => r.employee_id));
  } catch (err) {
    logger.warn("agent-decline-alert: failed to load dedup set from DB (falling back to in-memory)", {
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Record an alert in the DB history table. Upserts on employee_id so a
 * re-alert after the cool-off window refreshes the timestamp. Returns
 * silently on failure — the in-memory `previouslyAlerted` set still
 * provides one-cycle dedup as a fallback.
 */
async function recordAlertInDb(employeeId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO agent_decline_alert_history (employee_id, last_alerted_at)
       VALUES ($1, NOW())
       ON CONFLICT (employee_id) DO UPDATE SET last_alerted_at = NOW()`,
      [employeeId],
    );
  } catch (err) {
    logger.warn("agent-decline-alert: failed to persist alert to DB (non-blocking)", {
      employeeId,
      error: (err as Error).message,
    });
  }
}

/**
 * Prune history rows older than the cool-off window. Opportunistic cleanup
 * runs at the top of each cycle so the table stays bounded at roughly
 * `num-declining-agents × retention-window` rows.
 */
async function pruneDedupHistory(coolOffMs: number): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const cutoff = new Date(Date.now() - coolOffMs);
    await pool.query(`DELETE FROM agent_decline_alert_history WHERE last_alerted_at < $1`, [cutoff]);
  } catch (err) {
    logger.warn("agent-decline-alert: dedup history prune failed (non-blocking)", {
      error: (err as Error).message,
    });
  }
}

/**
 * Compute health pulse for a single employee — inlined subset of the logic
 * in /api/analytics/health-pulse. Returns null if either window has
 * insufficient data.
 */
async function computePulse(employeeId: string, windowDays: number): Promise<{
  current: { count: number; avgScore: number | null };
  prior: { count: number; avgScore: number | null };
  delta: number | null;
} | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const priorStart = new Date(now.getTime() - 2 * windowDays * 86_400_000);

  const allCalls = await storage.getCallsSinceWithDetails(priorStart, employeeId);

  const avgOf = (arr: number[]): number | null =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const bucket = (from: Date, to: Date) => {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const scores: number[] = [];
    let count = 0;
    for (const c of allCalls) {
      if (!c.uploadedAt) continue;
      const t = new Date(c.uploadedAt).getTime();
      if (t < fromMs || t >= toMs) continue;
      count++;
      const s = c.analysis?.performanceScore;
      if (s != null) {
        const n = parseFloat(String(s));
        if (Number.isFinite(n)) scores.push(n);
      }
    }
    return { count, avgScore: avgOf(scores) };
  };

  const current = bucket(windowStart, now);
  const prior = bucket(priorStart, windowStart);
  if (current.count < MIN_CALLS || prior.count < MIN_CALLS) return null;
  if (current.avgScore === null || prior.avgScore === null) return null;

  const delta = Math.round((current.avgScore - prior.avgScore) * 100) / 100;
  return { current, prior, delta };
}

/**
 * One decline-check cycle: walk active employees, compute each pulse, fire
 * webhook for any whose overall delta is below -threshold. Exported so
 * operators can trigger a manual run via an admin endpoint if desired.
 */
export async function runDeclineCheck(): Promise<{
  checked: number;
  alerted: number;
  employeeIds: string[];
}> {
  const windowDays = Math.max(7, Math.min(parseInt(process.env.AGENT_DECLINE_WINDOW_DAYS || "14", 10) || 14, 90));
  const threshold = Math.max(0.1, parseFloat(process.env.AGENT_DECLINE_THRESHOLD || String(DEFAULT_THRESHOLD)) || DEFAULT_THRESHOLD);
  const intervalHours = Math.max(1, Math.min(parseInt(process.env.AGENT_DECLINE_CHECK_INTERVAL_HOURS || "24", 10) || 24, 168));
  // Cool-off window: 2× the scheduler interval. An agent who fired an
  // alert stays muted until 2 full cycles have passed, giving them time
  // to recover before we repeat the alert.
  const coolOffMs = 2 * intervalHours * 3600 * 1000;

  // Opportunistic prune of expired history so the table stays bounded.
  await pruneDedupHistory(coolOffMs);

  // Load the effective dedup set. DB-backed when DATABASE_URL is set
  // (survives restarts); falls back to the in-memory previouslyAlerted
  // set when DB is unavailable. Crash during a cycle no longer re-fires
  // alerts for every currently-declining agent on next boot.
  const dbDedup = await loadDedupSetFromDb(coolOffMs);
  const dedupSet = dbDedup ?? previouslyAlerted;

  const employees = await storage.getAllEmployees();
  const activeEmployees = employees.filter(e => (e.status || "Active") === "Active");

  const newlyAlerted = new Set<string>();
  const alertedIds: string[] = [];

  for (const emp of activeEmployees) {
    try {
      const pulse = await computePulse(emp.id, windowDays);
      if (!pulse || pulse.delta === null) continue;

      // Trending down by at least the configured threshold.
      if (pulse.delta > -threshold) {
        // Employee is stable or improving — they're eligible to re-alert
        // on the next decline by virtue of not being in `newlyAlerted`.
        continue;
      }

      newlyAlerted.add(emp.id);

      // Dedup: skip if we already fired for this employee within the
      // cool-off window (DB-backed when available, in-memory fallback).
      if (dedupSet.has(emp.id)) continue;

      alertedIds.push(emp.id);
      const severity = Math.abs(pulse.delta) >= CRITICAL_THRESHOLD ? "critical" : "warning";

      // Non-blocking fire-and-forget webhook dispatch.
      triggerWebhook("agent.decline_alert", {
        employeeId: emp.id,
        employeeName: emp.name,
        currentAvg: pulse.current.avgScore,
        priorAvg: pulse.prior.avgScore,
        delta: pulse.delta,
        currentCount: pulse.current.count,
        priorCount: pulse.prior.count,
        windowDays,
        severity,
      }).catch(err => {
        logger.warn("agent-decline-alert: webhook delivery failed (non-blocking)", {
          employeeId: emp.id,
          error: (err as Error).message,
        });
      });

      // Persist to DB so a crash before cycle-end still dedups next boot.
      // Fire-and-forget — the in-memory set below provides fallback dedup
      // for the rest of this cycle even if the DB write fails.
      await recordAlertInDb(emp.id);

      logger.info("agent-decline-alert: fired", {
        employeeId: emp.id,
        employeeName: emp.name,
        delta: pulse.delta,
        severity,
      });
    } catch (err) {
      logger.warn("agent-decline-alert: failed to compute pulse for employee", {
        employeeId: emp.id,
        error: (err as Error).message,
      });
    }
  }

  // Replace the in-memory dedup set for the next cycle. Still meaningful
  // as a fallback when DB-backed dedup is unavailable.
  previouslyAlerted.clear();
  newlyAlerted.forEach(id => previouslyAlerted.add(id));

  logger.info("agent-decline-alert: cycle complete", {
    checked: activeEmployees.length,
    alerted: alertedIds.length,
    alertedIds,
    dedupBackend: dbDedup ? "db" : "in-memory",
  });

  return {
    checked: activeEmployees.length,
    alerted: alertedIds.length,
    employeeIds: alertedIds,
  };
}

/** Start the decline-check scheduler. No-op when disabled. Idempotent. */
export function startAgentDeclineScheduler(): () => void {
  if (!isAgentDeclineCheckEnabled()) {
    logger.info("agent-decline-alert: scheduler disabled (AGENT_DECLINE_CHECK_ENABLED != 'true')");
    return stopAgentDeclineScheduler;
  }
  if (checkInterval) return stopAgentDeclineScheduler;

  const intervalHours = Math.max(1, Math.min(parseInt(process.env.AGENT_DECLINE_CHECK_INTERVAL_HOURS || "24", 10) || 24, 168));
  logger.info("agent-decline-alert: scheduler started", { intervalHours });

  // First run after 2 minutes so the server finishes booting + schedulers
  // above us have a chance to warm up their caches. .unref() per INV-30.
  checkTimeout = setTimeout(() => {
    runDeclineCheck().catch(err => {
      logger.warn("agent-decline-alert: initial run failed", { error: (err as Error).message });
    });
  }, 2 * 60 * 1000);
  checkTimeout.unref();

  checkInterval = setInterval(() => {
    runDeclineCheck().catch(err => {
      logger.warn("agent-decline-alert: scheduled run failed", { error: (err as Error).message });
    });
  }, intervalHours * 3600 * 1000);
  checkInterval.unref();

  return stopAgentDeclineScheduler;
}

/** Stop the scheduler. Safe to call multiple times. */
export function stopAgentDeclineScheduler(): void {
  if (checkTimeout) { clearTimeout(checkTimeout); checkTimeout = null; }
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
}
