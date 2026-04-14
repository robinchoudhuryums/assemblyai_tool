/**
 * Scheduled Reports Service
 *
 * Generates periodic performance summaries (weekly/monthly).
 *
 * A3/F02/F12/F20:
 * - Reports persist to the `scheduled_reports` table when DATABASE_URL is set
 *   (UNIQUE(type, period_start) makes re-running the same period a no-op).
 * - In-memory cache mirrors the most recent reports for fast reads when no
 *   DB is configured (and as a hot cache when DB is configured).
 * - Scheduler does catch-up on startup: if the most recent expected weekly or
 *   monthly slot has not been generated, it runs immediately. This recovers
 *   from server downtime over the scheduled boundary.
 * - getReports() returns a defensive copy so external callers cannot mutate
 *   the in-memory cache.
 *
 * Email delivery can be added when SMTP is configured.
 */
import { storage } from "../storage";
import { randomUUID } from "crypto";
import { getPool } from "../db/pool";
import { logger } from "./logger";

export interface ScheduledReport {
  id: string;
  type: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  data: ReportData;
}

interface ReportData {
  totalCalls: number;
  completedCalls: number;
  avgScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topPerformers: { name: string; avgScore: number; callCount: number }[];
  lowPerformers: { name: string; avgScore: number; callCount: number }[];
  coachingSessions: number;
  newCoachingPlans: number;
}

// In-memory hot cache. Bounded to 50 entries (FIFO).
const MAX_CACHED_REPORTS = 50;
const reports: ScheduledReport[] = [];

function rowToReport(row: any): ScheduledReport {
  return {
    id: row.id,
    type: row.type,
    periodStart: row.period_start instanceof Date ? row.period_start.toISOString() : row.period_start,
    periodEnd: row.period_end instanceof Date ? row.period_end.toISOString() : row.period_end,
    generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
    generatedBy: row.generated_by,
    data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
  };
}

function cacheUpsert(report: ScheduledReport): void {
  // Replace any cached entry for the same (type, periodStart) — idempotent.
  const idx = reports.findIndex(
    (r) => r.type === report.type && r.periodStart === report.periodStart,
  );
  if (idx >= 0) {
    reports[idx] = report;
    return;
  }
  reports.unshift(report);
  if (reports.length > MAX_CACHED_REPORTS) reports.length = MAX_CACHED_REPORTS;
}

/**
 * Compute the canonical period boundaries for a given type and reference date.
 *
 * Weekly reports cover the prior 7 days ending at the reference time.
 * Monthly reports cover the prior 30 days ending at the reference time.
 *
 * Note: keeping the period_start computation deterministic for a given
 * `now` is what makes UNIQUE(type, period_start) effective for dedupe.
 * The scheduler always passes the canonical boundary timestamps below.
 */
function computePeriod(type: "weekly" | "monthly", now: Date): { periodStart: string; periodEnd: string } {
  const periodEnd = now.toISOString();
  const periodStart = new Date(
    type === "weekly" ? now.getTime() - 7 * 86400000 : now.getTime() - 30 * 86400000,
  ).toISOString();
  return { periodStart, periodEnd };
}

