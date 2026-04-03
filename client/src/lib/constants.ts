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

// ── Roles ─────────────────────────────────────────────────
/** Role display configuration — single source of truth for colors and labels */
export const ROLE_CONFIG: Record<string, { label: string; badgeClass: string; color: string }> = {
  viewer: { label: "Viewer", badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", color: "text-blue-500" },
  manager: { label: "Manager / QA", badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400", color: "text-amber-500" },
  admin: { label: "Admin", badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400", color: "text-purple-500" },
};
