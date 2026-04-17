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
import { BedrockClientError } from "./bedrock";
import { logger } from "./logger";
import { getModelForTier } from "./model-tiers";
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
  /**
   * Which model actually produced the script. For the generator this can
   * differ from what the admin requested if Haiku wasn't accessible in
   * their AWS account and we fell back to the BEDROCK_MODEL default.
   * The UI uses this to surface a note like "Generated with Sonnet
   * (Haiku 4.5 access not enabled)".
   */
  modelUsed?: "haiku" | "sonnet" | "default" | "fallback";
  /** True iff we tried Haiku first and had to fall back to the default model. */
  fellBackFromHaiku?: boolean;
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
    // 6144 tokens gives enough headroom for a 15-turn rewritten script
    // plus JSON overhead. The default 2048 cuts off mid-JSON on longer
    // scripts, producing parse_error stage failures.
    raw = await aiProvider.generateText(prompt, undefined, 6144);
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

// ── Script generation from a scenario description ──────────────────
//
// Different use case from rewriteScript: the admin has a title + scenario
// description but NO existing turns. The model is asked to produce a
// full script from scratch. Reuses the same JSON extraction + Zod
// validation + voice-preservation contract as rewriteScript.

/**
 * ElevenLabs voice IDs are not round-trippable through a cold-start
 * prompt (the model has never seen them). We pass them in and
 * force-restore on output. Same defense applies to qualityTier.
 */
export interface GenerateFromScenarioInput {
  title: string;
  scenario?: string;
  equipment?: string;
  qualityTier: "poor" | "acceptable" | "excellent";
  voices: { agent: string; customer: string };
  /** Requested number of turns. Model may produce ±20%. Default 10. */
  targetTurnCount?: number;
  /** Set true to route through Sonnet instead of the default (Haiku). */
  useSonnet?: boolean;
}

// Model IDs used by the generator now route through the tier abstraction
// (model-tiers.ts). "fast" = Haiku-class (the cost-optimized default);
// "strong" = Sonnet-class (the useSonnet=true opt-in). Admins can override
// either tier at runtime via PATCH /api/admin/model-tiers without a code
// change.

function buildGeneratorPrompt(input: GenerateFromScenarioInput): string {
  const targetTurns = Math.max(4, Math.min(input.targetTurnCount ?? 10, 30));
  const tierExpectation = {
    excellent: "Excellent handling: the agent is warm, proactive, solves the customer's issue efficiently, offers follow-up, and leaves the customer satisfied.",
    acceptable: "Acceptable handling: the agent answers correctly but doesn't go the extra mile. Tone is neutral, resolution is adequate.",
    poor: "Poor handling: the agent is curt, dismissive, or unhelpful. May fail to resolve the issue or leave the customer frustrated.",
  }[input.qualityTier];

  return [
    "You are a writer producing realistic customer-service phone call scripts for a medical-supply company's QA training tool. Generate a script from scratch given a title and a scenario description.",
    "",
    "Rules:",
    `1. Target approximately ${targetTurns} turns (±20% is fine). Natural back-and-forth — agent and customer alternate.`,
    "2. Every spoken turn must have non-empty `text`. Do not emit hold turns unless the scenario clearly calls for one.",
    "3. Preserve the voices mapping EXACTLY as given. Do not substitute voice IDs.",
    "4. Preserve the qualityTier exactly as given.",
    "5. The script should reflect a full realistic call: greeting, problem statement, resolution attempt, closing.",
    "6. Tone and outcome must match the quality tier expectation below.",
    "7. Output MUST be valid JSON matching this shape EXACTLY:",
    "",
    "{",
    '  "title": string,',
    '  "scenario": string,',
    '  "qualityTier": "poor" | "acceptable" | "excellent",',
    '  "equipment": string (optional),',
    '  "voices": { "agent": string, "customer": string },',
    '  "turns": Array<',
    '    | { "speaker": "agent" | "customer", "text": string }',
    '    | { "speaker": "hold", "duration": number }',
    "  >",
    "}",
    "",
    "8. Return ONLY the JSON. No markdown, no prose, no code fences.",
    "",
    `## TARGET QUALITY TIER: ${input.qualityTier}`,
    tierExpectation,
    "",
    "## SCRIPT TO GENERATE",
    "```json",
    JSON.stringify({
      title: input.title,
      scenario: input.scenario ?? "",
      qualityTier: input.qualityTier,
      equipment: input.equipment ?? "",
      voices: input.voices,
      targetTurns,
    }, null, 2),
    "```",
    "",
    "Return ONLY the generated script JSON. Preserve the voices mapping exactly.",
  ].join("\n");
}

