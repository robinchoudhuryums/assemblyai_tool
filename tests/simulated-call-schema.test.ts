/**
 * Zod schema tests for the Simulated Call Generator.
 *
 * These guard the script + config shapes against accidental API drift.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simulatedCallScriptSchema,
  simulatedCallConfigSchema,
  simulatedTurnSchema,
  generateSimulatedCallRequestSchema,
} from "../shared/simulated-call-schema.js";

describe("SimulatedTurn schema", () => {
  it("accepts a spoken agent turn", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "agent", text: "Hello!" });
    assert.ok(res.success);
  });

  it("accepts a spoken customer turn", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "customer", text: "Hi." });
    assert.ok(res.success);
  });

  it("accepts a hold turn with duration", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "hold", duration: 5 });
    assert.ok(res.success);
  });

  it("accepts an interrupt turn", () => {
    const res = simulatedTurnSchema.safeParse({
      speaker: "interrupt",
      primarySpeaker: "agent",
      text: "I was saying...",
      interruptText: "Wait, sorry",
    });
    assert.ok(res.success);
  });

  it("rejects hold turn with negative duration", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "hold", duration: -1 });
    assert.equal(res.success, false);
  });

  it("rejects hold turn with duration over 300s", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "hold", duration: 999 });
    assert.equal(res.success, false);
  });

  it("rejects spoken turn with empty text", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "agent", text: "" });
    assert.equal(res.success, false);
  });

  it("rejects unknown speaker value", () => {
    const res = simulatedTurnSchema.safeParse({ speaker: "manager", text: "hi" });
    assert.equal(res.success, false);
  });
});

describe("SimulatedCallScript schema", () => {
  const validScript = {
    title: "CPAP order status check",
    qualityTier: "acceptable",
    voices: { agent: "voice-a", customer: "voice-b" },
    turns: [
      { speaker: "agent", text: "Thanks for calling." },
      { speaker: "customer", text: "I have a question about my order." },
    ],
  };

  it("accepts a minimal valid script", () => {
    const res = simulatedCallScriptSchema.safeParse(validScript);
    assert.ok(res.success, res.success ? "" : JSON.stringify(res.error.format(), null, 2));
  });

  it("rejects a script with no turns", () => {
    const res = simulatedCallScriptSchema.safeParse({ ...validScript, turns: [] });
    assert.equal(res.success, false);
  });

  it("rejects a script with >200 turns", () => {
    const manyTurns = Array.from({ length: 201 }, () => ({ speaker: "agent", text: "x" }));
    const res = simulatedCallScriptSchema.safeParse({ ...validScript, turns: manyTurns });
    assert.equal(res.success, false);
  });

  it("rejects a script with invalid qualityTier", () => {
    const res = simulatedCallScriptSchema.safeParse({ ...validScript, qualityTier: "amazing" });
    assert.equal(res.success, false);
  });

  it("rejects a script missing agent/customer voice", () => {
    const res = simulatedCallScriptSchema.safeParse({
      ...validScript,
      voices: { agent: "voice-a" } as any,
    });
    assert.equal(res.success, false);
  });
});

describe("SimulatedCallConfig schema", () => {
  it("applies sensible defaults when fields are omitted", () => {
    const res = simulatedCallConfigSchema.parse({});
    assert.equal(res.gapDistribution, "natural");
    assert.equal(res.gapMeanSeconds, 0.8);
    assert.equal(res.connectionQuality, "phone");
    assert.equal(res.backgroundNoise, "none");
    assert.equal(res.analyzeAfterGeneration, false);
  });

  it("clamps gapMeanSeconds to [0, 10]", () => {
    assert.equal(simulatedCallConfigSchema.safeParse({ gapMeanSeconds: -1 }).success, false);
    assert.equal(simulatedCallConfigSchema.safeParse({ gapMeanSeconds: 20 }).success, false);
  });

  it("clamps backgroundNoiseLevel to [0, 1]", () => {
    assert.equal(simulatedCallConfigSchema.safeParse({ backgroundNoiseLevel: 1.5 }).success, false);
  });

  it("rejects unknown connectionQuality", () => {
    assert.equal(
      simulatedCallConfigSchema.safeParse({ connectionQuality: "perfect" }).success,
      false,
    );
  });

  it("analyzeAfterGeneration defaults to false (spend-protection default)", () => {
    const res = simulatedCallConfigSchema.parse({});
    assert.equal(res.analyzeAfterGeneration, false);
  });

  it("expectedScoreRange is optional and absent by default", () => {
    const res = simulatedCallConfigSchema.parse({});
    assert.equal(res.expectedScoreRange, undefined);
  });

  it("expectedScoreRange accepts valid { min, max } bounds", () => {
    const res = simulatedCallConfigSchema.safeParse({
      expectedScoreRange: { min: 8.0, max: 10.0 },
    });
    assert.ok(res.success);
    if (res.success) {
      assert.equal(res.data.expectedScoreRange?.min, 8.0);
      assert.equal(res.data.expectedScoreRange?.max, 10.0);
    }
  });

  it("expectedScoreRange rejects max < min", () => {
    const res = simulatedCallConfigSchema.safeParse({
      expectedScoreRange: { min: 9.0, max: 5.0 },
    });
    assert.equal(res.success, false);
  });

  it("expectedScoreRange rejects out-of-range values (< 0)", () => {
    const res = simulatedCallConfigSchema.safeParse({
      expectedScoreRange: { min: -1, max: 5 },
    });
    assert.equal(res.success, false);
  });

  it("expectedScoreRange rejects out-of-range values (> 10)", () => {
    const res = simulatedCallConfigSchema.safeParse({
      expectedScoreRange: { min: 5, max: 11 },
    });
    assert.equal(res.success, false);
  });

  it("expectedScoreRange accepts equal min and max (exact score preset)", () => {
    const res = simulatedCallConfigSchema.safeParse({
      expectedScoreRange: { min: 7.0, max: 7.0 },
    });
    assert.ok(res.success);
  });
});

describe("GenerateSimulatedCallRequest schema", () => {
  it("accepts a full valid request with defaults filled in", () => {
    const res = generateSimulatedCallRequestSchema.safeParse({
      script: {
        title: "t",
        qualityTier: "excellent",
        voices: { agent: "a", customer: "b" },
        turns: [{ speaker: "agent", text: "hi" }],
      },
      config: {},
    });
    assert.ok(res.success);
    if (res.success) {
      assert.equal(res.data.config.gapDistribution, "natural");
    }
  });
});
