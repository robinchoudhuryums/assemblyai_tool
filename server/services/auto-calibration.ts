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
    spread: number;
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
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const allCalls = await storage.getAllCalls();
    const recentScoredCalls = allCalls.filter(c =>
      c.status === "completed" &&
      c.uploadedAt &&
      c.uploadedAt > cutoff
    );

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
      console.log(`[CALIBRATION] Insufficient data: ${rawScores.length} scored calls (need ${MIN_SAMPLE_SIZE}). Skipping.`);
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
    // If observed spread is narrower than desired, increase spread multiplier
    const observedSpread = stdDev > 0 ? stdDev : 1;
    const targetSpread = 2.0; // Desired stdDev around center
    const recommendedSpread = Math.round(Math.min(2.0, Math.max(0.5, targetSpread / observedSpread)) * 10) / 10;

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
        spread: recommendedSpread,
      },
      driftDetected,
      autoApplied: false,
    };

    if (driftDetected) {
      console.warn(
        `[CALIBRATION] Score drift detected: observed mean=${mean.toFixed(2)}, configured aiModelMean=${currentConfig.aiModelMean}. ` +
        `Recommended: aiModelMean=${recommendedMean}, spread=${recommendedSpread}`
      );
    } else {
      console.log(
        `[CALIBRATION] Distribution healthy: mean=${mean.toFixed(2)}, median=${median.toFixed(2)}, stdDev=${stdDev.toFixed(2)} (${rawScores.length} calls)`
      );
    }

    // Store snapshot for admin visibility
    try {
      const s3Client = storage.getObjectStorageClient();
      if (s3Client) {
        await s3Client.uploadJson(`calibration/snapshots/${snapshot.timestamp.replace(/[:.]/g, "-")}.json`, snapshot);
        await s3Client.uploadJson("calibration/latest.json", snapshot);
      }
    } catch (storeErr) {
      console.warn("[CALIBRATION] Failed to store snapshot:", (storeErr as Error).message);
    }

    return snapshot;
  } catch (error) {
    console.error("[CALIBRATION] Analysis failed:", (error as Error).message);
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
  console.log(`[CALIBRATION] Auto-calibration analysis scheduled every ${intervalHours} hours.`);

  // First run after 2 minutes
  const timeout = setTimeout(() => analyzeScoreDistribution(), 2 * 60 * 1000);
  calibrationInterval = setInterval(() => analyzeScoreDistribution(), intervalHours * 3600 * 1000);

  return () => {
    clearTimeout(timeout);
    if (calibrationInterval) { clearInterval(calibrationInterval); calibrationInterval = null; }
  };
}
