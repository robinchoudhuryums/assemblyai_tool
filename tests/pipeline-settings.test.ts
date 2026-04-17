/**
 * Tests for the pipeline-settings service.
 *
 * S3 persistence is exercised indirectly — the service's `storage` import
 * resolves to MemStorage in this test process (no DATABASE_URL / S3_BUCKET),
 * whose getObjectStorageClient() returns null. So setPipelineSettings()
 * silently skips the S3 write and we verify only the in-memory effect.
 * An end-to-end S3 persistence test belongs in postgres-storage.test.ts.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getPipelineSettings,
  getPipelineSettingsWithMeta,
  setPipelineSettings,
  _resetPipelineSettingsForTests,
} from "../server/services/pipeline-settings.js";

beforeEach(() => {
  _resetPipelineSettingsForTests();
});

describe("pipeline-settings — defaults", () => {
  it("returns baked-in defaults when no env vars / overrides are set", () => {
    const s = getPipelineSettings();
    // env vars may be set in the CI environment; allow those but require
    // the fields to be present and numeric.
    assert.equal(typeof s.minCallDurationSec, "number");
    assert.equal(typeof s.minTranscriptLength, "number");
    assert.equal(typeof s.minTranscriptConfidence, "number");
  });

  it("reports sources as 'default' or 'env' when nothing has been overridden", () => {
    const meta = getPipelineSettingsWithMeta();
    for (const key of ["minCallDurationSec", "minTranscriptLength", "minTranscriptConfidence"] as const) {
      assert.ok(
        meta.source[key] === "default" || meta.source[key] === "env",
        `source.${key} expected default|env but got ${meta.source[key]}`,
      );
    }
  });
});

describe("pipeline-settings — override + clear", () => {
  it("setPipelineSettings applies an override and marks source=override", async () => {
    const result = await setPipelineSettings({ minTranscriptConfidence: 0.42 }, "test-admin");
    assert.equal(result.minTranscriptConfidence, 0.42);
    assert.equal(result.source.minTranscriptConfidence, "override");
    assert.equal(result.updatedBy, "test-admin");
    assert.ok(result.updatedAt);
    // getPipelineSettings also reflects the override.
    assert.equal(getPipelineSettings().minTranscriptConfidence, 0.42);
  });

  it("clamps out-of-range values to the valid range", async () => {
    const high = await setPipelineSettings({ minTranscriptConfidence: 999 }, "t");
    assert.equal(high.minTranscriptConfidence, 1);
    const low = await setPipelineSettings({ minTranscriptConfidence: -5 }, "t");
    assert.equal(low.minTranscriptConfidence, 0);
    const dur = await setPipelineSettings({ minCallDurationSec: -10 }, "t");
    assert.equal(dur.minCallDurationSec, 0);
  });

  it("passing undefined clears an override and falls back to baseline", async () => {
    await setPipelineSettings({ minTranscriptConfidence: 0.3 }, "t");
    assert.equal(getPipelineSettingsWithMeta().source.minTranscriptConfidence, "override");
    const cleared = await setPipelineSettings({ minTranscriptConfidence: undefined }, "t");
    assert.notEqual(cleared.source.minTranscriptConfidence, "override");
  });

  it("ignores non-finite numbers (NaN / Infinity) without throwing", async () => {
    const before = getPipelineSettings();
    await setPipelineSettings({ minCallDurationSec: NaN as unknown as number }, "t");
    assert.equal(getPipelineSettings().minCallDurationSec, before.minCallDurationSec);
  });

  it("a partial patch only touches the listed keys", async () => {
    const before = getPipelineSettings();
    const after = await setPipelineSettings({ minTranscriptConfidence: 0.5 }, "t");
    assert.equal(after.minCallDurationSec, before.minCallDurationSec);
    assert.equal(after.minTranscriptLength, before.minTranscriptLength);
    assert.equal(after.minTranscriptConfidence, 0.5);
  });
});
