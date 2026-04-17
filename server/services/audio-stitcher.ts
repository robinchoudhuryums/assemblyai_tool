/**
 * ffmpeg-based audio stitcher for the Simulated Call Generator.
 *
 * Takes per-turn MP3 buffers from ElevenLabs + generated silence / hold
 * music clips, stitches them with natural gap timing, and applies optional
 * post-processing (phone codec, background noise overlay).
 *
 * Uses the static ffmpeg binary from the `ffmpeg-static` package — no apt
 * install required on the EC2 deploy target.
 *
 * All work happens in a per-generation temp directory under os.tmpdir().
 * The caller is responsible for cleaning up when done; `withTempDir` helper
 * guarantees cleanup on success or failure.
 */
import { promises as fsp } from "fs";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import { logger } from "./logger";

const FFMPEG_PATH: string = (ffmpegStatic as unknown as string) || "ffmpeg";

interface RunFfmpegOptions {
  args: string[];
  /** Max runtime in ms before killing ffmpeg. Default 60s. */
  timeoutMs?: number;
}

/** Low-level ffmpeg runner. Rejects on non-zero exit or timeout. */
async function runFfmpeg(opts: RunFfmpegOptions): Promise<void> {
  const timeout = opts.timeoutMs ?? 60_000;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, ["-nostdin", "-y", ...opts.args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      // Keep last ~4KB of stderr for diagnostics.
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeout}ms`));
    }, timeout);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split("\n").pop()}`));
    });
  });
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), `simcall-${randomUUID()}`);
  await fsp.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn("audio-stitcher: temp dir cleanup failed", {
        dir,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Write a Buffer to disk inside a temp dir.
 */
export async function writeClip(dir: string, name: string, buffer: Buffer): Promise<string> {
  const filePath = path.join(dir, name);
  await fsp.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Generate a silence clip of the given duration (in seconds) and return
 * the path to the file.
 */
export async function generateSilence(
  dir: string,
  name: string,
  durationSec: number,
): Promise<string> {
  const out = path.join(dir, name);
  const clamped = Math.max(0.1, Math.min(durationSec, 300));
  await runFfmpeg({
    args: [
      "-f", "lavfi",
      "-i", `anullsrc=channel_layout=mono:sample_rate=44100`,
      "-t", clamped.toFixed(3),
      "-q:a", "2",
      out,
    ],
  });
  return out;
}

export type ConnectionQuality = "clean" | "phone" | "degraded" | "poor";
export type BackgroundNoise = "none" | "office" | "callcenter" | "static";

export interface StitchOptions {
  /** Clips in order — may be speech, silence, or hold music. All MP3. */
  clipPaths: string[];
  /** Gap (in seconds) to insert BETWEEN clips. Same for all, or per-slot array. */
  gaps: number | number[];
  connectionQuality: ConnectionQuality;
  backgroundNoise: BackgroundNoise;
  backgroundNoiseLevel: number; // 0–1
  /** Output MP3 path. */
  outPath: string;
}

/**
 * Build the ffmpeg filtergraph for codec simulation + background noise.
 *
 * The input at stream index 0 is the stitched speech/silence/music. If
 * noise is enabled we add an `anoisesrc` input at index 1 and amix.
 */
function buildPostProcessFilter(opts: StitchOptions): {
  filter: string;
  extraInputs: string[];
} {
  const parts: string[] = [];
  const extraInputs: string[] = [];

  // Codec simulation — bandwidth limiting + light compression.
  switch (opts.connectionQuality) {
    case "clean":
      // No codec sim; pass through.
      parts.push("[0:a]acopy[clean]");
      break;
    case "phone":
      // 300-3400 Hz voice-band + compression.
      parts.push(
        "[0:a]highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=3:attack=5:release=50[phoned]",
      );
      break;
    case "degraded":
      // Narrower band + mild artifacts via vibrato-less modulation.
      parts.push(
        "[0:a]highpass=f=400,lowpass=f=3000,acompressor=threshold=-15dB:ratio=4,aecho=0.8:0.5:60:0.3[phoned]",
      );
      break;
    case "poor":
      // Aggressive degradation: narrow band + echo + clipping.
      parts.push(
        "[0:a]highpass=f=500,lowpass=f=2800,acompressor=threshold=-12dB:ratio=6,aecho=0.8:0.7:100:0.5,volume=1.5:eval=frame[phoned]",
      );
      break;
  }

  const speechLabel = opts.connectionQuality === "clean" ? "clean" : "phoned";

  // Background noise mix.
  if (opts.backgroundNoise !== "none" && opts.backgroundNoiseLevel > 0) {
    let noiseFilter = "";
    switch (opts.backgroundNoise) {
      case "office":
        // Pink noise at a low volume feels roomy.
        noiseFilter = `anoisesrc=c=pink:r=44100:a=${opts.backgroundNoiseLevel}`;
        break;
      case "callcenter":
        // Pink noise + mild highpass for that distant-voices quality.
        noiseFilter = `anoisesrc=c=pink:r=44100:a=${opts.backgroundNoiseLevel * 1.2}`;
        break;
      case "static":
        // White noise.
        noiseFilter = `anoisesrc=c=white:r=44100:a=${opts.backgroundNoiseLevel * 0.6}`;
        break;
    }
    extraInputs.push("-f", "lavfi", "-i", noiseFilter);
    parts.push(
      `[${speechLabel}][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
    );
  } else {
    parts.push(`[${speechLabel}]acopy[out]`);
  }

  return { filter: parts.join(";"), extraInputs };
}

/**
 * Stitch clips + gaps into a single MP3 with optional codec + noise effects.
 *
 * Implementation:
 *   1. Write a concat-list file listing clips and silence gap files.
 *   2. ffmpeg concat → one intermediate MP3.
 *   3. ffmpeg filter graph for codec + noise → final MP3.
 */
export async function stitchAndPostProcess(
  dir: string,
  opts: StitchOptions,
): Promise<{ durationSec: number }> {
  if (opts.clipPaths.length === 0) {
    throw new Error("stitchAndPostProcess: no clips provided");
  }

  // Step 1: interleave clips with per-slot gap silence files.
  const interleaved: string[] = [];
  for (let i = 0; i < opts.clipPaths.length; i++) {
    interleaved.push(opts.clipPaths[i]);
    if (i < opts.clipPaths.length - 1) {
      const gapSec = Array.isArray(opts.gaps) ? (opts.gaps[i] ?? 0.8) : opts.gaps;
      if (gapSec > 0.05) {
        const gapPath = await generateSilence(dir, `gap-${i}.mp3`, gapSec);
        interleaved.push(gapPath);
      }
    }
  }

  // Step 2: concat list file for ffmpeg's concat demuxer.
  const listPath = path.join(dir, "concat.txt");
  // Per ffmpeg concat-demuxer docs, single-quote each path and escape internal quotes.
  const listLines = interleaved.map(
    (p) => `file '${p.replace(/'/g, "'\\''")}'`,
  );
  await fsp.writeFile(listPath, listLines.join("\n"), "utf-8");

  const mergedPath = path.join(dir, "merged.mp3");
  await runFfmpeg({
    args: ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", mergedPath],
    timeoutMs: 120_000,
  });

  // Step 3: post-process filter graph (codec sim + background noise).
  const { filter, extraInputs } = buildPostProcessFilter(opts);
  await runFfmpeg({
    args: [
      "-i", mergedPath,
      ...extraInputs,
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "libmp3lame",
      "-q:a", "4",
      opts.outPath,
    ],
    timeoutMs: 180_000,
  });

  // Read back duration via ffprobe-less route: parse with ffmpeg and look
  // at stderr. Simpler: use fs stat to ensure output exists, then probe.
  const duration = await probeDurationSeconds(opts.outPath);
  return { durationSec: duration };
}

/**
 * Probe duration by running `ffmpeg -i` and parsing the "Duration:" line
 * from stderr. Avoids a separate ffprobe binary.
 */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, ["-nostdin", "-i", filePath]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("exit", () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (!m) {
        // If we couldn't parse, fall back to 0 rather than crashing the
        // whole generation — duration is cosmetic metadata.
        logger.warn("audio-stitcher: could not parse duration from ffmpeg", {
          file: filePath,
        });
        return resolve(0);
      }
      const [, h, mm, s] = m;
      resolve(parseInt(h, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(s));
    });
  });
}

/**
 * Cheap bootstrap check — verifies ffmpeg-static is accessible at module
 * import time so route registration fails fast on a broken deploy.
 * Returns true if ffmpeg looks usable, false otherwise.
 */
export function isFfmpegAvailable(): boolean {
  try {
    if (!FFMPEG_PATH) return false;
    fs.accessSync(FFMPEG_PATH, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
