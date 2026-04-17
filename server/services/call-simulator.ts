/**
 * Call Simulator — orchestrator for the Simulated Call Generator.
 *
 * Invoked by the `generate_simulated_call` job worker (see routes.ts). Given
 * a SimulatedCallScript + SimulatedCallConfig, produces a stitched MP3 and
 * uploads it to S3. Updates the `simulated_calls` row with status +
 * audio_s3_key + cost tracking.
 *
 * Does NOT automatically feed the result into the real analysis pipeline —
 * that's a separate opt-in action (analyzeAfterGeneration config flag, or
 * the "Send to Analysis" button in the UI).
 */
import path from "path";
import { randomBytes } from "crypto";
import { logger } from "./logger";
import { storage } from "../storage";
import type {
  SimulatedCallScript,
  SimulatedCallConfig,
  SimulatedTurn,
} from "@shared/simulated-call-schema";
import {
  updateSimulatedCall,
  getSimulatedCall,
} from "./simulated-call-storage";
import {
  elevenLabsClient,
  estimateElevenLabsCost,
} from "./elevenlabs-client";
import {
  withTempDir,
  writeClip,
  stitchAndPostProcess,
  generateSilence,
  probeDurationSeconds,
  isFfmpegAvailable,
  type BackchannelOverlay,
} from "./audio-stitcher";
import { addDisfluencies, pickBackchannel } from "./disfluency";
import { applyCircumstanceModifiers } from "./circumstance-modifiers";

/** Minimum duration (seconds) for a primary turn to get a backchannel overlay. */
const BACKCHANNEL_MIN_TURN_SEC = 4;
/** Skip backchannels on poor-tier calls — poor handling rarely has active listening. */
const BACKCHANNEL_SKIP_TIERS = new Set(["poor"]);

/**
 * Sample a gap duration from the configured distribution.
 *
 * Uses Box–Muller for the "natural" path so pauses feel human; clamps to
 * [50ms, 5s] to avoid absurd gaps when the stddev is wide.
 */
function sampleGap(config: SimulatedCallConfig): number {
  if (config.gapDistribution === "fixed") {
    return Math.max(0, config.gapMeanSeconds);
  }
  // Box–Muller gaussian.
  const u1 = Math.max(Number.EPSILON, Math.random());
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const sampled = config.gapMeanSeconds + config.gapStdDevSeconds * z;
  return Math.min(5, Math.max(0.05, sampled));
}

interface SimulatorRunResult {
  audioS3Key: string;
  audioFormat: "mp3";
  durationSec: number;
  ttsCharCount: number;
  estimatedCost: number;
}

/**
 * Main entry point. Throws on any failure; the job worker catches and sets
 * status='failed' + error on the simulated_calls row.
 */