export async function generateReport(
  type: "weekly" | "monthly",
  generatedBy: string,
  referenceDate: Date = new Date(),
): Promise<ScheduledReport> {
  const { periodStart, periodEnd } = computePeriod(type, referenceDate);

  // A4/F15: only fetch calls inside the report window — previously this
  // loaded the entire call universe to filter by date in JS.
  const periodCalls = await storage.getCallsSinceWithDetails(new Date(periodStart));
  const periodEndMs = new Date(periodEnd).getTime();
  const inWindow = periodCalls.filter(c => {
    const uploaded = new Date(c.uploadedAt || 0).getTime();
    return uploaded <= periodEndMs;
  });

  const completedCalls = inWindow.filter(c => c.status === "completed");
  let totalScore = 0, scoredCount = 0;
  const sentiment = { positive: 0, neutral: 0, negative: 0 };

  // Per-employee aggregation
  const employeeStats = new Map<string, { name: string; totalScore: number; count: number }>();

  for (const call of completedCalls) {
    const score = call.analysis?.performanceScore ? Number(call.analysis.performanceScore) : null;
    if (score != null) {
      totalScore += score;
      scoredCount++;
    }
    const sent = call.sentiment?.overallSentiment;
    if (sent === "positive") sentiment.positive++;
    else if (sent === "negative") sentiment.negative++;
    else sentiment.neutral++;

    if (call.employee) {
      const existing = employeeStats.get(call.employee.id) || { name: call.employee.name, totalScore: 0, count: 0 };
      if (score != null) {
        existing.totalScore += score;
        existing.count++;
      }
      employeeStats.set(call.employee.id, existing);
    }
  }

  const rankedEmployees = Array.from(employeeStats.values())
    .filter(e => e.count >= 2) // Minimum 2 calls for ranking
    .map(e => ({ name: e.name, avgScore: e.totalScore / e.count, callCount: e.count }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Count coaching sessions in period
  const allCoaching = await storage.getAllCoachingSessions();
  const periodStartMs = new Date(periodStart).getTime();
  const periodCoaching = allCoaching.filter(c =>
    new Date(c.createdAt || 0).getTime() >= periodStartMs,
  );
  const aiPlans = periodCoaching.filter(c =>
    c.assignedBy === "System (AI Coaching Plan)",
  );

  const data: ReportData = {
    totalCalls: inWindow.length,
    completedCalls: completedCalls.length,
    avgScore: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 10) / 10 : null,
    sentimentBreakdown: sentiment,
    topPerformers: rankedEmployees.slice(0, 5),
    lowPerformers: rankedEmployees.slice(-3).reverse(),
    coachingSessions: periodCoaching.length,
    newCoachingPlans: aiPlans.length,
  };

  const report: ScheduledReport = {
    id: randomUUID(),
    type,
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    generatedBy,
    data,
  };

  // Persist to DB if configured. UNIQUE(type, period_start) makes this safe
  // to call concurrently / on catch-up — duplicate inserts are no-ops and
  // we return the existing row instead.
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query(
        `INSERT INTO scheduled_reports (id, type, period_start, period_end, generated_at, generated_by, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (type, period_start) DO NOTHING
         RETURNING *`,
        [report.id, report.type, report.periodStart, report.periodEnd, report.generatedAt, report.generatedBy, JSON.stringify(report.data)],
      );
      if (result.rows.length === 0) {
        // Conflict: row already exists for this (type, period_start). Return it.
        const existing = await pool.query(
          `SELECT * FROM scheduled_reports WHERE type = $1 AND period_start = $2 LIMIT 1`,
          [type, report.periodStart],
        );
        if (existing.rows.length > 0) {
          const persisted = rowToReport(existing.rows[0]);
          cacheUpsert(persisted);
          logger.info("scheduled report already existed", {
            type,
            periodStart: report.periodStart,
            existingId: persisted.id,
          });
          return persisted;
        }
      }
    } catch (err) {
      logger.error("scheduled report DB persist failed", {
        type,
        periodStart: report.periodStart,
        error: (err as Error).message,
      });
      // Fall through — keep the in-memory copy so the caller still gets a result.
    }
  }

  cacheUpsert(report);
  logger.info("scheduled report generated", {
    type,
    reportId: report.id,
    periodStart: report.periodStart,
    completedCalls: completedCalls.length,
    avgScore: report.data.avgScore,
  });
  return report;
}

/**
 * Returns a defensive shallow copy of the in-memory cache so external callers
 * cannot mutate the underlying array. The cache is hydrated from the DB on
 * scheduler init when configured.
 */
export function getReports(): ScheduledReport[] {
  return [...reports];
}

/**
 * Look up a single report by id. Async because it falls back to DB on cache miss
 * — the in-memory cache is bounded, so older reports must come from the DB.
 */
