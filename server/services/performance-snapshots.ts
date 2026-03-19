/**
 * Performance Snapshot Service
 *
 * Generates and stores periodic performance snapshots for employees, teams,
 * departments, and company-wide. Each snapshot captures:
 *
 * 1. Numerical metrics (fast, cheap — good for charts/trends)
 * 2. AI narrative summary (rich context — builds on prior snapshots for longitudinal awareness)
 *
 * The AI narrative prompt includes the last N prior snapshots so the model can
 * identify trajectories, improvements, regressions, and coaching effectiveness
 * over time — rather than treating every period as an isolated data point.
 *
 * Snapshot levels:
 * - employee: Individual agent performance
 * - team: Sub-team aggregate (e.g., PPD, Intake, Prior Auth)
 * - department: Department-level (by role field)
 * - company: Organization-wide aggregate
 */

import { randomUUID } from "crypto";
import { getPool } from "../db/pool";
import { logPhiAccess } from "./audit-log";

// --- Types ---

export type SnapshotLevel = "employee" | "team" | "department" | "company";

export interface PerformanceMetrics {
  totalCalls: number;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  subScores: {
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  };
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  flaggedCallCount: number;
  exceptionalCallCount: number;
}

export interface PerformanceSnapshot {
  id: string;
  level: SnapshotLevel;
  /** Employee ID (for employee level), team/department name, or "company" */
  targetId: string;
  targetName: string;
  periodStart: string;
  periodEnd: string;
  metrics: PerformanceMetrics;
  aiSummary: string | null;
  priorSnapshotIds: string[];
  generatedBy: string;
  generatedAt: string;
}

// --- In-memory store (falls back when no DB) ---

const snapshotStore: PerformanceSnapshot[] = [];

// --- Storage ---

export async function saveSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
  snapshotStore.push(snapshot);

  const pool = getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO performance_snapshots (id, level, target_id, target_name, period_start, period_end, metrics, ai_summary, prior_snapshot_ids, generated_by, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          snapshot.id, snapshot.level, snapshot.targetId, snapshot.targetName,
          snapshot.periodStart, snapshot.periodEnd,
          JSON.stringify(snapshot.metrics), snapshot.aiSummary,
          JSON.stringify(snapshot.priorSnapshotIds),
          snapshot.generatedBy, snapshot.generatedAt,
        ]
      );
    } catch {
      // Table may not exist — snapshot lives in memory
    }
  }
}

/**
 * Get snapshots for a target, ordered newest first.
 */
