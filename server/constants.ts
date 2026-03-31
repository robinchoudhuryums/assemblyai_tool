/**
 * Centralized scoring and performance thresholds.
 *
 * All scoring-related magic numbers live here so they can be tuned
 * in one place and (optionally) overridden via environment variables.
 */

// --- Coaching alert thresholds ---
/** Calls scoring at or below this trigger a low-performance coaching alert. */
export const LOW_SCORE_THRESHOLD = parseFloat(process.env.SCORE_LOW_THRESHOLD || "4.0");
/** Calls scoring at or above this trigger a recognition/exceptional alert. */
export const HIGH_SCORE_THRESHOLD = parseFloat(process.env.SCORE_HIGH_THRESHOLD || "9.0");

// --- Gamification ---
/** Minimum score for a call to count toward a consecutive streak. */
export const STREAK_SCORE_THRESHOLD = 8.0;

// --- Coaching weakness detection ---
/** Number of recent low sub-scores required to trigger a coaching plan. */
export const WEAKNESS_CALL_THRESHOLD = 3;
/** Sub-score below this is considered "weak". */
export const WEAKNESS_SCORE_THRESHOLD = 5.0;
/** Number of recent calls analyzed for recurring weakness patterns. */
export const LOOKBACK_CALLS = 10;

// --- Speech metrics ---
/** Monologue: a single speaker talking for longer than this (ms). */
export const MONOLOGUE_DURATION_MS = 60_000;
/** Interruption: speaker change gap shorter than this (ms). */
export const INTERRUPTION_GAP_MS = 200;
