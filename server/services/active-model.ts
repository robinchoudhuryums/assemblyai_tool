/**
 * Active Bedrock model override.
 *
 * Normally the active model is set via the BEDROCK_MODEL env var and frozen
 * at startup. This module adds a runtime promotion flow (for A/B test winners):
 *
 * 1. Admin promotes a model via POST /api/ab-tests/promote
 * 2. This module persists the choice to S3 (`config/active-model.json`)
 * 3. aiProvider.setModel() is called to swap the singleton
 * 4. On the next startup, loadActiveModelOverride() rehydrates the override
 *
 * The env var still takes precedence for the *initial* provider construction
 * (since aiProvider is created before this module runs), but loadActiveModelOverride()
 * runs shortly after startup and swaps the model if a persisted override exists.
 */

import { storage } from "../storage";
import { aiProvider } from "./ai-factory";
import { logger } from "./logger";

const S3_KEY = "config/active-model.json";

export interface ActiveModelOverride {
  model: string;
  promotedBy: string;
  promotedAt: string;
  baselineModel?: string;
  sampleSize?: number;
  avgDelta?: number | null;
}

/**
 * Persist and apply a promoted model. Called from the admin promote endpoint.
 * Validates only the shape — the caller is responsible for whitelisting against
 * BEDROCK_MODEL_PRESETS.
 */
export async function promoteActiveModel(override: ActiveModelOverride): Promise<void> {
  if (!override.model || typeof override.model !== "string") {
    throw new Error("promoteActiveModel: model is required");
  }

  // 1. Persist to S3 so the promotion survives restart
  const s3Client = storage.getObjectStorageClient();
  if (s3Client) {
    try {
      await s3Client.uploadJson(S3_KEY, override);
    } catch (err) {
      // Storage unavailable — log and continue. The in-memory swap still
      // applies for the current process, but it won't survive a restart.
      logger.warn("active-model: failed to persist override to S3", { error: (err as Error).message });
    }
  }

  // 2. Apply to the live aiProvider singleton
  if (typeof aiProvider.setModel === "function") {
    aiProvider.setModel(override.model);
    logger.info("active-model: promoted", {
      model: override.model,
      promotedBy: override.promotedBy,
      baselineModel: override.baselineModel,
      sampleSize: override.sampleSize,
    });
  } else {
    logger.warn("active-model: aiProvider does not support runtime setModel — override persisted but not applied until restart");
  }
}

/**
 * Load the persisted active-model override at startup and apply it.
 * Fire-and-forget from server/index.ts — silent no-op if nothing is persisted.
 */
export async function loadActiveModelOverride(): Promise<ActiveModelOverride | null> {
  try {
    const s3Client = storage.getObjectStorageClient();
    if (!s3Client) return null;

    const override = await s3Client.downloadJson<ActiveModelOverride>(S3_KEY);
    if (!override || !override.model) return null;

    if (typeof aiProvider.setModel === "function") {
      aiProvider.setModel(override.model);
      logger.info("active-model: restored persisted override", {
        model: override.model,
        promotedBy: override.promotedBy,
        promotedAt: override.promotedAt,
      });
    }
    return override;
  } catch (err) {
    logger.warn("active-model: failed to load persisted override", { error: (err as Error).message });
    return null;
  }
}

/** Read the currently-active model id (env var or persisted override after startup hydration). */
export function getCurrentActiveModel(): string | undefined {
  return aiProvider.modelId;
}
