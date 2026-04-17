/**
 * Rule-based circumstance modifiers (Approach A).
 *
 * Apply deterministic text + structural transforms to a script at render
 * time based on the configured circumstances. These are cheap (no API
 * calls) and reproducible (with a seeded RNG, same input → same output),
 * making them ideal for regression testing.
 *
 * A richer, LLM-driven rewriter lives in `script-rewriter.ts` (Approach B)
 * and handles nuanced circumstances that don't map cleanly to rules. The
 * two approaches compose: an admin can rewrite via Bedrock first, then
 * apply rule-based modifiers at generation time on top of the rewrite.
 *
 * Contract: these modifiers produce a NEW turn list and NEW text strings;
 * the caller is responsible for passing the result to `renderTurn`. The
 * stored `simulated_calls.script` JSONB is never mutated.
 */
import type {
  SimulatedTurn,
  SimulatedCallScript,
  Circumstance,
} from "@shared/simulated-call-schema";
import { CIRCUMSTANCE_META } from "@shared/simulated-call-schema";

type Rng = () => number;

interface CircumstanceRule {
  /** Transform an agent turn's text. Return the input unchanged to no-op. */
  transformAgentText?: (text: string, rng: Rng) => string;
  /** Transform a customer turn's text. Return the input unchanged to no-op. */
  transformCustomerText?: (text: string, rng: Rng) => string;
  /** Append new turns at the end of the call. */
  appendTurns?: (script: SimulatedCallScript, rng: Rng) => SimulatedTurn[];
}

// ── Rule helpers ───────────────────────────────────────────────────

function roll(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Angry customer ─────────────────────────────────────────────────
// Sharpens customer language: softeners removed, exclamations added,
// occasional terse interjection prepended. Agent lines mostly unchanged
// — a good agent stays professional even with an angry customer.

const ANGRY_SOFTENER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bi was hoping\b/gi, "I need"],
  [/\bcould you possibly\b/gi, "you need to"],
  [/\bwould you mind\b/gi, "I need you to"],
  [/\bif it's not too much trouble\b/gi, ""],
  [/\bjust wondering\b/gi, ""],
  [/\bplease\b/gi, ""],
];

const ANGRY_PREFIXES = [
  "Look, ",
  "Honestly, ",
  "Seriously, ",
  "",
  "",
];

