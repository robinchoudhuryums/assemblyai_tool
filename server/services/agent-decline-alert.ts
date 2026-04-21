/**
 * Agent decline alert scheduler (Tier 2 #6).
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
 * Dedup: only alerts for employees that weren't flagged in the previous
 * check cycle. Once an agent stabilizes (delta > threshold), they become
 * eligible to re-alert on the next decline. Dedup state is in-memory —
 * restart clears it, which means a just-restarted process may re-fire one
 * alert per declining agent. Acceptable trade-off given scheduler runs
 * every 24h by default.
 */
import { storage } from "../storage";
import { triggerWebhook } from "./webhooks";
import { logger } from "./logger";

// Same thresholds used by /api/analytics/health-pulse so the alert and
// dashboard widget agree on what "declining" means.
const MIN_CALLS = 3;
const DEFAULT_THRESHOLD = 1.0;      // overall delta magnitude that triggers an alert
const CRITICAL_THRESHOLD = 1.5;     // delta magnitude that escalates severity

let checkInterval: ReturnType<typeof setInterval> | null = null;
let checkTimeout: ReturnType<typeof setTimeout> | null = null;

// Dedup: employeeIds that were alerted on in the most recent cycle.
// Rebuilt each cycle so a stable agent is re-eligible.
const previouslyAlerted = new Set<string>();

export function isAgentDeclineCheckEnabled(): boolean {
  return process.env.AGENT_DECLINE_CHECK_ENABLED === "true";
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

      // Dedup: skip if we already fired for this employee in the prior
      // cycle (they're still declining; we don't want to spam).
      if (previouslyAlerted.has(emp.id)) continue;

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

  // Replace the dedup set for the next cycle.
  previouslyAlerted.clear();
  newlyAlerted.forEach(id => previouslyAlerted.add(id));

  logger.info("agent-decline-alert: cycle complete", {
    checked: activeEmployees.length,
    alerted: alertedIds.length,
    alertedIds,
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