export async function runSimulator(
  simulatedCallId: string,
): Promise<SimulatorRunResult> {
  if (!isFfmpegAvailable()) {
    throw new Error("ffmpeg binary not available — install ffmpeg-static");
  }
  if (!elevenLabsClient.isAvailable) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const row = await getSimulatedCall(simulatedCallId);
  if (!row) throw new Error(`simulated_calls row ${simulatedCallId} not found`);

  await updateSimulatedCall(simulatedCallId, { status: "generating" });

  const storedScript = row.script as SimulatedCallScript;
  const config = row.config as SimulatedCallConfig;

  // Step 0: apply rule-based circumstance modifiers. `applyCircumstanceModifiers`
  // returns the input turn list unchanged when no rule-based circumstances
  // are selected, so the no-circumstance path is byte-identical to before.
  // Non-rule circumstances (confused, grateful, etc.) are handled by the
  // Bedrock rewriter in the variant-creation flow — by the time the
  // simulator runs, the stored script already reflects those changes.
  const effectiveTurns = applyCircumstanceModifiers(
    storedScript,
    config.circumstances ?? [],
  );
  const script: SimulatedCallScript = { ...storedScript, turns: effectiveTurns };

  const result = await withTempDir(async (dir) => {
    // Step 1: synthesize each turn (or silence for hold) into a buffer/file.
    // We also record per-turn durations so backchannel placement in step 1b
    // can compute absolute offsets without re-probing every file.
    const clipPaths: string[] = [];
    const clipDurationsSec: number[] = [];
    const gapPlan: number[] = [];
    let totalChars = 0;

    for (let i = 0; i < script.turns.length; i++) {
      const turn = script.turns[i];
      const clipPath = await renderTurn(dir, i, turn, script, config, (chars) => {
        totalChars += chars;
      });
      clipPaths.push(clipPath);
      clipDurationsSec.push(await probeDurationSeconds(clipPath));
      if (i < script.turns.length - 1) {
        gapPlan.push(sampleGap(config));
      }
    }

    // Step 1b: plan + render backchannels. Disabled via config OR when the
    // call's quality tier is in BACKCHANNEL_SKIP_TIERS. Each backchannel is
    // a short TTS clip from the OPPOSITE speaker's voice, placed within the
    // primary turn's duration window. `totalChars` is bumped by each
    // backchannel so cost tracking stays accurate.
    const backchannels: BackchannelOverlay[] = [];
    const shouldBackchannel =
      config.backchannels !== false &&
      !BACKCHANNEL_SKIP_TIERS.has(script.qualityTier);
    if (shouldBackchannel) {
      let absoluteMs = 0;
      for (let i = 0; i < script.turns.length; i++) {
        const turn = script.turns[i];
        const turnDurSec = clipDurationsSec[i];
        // Only spoken turns over MIN seconds qualify. Hold/interrupt turns
        // are excluded — holds have no speech to listen to, and interrupts
        // are already vocally layered by design.
        if (
          (turn.speaker === "agent" || turn.speaker === "customer") &&
          turnDurSec >= BACKCHANNEL_MIN_TURN_SEC
        ) {
          const opposite = turn.speaker === "agent" ? "customer" : "agent";
          const oppositeVoice = opposite === "agent" ? script.voices.agent : script.voices.customer;
          // 1 backchannel for 4–9s turns, 2 for 9+s.
          const count = turnDurSec >= 9 ? 2 : 1;
          for (let k = 0; k < count; k++) {
            const text = pickBackchannel(opposite);
            try {
              const { audio, characterCount } = await elevenLabsClient.textToSpeech({
                voiceId: oppositeVoice,
                text,
              });
              totalChars += characterCount;
              const bcPath = await writeClip(dir, `bc-${i}-${k}.mp3`, audio);
              // Place within the 35–75% window of the turn so the backchannel
              // lands mid-sentence rather than at speaker boundaries.
              const low = 0.35, high = 0.75;
              const frac = count === 1
                ? low + Math.random() * (high - low)
                : low + ((k + 0.5) / count) * (high - low);
              backchannels.push({
                clipPath: bcPath,
                offsetMs: Math.round((absoluteMs + turnDurSec * 1000 * frac)),
                volumeDb: -10,
              });
            } catch (err) {
              // Backchannel generation is best-effort — a rate-limit or
              // network blip here must NOT fail the whole call. Log and skip.
              logger.warn("simulator: backchannel render failed (non-blocking)", {
                simulatedCallId,
                turnIndex: i,
                error: (err as Error).message,
              });
            }
          }
        }
        absoluteMs += turnDurSec * 1000;
        if (i < script.turns.length - 1) {
          absoluteMs += (gapPlan[i] ?? 0) * 1000;
        }
      }
    }

    // Step 2: stitch + post-process.
    const outPath = path.join(dir, "final.mp3");
    const { durationSec } = await stitchAndPostProcess(dir, {
      clipPaths,
      gaps: gapPlan,
      connectionQuality: config.connectionQuality,
      backgroundNoise: config.backgroundNoise,
      backgroundNoiseLevel: config.backgroundNoiseLevel,
      backchannels: backchannels.length > 0 ? backchannels : undefined,
      outPath,
    });

    // Step 3: upload the stitched MP3 to S3 under a dedicated prefix so it's
    // easy to distinguish from real call audio. Reuses the storage layer's
    // audio client so the same bucket / IAM scope apply.
    const s3Key = `simulated/${simulatedCallId}/${randomBytes(4).toString("hex")}.mp3`;
    const s3 = storage.getObjectStorageClient();
    const audioBuf = await import("fs").then((m) => m.promises.readFile(outPath));
    if (s3) {
      await s3.uploadFile(s3Key, audioBuf, "audio/mpeg");
    } else {
      // Dev fallback: MemStorage doesn't have an object client. Stash via
      // uploadAudio on the simulated-call id so getAudioFiles picks it up.
      await storage.uploadAudio(simulatedCallId, "simulated.mp3", audioBuf, "audio/mpeg");
    }

    return {
      audioS3Key: s3Key,
      durationSec: Math.round(durationSec),
      ttsCharCount: totalChars,
    };
  });

  const estimatedCost = estimateElevenLabsCost(result.ttsCharCount);

  await updateSimulatedCall(simulatedCallId, {
    status: "ready",
    audioS3Key: result.audioS3Key,
    audioFormat: "mp3",
    durationSeconds: result.durationSec,
    ttsCharCount: result.ttsCharCount,
    estimatedCost,
    error: null,
  });

  logger.info("simulator: generation complete", {
    simulatedCallId,
    durationSec: result.durationSec,
    ttsCharCount: result.ttsCharCount,
    estimatedCost,
  });

  return {
    audioS3Key: result.audioS3Key,
    audioFormat: "mp3",
    durationSec: result.durationSec,
    ttsCharCount: result.ttsCharCount,
    estimatedCost,
  };
}

