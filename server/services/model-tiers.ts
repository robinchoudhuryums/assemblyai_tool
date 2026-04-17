/**
 * Bedrock model-tier abstraction.
 *
 * All callers that need an Anthropic model ID go through getModelForTier()
 * rather than hardcoding a specific string or reading a per-service env var.
 * This confines model evolution (new Haikus, renamed Sonnets, regional
 * availability changes, A/B test winners) to ONE source of truth.
 *
 * ─── Tiers ───────────────────────────────────────────────────────────
 *   strong     — primary analysis model (Sonnet-class). Used by the
 *                on-demand pipeline's analyzeCallTranscript path and by
 *                the script rewriter / generator when admin picks Sonnet.
 *   fast       — cost-optimized (Haiku-class). Used by the short-call
 *                analysis optimization and by the scenario generator's
 *                default path.
 *   reasoning  — optional (Opus-class). Reserved for future features that
 *                need extended reasoning. Nothing reads it today, but the
 *                tier is plumbed so adding one doesn't require new code.
 *
 * ─── Resolution chain (most specific first) ─────────────────────────
 *   1. Runtime admin override
 *      (PATCH /api/admin/model-tiers → persisted to S3)
 *   2. Tier-specific env var
 *      (BEDROCK_MODEL_STRONG, BEDROCK_MODEL_FAST, BEDROCK_MODEL_REASONING)
 *   3. Back-compat env var
 *      (BEDROCK_MODEL → strong, BEDROCK_HAIKU_MODEL → fast)
 *   4. Baked-in default
 *
 * Runtime overrides survive restart — loadTierOverrides() rehydrates
 * from S3 at boot and calls aiProvider.setModel() + batch.setModel()
 * to swap the singletons for the strong tier.
 *
 * ─── Back-compat with active-model.ts ────────────────────────────────
 * The A/B test promotion flow (active-model.ts:promoteActiveModel) now
 * delegates to setTierOverride("strong", ...). External callers using the
 * old API keep working — same S3 reads on startup still apply via the
 * legacy key for tenants upgrading from pre-tier-abstraction deploys.
 */
import { storage } from "../storage";
import { logger } from "./logger";

export type ModelTier = "strong" | "fast" | "reasoning";

export const MODEL_TIERS: ModelTier[] = ["strong", "fast", "reasoning"];

export interface TierOverride {
  model: string;
  updatedBy: string;
  updatedAt: string;
  /** Why this override was set — e.g. "ab-test-promotion", "admin-ui". */
  reason?: string;
}

export interface TierOverridesPersisted {
  strong?: TierOverride;
  fast?: TierOverride;
  reasoning?: TierOverride;
  /** Legacy single-slot shape from the pre-tier-abstraction era. */
  legacyActiveModel?: TierOverride;
}

export interface TierSnapshot {
  tier: ModelTier;
  /** The model currently being used after resolution. */
  effectiveModel: string;
  /** Where the effective model came from — for UI badges. */
  source: "override" | "env" | "legacy-env" | "default";
  /** The runtime override, if any. */
  override?: TierOverride;
  /** The env-var value for this tier, if set. */
  envValue?: string;
  /** The baked-in default for this tier. */
  defaultValue: string;
}

// ── Defaults ─────────────────────────────────────────────────────────
// NOTE: These are suggestions. The actual valid IDs for a given AWS
// account/region change over time. Operators should set
// BEDROCK_MODEL_* env vars or use the Admin UI to override.
// If a default fails at runtime, callers with fallback logic will
// silently retry on the "strong" tier (see script-rewriter.ts +
// pipeline.ts short-call path).
const DEFAULTS: Record<ModelTier, string> = {
  strong: "us.anthropic.claude-sonnet-4-6",
  fast: "us.anthropic.claude-haiku-4-5-20251001",
  reasoning: "us.anthropic.claude-opus-4-7",
};

// Maps tier → env var names in resolution order.
const ENV_VARS: Record<ModelTier, { primary: string; legacy?: string }> = {
  strong: { primary: "BEDROCK_MODEL_STRONG", legacy: "BEDROCK_MODEL" },
  fast: { primary: "BEDROCK_MODEL_FAST", legacy: "BEDROCK_HAIKU_MODEL" },
  reasoning: { primary: "BEDROCK_MODEL_REASONING" },
};

const S3_KEY = "config/model-tiers.json";
const LEGACY_S3_KEY = "config/active-model.json";

// In-memory overrides, loaded from S3 at startup via loadTierOverrides().
// Map operations are O(1); this is a hot path.
const overrides: Partial<Record<ModelTier, TierOverride>> = {};

// ── Resolution ───────────────────────────────────────────────────────

/** Read tier-specific env var, falling back to legacy var if primary is unset. */
function envFor(tier: ModelTier): string | undefined {
  const { primary, legacy } = ENV_VARS[tier];
  const p = process.env[primary];
  if (p) return p;
  if (legacy) {
    const l = process.env[legacy];
    if (l) return l;
  }
  return undefined;
}

/** Used by getTierSnapshot to distinguish env-primary vs env-legacy. */
function resolveEnvSource(tier: ModelTier): { value: string; legacy: boolean } | undefined {
  const { primary, legacy } = ENV_VARS[tier];
  const p = process.env[primary];
  if (p) return { value: p, legacy: false };
  if (legacy) {
    const l = process.env[legacy];
    if (l) return { value: l, legacy: true };
  }
  return undefined;
}

/**
 * Get the effective model ID for a tier. O(1); safe to call on hot paths.
 * Returns the resolved ID after applying override → env → legacy → default.
 */
export function getModelForTier(tier: ModelTier): string {
  return overrides[tier]?.model ?? envFor(tier) ?? DEFAULTS[tier];
}

