/**
 * Shared chart-primitives for the warm-paper analytics pages.
 *
 * These constants + helpers were originally inlined at the bottom of
 * `client/src/pages/reports.tsx` (installment 7). Installment 9 lifts them
 * here so subsequent analytics pages (Sentiment, Performance, Insights,
 * Agent Scorecard, Team Analytics, Spend Tracking, etc.) can consume one
 * source of truth for Recharts typography / chrome and score-tier color.
 *
 * Keep this module presentational + dependency-light: no React imports,
 * no business logic. It's a CSS-in-JS bundle.
 */

import type { CSSProperties } from "react";

/**
 * Recharts axis tick — mono 10px ticks for both X and Y axes.
 * Pass directly to `<XAxis tick={CHART_TICK} />`.
 */
export const CHART_TICK = {
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  fill: "var(--muted-foreground)",
} as const;

/**
 * Recharts tooltip chrome — paper-card background, hairline border,
 * sans-serif body text. Pass to `<Tooltip contentStyle={CHART_TOOLTIP} />`.
 */
export const CHART_TOOLTIP: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 2,
  fontSize: 12,
  fontFamily: "var(--font-sans)",
};

/**
 * Recharts legend wrapper — mono 10px uppercase, matches the page
 * kicker typography. Pass to `<Legend wrapperStyle={CHART_LEGEND} />`.
 */
export const CHART_LEGEND: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

/**
 * Recharts CartesianGrid stroke — hairline border color, matching
 * the document-row separators throughout the app. Pass via the
 * `stroke` prop (and a faint dash if desired).
 */
export const CHART_GRID_STROKE = "var(--border)";

/**
 * Sentiment-tone fill colors — used by stacked area / bar charts and
 * sentiment dots throughout the app. Sage = positive, muted = neutral,
 * destructive = negative. Lined up with the warm-paper palette so charts
 * visually match the surrounding panels.
 */
export const SENTIMENT_COLOR = {
  positive: "var(--sage)",
  neutral: "var(--muted-foreground)",
  negative: "var(--destructive)",
} as const;

/**
 * Score tier color derivation — mirrors the CallsTable + CallsPreviewRail
 * score palette (sage ≥ EXCELLENT, foreground ≥ GOOD, copper ≥ NEEDS_WORK,
 * destructive below). Accepts null/undefined and returns a muted fallback
 * so it can be used unconditionally on optional scores.
 *
 * Tier breakpoints intentionally hardcoded here rather than imported from
 * `@/lib/constants` so the chart layer stays decoupled from app config —
 * if those breakpoints ever drift, this module is the single grep target.
 */
export function scoreTierColor(score: number | null | undefined): string {
  if (score == null) return "var(--muted-foreground)";
  if (score >= 8) return "var(--sage)";
  if (score >= 6) return "var(--foreground)";
  if (score >= 4) return "var(--accent)";
  return "var(--destructive)";
}
