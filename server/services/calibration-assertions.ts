/**
 * Calibration assertions (Tier C #9, extension of Tier A #1).
 *
 * Runs a single check after a synthetic call's analysis completes: if the
 * underlying simulated-call preset carries an `expectedScoreRange` in its
 * config, compare the freshly-computed performance score against the range
 * and emit a `logger.warn` with a structured tag (`alert: calibration_drift`)
 * when it falls outside. CloudWatch metric filters match the tag so an
 * operator alert fires automatically on regressions.
 *
 * This is a passive assertion — it does NOT fail the pipeline or block the
 * call. It's a signal, not a gate. The calibration suite runner (Tier A #1)
 * is the UI-facing version of the same signal, aggregated across all presets.
 *
 * Fire-and-forget: errors in the assertion itself (DB unavailable, lookup
 * failure) log at debug level and don't propagate.
 */
import { logger } from "./logger";
import { findSimulatedCallBySentToAnalysisCallId } from "./simulated-call-storage";

export interface CalibrationAssertionInput {
  /** The calls.id that just completed analysis. */
  callId: string;
  /** The computed performance score (0-10 scale). */
  performanceScore: number;
}

export interface CalibrationAssertionResult {
  /** True if the call was tied to a preset with expectedScoreRange AND checked. */
  checked: boolean;
  /** True iff the score landed in range (always false when checked=false). */
  inRange: boolean;
  expectedMin?: number;
  expectedMax?: number;
  presetId?: string;
  presetTitle?: string;
  /** Signed delta from the nearest range boundary (0 when in range). */
  delta?: number;
}

/**
 * Check whether a synthetic call's score agrees with its preset's
 * expectedScoreRange. Non-synthetic calls and non-calibration presets are
 * silently skipped (checked=false).
 */
export async function checkCalibrationAssertion(
  input: CalibrationAssertionInput,
): Promise<CalibrationAssertionResult> {
  try {
    const preset = await findSimulatedCallBySentToAnalysisCallId(input.callId);
    if (!preset) return { checked: false, inRange: false };
    const range = preset.config?.expectedScoreRange;
    if (!range) return { checked: false, inRange: false };

    const { min, max } = range;
    const score = input.performanceScore;
    const inRange = score >= min && score <= max;
    const delta = inRange
      ? 0
      : score < min
        ? score - min
        : score - max;

    const result: CalibrationAssertionResult = {
      checked: true,
      inRange,
      expectedMin: min,
      expectedMax: max,
      presetId: preset.id,
      presetTitle: preset.title,
      delta,
    };

    if (!inRange) {
      // Structured tag used by CloudWatch metric filters. Operators set an
      // alarm on any log line with `alert: "calibration_drift"` so prompt
      // template regressions surface in their existing alerting stack.
      logger.warn("calibration drift detected", {
        alert: "calibration_drift",
        callId: input.callId,
        presetId: preset.id,
        presetTitle: preset.title,
        expectedMin: min,
        expectedMax: max,
        actualScore: score,
        delta,
        qualityTier: preset.qualityTier,
      });
    } else {
      logger.info("calibration assertion passed", {
        callId: input.callId,
        presetId: preset.id,
        actualScore: score,
      });
    }

    return result;
  } catch (err) {
    logger.debug("calibration assertion check failed (non-blocking)", {
      callId: input.callId,
      error: (err as Error).message,
    });
    return { checked: false, inRange: false };
  }
}
