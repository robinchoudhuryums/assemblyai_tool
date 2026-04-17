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
  isFfmpegAvailable,
} from "./audio-stitcher";

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

  const script = row.script as SimulatedCallScript;
  const config = row.config as SimulatedCallConfig;

  const result = await withTempDir(async (dir) => {
    // Step 1: synthesize each turn (or silence for hold) into a buffer/file.
    const clipPaths: string[] = [];
    const gapPlan: number[] = [];
    let totalChars = 0;

    for (let i = 0; i < script.turns.length; i++) {
      const turn = script.turns[i];
      const clipPath = await renderTurn(dir, i, turn, script, config, (chars) => {
        totalChars += chars;
      });
      clipPaths.push(clipPath);
      if (i < script.turns.length - 1) {
        gapPlan.push(sampleGap(config));
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
    const combinedText = `${turn.text} ... ${turn.interruptText}`;
    const { audio, characterCount } = await elevenLabsClient.textToSpeech({
      voiceId: voice,
      text: combinedText,
    });
    charTally(characterCount);
    return writeClip(dir, `turn-${index}.mp3`, audio);
  }

  // Standard spoken turn.
  const voice = turn.speaker === "agent" ? script.voices.agent : script.voices.customer;
  const { audio, characterCount } = await elevenLabsClient.textToSpeech({
    voiceId: voice,
    text: turn.text,
  });
  charTally(characterCount);
  return writeClip(dir, `turn-${index}.mp3`, audio);
}
