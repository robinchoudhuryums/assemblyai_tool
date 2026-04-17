/**
 * Bedrock-powered script rewriter (Approach B).
 *
 * Takes a base SimulatedCallScript and a list of circumstances + target
 * qualityTier, returns a rewritten script JSON. Used by the "Create
 * Variation" flow in the admin UI to generate richer, more nuanced
 * variants than the rule-based modifiers can produce.
 *
 * Cost: ~$0.003 on Haiku, ~$0.034 on Sonnet per rewrite. Dwarfed by
 * the TTS cost of the resulting call (~$1–2). We use the configured
 * `aiProvider.generateText()` directly rather than going through the
 * call-analysis path — no transcript analysis semantics apply here.
 *
 * Security posture:
 * - The output is validated against `simulatedCallScriptSchema` via Zod.
 *   Malformed or missing fields throw, keeping the route handler honest.
 * - `voices` field is force-preserved from the base script so the model
 *   cannot swap in unknown voice IDs. Quality tier is force-set from the
 *   caller so an overzealous rewrite can't drop tier consistency.
 * - Output never includes real PHI by construction (synthetic inputs),
 *   but the PHI redactor still runs on any logs that capture the output.
 *
 * Composition with Phase A: the rewritten script lands in a new
 * `simulated_calls` row whose `config.circumstances` reflects what was
 * asked for. The rule-based modifiers (angry/hard_of_hearing/escalation)
 * then STILL apply at generation time unless the caller clears them —
 * giving stacked realism if desired. Callers who want only the LLM
 * rewrite (no rule-based overlay) should pass an empty circumstances
 * array to `generate`.
 */
import { z } from "zod";
import { aiProvider } from "./ai-factory";
import { logger } from "./logger";
import {
  simulatedCallScriptSchema,
  CIRCUMSTANCE_META,
  type SimulatedCallScript,
  type Circumstance,
} from "@shared/simulated-call-schema";

export interface RewriteInput {
  baseScript: SimulatedCallScript;
  circumstances: Circumstance[];
  /** Target quality tier for the rewrite. Defaults to the base script's tier. */
  targetQualityTier?: "poor" | "acceptable" | "excellent";
}

export interface RewriteResult {
  script: SimulatedCallScript;
  /** Raw model output for debugging. Not persisted. */
  rawResponse: string;
  /** Approximate input + output char count so the UI can estimate cost if it wants. */
  promptChars: number;
  responseChars: number;
}

// ── Prompt construction ────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `You are a writer rewriting customer-service call scripts for a medical-supply company's QA training tool. You transform a BASE SCRIPT into a VARIANT that reflects specific circumstances (e.g. angry customer, escalation, non-native speaker) while preserving the scenario and core outcome.

Rules:
1. Preserve the call's scenario and overall resolution path. Do not invent new medical facts or policies.
2. Preserve the voices mapping EXACTLY as given. Do not substitute voice IDs.
3. Preserve the qualityTier the caller specifies (it may differ from the base script's tier).
4. Turn count may change modestly (±30%) but must remain between 4 and 30 turns.
5. Speaker alternation should remain natural; do not have the same speaker for 4+ turns in a row.
6. Output MUST be valid JSON, matching exactly this shape:

{
  "title": string,
  "scenario": string,
  "qualityTier": "poor" | "acceptable" | "excellent",
  "equipment": string (optional),
  "voices": { "agent": string, "customer": string },
  "turns": Array<
    | { "speaker": "agent" | "customer", "text": string }
    | { "speaker": "hold", "duration": number }
    | { "speaker": "interrupt", "primarySpeaker": "agent" | "customer", "text": string, "interruptText": string }
  >
}

7. Return ONLY the JSON. No markdown, no prose, no code fences.

Circumstance glossary:
- angry: customer is frustrated and shows it; softer language is replaced by terse demands; exclamations allowed but don't overdo them.
- hard_of_hearing: customer occasionally asks the agent to repeat something; may mishear a detail and need clarification.
- escalation: the call ends with the customer requesting a supervisor; add 2–4 turns at the tail reflecting that.
- confused: customer repeatedly asks clarifying questions, pauses, seems lost.
- non_native_speaker: simpler sentence structure for the customer, occasional minor word choice oddities (but still understandable — do not caricature).
- time_pressure: terse, hurried customer lines; customer may interrupt or cut off the agent.
- grateful: warm, affirming customer; "thank you so much" / "I really appreciate it" throughout.
- distressed: emotional urgency; short sentences; customer may sound overwhelmed.`;

function buildRewritePrompt(input: RewriteInput): string {
  const circumstanceBlock = input.circumstances.length === 0
    ? "(none — return the script essentially unchanged, just adjusted to the target quality tier)"
    : input.circumstances
        .map((c) => {
          const meta = CIRCUMSTANCE_META[c];
          return `- ${c}: ${meta?.description ?? ""}`;
        })
        .join("\n");

  const targetTier = input.targetQualityTier ?? input.baseScript.qualityTier;

  return [
    SYSTEM_INSTRUCTIONS,
    "",
    "## BASE SCRIPT",
    "```json",
    JSON.stringify(input.baseScript, null, 2),
    "```",
    "",
    "## REQUESTED CIRCUMSTANCES",
    circumstanceBlock,
    "",
    `## TARGET QUALITY TIER: ${targetTier}`,
    "",
    "Return ONLY the rewritten script JSON. Preserve the voices mapping exactly.",
  ].join("\n");
}

