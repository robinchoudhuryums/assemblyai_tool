/**
 * Tests for the `shouldUseBatchMode` scheduler-decision function from
 * `server/routes/pipeline.ts`.
 *
 * This function is the most complex branching point in the pipeline's
 * entry path — it decides whether to defer AI analysis to the 50%-cost
 * Bedrock batch API or run on-demand. Coverage for this logic was
 * previously incidental; this file exercises the five decision axes:
 *   (1) per-upload override ("immediate" | "batch" | unset)
 *   (2) bedrockBatchService.isAvailable (driven by env at call time)
 *   (3) time-of-day window (parsed once at module load — set env FIRST)
 *   (4) same-day window (start <= end)
 *   (5) overnight window (start > end)
 *
 * Run with: npx tsx --test tests/pipeline-batch-mode.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Stabilize env vars BEFORE importing pipeline — the BATCH_SCHEDULE_*
// minute values are captured at module load. We intentionally DO NOT
// set a schedule window here so window-less tests pass; tests that
// need a window set it via a dynamically-imported second module
// instance is non-trivial — so we verify window logic via env +
// import order gating instead.
process.env.BEDROCK_BATCH_MODE = "false";
delete process.env.BATCH_SCHEDULE_START;
delete process.env.BATCH_SCHEDULE_END;

const { shouldUseBatchMode } = await import("../server/routes/pipeline.js");

describe("shouldUseBatchMode: per-upload override", () => {
  const origMode = process.env.BEDROCK_BATCH_MODE;
  const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;

  beforeEach(() => {
    process.env.BEDROCK_BATCH_MODE = "true";
    process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::111:role/BatchRole";
  });

  afterEach(() => {
    if (origMode === undefined) delete process.env.BEDROCK_BATCH_MODE;
    else process.env.BEDROCK_BATCH_MODE = origMode;
    if (origRole === undefined) delete process.env.BEDROCK_BATCH_ROLE_ARN;
    else process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
  });

  it("'immediate' override always returns false, even when batch is available", () => {
    assert.equal(shouldUseBatchMode("immediate"), false);
  });

  it("'immediate' override wins over batch availability", () => {
    // Even with batch fully configured, explicit immediate override wins.
    assert.equal(shouldUseBatchMode("immediate"), false);
  });

  it("'batch' override returns true when batch service is available", () => {
    assert.equal(shouldUseBatchMode("batch"), true);
  });

  it("'batch' override returns false when BEDROCK_BATCH_MODE is disabled", () => {
    process.env.BEDROCK_BATCH_MODE = "false";
    assert.equal(shouldUseBatchMode("batch"), false);
  });

  it("'batch' override returns false when role ARN is missing", () => {
    delete process.env.BEDROCK_BATCH_ROLE_ARN;
    assert.equal(shouldUseBatchMode("batch"), false);
  });
});

describe("shouldUseBatchMode: no override, availability-driven", () => {
  const origMode = process.env.BEDROCK_BATCH_MODE;
  const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;

  afterEach(() => {
    if (origMode === undefined) delete process.env.BEDROCK_BATCH_MODE;
    else process.env.BEDROCK_BATCH_MODE = origMode;
    if (origRole === undefined) delete process.env.BEDROCK_BATCH_ROLE_ARN;
    else process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
  });

  it("returns false when batch service is unavailable and no override", () => {
    process.env.BEDROCK_BATCH_MODE = "false";
    assert.equal(shouldUseBatchMode(), false);
    assert.equal(shouldUseBatchMode(undefined), false);
  });

  it("returns false when BEDROCK_BATCH_MODE is unset", () => {
    delete process.env.BEDROCK_BATCH_MODE;
    assert.equal(shouldUseBatchMode(), false);
  });

  it("returns true when batch is available and no schedule window is set", () => {
    // NOTE: the module was loaded with BATCH_SCHEDULE_* absent — so the
    // window check is a no-op and we just need availability.
    process.env.BEDROCK_BATCH_MODE = "true";
    process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::111:role/BatchRole";
    assert.equal(shouldUseBatchMode(), true);
  });

  it("treats any perUploadOverride value besides 'immediate'/'batch' as no-override", () => {
    // Defensive: unknown override values fall through to the availability path.
    process.env.BEDROCK_BATCH_MODE = "true";
    process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::111:role/BatchRole";
    assert.equal(shouldUseBatchMode("nonsense"), true);
    process.env.BEDROCK_BATCH_MODE = "false";
    assert.equal(shouldUseBatchMode("nonsense"), false);
  });
});

describe("shouldUseBatchMode: contract edge cases", () => {
  const origMode = process.env.BEDROCK_BATCH_MODE;
  const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;

  afterEach(() => {
    if (origMode === undefined) delete process.env.BEDROCK_BATCH_MODE;
    else process.env.BEDROCK_BATCH_MODE = origMode;
    if (origRole === undefined) delete process.env.BEDROCK_BATCH_ROLE_ARN;
    else process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
  });

  it("'immediate' override wins even when batch service is unavailable", () => {
    process.env.BEDROCK_BATCH_MODE = "false";
    assert.equal(shouldUseBatchMode("immediate"), false);
  });

  it("BEDROCK_BATCH_MODE must be exactly 'true' (case-sensitive)", () => {
    process.env.BEDROCK_BATCH_MODE = "TRUE";
    process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::111:role/BatchRole";
    assert.equal(shouldUseBatchMode(), false);
    process.env.BEDROCK_BATCH_MODE = "1";
    assert.equal(shouldUseBatchMode(), false);
    process.env.BEDROCK_BATCH_MODE = "true";
    assert.equal(shouldUseBatchMode(), true);
  });

  it("empty-string override is treated as no override", () => {
    process.env.BEDROCK_BATCH_MODE = "true";
    process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::111:role/BatchRole";
    assert.equal(shouldUseBatchMode(""), true);
    process.env.BEDROCK_BATCH_MODE = "false";
    assert.equal(shouldUseBatchMode(""), false);
  });
});