export async function getReport(id: string): Promise<ScheduledReport | undefined> {
  const cached = reports.find(r => r.id === id);
  if (cached) return cached;
  const pool = getPool();
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM scheduled_reports WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (rows.length > 0) {
        const report = rowToReport(rows[0]);
        cacheUpsert(report);
        return report;
      }
    } catch (err) {
      logger.warn("scheduled report lookup failed", {
        reportId: id,
        error: (err as Error).message,
      });
    }
  }
  return undefined;
}

/**
 * Hydrate the in-memory cache from the DB. Called on startup so /api/admin/reports
 * works immediately without waiting for the next scheduler tick.
 */
async function hydrateCache(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const result = await pool.query(
      `SELECT * FROM scheduled_reports ORDER BY generated_at DESC LIMIT $1`,
      [MAX_CACHED_REPORTS],
    );
    for (const row of result.rows.reverse()) {
      // reverse() so cacheUpsert (which unshifts) ends up newest-first
      cacheUpsert(rowToReport(row));
    }
    logger.info("scheduled report cache hydrated", { count: result.rows.length });
  } catch (err) {
    logger.warn("scheduled report cache hydration failed", {
      error: (err as Error).message,
    });
  }
}

/**
 * Check whether a report for the canonical (type, periodStart) already exists.
 * Used by the catch-up scheduler.
 */