// ── JSON extraction ────────────────────────────────────────────────

/**
 * Pull the first JSON object out of a string that may contain prose or
 * code fences around it. Returns null if no balanced object is found.
 */
function extractJsonObject(text: string): string | null {
  // Strip ```json ... ``` fences first if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const firstBrace = candidate.indexOf("{");
  if (firstBrace < 0) return null;
  // Walk to find the matching brace. Simple depth counter; string literals
  // with quoted braces are handled by a tiny state machine.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(firstBrace, i + 1);
    }
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────

export class ScriptRewriterError extends Error {
  constructor(
    message: string,
    public readonly stage: "unavailable" | "model_error" | "parse_error" | "validation_error",
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ScriptRewriterError";
  }
}

/**
 * Rewrite a script via Bedrock. Throws `ScriptRewriterError` on any
 * failure so callers can distinguish stage-specific issues.
 *
 * Contract:
 * - Returns a script that has passed `simulatedCallScriptSchema` parse.
 * - `voices` is force-restored from the base script (model cannot swap).
 * - `qualityTier` is force-set from `targetQualityTier` if provided.
 */
export async function rewriteScript(input: RewriteInput): Promise<RewriteResult> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    throw new ScriptRewriterError(
      "AI provider is not configured — set AWS credentials to enable script rewriting",
      "unavailable",
    );
  }

  const prompt = buildRewritePrompt(input);
  let raw: string;
  try {
    raw = await aiProvider.generateText(prompt);
  } catch (err) {
    throw new ScriptRewriterError(
      `Bedrock generateText failed: ${(err as Error).message}`,
      "model_error",
      err,
    );
  }

  const jsonBlob = extractJsonObject(raw);
  if (!jsonBlob) {
    logger.warn("script-rewriter: model response had no JSON block", { sample: raw.slice(0, 200) });
    throw new ScriptRewriterError(
      "Model response did not contain a JSON object",
      "parse_error",
      { sample: raw.slice(0, 200) },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlob);
  } catch (err) {
    throw new ScriptRewriterError(
      `Model JSON was malformed: ${(err as Error).message}`,
      "parse_error",
      { jsonBlob: jsonBlob.slice(0, 500) },
    );
  }

  const result = simulatedCallScriptSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn("script-rewriter: rewritten script failed schema validation", {
      error: result.error.format(),
    });
    throw new ScriptRewriterError(
      "Rewritten script failed schema validation",
      "validation_error",
      result.error.flatten(),
    );
  }

  // Force-restore voices + tier so the model can't drift these.
  const script: SimulatedCallScript = {
    ...result.data,
    voices: input.baseScript.voices,
    qualityTier: input.targetQualityTier ?? input.baseScript.qualityTier,
  };

  return {
    script,
    rawResponse: raw,
    promptChars: prompt.length,
    responseChars: raw.length,
  };
}

// Test seam — exported for unit tests so they can exercise the
// validator + voice-preservation logic without hitting Bedrock.
export const _internal = {
  buildRewritePrompt,
  extractJsonObject,
};
