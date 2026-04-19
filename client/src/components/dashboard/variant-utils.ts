/**
 * Shared TS types + data-shaping helpers used by both dashboard variants.
 *
 * Kept separate from `primitives.tsx` so the presentational components stay
 * pure and the data-munging is isolated + testable.
 */
import type { CallWithDetails, Employee } from "@shared/schema";

// ────── API response shapes the dashboard queries ──────

export interface HeatmapCell {
  dow: number;
  hour: number;
  count: number;
  avgScore: number | null;
}

export interface HeatmapResponse {
  cells: HeatmapCell[];
  days: number;
}

export interface AgentDelta {
  employeeId: string;
  employeeName: string;
  currentAvg: number;
  previousAvg: number;
  delta: number;
  currentCount: number;
  previousCount: number;
}

export interface FlagPair {
  current: number;
  previous: number;
}

export interface NoteworthyCall {
  callId: string;
  fileName: string | null;
  score: number | null;
  employeeName: string | null;
  kind: "exceptional" | "regression" | "flag";
}

export interface WeeklyChangesResponse {
  windowDays: number;
  currentWeek: {
    callCount: number;
    avgScore: number | null;
    positivePct: number | null;
    start: string;
    end: string;
  };
  previousWeek: {
    callCount: number;
    avgScore: number | null;
    positivePct: number | null;
    start: string;
    end: string;
  };
  scoreDelta: number | null;
  positiveDelta: number | null;
  topImprovers: AgentDelta[];
  topRegressions: AgentDelta[];
  flags: {
    lowScore: FlagPair;
    exceptional: FlagPair;
    agentMisconduct: FlagPair;
    missingRequiredPhrase: FlagPair;
    promptInjection: FlagPair;
  };
  noteworthy: NoteworthyCall[];
  narrative: string;
}

export type TopPerformer = Partial<Employee> & {
  score?: number | null;
  avgPerformanceScore?: number | null;
  totalCalls?: number | null;
};

// ────── Derivation helpers ──────

/**
 * Aggregate the heatmap grid (7 × 24) into a 24-element hourly curve.
 * For each hour-of-day, average `avgScore` across all days (weighted by count)
 * to produce a single representative score, then map score→sentiment on
 * [-1, 1] via `(score - 5) / 5` so 0 is the neutral pivot.
 */
export function deriveHourlyCurve(cells: HeatmapCell[] | undefined): {
  sentiment: Array<number | null>;
  volume: number[];
  peak: { hour: number; value: number } | null;
  trough: { hour: number; value: number } | null;
} {
  const sentiment: Array<number | null> = new Array(24).fill(null);
  const volume: number[] = new Array(24).fill(0);
  if (!cells || cells.length === 0) return { sentiment, volume, peak: null, trough: null };

  // Accumulate per-hour total-score + count across all 7 days.
  const acc: Array<{ totalScore: number; scored: number; count: number }> = Array.from({ length: 24 }, () => ({
    totalScore: 0,
    scored: 0,
    count: 0,
  }));
  for (const cell of cells) {
    if (cell.hour < 0 || cell.hour > 23) continue;
    const slot = acc[cell.hour];
    slot.count += cell.count || 0;
    if (cell.avgScore != null && cell.count > 0) {
      slot.totalScore += cell.avgScore * cell.count;
      slot.scored += cell.count;
    }
  }

  for (let h = 0; h < 24; h++) {
    volume[h] = acc[h].count;
    if (acc[h].scored > 0) {
      const avg = acc[h].totalScore / acc[h].scored;
      // Map [0, 10] → [-1, 1]
      const normalized = Math.max(-1, Math.min(1, (avg - 5) / 5));
      sentiment[h] = Math.round(normalized * 100) / 100;
    }
  }

  // Peak / trough across non-null hours
  let peak: { hour: number; value: number } | null = null;
  let trough: { hour: number; value: number } | null = null;
  sentiment.forEach((v, h) => {
    if (v == null) return;
    if (peak == null || v > peak.value) peak = { hour: h, value: v };
    if (trough == null || v < trough.value) trough = { hour: h, value: v };
  });

  return { sentiment, volume, peak, trough };
}

/**
 * Extract the flagged / exceptional calls client-side from a paginated
 * calls response. Same heuristic as the old dashboard.
 */
export function extractFlagged(calls: CallWithDetails[]): CallWithDetails[] {
  const out: CallWithDetails[] = [];
  for (const c of calls) {
    const flags = c.analysis?.flags;
    if (!Array.isArray(flags) || flags.length === 0) continue;
    const isBad = flags.some((f) => typeof f === "string" && (f === "low_score" || f.startsWith("agent_misconduct")));
    if (isBad) out.push(c);
  }
  return out;
}

export function extractExemplar(calls: CallWithDetails[]): CallWithDetails | undefined {
  for (const c of calls) {
    const flags = c.analysis?.flags;
    if (Array.isArray(flags) && flags.includes("exceptional_call")) return c;
  }
  // Fallback: highest-scoring completed call
  let best: CallWithDetails | undefined;
  let bestScore = -Infinity;
  for (const c of calls) {
    if (c.status !== "completed") continue;
    const score = parseFloat(c.analysis?.performanceScore || "0");
    if (Number.isFinite(score) && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best && bestScore >= 8 ? best : undefined;
}

/**
 * "Alex Rivera" → "AR" · "Single" → "SI" · "" → "—"
 */
export function initialsFromName(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function safeAvg(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.round((sum / arr.length) * 10) / 10;
}

/**
 * Short hh:mm from an ISO timestamp string. Used in Ledger's recent-calls row.
 */
export function formatClock(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

/**
 * Convert seconds to "m:ss" (no hour). Used in Ledger's recent-calls row.
 */
export function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
