/**
 * Auto-Calibration Service
 *
 * Automatically adjusts score calibration parameters based on observed
 * score distribution. Runs periodically to keep the scoring curve aligned
 * with the configured target center/spread.
 *
 * How it works:
 * 1. Collects all scored calls from a configurable time window (default: 30 days)
 * 2. Computes observed mean, median, standard deviation of raw AI scores
 * 3. Compares observed mean vs. current aiModelMean config
 * 4. If drift exceeds threshold, logs a recommended adjustment
 * 5. If AUTO_CALIBRATE=true, writes updated calibration to storage
 *
 * Does NOT modify environment variables — stores calibration state in S3/DB
 * so it persists across restarts without requiring env var changes.
 */
import { storage } from "../storage";
import { getCalibrationConfig, type ScoringCalibration } from "./scoring-calibration";
import { checkScoringQuality, detectScoringRegression } from "./scoring-feedback";
import { logger } from "./logger";

export interface CalibrationSnapshot {
  timestamp: string;
  sampleSize: number;
  windowDays: number;
  observed: {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    p10: number;
    p90: number;
  };
  current: ScoringCalibration;
  recommended: {
    aiModelMean: number;
    center: number;
    // A14/F15: `spread` intentionally removed — the prior calculation
    // (targetSpread / observedSpread) was dimensionally wrong and produced
    // values that would distort the distribution rather than correct it.
    // Operators must set `spread` manually until a correct derivation exists.
  };
  driftDetected: boolean;
  autoApplied: boolean;
}

const DRIFT_THRESHOLD = 0.5; // Trigger recalibration if observed mean drifts >0.5 from config
const DEFAULT_WINDOW_DAYS = 30;
const MIN_SAMPLE_SIZE = 20; // Need at least 20 scored calls for meaningful calibration

/**
 * Compute percentile value from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Analyze current score distribution and produce a calibration snapshot.
 */
