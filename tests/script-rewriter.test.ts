/**
 * Tests for script-rewriter.ts.
 *
 * The live Bedrock call is mocked. These tests exercise:
 *   - Prompt construction for various circumstance combinations
 *   - JSON extraction from model responses (with code fences, prose, etc.)
 *   - Schema validation + voice-preservation contract
 *   - Error classification via ScriptRewriterError.stage
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteScript,
  generateScriptFromScenario,
  ScriptRewriterError,
  _internal,
} from "../server/services/script-rewriter.js";
import type { SimulatedCallScript } from "../shared/simulated-call-schema.js";
import { aiProvider } from "../server/services/ai-factory.js";

function baseScript(): SimulatedCallScript {
  return {
    title: "CPAP status check",
    scenario: "Customer asking about order status",
    qualityTier: "acceptable",
    equipment: "CPAP",
    voices: { agent: "voice-a", customer: "voice-b" },
    turns: [
      { speaker: "agent", text: "Thanks for calling, how can I help?" },
      { speaker: "customer", text: "I wanted to check on my CPAP order." },
      { speaker: "agent", text: "Sure, let me look that up." },
    ],
  };
}

// Save and restore the provider's mocked methods.
const originalGenerateText = (aiProvider as any).generateText;
const originalIsAvailable = Object.getOwnPropertyDescriptor(aiProvider, "isAvailable");

function mockProvider(override: { available: boolean; response?: string; error?: Error }) {
  Object.defineProperty(aiProvider, "isAvailable", {
    get: () => override.available,
    configurable: true,
  });
  (aiProvider as any).generateText = async () => {
    if (override.error) throw override.error;
    return override.response ?? "";
  };
}

afterEach(() => {
  (aiProvider as any).generateText = originalGenerateText;
  if (originalIsAvailable) {
    Object.defineProperty(aiProvider, "isAvailable", originalIsAvailable);
  }
});

// ─────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────
describe("buildRewritePrompt", () => {
  it("includes the base script JSON", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript: baseScript(),
      circumstances: ["angry"],
    });
    assert.ok(prompt.includes('"title": "CPAP status check"'));
    assert.ok(prompt.includes("voice-a"));
    assert.ok(prompt.includes("voice-b"));
  });

  it("lists each circumstance with its description", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript: baseScript(),
      circumstances: ["angry", "escalation"],
    });
    assert.ok(prompt.includes("- angry:"));
    assert.ok(prompt.includes("- escalation:"));
  });

  it("shows '(none)' hint when circumstances is empty", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript: baseScript(),
      circumstances: [],
    });
    assert.ok(prompt.includes("(none"));
  });

  it("honors explicit targetQualityTier", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript: baseScript(), // base is "acceptable"
      circumstances: [],
      targetQualityTier: "poor",
    });
    assert.ok(prompt.includes("TARGET QUALITY TIER: poor"));
  });

  it("falls back to base tier if target is not specified", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript: baseScript(),
      circumstances: [],
    });
    assert.ok(prompt.includes("TARGET QUALITY TIER: acceptable"));
  });
});

// ─────────────────────────────────────────────────────────────
// JSON extraction
// ─────────────────────────────────────────────────────────────
describe("extractJsonObject", () => {
  it("extracts raw JSON with no wrapper", () => {
    const out = _internal.extractJsonObject('{"foo": 1}');
    assert.equal(out, '{"foo": 1}');
  });

  it("strips ```json``` fences", () => {
    const out = _internal.extractJsonObject('```json\n{"foo": 1}\n```');
    assert.equal(out?.trim(), '{"foo": 1}');
  });

  it("strips bare ``` fences", () => {
    const out = _internal.extractJsonObject('```\n{"foo": 1}\n```');
    assert.equal(out?.trim(), '{"foo": 1}');
  });

  it("handles nested braces", () => {
    const json = '{"outer": {"inner": {"deep": 42}}}';
    const out = _internal.extractJsonObject(`Here it is: ${json}\n\nThanks`);
    assert.equal(out, json);
  });

  it("handles braces inside string literals", () => {
    const json = '{"text": "a { b } c", "n": 1}';
    const out = _internal.extractJsonObject(json);
    assert.equal(out, json);
  });

  it("returns null when no opening brace", () => {
    assert.equal(_internal.extractJsonObject("no json here"), null);
  });

  it("returns null for unbalanced braces", () => {
    assert.equal(_internal.extractJsonObject("{foo: 1"), null);
  });
});

// ─────────────────────────────────────────────────────────────
// rewriteScript contract
// ─────────────────────────────────────────────────────────────
describe("rewriteScript — provider unavailable", () => {
  it("throws ScriptRewriterError with stage=unavailable", async () => {
    mockProvider({ available: false });
    await assert.rejects(
      () => rewriteScript({ baseScript: baseScript(), circumstances: ["angry"] }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "unavailable");
        return true;
      },
    );
  });
});

describe("rewriteScript — successful path", () => {
  it("returns a validated script, preserving voices from the base", async () => {
    // Model returns a valid rewrite — but we'll verify the rewriter
    // force-restores voices even if the model tries to change them.
    const modelOutput = JSON.stringify({
      title: "CPAP status check — angry variant",
      scenario: "Customer asking about order status, now upset",
      qualityTier: "poor",
      equipment: "CPAP",
      voices: { agent: "ATTACKER-VOICE-ID", customer: "MALICIOUS-VOICE" }, // should be overridden
      turns: [
        { speaker: "agent", text: "Thanks for calling, how can I help?" },
        { speaker: "customer", text: "This is unacceptable!" },
        { speaker: "agent", text: "I'm sorry to hear that." },
      ],
    });
    mockProvider({ available: true, response: modelOutput });
    const result = await rewriteScript({
      baseScript: baseScript(),
      circumstances: ["angry"],
      targetQualityTier: "poor",
    });
    // Voice mapping force-restored from base.
    assert.equal(result.script.voices.agent, "voice-a");
    assert.equal(result.script.voices.customer, "voice-b");
    // Quality tier force-set to target.
    assert.equal(result.script.qualityTier, "poor");
    // Content came through.
    assert.equal(result.script.turns.length, 3);
  });

  it("handles model output wrapped in markdown fences", async () => {
    const modelOutput = "```json\n" + JSON.stringify({
      title: "t",
      qualityTier: "acceptable",
      voices: { agent: "a", customer: "b" },
      turns: [{ speaker: "agent", text: "hi" }],
    }) + "\n```";
    mockProvider({ available: true, response: modelOutput });
    const result = await rewriteScript({
      baseScript: baseScript(),
      circumstances: [],
    });
    assert.equal(result.script.title, "t");
  });
});

describe("rewriteScript — parse error paths", () => {
  it("throws stage=parse_error when response has no JSON", async () => {
    mockProvider({ available: true, response: "Sorry, I cannot do that." });
    await assert.rejects(
      () => rewriteScript({ baseScript: baseScript(), circumstances: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "parse_error");
        return true;
      },
    );
  });

  it("throws stage=parse_error when JSON is malformed", async () => {
    mockProvider({ available: true, response: '{"title": "t", "turns": [' });
    await assert.rejects(
      () => rewriteScript({ baseScript: baseScript(), circumstances: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "parse_error");
        return true;
      },
    );
  });

  it("throws stage=validation_error when schema rejects the output", async () => {
    // Missing required `voices` field.
    const bad = JSON.stringify({
      title: "t",
      qualityTier: "acceptable",
      turns: [{ speaker: "agent", text: "hi" }],
    });
    mockProvider({ available: true, response: bad });
    await assert.rejects(
      () => rewriteScript({ baseScript: baseScript(), circumstances: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "validation_error");
        return true;
      },
    );
  });

  it("throws stage=model_error when Bedrock call itself throws", async () => {
    mockProvider({ available: true, error: new Error("bedrock timeout") });
    await assert.rejects(
      () => rewriteScript({ baseScript: baseScript(), circumstances: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "model_error");
        return true;
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────
// generateScriptFromScenario (cold-start, no base script)
// ─────────────────────────────────────────────────────────────
describe("generateScriptFromScenario — prompt construction", () => {
  it("includes the title + scenario in the prompt", () => {
    const prompt = _internal.buildGeneratorPrompt({
      title: "CPAP mask return",
      scenario: "Customer received a mask that doesn't fit and wants to return it.",
      qualityTier: "acceptable",
      voices: { agent: "voice-a", customer: "voice-b" },
    });
    assert.ok(prompt.includes("CPAP mask return"));
    assert.ok(prompt.includes("doesn't fit"));
    assert.ok(prompt.includes("voice-a"));
    assert.ok(prompt.includes("voice-b"));
  });

  it("honors targetTurnCount in the prompt instructions", () => {
    const prompt = _internal.buildGeneratorPrompt({
      title: "t",
      qualityTier: "excellent",
      voices: { agent: "a", customer: "b" },
      targetTurnCount: 14,
    });
    assert.ok(prompt.includes("14 turns"), "expected explicit turn count in prompt");
  });

  it("clamps targetTurnCount to [4,30]", () => {
    const low = _internal.buildGeneratorPrompt({
      title: "t", qualityTier: "acceptable",
      voices: { agent: "a", customer: "b" }, targetTurnCount: 1,
    });
    const high = _internal.buildGeneratorPrompt({
      title: "t", qualityTier: "acceptable",
      voices: { agent: "a", customer: "b" }, targetTurnCount: 99,
    });
    assert.ok(low.includes("4 turns"), "lower bound should clamp to 4");
    assert.ok(high.includes("30 turns"), "upper bound should clamp to 30");
  });

  it("describes the requested quality tier in the prompt", () => {
    const poor = _internal.buildGeneratorPrompt({
      title: "t", qualityTier: "poor",
      voices: { agent: "a", customer: "b" },
    });
    const excellent = _internal.buildGeneratorPrompt({
      title: "t", qualityTier: "excellent",
      voices: { agent: "a", customer: "b" },
    });
    assert.ok(/curt|dismissive|unhelpful/i.test(poor));
    assert.ok(/warm|proactive/i.test(excellent));
  });
});

describe("generateScriptFromScenario — execution", () => {
  it("throws validation_error when title is empty", async () => {
    mockProvider({ available: true, response: "" });
    await assert.rejects(
      () => generateScriptFromScenario({
        title: "   ",
        qualityTier: "acceptable",
        voices: { agent: "a", customer: "b" },
      }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "validation_error");
        return true;
      },
    );
  });

  it("throws unavailable when AI provider is not configured", async () => {
    mockProvider({ available: false });
    await assert.rejects(
      () => generateScriptFromScenario({
        title: "t",
        qualityTier: "acceptable",
        voices: { agent: "a", customer: "b" },
      }),
      (err: unknown) => {
        assert.ok(err instanceof ScriptRewriterError);
        assert.equal((err as ScriptRewriterError).stage, "unavailable");
        return true;
      },
    );
  });

  it("force-restores voices + title + qualityTier from the caller", async () => {
    // Model tries to drift all three — the generator must ignore those drifts.
    const modelOutput = JSON.stringify({
      title: "REWRITTEN TITLE",
      scenario: "model-written scenario",
      qualityTier: "poor",
      equipment: "CPAP",
      voices: { agent: "ATTACKER", customer: "MALICIOUS" },
      turns: [
        { speaker: "agent", text: "Hello." },
        { speaker: "customer", text: "Hi." },
      ],
    });
    mockProvider({ available: true, response: modelOutput });
    const result = await generateScriptFromScenario({
      title: "Admin's title",
      scenario: "Admin's scenario",
      qualityTier: "excellent",
      voices: { agent: "admin-agent", customer: "admin-customer" },
    });
    assert.equal(result.script.title, "Admin's title");
    assert.equal(result.script.qualityTier, "excellent");
    assert.equal(result.script.voices.agent, "admin-agent");
    assert.equal(result.script.voices.customer, "admin-customer");
    assert.equal(result.script.turns.length, 2);
  });
});
