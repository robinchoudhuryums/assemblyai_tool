/**
 * Call Quality Scoring Calibration
 *
 * AI models tend to score generously (average ~7.5/10). This module
 * applies configurable calibration to normalize scores to a desired
 * distribution, making the scoring system more useful for identifying
 * truly exceptional and underperforming calls.
 *
 * Configure via environment variables:
 *   SCORE_CALIBRATION_ENABLED=true
 *   SCORE_CALIBRATION_CENTER=5.5   (desired mean score)
 *   SCORE_CALIBRATION_SPREAD=1.2   (>1 widens distribution, <1 compresses)
 *   SCORE_LOW_THRESHOLD=4.0        (flag threshold for coaching alerts)
 *   SCORE_HIGH_THRESHOLD=9.0       (flag threshold for exceptional calls)
 */

export interface ScoringCalibration {
  enabled: boolean;
  /** Desired center/mean of the score distribution (default: 5.5) */
  center: number;
  /** Multiplier for how far scores deviate from center (default: 1.2) */
  spread: number;
  /** Observed AI model mean (estimated from recent data) */
  aiModelMean: number;
  /** Score threshold for "low_score" flag (default: 4.0) */
  lowThreshold: number;
  /** Score threshold for "exceptional_call" flag (default: 9.0) */
  highThreshold: number;
}

/** Parse a float from env var with a fallback default (guards against NaN from malformed values). */
function safeParseFloat(envVal: string | undefined, fallback: number): number {
  if (!envVal) return fallback;
  const parsed = parseFloat(envVal);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Runtime overrides applied via admin calibration UI.
 * Persisted to S3 (`calibration/active-config.json`) and loaded on startup.
 * Takes precedence over env vars when set.
 */
let runtimeOverrides: Partial<ScoringCalibration> | null = null;

/** Apply runtime overrides (called from admin calibration endpoint). */
export function setRuntimeCalibration(overrides: Partial<ScoringCalibration>): void {
  runtimeOverrides = overrides;
}

/** Load runtime overrides from S3 on startup. */
export async function loadPersistedCalibration(s3Client: { downloadJson<T>(key: string): Promise<T | undefined> } | undefined): Promise<void> {
  if (!s3Client) return;
  try {
    const stored = await s3Client.downloadJson<Partial<ScoringCalibration>>("calibration/active-config.json");
    if (stored) {
      runtimeOverrides = stored;
      console.log("[CALIBRATION] Loaded persisted calibration overrides:", JSON.stringify(stored));
    }
  } catch {
    // No persisted config — use env vars
  }
}

/** Default calibration config — runtime overrides > env vars > defaults */
export function getCalibrationConfig(): ScoringCalibration {
  return {
    enabled: runtimeOverrides?.enabled ?? (process.env.SCORE_CALIBRATION_ENABLED === "true"),
    center: runtimeOverrides?.center ?? safeParseFloat(process.env.SCORE_CALIBRATION_CENTER, 5.5),
    spread: runtimeOverrides?.spread ?? safeParseFloat(process.env.SCORE_CALIBRATION_SPREAD, 1.2),
    aiModelMean: runtimeOverrides?.aiModelMean ?? safeParseFloat(process.env.SCORE_AI_MODEL_MEAN, 7.0),
    lowThreshold: runtimeOverrides?.lowThreshold ?? safeParseFloat(process.env.SCORE_LOW_THRESHOLD, 4.0),
    highThreshold: runtimeOverrides?.highThreshold ?? safeParseFloat(process.env.SCORE_HIGH_THRESHOLD, 9.0),
  };
}

/**
 * Calibrate a raw AI performance score.
 *
 * Shifts the score distribution from the AI model's natural center
 * (typically ~7.0) to the configured target center, and applies
 * a spread multiplier. Result is clamped to [0, 10].
 */
export function calibrateScore(rawScore: number, config?: ScoringCalibration): number {
  const cal = config || getCalibrationConfig();
  if (!cal.enabled) return rawScore;

  // Shift: move from AI center to desired center, then scale spread
  const deviation = rawScore - cal.aiModelMean;
  const calibrated = cal.center + deviation * cal.spread;

  // Clamp to valid range
  return Math.round(Math.max(0, Math.min(10, calibrated)) * 10) / 10;
}

/**
 * Calibrate all sub-scores in a score object.
 */
export function calibrateSubScores(
  subScores: { compliance: number; customer_experience: number; communication: number; resolution: number },
  config?: ScoringCalibration,
): { compliance: number; customer_experience: number; communication: number; resolution: number } {
  const cal = config || getCalibrationConfig();
  if (!cal.enabled) return subScores;

  return {
    compliance: calibrateScore(subScores.compliance, cal),
    customer_experience: calibrateScore(subScores.customer_experience, cal),
    communication: calibrateScore(subScores.communication, cal),
    resolution: calibrateScore(subScores.resolution, cal),
  };
}

/**
 * Determine flags based on calibrated score thresholds.
 */
export function getScoreFlags(calibratedScore: number, config?: ScoringCalibration): string[] {
  const cal = config || getCalibrationConfig();
  const flags: string[] = [];
  if (calibratedScore <= cal.lowThreshold) flags.push("low_score");
  if (calibratedScore >= cal.highThreshold) flags.push("exceptional_call");
  return flags;
}