export async function analyzeScoreDistribution(windowDays?: number): Promise<CalibrationSnapshot | null> {
  const days = windowDays || parseInt(process.env.CALIBRATION_WINDOW_DAYS || String(DEFAULT_WINDOW_DAYS), 10);
  const cutoffDate = new Date(Date.now() - days * 86400000);

  try {
    // A7/F14: uploaded_at indexed range scan replaces full-table getAllCalls().
    const windowedCalls = await storage.getCallsSince(cutoffDate);
    const recentScoredCalls = windowedCalls.filter(c => c.status === "completed");

    // F03: Bulk-fetch analyses in a single query instead of N+1 individual lookups.
    // With hundreds of calls in the calibration window, this reduces DB round-trips
    // from O(N) to O(N/500) (chunked IN clause).
    const callIds = recentScoredCalls.map(c => c.id);
    const analysesMap = await storage.getCallAnalysesBulk(callIds);

    // Sc-1: read PRE-calibration scores so drift detection actually compares
    // raw AI output against the configured aiModelMean. Pre-fix rows lack
    // confidenceFactors.rawAiScore — for those, fall back to the persisted
    // performanceScore column (which is the calibrated value when calibration
    // was on at write time, or the raw value when it wasn't). The fallback
    // skews the distribution toward calibration-center for legacy rows in
    // calibration-on tenants — accepted as a transition-period inaccuracy
    // that decays as new analyses overwrite the bulk of the window.
    const rawScores: number[] = [];
    for (const [, analysis] of analysesMap) {
      if (!analysis) continue;
      const factors = (analysis.confidenceFactors ?? {}) as Record<string, unknown>;
      const stored = factors.rawAiScore;
      let score: number | null = null;
      if (typeof stored === "number" && Number.isFinite(stored)) {
        score = stored;
      } else if (stored === null) {
        // AI didn't run — skip this row from the calibration sample.
        continue;
      } else if (analysis.performanceScore) {
        // Legacy row without rawAiScore — fall back to persisted column.
        const parsed = parseFloat(String(analysis.performanceScore));
        if (Number.isFinite(parsed)) score = parsed;
      }
      if (score !== null && score >= 0 && score <= 10) {
        rawScores.push(score);
      }
    }

    if (rawScores.length < MIN_SAMPLE_SIZE) {
      logger.info("Calibration: insufficient data, skipping", { scoredCalls: rawScores.length, minSampleSize: MIN_SAMPLE_SIZE });
      return null;
    }

    rawScores.sort((a, b) => a - b);

    const sum = rawScores.reduce((a, b) => a + b, 0);
    const mean = sum / rawScores.length;
    const median = percentile(rawScores, 50);
    // F-23: use sample variance (N-1) instead of population variance (N).
    // The scores are a sample from the ongoing call distribution, not the full population.
    const variance = rawScores.reduce((s, x) => s + (x - mean) ** 2, 0) / (rawScores.length - 1);
    const stdDev = Math.sqrt(variance);

    const currentConfig = getCalibrationConfig();
    const drift = Math.abs(mean - currentConfig.aiModelMean);
    const driftDetected = drift > DRIFT_THRESHOLD;

    // Recommended adjustments
    const recommendedMean = Math.round(mean * 10) / 10;

    const snapshot: CalibrationSnapshot = {
      timestamp: new Date().toISOString(),
      sampleSize: rawScores.length,
      windowDays: days,
      observed: {
        mean: Math.round(mean * 100) / 100,
        median: Math.round(median * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        min: rawScores[0],
        max: rawScores[rawScores.length - 1],
        p10: Math.round(percentile(rawScores, 10) * 100) / 100,
        p90: Math.round(percentile(rawScores, 90) * 100) / 100,
      },
      current: currentConfig,
      recommended: {
        aiModelMean: recommendedMean,
        center: currentConfig.center, // Keep target center as configured
      },
      driftDetected,
      autoApplied: false,
    };

    if (driftDetected) {
      logger.warn("Calibration: score drift detected", {
        observedMean: Number(mean.toFixed(2)),
        configuredAiModelMean: currentConfig.aiModelMean,
        recommendedMean,
      });
    } else {
      logger.info("Calibration: distribution healthy", {
        mean: Number(mean.toFixed(2)),
        median: Number(median.toFixed(2)),
        stdDev: Number(stdDev.toFixed(2)),
        sampleCount: rawScores.length,
      });
    }

    // Operator drift alarm — separate from the calibration recommendation.
    // Compares trailing 7d to trailing 30d (default window) so a sudden
    // regression in scoring (prompt-template edit gone wrong, model change
    // unexpectedly shifting the distribution) surfaces as a structured
    // CloudWatch-queryable signal: $.alert = "score_distribution_alert".
    // Mirrors the synthetic-call `calibration_drift` pattern but for real
    // calls. Severity: warning at >0.8 mean shift, critical at >1.5.
    try {
      const sevenDayCutoff = new Date(Date.now() - 7 * 86400000);
      const sevenDayCalls = await storage.getCallsSince(sevenDayCutoff);
      const sevenDayCompleted = sevenDayCalls.filter(c => c.status === "completed");
      if (sevenDayCompleted.length >= MIN_SAMPLE_SIZE) {
        const sevenDayIds = sevenDayCompleted.map(c => c.id);
        const sevenDayAnalyses = await storage.getCallAnalysesBulk(sevenDayIds);
        const sevenDayScores: number[] = [];
        for (const [, analysis] of sevenDayAnalyses) {
          if (analysis?.performanceScore) {
            const score = parseFloat(String(analysis.performanceScore));
            if (Number.isFinite(score) && score >= 0 && score <= 10) sevenDayScores.push(score);
          }
        }
        if (sevenDayScores.length >= MIN_SAMPLE_SIZE) {
          const sevenDayMean = sevenDayScores.reduce((a, b) => a + b, 0) / sevenDayScores.length;
          const meanShift = Math.abs(sevenDayMean - mean);
          const SCORE_DRIFT_WARN = 0.8;
          const SCORE_DRIFT_CRITICAL = 1.5;
          if (meanShift >= SCORE_DRIFT_WARN) {
            const severity = meanShift >= SCORE_DRIFT_CRITICAL ? "critical" : "warning";
            logger.warn("score distribution drift", {
              alert: "score_distribution_alert",
              severity,
              sevenDayMean: Number(sevenDayMean.toFixed(2)),
              windowMean: Number(mean.toFixed(2)),
              meanShift: Number(meanShift.toFixed(2)),
              sevenDaySampleSize: sevenDayScores.length,
              windowSampleSize: rawScores.length,
              direction: sevenDayMean > mean ? "up" : "down",
            });
          }
        }
      }
    } catch (driftErr) {
      logger.debug("score distribution drift check failed (non-blocking)", { error: (driftErr as Error).message });
    }

    // Store snapshot for admin visibility
    try {
      const s3Client = storage.getObjectStorageClient();
      if (s3Client) {
        await s3Client.uploadJson(`calibration/snapshots/${snapshot.timestamp.replace(/[:.]/g, "-")}.json`, snapshot);
        await s3Client.uploadJson("calibration/latest.json", snapshot);
      }
    } catch (storeErr) {
      logger.warn("Calibration: failed to store snapshot", { error: (storeErr as Error).message });
    }

    return snapshot;
  } catch (error) {
    logger.error("Calibration analysis failed", { error: (error as Error).message });
    return null;
  }
}

/**
 * Get the latest calibration snapshot (from S3).
 */
export async function getLatestCalibrationSnapshot(): Promise<CalibrationSnapshot | null> {
  try {
    const s3Client = storage.getObjectStorageClient();
    if (!s3Client) return null;
    return await s3Client.downloadJson<CalibrationSnapshot>("calibration/latest.json") ?? null;
  } catch {
    return null;
  }
}

// Scheduler
let calibrationInterval: ReturnType<typeof setInterval> | null = null;
let calibrationTimeout: ReturnType<typeof setTimeout> | null = null;

export function startCalibrationScheduler(): () => void {
  const intervalHours = parseInt(process.env.CALIBRATION_INTERVAL_HOURS || "24", 10);
  logger.info("Auto-calibration analysis scheduled", { intervalHours });

  // Combined calibration + scoring quality check
  const runCycle = async () => {
    await analyzeScoreDistribution();
    // Scoring quality alerts: check correction patterns alongside calibration
    await checkScoringQuality().catch(err =>
      logger.warn("Scoring quality check failed (non-blocking)", { error: (err as Error).message })
    );
    // Scoring regression detection: compare week-over-week score distributions
    await detectScoringRegression().catch(err =>
      logger.warn("Scoring regression detection failed (non-blocking)", { error: (err as Error).message })
    );
  };

  // First run after 2 minutes. .unref() so timers don't keep the event loop
  // alive past graceful shutdown.
  calibrationTimeout = setTimeout(runCycle, 2 * 60 * 1000);
  calibrationTimeout.unref();
  calibrationInterval = setInterval(runCycle, intervalHours * 3600 * 1000);
  calibrationInterval.unref();

  return stopCalibrationScheduler;
}

/**
 * Stop the auto-calibration scheduler. Safe to call multiple times.
 * Exported for use in graceful shutdown.
 */
export function stopCalibrationScheduler(): void {
  if (calibrationTimeout) { clearTimeout(calibrationTimeout); calibrationTimeout = null; }
  if (calibrationInterval) { clearInterval(calibrationInterval); calibrationInterval = null; }
}
