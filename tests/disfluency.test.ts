/**
 * Tests for disfluency injection + backchannel pool helpers.
 * Uses a seeded RNG so assertions are deterministic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDisfluencies,
  pickBackchannel,
  AGENT_BACKCHANNELS,
  CUSTOMER_BACKCHANNELS,
} from "../server/services/disfluency.js";

/** Simple deterministic RNG — mulberry32. Same seed → same sequence. */
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

describe("addDisfluencies — excellent tier", () => {
  it("returns the input unchanged", () => {
    const text = "Thank you for calling. How can I help you today?";
    assert.equal(addDisfluencies(text, "excellent"), text);
  });

  it("returns unchanged regardless of RNG state", () => {
    const text = "Hello.";
    // Run 20 times — excellent tier has all-zero rates.
    for (let seed = 0; seed < 20; seed++) {
      assert.equal(addDisfluencies(text, "excellent", seededRng(seed)), text);
    }
  });
});

describe("addDisfluencies — empty/degenerate input", () => {
  it("returns empty string unchanged", () => {
    assert.equal(addDisfluencies("", "poor"), "");
  });

  it("handles a single character safely", () => {
    const out = addDisfluencies("A", "acceptable", seededRng(1));
    // No crash; output is a string.
    assert.equal(typeof out, "string");
  });
});

describe("addDisfluencies — poor tier with deterministic RNG", () => {
  it("sometimes injects a leading filler word", () => {
    // Seed 0 lands in the leading-filler range (~0.25).
    let sawLeadingFiller = false;
    for (let seed = 0; seed < 30; seed++) {
      const out = addDisfluencies("Hello, how are you?", "poor", seededRng(seed));
      if (/^(Um|Uh|So|Well|Hmm|Okay so),/i.test(out)) {
        sawLeadingFiller = true;
        break;
      }
    }
    assert.ok(sawLeadingFiller, "expected at least one seed to produce a leading filler");
  });

  it("preserves original text content (just adds words, never removes)", () => {
    for (let seed = 0; seed < 10; seed++) {
      const input = "Thank you for calling today.";
      const out = addDisfluencies(input, "poor", seededRng(seed));
      // Output should contain the core content words (lowercased for case-insensitive match
      // since leading filler can lowercase the first letter).
      assert.ok(
        out.toLowerCase().includes("thank you for calling today"),
        `seed ${seed}: expected core text preserved, got: ${out}`,
      );
    }
  });
});

describe("addDisfluencies — acceptable tier", () => {
  it("produces fillers at a noticeably lower rate than poor", () => {
    let poorFillerCount = 0;
    let acceptableFillerCount = 0;
    const FILLER_RE = /\b(um|uh|hmm|you know|i mean|like|well)\b/i;
    for (let seed = 0; seed < 100; seed++) {
      const poorOut = addDisfluencies("Hello. How can I help you. Is that okay.", "poor", seededRng(seed));
      const acceptableOut = addDisfluencies("Hello. How can I help you. Is that okay.", "acceptable", seededRng(seed));
      if (FILLER_RE.test(poorOut)) poorFillerCount++;
      if (FILLER_RE.test(acceptableOut)) acceptableFillerCount++;
    }
    assert.ok(
      poorFillerCount > acceptableFillerCount,
      `expected poor to have more fillers than acceptable (got poor=${poorFillerCount}, acceptable=${acceptableFillerCount})`,
    );
  });
});

describe("pickBackchannel", () => {
  it("returns from AGENT_BACKCHANNELS when role=agent", () => {
    for (let seed = 0; seed < 20; seed++) {
      const pick = pickBackchannel("agent", seededRng(seed));
      assert.ok(AGENT_BACKCHANNELS.includes(pick), `${pick} not in agent pool`);
    }
  });

  it("returns from CUSTOMER_BACKCHANNELS when role=customer", () => {
    for (let seed = 0; seed < 20; seed++) {
      const pick = pickBackchannel("customer", seededRng(seed));
      assert.ok(CUSTOMER_BACKCHANNELS.includes(pick), `${pick} not in customer pool`);
    }
  });

  it("all backchannel strings are short (under 20 chars) to control TTS cost", () => {
    for (const b of [...AGENT_BACKCHANNELS, ...CUSTOMER_BACKCHANNELS]) {
      assert.ok(b.length < 20, `backchannel "${b}" too long — would bloat TTS spend`);
    }
  });
});