export async function getSnapshots(
  level: SnapshotLevel,
  targetId: string,
  limit: number = 50
): Promise<PerformanceSnapshot[]> {
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT * FROM performance_snapshots WHERE level = $1 AND target_id = $2 ORDER BY period_end DESC LIMIT $3`,
        [level, targetId, limit]
      );
      if (result.rows.length > 0) {
        return result.rows.map(rowToSnapshot);
      }
    } catch {
      // Fall through to in-memory
    }
  }

  return snapshotStore
    .filter((s) => s.level === level && s.targetId === targetId)
    .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())
    .slice(0, limit);
}

/**
 * Get the most recent snapshot for a target.
 */
export async function getLatestSnapshot(
  level: SnapshotLevel,
  targetId: string
): Promise<PerformanceSnapshot | null> {
  const results = await getSnapshots(level, targetId, 1);
  return results.length > 0 ? results[0] : null;
}

/**
 * Get all snapshots across all targets for a given level (for admin overview).
 */
export async function getAllSnapshotsForLevel(level: SnapshotLevel): Promise<PerformanceSnapshot[]> {
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query(
        `SELECT * FROM performance_snapshots WHERE level = $1 ORDER BY period_end DESC`,
        [level]
      );
      if (result.rows.length > 0) return result.rows.map(rowToSnapshot);
    } catch {
      // Fall through
    }
  }
  return snapshotStore
    .filter((s) => s.level === level)
    .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime());
}

/**
 * AI Context Reset — delete all snapshots for a target so the AI starts fresh.
 * Useful when an employee changes roles, transfers teams, or historical context
 * becomes misleading.
 */
export async function resetSnapshotContext(
  level: SnapshotLevel,
  targetId: string,
  resetBy: string
): Promise<number> {
  // Remove from in-memory store
  let removed = 0;
  for (let i = snapshotStore.length - 1; i >= 0; i--) {
    if (snapshotStore[i].level === level && snapshotStore[i].targetId === targetId) {
      snapshotStore.splice(i, 1);
      removed++;
    }
  }

  // Remove from database
  const pool = getPool();
  if (pool) {
    try {
      const result = await pool.query(
        "DELETE FROM performance_snapshots WHERE level = $1 AND target_id = $2",
        [level, targetId]
      );
      removed = Math.max(removed, result.rowCount || 0);
    } catch {
      // Table may not exist
    }
  }

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "snapshot_context_reset",
    username: resetBy,
    resourceType: "performance_snapshot",
    resourceId: targetId,
    detail: `Reset ${removed} ${level}-level snapshot(s) for "${targetId}"`,
  });

  return removed;
}

// --- Metrics Aggregation ---

interface CallData {
  analysis?: {
    performanceScore?: string;
    subScores?: string | { compliance?: number; customer_experience?: number; communication?: number; resolution?: number };
    feedback?: string | { strengths?: Array<string | { text: string }>; suggestions?: Array<string | { text: string }> };
    topics?: string | string[];
    flags?: string | string[];
  };
  sentiment?: {
    overallSentiment?: string;
  };
}

function safeFloat(val: string | number | undefined | null, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === "number" ? val : parseFloat(val);
  return Number.isNaN(n) ? fallback : n;
}

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (typeof val === "string") {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return (val as T) || fallback;
}

/**
 * Aggregate performance metrics from a set of calls.
 */
export function aggregateMetrics(calls: CallData[]): PerformanceMetrics {
  const scores: number[] = [];
  const allStrengths: string[] = [];
  const allSuggestions: string[] = [];
  const allTopics: string[] = [];
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  let flaggedCount = 0;
  let exceptionalCount = 0;
  const subScoreSums = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0 };
  let subScoreCount = 0;

  for (const call of calls) {
    if (call.analysis?.performanceScore) {
      scores.push(safeFloat(call.analysis.performanceScore));
    }

    // Sub-scores
    if (call.analysis?.subScores) {
      const sub = safeJsonParse<Record<string, number>>(call.analysis.subScores, {});
      if (sub.compliance !== undefined || sub.customer_experience !== undefined) {
        subScoreSums.compliance += safeFloat(sub.compliance);
        subScoreSums.customerExperience += safeFloat(sub.customer_experience);
        subScoreSums.communication += safeFloat(sub.communication);
        subScoreSums.resolution += safeFloat(sub.resolution);
        subScoreCount++;
      }
    }

    // Feedback
    if (call.analysis?.feedback) {
      const fb = safeJsonParse<{ strengths?: Array<string | { text: string }>; suggestions?: Array<string | { text: string }> }>(
        call.analysis.feedback, { strengths: [], suggestions: [] }
      );
      if (fb.strengths) {
        for (const s of fb.strengths) allStrengths.push(typeof s === "string" ? s : s.text);
      }
      if (fb.suggestions) {
        for (const s of fb.suggestions) allSuggestions.push(typeof s === "string" ? s : s.text);
      }
    }

    // Topics
    if (call.analysis?.topics) {
      const topics = safeJsonParse<string[]>(call.analysis.topics, []);
      if (Array.isArray(topics)) allTopics.push(...topics);
    }

    // Flags
    if (call.analysis?.flags) {
      const flags = safeJsonParse<string[]>(call.analysis.flags, []);
      if (Array.isArray(flags)) {
        for (const f of flags) {
          if (typeof f === "string") {
            if (f === "low_score" || f.startsWith("agent_misconduct")) flaggedCount++;
            if (f === "exceptional_call") exceptionalCount++;
          }
        }
      }
    }

    // Sentiment
    if (call.sentiment?.overallSentiment) {
      const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
      if (s in sentimentCounts) sentimentCounts[s]++;
    }
  }

  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return {
    totalCalls: calls.length,
    avgScore: avgScore !== null ? Math.round(avgScore * 100) / 100 : null,
    highScore: scores.length > 0 ? Math.max(...scores) : null,
    lowScore: scores.length > 0 ? Math.min(...scores) : null,
    subScores: {
      compliance: subScoreCount > 0 ? Math.round((subScoreSums.compliance / subScoreCount) * 100) / 100 : null,
      customerExperience: subScoreCount > 0 ? Math.round((subScoreSums.customerExperience / subScoreCount) * 100) / 100 : null,
      communication: subScoreCount > 0 ? Math.round((subScoreSums.communication / subScoreCount) * 100) / 100 : null,
      resolution: subScoreCount > 0 ? Math.round((subScoreSums.resolution / subScoreCount) * 100) / 100 : null,
    },
    sentimentBreakdown: sentimentCounts,
    topStrengths: countFrequency(allStrengths),
    topSuggestions: countFrequency(allSuggestions),
    commonTopics: countFrequency(allTopics),
    flaggedCallCount: flaggedCount,
    exceptionalCallCount: exceptionalCount,
  };
}

function countFrequency(arr: string[]): Array<{ text: string; count: number }> {
  const freq = new Map<string, number>();
  for (const item of arr) {
    const n = item.trim().toLowerCase();
    if (n) freq.set(n, (freq.get(n) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([text, count]) => ({ text, count }));
}

// --- AI Summary Prompt Builder ---

/**
 * Build a prompt that includes prior snapshot context for longitudinal awareness.
 */
export function buildSnapshotSummaryPrompt(params: {
  level: SnapshotLevel;
  targetName: string;
  periodLabel: string;
  metrics: PerformanceMetrics;
  priorSnapshots: PerformanceSnapshot[];
  role?: string;
  memberCount?: number;
}): string {
  const { level, targetName, periodLabel, metrics, priorSnapshots, role, memberCount } = params;

  const levelLabels: Record<SnapshotLevel, string> = {
    employee: "call center agent",
    team: "sub-team",
    department: "department",
    company: "company",
  };

  const strengthsList = metrics.topStrengths.map(s => `- "${s.text}" (${s.count}x)`).join("\n");
  const suggestionsList = metrics.topSuggestions.map(s => `- "${s.text}" (${s.count}x)`).join("\n");
  const topicsList = metrics.commonTopics.map(t => `- ${t.text} (${t.count} calls)`).join("\n");

  // Build prior context section
  let priorContext = "";
  if (priorSnapshots.length > 0) {
    priorContext = "\n\nPRIOR REVIEW HISTORY (use this to identify trends, improvements, and regressions):\n";
    for (const snap of priorSnapshots.slice(0, 6)) {
      priorContext += `\n--- ${snap.periodStart} to ${snap.periodEnd} ---\n`;
      priorContext += `Calls: ${snap.metrics.totalCalls}, Avg Score: ${snap.metrics.avgScore?.toFixed(1) ?? "N/A"}/10`;
      if (snap.metrics.subScores.compliance !== null) {
        priorContext += `, Sub-scores: Compliance ${snap.metrics.subScores.compliance}, CX ${snap.metrics.subScores.customerExperience}, Comm ${snap.metrics.subScores.communication}, Resolution ${snap.metrics.subScores.resolution}`;
      }
      priorContext += `\nSentiment: +${snap.metrics.sentimentBreakdown.positive} / ~${snap.metrics.sentimentBreakdown.neutral} / -${snap.metrics.sentimentBreakdown.negative}`;
      priorContext += `\nFlagged: ${snap.metrics.flaggedCallCount}, Exceptional: ${snap.metrics.exceptionalCallCount}`;
      if (snap.aiSummary) {
        // Include a condensed version of the prior AI summary
        const condensed = snap.aiSummary.length > 500 ? snap.aiSummary.slice(0, 500) + "..." : snap.aiSummary;
        priorContext += `\nPrior AI Assessment: ${condensed}`;
      }
      priorContext += "\n";
    }
  }

  const memberInfo = memberCount !== undefined ? `\nTEAM SIZE: ${memberCount} members` : "";
  const roleInfo = role ? `\nROLE/DEPARTMENT: ${role}` : "";

  return `You are an HR/quality assurance analyst for a medical supply company. Write a professional performance review for the following ${levelLabels[level]}.

${level === "company" ? "ORGANIZATION" : level.toUpperCase()}: ${targetName}${roleInfo}${memberInfo}
REVIEW PERIOD: ${periodLabel}
TOTAL CALLS ANALYZED: ${metrics.totalCalls}

PERFORMANCE SCORES:
- Average: ${metrics.avgScore?.toFixed(1) ?? "N/A"}/10
- Best: ${metrics.highScore?.toFixed(1) ?? "N/A"}/10
- Lowest: ${metrics.lowScore?.toFixed(1) ?? "N/A"}/10
${metrics.subScores.compliance !== null ? `- Sub-scores: Compliance ${metrics.subScores.compliance}/10, Customer Experience ${metrics.subScores.customerExperience}/10, Communication ${metrics.subScores.communication}/10, Resolution ${metrics.subScores.resolution}/10` : ""}

SENTIMENT BREAKDOWN:
- Positive: ${metrics.sentimentBreakdown.positive}
- Neutral: ${metrics.sentimentBreakdown.neutral}
- Negative: ${metrics.sentimentBreakdown.negative}

FLAGGED CALLS: ${metrics.flaggedCallCount} (low score or misconduct)
EXCEPTIONAL CALLS: ${metrics.exceptionalCallCount} (score >= 9)

RECURRING STRENGTHS:
${strengthsList || "None identified"}

RECURRING AREAS FOR IMPROVEMENT:
${suggestionsList || "None identified"}

COMMON CALL TOPICS:
${topicsList || "Various"}
${priorContext}
Write a concise (3-4 paragraph) professional narrative that:
1. Summarizes performance for THIS period specifically
2. ${priorSnapshots.length > 0 ? "Compares against prior periods — note improvements, regressions, or plateaus with specific metric changes" : "Establishes a baseline assessment"}
3. Highlights consistent strengths and persistent or emerging areas for improvement
4. Provides actionable recommendations ${level === "employee" ? "for coaching" : "for leadership to address"}
${priorSnapshots.length > 0 ? "5. Notes whether previous recommendations appear to have been acted upon (based on metric changes)" : ""}

Use a professional but supportive tone. Do NOT use markdown formatting, bullet points, or headers — write in plain paragraph form.`;
}

// --- DB Row Conversion ---

function rowToSnapshot(r: any): PerformanceSnapshot {
  return {
    id: r.id,
    level: r.level,
    targetId: r.target_id,
    targetName: r.target_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    metrics: typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics,
    aiSummary: r.ai_summary,
    priorSnapshotIds: typeof r.prior_snapshot_ids === "string" ? JSON.parse(r.prior_snapshot_ids) : (r.prior_snapshot_ids || []),
    generatedBy: r.generated_by,
    generatedAt: r.generated_at,
  };
}
