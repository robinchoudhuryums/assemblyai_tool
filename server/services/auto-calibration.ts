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

    // Extract raw performance scores from analysis
    const rawScores: number[] = [];
    for (const call of recentScoredCalls) {
      try {
        const analysis = await storage.getCallAnalysis(call.id);
        if (analysis?.performanceScore) {
          const score = parseFloat(String(analysis.performanceScore));
          if (Number.isFinite(score) && score >= 0 && score <= 10) {
            rawScores.push(score);
          }
        }
      } catch {
        // Skip calls with missing analysis
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
    const variance = rawScores.reduce((s, x) => s + (x - mean) ** 2, 0) / rawScores.length;
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

export function startCalibrationScheduler(): () => void {
  const intervalHours = parseInt(process.env.CALIBRATION_INTERVAL_HOURS || "24", 10);
  logger.info("Auto-calibration analysis scheduled", { intervalHours });

  // First run after 2 minutes
  const timeout = setTimeout(() => analyzeScoreDistribution(), 2 * 60 * 1000);
  calibrationInterval = setInterval(() => analyzeScoreDistribution(), intervalHours * 3600 * 1000);

  return () => {
    clearTimeout(timeout);
    if (calibrationInterval) { clearInterval(calibrationInterval); calibrationInterval = null; }
  };
}
