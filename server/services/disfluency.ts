/**
 * Disfluency injection for the Simulated Call Generator.
 *
 * Real customer-service calls are full of filler words ("um", "uh", "you
 * know") and micro-pauses. Clean TTS output sounds synthetically fluent,
 * which makes it easy for a reviewer to tell a call is fake AND makes the
 * AI analysis pipeline artificially optimistic (transcripts without
 * hesitation markers score higher).
 *
 * This module applies probabilistic text-level transformations before the
 * turn is sent to ElevenLabs. Transformations are intentionally at the
 * text layer (not SSML) because ElevenLabs' `eleven_flash_v2_5` model
 * handles natural text pauses via commas and ellipses; SSML support is
 * inconsistent across model families.
 *
 * Rates are tuned per quality tier — "excellent" calls get NO fillers (so
 * exceptional handling still sounds fluent), "acceptable" gets light
 * filler use, and "poor" gets heavy filler use.
 */

export type QualityTier = "poor" | "acceptable" | "excellent";

interface DisfluencyRates {
  /** Probability of injecting a filler at the start of the text. */
  leading: number;
  /** Probability of injecting a filler between sentences (split on ". "). */
  midSentence: number;
  /** Probability of adding a trailing hesitation. */
  trailing: number;
  /** Probability of stretching a comma to ", um, ". */
  commaHesitation: number;
}

const RATES: Record<QualityTier, DisfluencyRates> = {
  excellent: { leading: 0, midSentence: 0, trailing: 0, commaHesitation: 0 },
  acceptable: {
    leading: 0.1,
    midSentence: 0.06,
    trailing: 0.03,
    commaHesitation: 0.05,
  },
  poor: {
    leading: 0.25,
    midSentence: 0.18,
    trailing: 0.1,
    commaHesitation: 0.15,
  },
};

const LEADING_FILLERS = ["Um, ", "Uh, ", "So, ", "Well, ", "Hmm, ", "Okay so, "];
const MID_FILLERS = [", uh, ", ", um, ", ", you know, ", ", I mean, ", ", like, "];
const TRAILING_FILLERS = [" ... yeah.", " ... I guess.", " ... right?"];
const COMMA_HESITATIONS = [", um,", ", uh,", ", well,"];

/**
 * Seeded-random helper. Uses an injectable RNG so tests can be deterministic.
 * Defaults to `Math.random`.
 */
type Rng = () => number;

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Apply disfluencies to a single turn's text.
 *
 * Returns the transformed text. The original `turn.text` stored in the
 * simulated_calls row is NOT mutated — only the string sent to the TTS
 * API is modified. This keeps the admin-facing script readable and lets
 * the same script regenerate deterministically (given a seeded RNG).
 */
export function addDisfluencies(
  text: string,
  tier: QualityTier,
  rng: Rng = Math.random,
): string {
  if (!text) return text;
  const rates = RATES[tier];
  if (rates.leading === 0 && rates.midSentence === 0 && rates.trailing === 0 && rates.commaHesitation === 0) {
    return text;
  }

  let out = text;

  // Leading filler — replace the first capital letter with a filler + lowercase first char.
  if (rng() < rates.leading) {
    const filler = pick(LEADING_FILLERS, rng);
    out = filler + out.charAt(0).toLowerCase() + out.slice(1);
  }

  // Mid-sentence filler — inject a filler in the middle of a period boundary.
  if (rng() < rates.midSentence && /\.\s/.test(out)) {
    const sentences = out.split(/(?<=\.\s)/);
    if (sentences.length >= 2) {
      const injectAt = 1 + Math.floor(rng() * (sentences.length - 1));
      const filler = pick(MID_FILLERS, rng);
      // Prepend the filler (stripped of leading ", ") to the next sentence.
      const cleanFiller = filler.replace(/^,\s*/, "").replace(/,\s*$/, "") + ", ";
      sentences[injectAt] =
        cleanFiller.charAt(0).toUpperCase() + cleanFiller.slice(1) + sentences[injectAt];
      out = sentences.join("");
    }
  }

  // Comma hesitation — occasionally stretch a comma into ", um,".
  if (rates.commaHesitation > 0) {
    out = out.replace(/,\s/g, (match) => {
      if (rng() < rates.commaHesitation) {
        return pick(COMMA_HESITATIONS, rng) + " ";
      }
      return match;
    });
  }

  // Trailing filler.
  if (rng() < rates.trailing) {
    // Strip a final period if present, then re-add after the filler.
    out = out.replace(/\.\s*$/, "") + pick(TRAILING_FILLERS, rng);
  }

  return out;
}

/**
 * Pool of backchannel utterances by speaker role. These are rendered as
 * separate TTS calls and overlaid under the opposite speaker's primary
 * turn — see call-simulator.ts for placement logic.
 *
 * Kept short (1–2 words) to stay under 15 chars each, which keeps the
 * added cost per call in the single-cents range.
 */
export const AGENT_BACKCHANNELS = [
  "mm-hmm",
  "I see",
  "got it",
  "okay",
  "right",
  "understood",
  "sure",
];

export const CUSTOMER_BACKCHANNELS = [
  "uh huh",
  "mm-hmm",
  "okay",
  "yeah",
  "right",
  "I see",
];

export function pickBackchannel(
  role: "agent" | "customer",
  rng: Rng = Math.random,
): string {
  const pool = role === "agent" ? AGENT_BACKCHANNELS : CUSTOMER_BACKCHANNELS;
  return pick(pool, rng);
}