async function reportExistsForPeriod(type: "weekly" | "monthly", periodStart: string): Promise<boolean> {
  const pool = getPool();
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM scheduled_reports WHERE type = $1 AND period_start = $2 LIMIT 1`,
        [type, periodStart],
      );
      return rows.length > 0;
    } catch (err) {
      logger.warn("scheduled report existence check failed", {
        type,
        periodStart,
        error: (err as Error).message,
      });
    }
  }
  return reports.some(r => r.type === type && r.periodStart === periodStart);
}

// Catch-up lookback windows. Covers realistic production outage durations
// (a missed weekend, an extended holiday, a quarter of operational silence).
// generateReport() is pure SQL aggregation — no Bedrock calls — so filling
// up to 12 weekly + 12 monthly missed slots on first boot is cheap (a few
// seconds of DB work) and `ON CONFLICT DO NOTHING` on scheduled_reports
// means re-running catch-up is idempotent across restarts.
const CATCH_UP_WEEKLY_LOOKBACK = 12;
const CATCH_UP_MONTHLY_LOOKBACK = 12;

/**
 * Generate any reports whose canonical scheduled boundary has passed but
 * which were not actually generated (e.g. server was down at midnight).
 *
 * Boundaries:
 * - Weekly: Monday at 00:00 local time
 * - Monthly: 1st-of-month at 00:00 local time
 *
 * This walks back up to CATCH_UP_{WEEKLY,MONTHLY}_LOOKBACK boundaries from
 * "now" and generates each missing report in chronological order. Closes a
 * gap where the previous single-boundary catch-up silently lost every missed
 * period older than the most recent Monday / 1st-of-month. A month-long
 * outage now recovers all affected weeklies and the full missed monthly.
 */
async function runCatchUp(): Promise<void> {
  const now = new Date();

  // --- Weekly: walk back CATCH_UP_WEEKLY_LOOKBACK Mondays ---
  const weeklyAnchor = new Date(now);
  weeklyAnchor.setHours(0, 0, 0, 0);
  const dayOfWeek = weeklyAnchor.getDay(); // 0 = Sunday, 1 = Monday
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  weeklyAnchor.setDate(weeklyAnchor.getDate() - daysSinceMonday);

  // Collect missing boundaries from most-recent back to oldest, then generate
  // oldest-first so the stored reports have natural chronology.
  const missingWeekly: Date[] = [];
  for (let i = 0; i < CATCH_UP_WEEKLY_LOOKBACK; i++) {
    const boundary = new Date(weeklyAnchor);
    boundary.setDate(boundary.getDate() - i * 7);
    if (boundary.getTime() > now.getTime()) continue;
    const { periodStart } = computePeriod("weekly", boundary);
    if (!(await reportExistsForPeriod("weekly", periodStart))) {
      missingWeekly.push(boundary);
    }
  }
  missingWeekly.reverse();
  let weeklyGenerated = 0;
  for (const boundary of missingWeekly) {
    try {
      await generateReport("weekly", "System (Scheduler Catch-up)", boundary);
      weeklyGenerated++;
    } catch (err) {
      logger.error("weekly catch-up report failed", {
        error: (err as Error).message,
        boundary: boundary.toISOString(),
      });
    }
  }
  if (weeklyGenerated > 0) {
    logger.info("weekly catch-up: generated missed reports", { count: weeklyGenerated, lookback: CATCH_UP_WEEKLY_LOOKBACK });
  }

  // --- Monthly: walk back CATCH_UP_MONTHLY_LOOKBACK 1st-of-month boundaries ---
  const missingMonthly: Date[] = [];
  for (let i = 0; i < CATCH_UP_MONTHLY_LOOKBACK; i++) {
    const boundary = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
    if (boundary.getTime() > now.getTime()) continue;
    const { periodStart } = computePeriod("monthly", boundary);
    if (!(await reportExistsForPeriod("monthly", periodStart))) {
      missingMonthly.push(boundary);
    }
  }
  missingMonthly.reverse();
  let monthlyGenerated = 0;
  for (const boundary of missingMonthly) {
    try {
      await generateReport("monthly", "System (Scheduler Catch-up)", boundary);
      monthlyGenerated++;
    } catch (err) {
      logger.error("monthly catch-up report failed", {
        error: (err as Error).message,
        boundary: boundary.toISOString(),
      });
    }
  }
  if (monthlyGenerated > 0) {
    logger.info("monthly catch-up: generated missed reports", { count: monthlyGenerated, lookback: CATCH_UP_MONTHLY_LOOKBACK });
  }
}

// Scheduler
let reportSchedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Auto-generate weekly report every Monday at midnight (called from scheduler).
 *
 * On startup: hydrate the cache, then run catch-up immediately. After that,
 * the hourly tick handles new boundaries as they arrive.
 */
export function startReportScheduler(): void {
  // Fire-and-forget startup tasks: hydrate cache + catch-up.
  hydrateCache()
    .then(() => runCatchUp())
    .catch(err => logger.error("scheduler startup failed", { error: (err as Error).message }));

  const checkAndGenerate = async () => {
    const now = new Date();
    // Generate weekly on Monday (day 1) at the 00:00 hour. Catch-up handles
    // any missed slots; this is just the regular periodic trigger.
    if (now.getDay() === 1 && now.getHours() === 0) {
      const boundary = new Date(now);
      boundary.setMinutes(0, 0, 0);
      const { periodStart } = computePeriod("weekly", boundary);
      if (!(await reportExistsForPeriod("weekly", periodStart))) {
        try {
          await generateReport("weekly", "System (Scheduler)", boundary);
        } catch (error) {
          logger.error("weekly auto-generate failed", { error: (error as Error).message });
        }
      }
    }
    // Generate monthly on 1st of month at 00:00.
    if (now.getDate() === 1 && now.getHours() === 0) {
      const boundary = new Date(now);
      boundary.setMinutes(0, 0, 0);
      const { periodStart } = computePeriod("monthly", boundary);
      if (!(await reportExistsForPeriod("monthly", periodStart))) {
        try {
          await generateReport("monthly", "System (Scheduler)", boundary);
        } catch (error) {
          logger.error("monthly auto-generate failed", { error: (error as Error).message });
        }
      }
    }
  };

  // Check every hour. .unref() so this timer doesn't keep the event loop
  // alive past graceful shutdown.
  reportSchedulerInterval = setInterval(checkAndGenerate, 60 * 60 * 1000);
  reportSchedulerInterval.unref();
  logger.info("scheduled report scheduler started", {
    weekly: "Monday 00:00",
    monthly: "1st of month 00:00",
  });
}

/**
 * Stop the scheduled-reports hourly tick. Safe to call multiple times.
 * Exported for use in graceful shutdown.
 */
export function stopReportScheduler(): void {
  if (reportSchedulerInterval) {
    clearInterval(reportSchedulerInterval);
    reportSchedulerInterval = null;
  }
}
