/**
 * Active Bedrock model override (legacy A/B-test-promotion API).
 *
 * This module used to own the single-slot model override flow. As of the
 * model-tier refactor it's a thin shim over `model-tiers.ts`, preserving
 * the external contract used by the A/B test promote endpoint and by
 * `loadActiveModelOverride()` at startup. New code should call
 * `setTierOverride()` / `getModelForTier()` directly — this file exists
 * only for back-compat with the A/B test flow.
 *
 * Flow:
 * 1. Admin promotes a model via POST /api/ab-tests/promote
 * 2. promoteActiveModel() → setTierOverride("strong", ...)
 * 3. setTierOverride persists to S3 under `config/model-tiers.json` AND
 *    calls aiProvider.setModel() + bedrockBatchService.setModel()
 * 4. On the next startup, loadTierOverrides() rehydrates + ALSO migrates
 *    any legacy `config/active-model.json` into the new tier file.
 */

import { aiProvider } from "./ai-factory";
import { logger } from "./logger";
import {
  getModelForTier,
  setTierOverride,
  loadTierOverrides,
} from "./model-tiers";

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

  // Route through the tier abstraction. setTierOverride handles
  // persistence + calls aiProvider.setModel() + bedrockBatchService.setModel()
  // via its singleton-sync hook. External behavior is identical to the
  // pre-refactor flow; only the S3 file name changes (legacy file is
  // migrated on next startup).
  const reason = override.sampleSize
    ? `ab-test-promotion (n=${override.sampleSize}${override.avgDelta !== undefined && override.avgDelta !== null ? ", Δ=" + override.avgDelta.toFixed(2) : ""})`
    : "ab-test-promotion";
  await setTierOverride("strong", override.model, override.promotedBy, reason);
  logger.info("active-model: promoted via tier abstraction", {
    model: override.model,
    promotedBy: override.promotedBy,
    baselineModel: override.baselineModel,
    sampleSize: override.sampleSize,
  });
}

/**
 * Load the persisted active-model override at startup and apply it.
 * Fire-and-forget from server/index.ts — silent no-op if nothing is persisted.
 * Delegates to the tier system, which handles both the new key and the
 * legacy `config/active-model.json` migration automatically.
 */
export async function loadActiveModelOverride(): Promise<ActiveModelOverride | null> {
  try {
    await loadTierOverrides();
    // After hydration, report back what the strong tier resolved to.
    // The shape matches the old return type so any callers depending on
    // it keep working. Promotion metadata is best-effort — we don't track
    // baselineModel/sampleSize in the tier system.
    const model = getModelForTier("strong");
    return {
      model,
      promotedBy: "unknown",
      promotedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("active-model: failed to load persisted override", { error: (err as Error).message });
    return null;
  }
}

/** Read the currently-active model id (env var or persisted override after startup hydration). */
export function getCurrentActiveModel(): string | undefined {
  return aiProvider.modelId;
}