export async function generateScriptFromScenario(
  input: GenerateFromScenarioInput,
): Promise<RewriteResult> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    throw new ScriptRewriterError(
      "AI provider is not configured — set AWS credentials to enable script generation",
      "unavailable",
    );
  }
  if (!input.title.trim()) {
    throw new ScriptRewriterError(
      "Title is required to generate a script",
      "validation_error",
    );
  }

  const prompt = buildGeneratorPrompt(input);
  const primaryModel = input.useSonnet ? getModelForTier("strong") : getModelForTier("fast");

  // 8192 tokens gives enough headroom for up to ~30 turns of dialogue
  // (the generator's max). The default 2048 caps out around 8-10 turns
  // before JSON gets truncated mid-object, causing parse_error.
  const MAX_TOKENS = 8192;

  let raw: string;
  let fellBackFromHaiku = false;
  let modelUsed: RewriteResult["modelUsed"] = input.useSonnet ? "sonnet" : "haiku";
  try {
    raw = await aiProvider.generateText(prompt, primaryModel, MAX_TOKENS);
  } catch (err) {
    // Fallback: if the admin asked for Haiku (default) but the AWS
    // account doesn't have Haiku 4.5 access enabled, retry with the
    // configured BEDROCK_MODEL (typically Sonnet 4.6, which has
    // already been proven to work for regular call analysis). A 4xx
    // from Bedrock is almost always "access denied" (403) or
    // "model not found" (400), both of which mean "try a different model".
    // 429 (rate limit) and 5xx (Bedrock outage) still surface as hard
    // failures — falling back wouldn't help either of those.
    const isBedrockClientErr = err instanceof BedrockClientError;
    const shouldFallback =
      !input.useSonnet &&                         // only when admin picked Haiku
      isBedrockClientErr &&                        // 4xx from Bedrock
      (err as BedrockClientError).status !== 429;  // not a rate limit
    if (shouldFallback) {
      logger.warn("script-generator: Haiku rejected by Bedrock, falling back to default model", {
        haikuModel: primaryModel,
        haikuStatus: (err as BedrockClientError).status,
        haikuError: (err as Error).message,
      });
      try {
        // `undefined` modelOverride → uses BEDROCK_MODEL env var (Sonnet for this tenant).
        raw = await aiProvider.generateText(prompt, undefined, MAX_TOKENS);
        fellBackFromHaiku = true;
        modelUsed = "fallback";
      } catch (fallbackErr) {
        throw new ScriptRewriterError(
          `Bedrock generateText failed (after Haiku fallback): ${(fallbackErr as Error).message}`,
          "model_error",
          fallbackErr,
        );
      }
    } else {
      throw new ScriptRewriterError(
        `Bedrock generateText failed: ${(err as Error).message}`,
        "model_error",
        err,
      );
    }
  }

  const jsonBlob = extractJsonObject(raw);
  if (!jsonBlob) {
    logger.warn("script-generator: model response had no JSON block", {
      sample: raw.slice(0, 400),
      totalChars: raw.length,
    });
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
    logger.warn("script-generator: generated script failed schema validation", {
      error: result.error.format(),
    });
    throw new ScriptRewriterError(
      "Generated script failed schema validation",
      "validation_error",
      result.error.flatten(),
    );
  }

  // Force-restore voices + tier so the model cannot drift these, same
  // contract as rewriteScript. Also preserve the admin-supplied title
  // verbatim — the model sometimes rewrites it into something wordier
  // and we want the Library card to match what the admin typed.
  const script: SimulatedCallScript = {
    ...result.data,
    title: input.title,
    scenario: input.scenario ?? result.data.scenario,
    qualityTier: input.qualityTier,
    voices: input.voices,
  };

  return {
    script,
    rawResponse: raw,
    promptChars: prompt.length,
    responseChars: raw.length,
    modelUsed,
    fellBackFromHaiku,
  };
}

// Test seam — exported for unit tests so they can exercise the
// validator + voice-preservation logic without hitting Bedrock.
export const _internal = {
  buildRewritePrompt,
  buildGeneratorPrompt,
  extractJsonObject,
};
