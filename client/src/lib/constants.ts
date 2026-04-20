/**
 * Shared frontend constants — extracted from hardcoded values across components.
 * Centralizes magic numbers and configuration for easy tuning.
 */

// ── Upload ────────────────────────────────────────────────
/** Maximum number of files in a single batch upload */
export const MAX_BATCH_SIZE = 20;
/** Maximum individual file size in bytes (100 MB) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
/** Maximum concurrent uploads */
export const MAX_CONCURRENT_UPLOADS = 3;

// ── Calls Table ───────────────────────────────────────────
/** Available page size options for tables */
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
/** Default page size */
export const DEFAULT_PAGE_SIZE = 25;

// ── Audio Playback ────────────────────────────────────────
/** Available playback speed multipliers */
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// ── Search ────────────────────────────────────────────────
/** Debounce delay for search input (ms) */
export const SEARCH_DEBOUNCE_MS = 500;

// ── Query Caching ─────────────────────────────────────────
/** Default stale time for TanStack Query (ms) */
export const DEFAULT_STALE_TIME_MS = 60_000;
/** Grace period after a successful login during which transient 401s are
 * treated as in-flight propagation, not session expiry. */
export const LOGIN_GRACE_MS = 5000;
/** Stale time for calls query in sidebar (ms) */
export const CALLS_STALE_TIME_MS = 30_000;
/** Stale time for employees query (ms) */
export const EMPLOYEES_STALE_TIME_MS = 60_000;

// ── Dashboard ─────────────────────────────────────────────
/** Number of days shown in the dashboard trend chart */
export const DASHBOARD_TREND_DAYS = 30;
/** Number of notifications to keep in the sidebar */
export const MAX_NOTIFICATIONS = 30;

// ── Sentiment ─────────────────────────────────────────────
/** Days lookback for the sentiment page */
export const SENTIMENT_LOOKBACK_DAYS = 90;

// ── Scoring Tiers ─────────────────────────────────────────
// Mirror of server-side scoring constants. Source of truth lives in
// server/constants.ts and is exposed via GET /api/config; these values are
// the static fallback used at module-load time before /api/config resolves.
// A11/A27: a future cleanup will replace these with values fetched from the
// config endpoint via useConfig().
/** Calls scoring at or below this trigger a low-performance coaching alert. */
export const LOW_SCORE_THRESHOLD = 4.0;
/** Calls scoring at or above this trigger a recognition/exceptional alert. */
export const HIGH_SCORE_THRESHOLD = 9.0;
/** Minimum score for a call to count toward a consecutive streak. */
export const STREAK_SCORE_THRESHOLD = 8.0;
/** Score tier breakpoints used by score color/label logic. */
export const SCORE_EXCELLENT = 8;
export const SCORE_GOOD = 6;
export const SCORE_NEEDS_WORK = 4;

/** Default company name (fallback before /api/config resolves). */
export const DEFAULT_COMPANY_NAME = "CallAnalyzer";

// ── Roles ─────────────────────────────────────────────────
/** Role display configuration — label + warm-paper token color per role tier.
 *  `badgeClass` was dropped in the dark-mode-QA pass after confirming zero
 *  consumers; the only remaining consumer is `auth.tsx` which uses `color`
 *  as an inline-style value. Color tokens ramp with privilege: viewer → muted,
 *  manager → amber, admin → accent (copper). */
export const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  viewer: { label: "Viewer", color: "var(--muted-foreground)" },
  manager: { label: "Manager / QA", color: "var(--amber)" },
  admin: { label: "Admin", color: "var(--accent)" },
};
