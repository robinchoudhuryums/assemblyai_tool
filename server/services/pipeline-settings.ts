/**
 * Pipeline quality-gate settings (runtime-tunable).
 *
 * Controls the three "skip AI analysis" thresholds that guard Bedrock
 * spend on unanalyzable calls:
 *   - minCallDurationSec       — shorter calls skip AI
 *   - minTranscriptLength      — shorter transcripts skip AI
 *   - minTranscriptConfidence  — lower-confidence transcripts skip AI
 *
 * Source priority: S3 override → env vars → baked-in defaults. The S3
 * override exists so an admin can tune these via the Admin UI without
 * a redeploy; env vars remain as the canonical source for fresh deploys.
 *
 * Persistence pattern mirrors active-model.ts: single JSON file in S3,
 * in-memory singleton, hydrated at startup via loadPipelineSettings().
 * If S3 is unavailable the in-memory copy still reflects the env-driven
 * baseline — the app never fails closed because of this module.
 */
import { storage } from "../storage";
import { logger } from "./logger";

const S3_KEY = "config/pipeline-settings.json";

export interface PipelineSettings {
  minCallDurationSec: number;
  minTranscriptLength: number;
  minTranscriptConfidence: number;
}

export interface PipelineSettingsWithMeta extends PipelineSettings {
  /** Where each field came from for the UI to show "(default)" / "(overridden)". */
  source: {
    minCallDurationSec: "default" | "env" | "override";
    minTranscriptLength: "default" | "env" | "override";
    minTranscriptConfidence: "default" | "env" | "override";
  };
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULTS: PipelineSettings = {
  minCallDurationSec: 15,
  minTranscriptLength: 10,
  minTranscriptConfidence: 0.6,
};

// Env-var readers. Invalid / missing → fall through to default.
function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

// Baseline from env vars computed once at module load.
const ENV_BASELINE: Partial<PipelineSettings> = {
  minCallDurationSec: envNumber("MIN_CALL_DURATION_FOR_AI_SEC"),
  minTranscriptLength: envNumber("MIN_TRANSCRIPT_LEN_FOR_AI"),
  minTranscriptConfidence: envNumber("MIN_TRANSCRIPT_CONFIDENCE_FOR_AI"),
};

// Current in-memory state. Populated from env baseline at import time;
// loadPipelineSettings() may overwrite individual fields from S3.
let current: PipelineSettings = {
  minCallDurationSec: ENV_BASELINE.minCallDurationSec ?? DEFAULTS.minCallDurationSec,
  minTranscriptLength: ENV_BASELINE.minTranscriptLength ?? DEFAULTS.minTranscriptLength,
  minTranscriptConfidence: ENV_BASELINE.minTranscriptConfidence ?? DEFAULTS.minTranscriptConfidence,
};

// Track which fields were loaded from S3 vs env vs default for UI display.
const overrides = new Set<keyof PipelineSettings>();
let overrideMeta: { updatedAt?: string; updatedBy?: string } = {};

/** Clamp a value into the valid range for its field. */
const RANGES: Record<keyof PipelineSettings, { min: number; max: number }> = {
  minCallDurationSec: { min: 0, max: 600 },          // 0s – 10 min
  minTranscriptLength: { min: 0, max: 10_000 },       // 0 – 10k chars
  minTranscriptConfidence: { min: 0, max: 1 },        // 0 – 100%
};
function clamp(key: keyof PipelineSettings, value: number): number {
  const { min, max } = RANGES[key];
  return Math.max(min, Math.min(max, value));
}

/** Get the current effective settings. Hot path; O(1). */
export function getPipelineSettings(): PipelineSettings {
  return { ...current };
}

/** Get settings + per-field source metadata for the Admin UI. */
export function getPipelineSettingsWithMeta(): PipelineSettingsWithMeta {
  const source = {
    minCallDurationSec: overrides.has("minCallDurationSec")
      ? "override" as const
      : ENV_BASELINE.minCallDurationSec !== undefined ? "env" as const : "default" as const,
    minTranscriptLength: overrides.has("minTranscriptLength")
      ? "override" as const
      : ENV_BASELINE.minTranscriptLength !== undefined ? "env" as const : "default" as const,
    minTranscriptConfidence: overrides.has("minTranscriptConfidence")
      ? "override" as const
      : ENV_BASELINE.minTranscriptConfidence !== undefined ? "env" as const : "default" as const,
  };
  return { ...current, source, ...overrideMeta };
}

/**
 * Apply a partial patch to the current settings. Values are clamped to
 * their valid ranges. Persists to S3 if available; always applies
 * in-memory (even if persistence fails) so the admin sees immediate
 * effect. Returns the new effective settings.
 *
 * Pass `undefined` for a field to REMOVE its override and fall back to
 * the env/default baseline.
 */
export async function setPipelineSettings(
  patch: Partial<Record<keyof PipelineSettings, number | undefined>>,
  updatedBy: string,
): Promise<PipelineSettingsWithMeta> {
  (Object.keys(patch) as Array<keyof PipelineSettings>).forEach((key) => {
    const raw = patch[key];
    if (raw === undefined) {
      // Clear the override → fall back to env baseline, then default.
      overrides.delete(key);
      current[key] = ENV_BASELINE[key] ?? DEFAULTS[key];
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      const clamped = clamp(key, raw);
      current[key] = clamped;
      overrides.add(key);
    }
  });
  overrideMeta = { updatedAt: new Date().toISOString(), updatedBy };

  // Persist. Best-effort — if S3 write fails, the in-memory change still
  // applies for this process but won't survive a restart. The admin sees
  // a warning via the caller's error handling.
  const s3Client = storage.getObjectStorageClient();
  if (s3Client) {
    try {
      const onlyOverrides: Partial<PipelineSettings> = {};
      overrides.forEach((k) => { onlyOverrides[k] = current[k]; });
      await s3Client.uploadJson(S3_KEY, {
        overrides: onlyOverrides,
        updatedAt: overrideMeta.updatedAt,
        updatedBy: overrideMeta.updatedBy,
      });
    } catch (err) {
      logger.warn("pipeline-settings: failed to persist to S3", {
        error: (err as Error).message,
      });
    }
  }

  return getPipelineSettingsWithMeta();
}

interface PersistedShape {
  overrides?: Partial<PipelineSettings>;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Hydrate overrides from S3 at startup. Fire-and-forget from routes.ts.
 * Silent no-op if nothing is persisted; logs at warn level on error.
 */
export async function loadPipelineSettings(): Promise<void> {
  try {
    const s3Client = storage.getObjectStorageClient();
    if (!s3Client) return;
    const persisted = await s3Client.downloadJson<PersistedShape>(S3_KEY);
    if (!persisted?.overrides) return;
    (Object.keys(persisted.overrides) as Array<keyof PipelineSettings>).forEach((key) => {
      const value = persisted.overrides![key];
      if (typeof value === "number" && Number.isFinite(value)) {
        current[key] = clamp(key, value);
        overrides.add(key);
      }
    });
    if (persisted.updatedAt) overrideMeta.updatedAt = persisted.updatedAt;
    if (persisted.updatedBy) overrideMeta.updatedBy = persisted.updatedBy;
    if (overrides.size > 0) {
      logger.info("pipeline-settings: restored persisted overrides", {
        overrides: [...overrides],
        ...current,
      });
    }
  } catch (err) {
    logger.warn("pipeline-settings: failed to load from S3", {
      error: (err as Error).message,
    });
  }
}

// Test seam: reset state (not exposed in production code paths).
export function _resetPipelineSettingsForTests(): void {
  current = {
    minCallDurationSec: ENV_BASELINE.minCallDurationSec ?? DEFAULTS.minCallDurationSec,
    minTranscriptLength: ENV_BASELINE.minTranscriptLength ?? DEFAULTS.minTranscriptLength,
    minTranscriptConfidence: ENV_BASELINE.minTranscriptConfidence ?? DEFAULTS.minTranscriptConfidence,
  };
  overrides.clear();
  overrideMeta = {};
}
