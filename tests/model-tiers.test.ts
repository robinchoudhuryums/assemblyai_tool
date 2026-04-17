/**
 * Tests for the model-tiers service.
 *
 * S3 persistence is exercised indirectly — the service's `storage` import
 * resolves to MemStorage in this test process (no DATABASE_URL /
 * S3_BUCKET), whose getObjectStorageClient() returns null. So setTier /
 * clearTier silently skip the S3 write; we verify only the in-memory
 * effect here. An end-to-end persistence + rehydration test belongs in
 * postgres-storage.test.ts once S3 emulation is wired.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_TIERS,
  getModelForTier,
  getTierSnapshot,
  getAllTierSnapshots,
  setTierOverride,
  clearTierOverride,
  _resetTierOverridesForTests,
} from "../server/services/model-tiers.js";

const ENV_KEYS = [
  "BEDROCK_MODEL",
  "BEDROCK_MODEL_STRONG",
  "BEDROCK_MODEL_FAST",
  "BEDROCK_MODEL_REASONING",
  "BEDROCK_HAIKU_MODEL",
];

// Snapshot + restore env vars so tests don't leak into each other.
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  _resetTierOverridesForTests();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("model-tiers — tier enumeration", () => {
  it("exports all three tiers in a stable order", () => {
    assert.deepEqual(MODEL_TIERS, ["strong", "fast", "reasoning"]);
  });
});

describe("model-tiers — defaults and env resolution", () => {
  it("falls through to the baked-in default when nothing else is set", () => {
    const snap = getTierSnapshot("strong");
    assert.equal(snap.source, "default");
    assert.equal(snap.effectiveModel, snap.defaultValue);
  });

  it("tier-specific env var wins over the baked-in default", () => {
    process.env.BEDROCK_MODEL_FAST = "test-haiku-id";
    _resetTierOverridesForTests(); // re-evaluate so env is picked up
    const snap = getTierSnapshot("fast");
    assert.equal(snap.source, "env");
    assert.equal(snap.effectiveModel, "test-haiku-id");
  });

  it("legacy env var (BEDROCK_MODEL) maps to the strong tier", () => {
    process.env.BEDROCK_MODEL = "legacy-sonnet-id";
    const snap = getTierSnapshot("strong");
    assert.equal(snap.source, "legacy-env");
    assert.equal(snap.effectiveModel, "legacy-sonnet-id");
  });

  it("legacy env var (BEDROCK_HAIKU_MODEL) maps to the fast tier", () => {
    process.env.BEDROCK_HAIKU_MODEL = "legacy-haiku-id";
    const snap = getTierSnapshot("fast");
    assert.equal(snap.source, "legacy-env");
    assert.equal(snap.effectiveModel, "legacy-haiku-id");
  });

  it("primary env var wins over the legacy alias", () => {
    process.env.BEDROCK_MODEL = "legacy-sonnet";
    process.env.BEDROCK_MODEL_STRONG = "primary-sonnet";
    const snap = getTierSnapshot("strong");
    assert.equal(snap.source, "env");
    assert.equal(snap.effectiveModel, "primary-sonnet");
  });

  it("getAllTierSnapshots returns all three tiers in order", () => {
    const snaps = getAllTierSnapshots();
    assert.deepEqual(snaps.map((s) => s.tier), ["strong", "fast", "reasoning"]);
  });
});

describe("model-tiers — runtime overrides", () => {
  it("setTierOverride makes the new model the effective value", async () => {
    await setTierOverride("fast", "custom-haiku-4-7", "test-admin");
    const snap = getTierSnapshot("fast");
    assert.equal(snap.source, "override");
    assert.equal(snap.effectiveModel, "custom-haiku-4-7");
    assert.equal(snap.override?.updatedBy, "test-admin");
    assert.equal(getModelForTier("fast"), "custom-haiku-4-7");
  });

  it("override beats env var", async () => {
    process.env.BEDROCK_MODEL_FAST = "env-haiku";
    await setTierOverride("fast", "override-haiku", "test-admin");
    assert.equal(getModelForTier("fast"), "override-haiku");
  });

  it("clearTierOverride removes the override and falls back through the chain", async () => {
    process.env.BEDROCK_MODEL_FAST = "env-haiku";
    await setTierOverride("fast", "override-haiku", "test-admin");
    assert.equal(getModelForTier("fast"), "override-haiku");
    await clearTierOverride("fast", "test-admin");
    assert.equal(getModelForTier("fast"), "env-haiku");
    const snap = getTierSnapshot("fast");
    assert.equal(snap.source, "env");
  });

  it("rejects empty or whitespace model strings", async () => {
    await assert.rejects(() => setTierOverride("strong", "", "t"), /non-empty string/);
    await assert.rejects(() => setTierOverride("strong", "   ", "t"), /non-empty string/);
  });

  it("overrides are independent across tiers", async () => {
    await setTierOverride("fast", "haiku-a", "t");
    await setTierOverride("strong", "sonnet-a", "t");
    assert.equal(getModelForTier("fast"), "haiku-a");
    assert.equal(getModelForTier("strong"), "sonnet-a");
    await clearTierOverride("fast", "t");
    // Strong override still in place.
    assert.equal(getModelForTier("strong"), "sonnet-a");
  });

  it("setting the same tier twice replaces the override, not stacks", async () => {
    await setTierOverride("reasoning", "opus-a", "t");
    await setTierOverride("reasoning", "opus-b", "t");
    assert.equal(getModelForTier("reasoning"), "opus-b");
  });

  it("override metadata captures updatedBy + updatedAt + optional reason", async () => {
    const before = Date.now();
    await setTierOverride("strong", "sonnet-x", "alice", "A/B test winner");
    const after = Date.now();
    const snap = getTierSnapshot("strong");
    assert.equal(snap.override?.updatedBy, "alice");
    assert.equal(snap.override?.reason, "A/B test winner");
    const t = new Date(snap.override!.updatedAt).getTime();
    assert.ok(t >= before && t <= after, `updatedAt should be between test bounds, got ${snap.override!.updatedAt}`);
  });
});
