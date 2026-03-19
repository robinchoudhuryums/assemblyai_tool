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

/** Default calibration config — loaded from env vars */
export function getCalibrationConfig(): ScoringCalibration {
  return {
    enabled: process.env.SCORE_CALIBRATION_ENABLED === "true",
    center: parseFloat(process.env.SCORE_CALIBRATION_CENTER || "5.5"),
    spread: parseFloat(process.env.SCORE_CALIBRATION_SPREAD || "1.2"),
    aiModelMean: parseFloat(process.env.SCORE_AI_MODEL_MEAN || "7.0"),
    lowThreshold: parseFloat(process.env.SCORE_LOW_THRESHOLD || "4.0"),
    highThreshold: parseFloat(process.env.SCORE_HIGH_THRESHOLD || "9.0"),
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
