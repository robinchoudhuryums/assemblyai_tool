/**
 * Tests for scoring calibration module.
 * Run with: npx tsx --test tests/scoring-calibration.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calibrateScore, calibrateSubScores, getScoreFlags, getCalibrationConfig, setRuntimeCalibration } from "../server/services/scoring-calibration.js";
import type { ScoringCalibration } from "../server/services/scoring-calibration.js";

const enabledConfig: ScoringCalibration = {
  enabled: true,
  center: 5.5,
  spread: 1.2,
  aiModelMean: 7.0,
  lowThreshold: 4.0,
  highThreshold: 9.0,
};

const disabledConfig: ScoringCalibration = {
  ...enabledConfig,
  enabled: false,
};

describe("calibrateScore", () => {
  it("returns raw score when calibration is disabled", () => {
    assert.equal(calibrateScore(8.0, disabledConfig), 8.0);
  });

  it("shifts scores down from AI mean to target center", () => {
    // AI mean is 7.0, target center is 5.5
    // A score of 7.0 should map to 5.5
    const result = calibrateScore(7.0, enabledConfig);
    assert.equal(result, 5.5);
  });

  it("preserves relative ordering", () => {
    const low = calibrateScore(5.0, enabledConfig);
    const mid = calibrateScore(7.0, enabledConfig);
    const high = calibrateScore(9.0, enabledConfig);
    assert.ok(low < mid, `${low} should be less than ${mid}`);
    assert.ok(mid < high, `${mid} should be less than ${high}`);
  });

  it("clamps to 0 minimum", () => {
    const result = calibrateScore(0.0, enabledConfig);
    assert.ok(result >= 0, `Score should be >= 0, got ${result}`);
  });

  it("clamps to 10 maximum", () => {
    const result = calibrateScore(10.0, enabledConfig);
    assert.ok(result <= 10, `Score should be <= 10, got ${result}`);
  });

  it("applies spread multiplier to deviation", () => {
    // Score 9.0: deviation from mean = 2.0, spread = 1.2 → adjusted deviation = 2.4
    // Result = 5.5 + 2.4 = 7.9
    const result = calibrateScore(9.0, enabledConfig);
    assert.equal(result, 7.9);
  });
});

describe("calibrateSubScores", () => {
  it("calibrates all four sub-scores", () => {
    const raw = { compliance: 8.0, customer_experience: 7.0, communication: 6.0, resolution: 9.0 };
    const result = calibrateSubScores(raw, enabledConfig);
    assert.ok(result.compliance !== raw.compliance, "compliance should be calibrated");
    assert.equal(result.customer_experience, 5.5); // 7.0 maps to center
  });

  it("returns raw sub-scores when disabled", () => {
    const raw = { compliance: 8.0, customer_experience: 7.0, communication: 6.0, resolution: 9.0 };
    const result = calibrateSubScores(raw, disabledConfig);
    assert.deepEqual(result, raw);
  });
});

describe("getScoreFlags", () => {
  it("flags low scores", () => {
    const flags = getScoreFlags(3.5, enabledConfig);
    assert.ok(flags.includes("low_score"));
    assert.ok(!flags.includes("exceptional_call"));
  });

  it("flags exceptional scores", () => {
    const flags = getScoreFlags(9.5, enabledConfig);
    assert.ok(!flags.includes("low_score"));
    assert.ok(flags.includes("exceptional_call"));
  });

  it("returns no flags for mid-range scores", () => {
    const flags = getScoreFlags(6.0, enabledConfig);
    assert.equal(flags.length, 0);
  });

  it("flags score exactly at threshold", () => {
    const lowFlags = getScoreFlags(4.0, enabledConfig);
    assert.ok(lowFlags.includes("low_score"));
    const highFlags = getScoreFlags(9.0, enabledConfig);
    assert.ok(highFlags.includes("exceptional_call"));
  });
});

describe("getCalibrationConfig clamping", () => {
  it("clamps spread to [0.1, 5.0] range", () => {
    // Set extreme spread values via runtime overrides
    setRuntimeCalibration({ spread: 50.0 });
    const configHigh = getCalibrationConfig();
    assert.equal(configHigh.spread, 5.0, "spread should be clamped to 5.0 max");

    setRuntimeCalibration({ spread: 0.0 });
    const configLow = getCalibrationConfig();
    assert.equal(configLow.spread, 0.1, "spread should be clamped to 0.1 min");

    setRuntimeCalibration({ spread: -5 });
    const configNeg = getCalibrationConfig();
    assert.equal(configNeg.spread, 0.1, "negative spread should be clamped to 0.1");

    // Reset
    setRuntimeCalibration({});
  });

  it("clamps center to [0, 10] range", () => {
    setRuntimeCalibration({ center: 15.0 });
    const config = getCalibrationConfig();
    assert.equal(config.center, 10, "center should be clamped to 10 max");

    setRuntimeCalibration({ center: -3.0 });
    const config2 = getCalibrationConfig();
    assert.equal(config2.center, 0, "center should be clamped to 0 min");

    // Reset
    setRuntimeCalibration({});
  });

  it("clamps thresholds to [0, 10] range", () => {
    setRuntimeCalibration({ lowThreshold: -1, highThreshold: 12 });
    const config = getCalibrationConfig();
    assert.equal(config.lowThreshold, 0);
    assert.equal(config.highThreshold, 10);

    // Reset
    setRuntimeCalibration({});
  });
});