/**
 * Render one turn (speech / hold / interrupt) into an audio file on disk
 * and return the path. `charTally` accumulates TTS character counts for
 * cost tracking.
 */
async function renderTurn(
  dir: string,
  index: number,
  turn: SimulatedTurn,
  script: SimulatedCallScript,
  config: SimulatedCallConfig,
  charTally: (chars: number) => void,
): Promise<string> {
  if (turn.speaker === "hold") {
    // Silence or hold music for `duration` seconds. Hold music overlay is
    // a future enhancement — for now, silence always.
    return generateSilence(dir, `turn-${index}.mp3`, turn.duration);
  }

  if (turn.speaker === "interrupt") {
    // Render the primary speaker's line + the interrupter's line as two
    // separate clips, stitched back-to-back. A true overlap would require
    // amix; for MVP we treat it as a fast cut (primary → interrupt → primary
    // resumes is the caller's responsibility — they'd model it as three
    // turns). Treating interrupt as a single clip keeps the MVP honest.
    const voice = turn.primarySpeaker === "agent" ? script.voices.agent : script.voices.customer;
    const combinedText = maybeAddDisfluencies(
      `${turn.text} ... ${turn.interruptText}`,
      script.qualityTier,
      config.disfluencies,
    );
    const { audio, characterCount } = await elevenLabsClient.textToSpeech({
      voiceId: voice,
      text: combinedText,
    });
    charTally(characterCount);
    return writeClip(dir, `turn-${index}.mp3`, audio);
  }

  // Standard spoken turn. Disfluencies are applied to the TTS request only;
  // the stored script is untouched so admins see what they wrote.
  const voice = turn.speaker === "agent" ? script.voices.agent : script.voices.customer;
  const ttsText = maybeAddDisfluencies(turn.text, script.qualityTier, config.disfluencies);
  const { audio, characterCount } = await elevenLabsClient.textToSpeech({
    voiceId: voice,
    text: ttsText,
  });
  charTally(characterCount);
  return writeClip(dir, `turn-${index}.mp3`, audio);
}

/**
 * Gate disfluency injection behind the config flag. Kept as a helper so
 * renderTurn reads cleanly at every call site and the qualityTier-to-rate
 * mapping lives in one place (see `disfluency.ts`).
 */
function maybeAddDisfluencies(
  text: string,
  qualityTier: string,
  enabled: boolean | undefined,
): string {
  if (enabled === false) return text;
  if (qualityTier !== "excellent" && qualityTier !== "acceptable" && qualityTier !== "poor") {
    return text;
  }
  return addDisfluencies(text, qualityTier);
}