/** Per-tier introspection for the Admin UI. */
export function getTierSnapshot(tier: ModelTier): TierSnapshot {
  const override = overrides[tier];
  const env = resolveEnvSource(tier);
  const effectiveModel = override?.model ?? env?.value ?? DEFAULTS[tier];
  const source: TierSnapshot["source"] = override
    ? "override"
    : env
      ? (env.legacy ? "legacy-env" : "env")
      : "default";
  return {
    tier,
    effectiveModel,
    source,
    override,
    envValue: env?.value,
    defaultValue: DEFAULTS[tier],
  };
}

export function getAllTierSnapshots(): TierSnapshot[] {
  return MODEL_TIERS.map(getTierSnapshot);
}

// ── Persistence ──────────────────────────────────────────────────────

async function persistOverrides(): Promise<void> {
  const s3Client = storage.getObjectStorageClient();
  if (!s3Client) {
    logger.warn("model-tiers: no object storage client — override will not survive restart");
    return;
  }
  try {
    const payload: TierOverridesPersisted = { ...overrides };
    await s3Client.uploadJson(S3_KEY, payload);
  } catch (err) {
    logger.warn("model-tiers: failed to persist overrides to S3", { error: (err as Error).message });
  }
}

/**
 * Set a tier override. Persists to S3 and — for the "strong" tier — also
 * calls into the aiProvider + bedrockBatchService singletons via the
 * side-effect hook below, keeping runtime state consistent.
 *
 * Pass `undefined` (or call clearTierOverride) to remove an override and
 * fall back through the resolution chain.
 */
export async function setTierOverride(
  tier: ModelTier,
  model: string,
  updatedBy: string,
  reason?: string,
): Promise<TierOverride> {
  if (!model || typeof model !== "string" || model.trim().length === 0) {
    throw new Error("setTierOverride: model must be a non-empty string");
  }
  const override: TierOverride = {
    model,
    updatedBy,
    updatedAt: new Date().toISOString(),
    reason,
  };
  overrides[tier] = override;
  await persistOverrides();
  notifySingletonsOfChange(tier);
  logger.info("model-tiers: override applied", { tier, model, updatedBy, reason });
  return override;
}

export async function clearTierOverride(tier: ModelTier, updatedBy: string): Promise<void> {
  delete overrides[tier];
  await persistOverrides();
  notifySingletonsOfChange(tier);
  logger.info("model-tiers: override cleared", { tier, updatedBy });
}

/**
 * When the "strong" tier changes (override applied or cleared), keep
 * aiProvider + bedrockBatchService in sync. Other tiers have no singleton
 * to update — getModelForTier() is consulted dynamically by their callers.
 */
function notifySingletonsOfChange(tier: ModelTier): void {
  if (tier !== "strong") return;
  const model = getModelForTier("strong");
  // Lazy imports to avoid a module-load cycle (ai-factory imports bedrock
  // which imports resilience which would otherwise transitively touch this
  // module at load time).
  try {
    const { aiProvider } = require("./ai-factory") as typeof import("./ai-factory");
    if (typeof aiProvider.setModel === "function") {
      aiProvider.setModel(model);
    }
  } catch (err) {
    logger.warn("model-tiers: failed to update aiProvider singleton", { error: (err as Error).message });
  }
  try {
    const { bedrockBatchService } = require("./bedrock-batch") as typeof import("./bedrock-batch");
    bedrockBatchService.setModel(model);
  } catch (err) {
    logger.warn("model-tiers: failed to update bedrockBatchService", { error: (err as Error).message });
  }
}

/**
 * Startup hydration. Restores overrides from S3 + migrates legacy
 * active-model.json if present. Fire-and-forget from server/index.ts.
 */
export async function loadTierOverrides(): Promise<void> {
  const s3Client = storage.getObjectStorageClient();
  if (!s3Client) return;
  try {
    // Primary: the new tier-based file.
    const persisted = await s3Client.downloadJson<TierOverridesPersisted>(S3_KEY);
    let restored = false;
    if (persisted) {
      for (const tier of MODEL_TIERS) {
        const o = persisted[tier];
        if (o && typeof o.model === "string" && o.model.length > 0) {
          overrides[tier] = o;
          restored = true;
        }
      }
    }

    // Legacy: pre-tier-abstraction active-model.json. Migrate to the
    // "strong" tier if present and no new-form override has claimed it.
    if (!overrides.strong) {
      try {
        const legacy = await s3Client.downloadJson<{
          model: string;
          promotedBy?: string;
          promotedAt?: string;
        }>(LEGACY_S3_KEY);
        if (legacy?.model) {
          overrides.strong = {
            model: legacy.model,
            updatedBy: legacy.promotedBy ?? "ab-test-promotion",
            updatedAt: legacy.promotedAt ?? new Date().toISOString(),
            reason: "migrated from config/active-model.json",
          };
          restored = true;
          logger.info("model-tiers: migrated legacy active-model.json into strong tier", {
            model: legacy.model,
          });
          // Persist under the new key so the legacy key becomes harmless.
          await persistOverrides();
        }
      } catch {
        // Legacy file not present — fine.
      }
    }

    if (restored) {
      for (const tier of MODEL_TIERS) {
        if (overrides[tier]) notifySingletonsOfChange(tier);
      }
    }
  } catch (err) {
    logger.warn("model-tiers: failed to load overrides from S3", { error: (err as Error).message });
  }
}

// ── Test seams ───────────────────────────────────────────────────────

/** Test-only: clear all overrides without persisting. */
export function _resetTierOverridesForTests(): void {
  for (const tier of MODEL_TIERS) delete overrides[tier];
}

/** Test-only: set an override without hitting S3 or singletons. */
export function _setOverrideForTests(tier: ModelTier, override: TierOverride): void {
  overrides[tier] = override;
}
