/**
 * Centralized scoring and performance thresholds.
 *
 * All scoring-related magic numbers live here so they can be tuned
 * in one place and (optionally) overridden via environment variables.
 */

// A41/F61-F62: every exported constant is env-overridable and NaN-guarded.
function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// --- Coaching alert thresholds ---
/** Calls scoring at or below this trigger a low-performance coaching alert. */
export const LOW_SCORE_THRESHOLD = numFromEnv("SCORE_LOW_THRESHOLD", 4.0);
/** Calls scoring at or above this trigger a recognition/exceptional alert. */
export const HIGH_SCORE_THRESHOLD = numFromEnv("SCORE_HIGH_THRESHOLD", 9.0);

// --- Gamification ---
/** Minimum score for a call to count toward a consecutive streak. */
export const STREAK_SCORE_THRESHOLD = numFromEnv("STREAK_SCORE_THRESHOLD", 8.0);

// --- Coaching weakness detection ---
/** Number of recent low sub-scores required to trigger a coaching plan. */
export const WEAKNESS_CALL_THRESHOLD = numFromEnv("WEAKNESS_CALL_THRESHOLD", 3);
/** Sub-score below this is considered "weak". */
export const WEAKNESS_SCORE_THRESHOLD = numFromEnv("WEAKNESS_SCORE_THRESHOLD", 5.0);
/** Number of recent calls analyzed for recurring weakness patterns. */
export const LOOKBACK_CALLS = numFromEnv("LOOKBACK_CALLS", 10);

/** Monologue: a single speaker talking for longer than this (ms). */
export const MONOLOGUE_DURATION_MS = numFromEnv("MONOLOGUE_DURATION_MS", 60_000);
/** Interruption: speaker change gap shorter than this (ms). */
export const INTERRUPTION_GAP_MS = numFromEnv("INTERRUPTION_GAP_MS", 200);

// --- Pipeline quality gates (A24) ---
/** Minimum call duration in seconds required to run AI analysis. */
export const MIN_CALL_DURATION_FOR_AI_SEC = numFromEnv("MIN_CALL_DURATION_FOR_AI_SEC", 15);
/** Minimum transcript length (chars) to run AI analysis. */
export const MIN_TRANSCRIPT_LEN_FOR_AI = numFromEnv("MIN_TRANSCRIPT_LEN_FOR_AI", 10);
/** Minimum transcript confidence to run AI analysis. */
export const MIN_TRANSCRIPT_CONFIDENCE_FOR_AI = numFromEnv("MIN_TRANSCRIPT_CONFIDENCE_FOR_AI", 0.6);
/** Duration (sec) at or below which routine short-call Haiku optimization kicks in. */
export const HAIKU_SHORT_CALL_MAX_SEC = numFromEnv("HAIKU_SHORT_CALL_MAX_SEC", 120);
/** Estimated-token upper bound for Haiku short-call eligibility. */
export const HAIKU_SHORT_CALL_MAX_TOKENS = numFromEnv("HAIKU_SHORT_CALL_MAX_TOKENS", 3000);
