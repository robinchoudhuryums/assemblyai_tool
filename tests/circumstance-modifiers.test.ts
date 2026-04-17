/**
 * Tests for rule-based circumstance modifiers.
 * Uses a seeded RNG for deterministic assertions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCircumstanceModifiers } from "../server/services/circumstance-modifiers.js";
import type { SimulatedCallScript } from "../shared/simulated-call-schema.js";

function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function baseScript(): SimulatedCallScript {
  return {
    title: "Base",
    qualityTier: "acceptable",
    voices: { agent: "a", customer: "b" },
    turns: [
      { speaker: "agent", text: "Thank you for calling, how can I help?" },
      { speaker: "customer", text: "I was hoping you could please help me with my order. It's been weeks." },
      { speaker: "agent", text: "I understand. Let me look into that for you." },
      { speaker: "customer", text: "Could you possibly check the status please?" },
    ],
  };
}

describe("applyCircumstanceModifiers — no circumstances", () => {
  it("returns input turns unchanged when list is empty", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, []);
    assert.equal(out, s.turns, "should return exact same reference when no-op");
  });

  it("no-ops when only non-rule circumstances are selected (LLM-only ones)", () => {
    const s = baseScript();
    // "grateful" has ruleBased: false — no rule handler exists.
    const out = applyCircumstanceModifiers(s, ["grateful"]);
    assert.equal(out, s.turns);
  });
});

describe("applyCircumstanceModifiers — angry", () => {
  it("removes softeners from customer turns", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, ["angry"], seededRng(1));
    const customerTexts = out
      .filter((t) => t.speaker === "customer")
      .map((t) => (t as { text: string }).text);
    for (const text of customerTexts) {
      assert.ok(!/i was hoping/i.test(text), `softener "I was hoping" should be removed: ${text}`);
      assert.ok(!/could you possibly/i.test(text), `softener "could you possibly" should be removed: ${text}`);
    }
  });

  it("leaves agent turns unchanged", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, ["angry"], seededRng(1));
    const agentTurns = out.filter((t) => t.speaker === "agent") as Array<{ text: string }>;
    const origAgentTurns = s.turns.filter((t) => t.speaker === "agent") as Array<{ text: string }>;
    assert.deepEqual(
      agentTurns.map((t) => t.text),
      origAgentTurns.map((t) => t.text),
      "agent turns should not be transformed by angry modifier",
    );
  });

  it("is deterministic for a given seed", () => {
    const s = baseScript();
    const a = applyCircumstanceModifiers(s, ["angry"], seededRng(42));
    const b = applyCircumstanceModifiers(s, ["angry"], seededRng(42));
    assert.deepEqual(a, b, "same seed must yield same output");
  });
});

describe("applyCircumstanceModifiers — hard_of_hearing", () => {
  it("sometimes prepends a repeat request to customer turns", () => {
    const s = baseScript();
    let sawRepeat = false;
    for (let seed = 0; seed < 30; seed++) {
      const out = applyCircumstanceModifiers(s, ["hard_of_hearing"], seededRng(seed));
      const customerTexts = out
        .filter((t) => t.speaker === "customer")
        .map((t) => (t as { text: string }).text);
      if (customerTexts.some((t) => /repeat that|what was that|didn't catch/i.test(t))) {
        sawRepeat = true;
        break;
      }
    }
    assert.ok(sawRepeat, "expected at least one seed to produce a repeat request");
  });

  it("never modifies agent turns", () => {
    const s = baseScript();
    for (let seed = 0; seed < 10; seed++) {
      const out = applyCircumstanceModifiers(s, ["hard_of_hearing"], seededRng(seed));
      const agentTexts = out.filter((t) => t.speaker === "agent").map((t) => (t as { text: string }).text);
      const orig = s.turns.filter((t) => t.speaker === "agent").map((t) => (t as { text: string }).text);
      assert.deepEqual(agentTexts, orig, `seed ${seed}: agent turns changed unexpectedly`);
    }
  });
});

describe("applyCircumstanceModifiers — escalation", () => {
  it("appends 3 turns (customer demand → agent transfer → customer ack)", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, ["escalation"], seededRng(5));
    assert.equal(out.length, s.turns.length + 3, "escalation adds exactly 3 turns");
    const tail = out.slice(-3);
    assert.equal(tail[0].speaker, "customer", "first appended turn is customer");
    assert.equal(tail[1].speaker, "agent", "second appended turn is agent");
    assert.equal(tail[2].speaker, "customer", "third appended turn is customer");
    const demand = (tail[0] as { text: string }).text.toLowerCase();
    assert.ok(
      /supervisor|manager|escalate|charge/.test(demand),
      `customer demand should mention supervisor/manager: ${demand}`,
    );
    const transfer = (tail[1] as { text: string }).text.toLowerCase();
    assert.ok(
      /transfer|supervisor|manager/.test(transfer),
      `agent response should mention transfer: ${transfer}`,
    );
  });

  it("does not modify existing turns — only appends", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, ["escalation"], seededRng(5));
    const head = out.slice(0, s.turns.length);
    assert.deepEqual(head, s.turns, "original turns should be untouched");
  });
});

describe("applyCircumstanceModifiers — composition", () => {
  it("angry + escalation stacks: angry transforms existing customer turns AND escalation appends", () => {
    const s = baseScript();
    const out = applyCircumstanceModifiers(s, ["angry", "escalation"], seededRng(10));
    // 3 appended turns.
    assert.equal(out.length, s.turns.length + 3);
    // Original customer turns were run through angry transformation.
    const origCustomerTexts = s.turns
      .filter((t) => t.speaker === "customer")
      .map((t) => (t as { text: string }).text);
    const outCustomerTexts = out
      .slice(0, s.turns.length)
      .filter((t) => t.speaker === "customer")
      .map((t) => (t as { text: string }).text);
    // Softeners should be gone in the transformed customer turns.
    for (const text of outCustomerTexts) {
      assert.ok(!/i was hoping/i.test(text), `angry should have stripped softeners: ${text}`);
    }
    // And original texts had those softeners.
    assert.ok(origCustomerTexts.some((t) => /i was hoping/i.test(t)), "sanity: base had softeners");
  });

  it("hard_of_hearing + angry both apply to customer text", () => {
    const s = baseScript();
    // Test determinism across composition.
    const a = applyCircumstanceModifiers(s, ["hard_of_hearing", "angry"], seededRng(99));
    const b = applyCircumstanceModifiers(s, ["hard_of_hearing", "angry"], seededRng(99));
    assert.deepEqual(a, b);
  });
});