function transformAngryCustomer(text: string, rng: Rng): string {
  if (!text) return text;
  let out = text;
  for (const [re, replacement] of ANGRY_SOFTENER_REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  out = out.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  // 30% chance of a prefix.
  if (roll(rng, 0.3)) {
    const prefix = pick(ANGRY_PREFIXES, rng);
    if (prefix) {
      out = prefix + out.charAt(0).toLowerCase() + out.slice(1);
    }
  }
  // 25% chance of converting a trailing period to an exclamation.
  if (roll(rng, 0.25)) {
    out = out.replace(/\.\s*$/, "!");
  }
  return out;
}

// ── Hard of hearing ────────────────────────────────────────────────
// 18% chance per customer turn of prepending a "couldn't hear you" line.
// The added text is short so cost impact is small. Applied to customer
// turns only (customer is the hard-of-hearing party by convention).

const REPEAT_REQUESTS = [
  "I'm sorry, could you repeat that? ",
  "What was that? ",
  "Sorry, I didn't catch that. ",
  "Could you say that again please? ",
];

function transformHardOfHearingCustomer(text: string, rng: Rng): string {
  if (!text) return text;
  if (roll(rng, 0.18)) {
    return pick(REPEAT_REQUESTS, rng) + text;
  }
  return text;
}

// ── Escalation ─────────────────────────────────────────────────────
// Appends 3 turns at the end: customer demands supervisor, agent offers
// to transfer, customer accepts. Does NOT modify existing turns.

function escalationAppendTurns(_script: SimulatedCallScript, rng: Rng): SimulatedTurn[] {
  const demandLines = [
    "This isn't working for me. I need to speak to a supervisor.",
    "I want to talk to your manager, please.",
    "Let me speak to someone in charge. This isn't getting resolved.",
    "I'd like to escalate this. Can you transfer me to a supervisor?",
  ];
  const agentLines = [
    "Of course, I completely understand. Let me transfer you to my supervisor right now. Please stay on the line.",
    "I hear you. I'll get my supervisor on the phone. One moment please.",
    "Absolutely, I'll bring in my manager. Can you hold for a minute while I find them?",
  ];
  const customerAck = [
    "Fine.",
    "Okay.",
    "Yes, thank you.",
    "Alright.",
  ];
  return [
    { speaker: "customer", text: pick(demandLines, rng) },
    { speaker: "agent", text: pick(agentLines, rng) },
    { speaker: "customer", text: pick(customerAck, rng) },
  ];
}

// ── Rule registry ──────────────────────────────────────────────────

const RULES: Partial<Record<Circumstance, CircumstanceRule>> = {
  angry: {
    transformCustomerText: transformAngryCustomer,
  },
  hard_of_hearing: {
    transformCustomerText: transformHardOfHearingCustomer,
  },
  escalation: {
    appendTurns: escalationAppendTurns,
  },
};

/**
 * Apply the rule-based circumstance modifiers to a script. Produces a
 * NEW turn list with transformed text and any appended turns. Returns
 * `script.turns` unchanged if no circumstance in the list has a rule
 * handler — non-rule circumstances (confused, grateful, etc.) are
 * handled exclusively by the Bedrock rewriter.
 *
 * Ordering:
 *   1. Apply text transforms to each existing turn (in circumstance list order).
 *   2. Append turns from each circumstance (in circumstance list order).
 *
 * Text transforms compose: if both `angry` and `hard_of_hearing` are
 * applied, customer lines first get the angry sharpening, then the
 * "could you repeat" prefix. Composition order matches the array order
 * the admin selected.
 */
export function applyCircumstanceModifiers(
  script: SimulatedCallScript,
  circumstances: Circumstance[],
  rng: Rng = Math.random,
): SimulatedTurn[] {
  if (circumstances.length === 0) return script.turns;
  const ruleCircumstances = circumstances.filter(
    (c) => CIRCUMSTANCE_META[c]?.ruleBased && RULES[c],
  );
  if (ruleCircumstances.length === 0) return script.turns;

  // Step 1: text transforms in order.
  const transformed: SimulatedTurn[] = script.turns.map((turn) => {
    if (turn.speaker === "hold") return turn;
    let t = turn;
    for (const c of ruleCircumstances) {
      const rule = RULES[c];
      if (!rule) continue;
      if (t.speaker === "agent" || (t.speaker === "interrupt" && t.primarySpeaker === "agent")) {
        if (rule.transformAgentText) {
          if (t.speaker === "interrupt") {
            t = {
              ...t,
              text: rule.transformAgentText(t.text, rng),
              interruptText: rule.transformAgentText(t.interruptText, rng),
            };
          } else {
            t = { ...t, text: rule.transformAgentText(t.text, rng) };
          }
        }
      } else if (t.speaker === "customer" || (t.speaker === "interrupt" && t.primarySpeaker === "customer")) {
        if (rule.transformCustomerText) {
          if (t.speaker === "interrupt") {
            t = {
              ...t,
              text: rule.transformCustomerText(t.text, rng),
              interruptText: rule.transformCustomerText(t.interruptText, rng),
            };
          } else {
            t = { ...t, text: rule.transformCustomerText(t.text, rng) };
          }
        }
      }
    }
    return t;
  });

  // Step 2: append turns in order.
  const appended: SimulatedTurn[] = [];
  for (const c of ruleCircumstances) {
    const rule = RULES[c];
    if (rule?.appendTurns) {
      appended.push(...rule.appendTurns(script, rng));
    }
  }

  return [...transformed, ...appended];
}
