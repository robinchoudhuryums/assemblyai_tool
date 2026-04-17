/**
 * ElevenLabs TTS REST client.
 *
 * Mirrors the AssemblyAIService pattern: thin fetch wrapper, API key read
 * from env, graceful degradation (isAvailable=false) when key is missing.
 *
 * Used by the Simulated Call Generator to synthesize per-turn audio clips.
 * No SDK dependency — raw REST to match the existing codebase posture.
 *
 * Pricing reference (standard tier, as of this writing):
 *   $0.30 per 1000 characters → tracked in usage_records.
 *
 * Rate limiting: ElevenLabs limits concurrent requests per API key. We
 * serialize TTS calls via the JobQueue (one call generation per job) and
 * apply exponential backoff on 429.
 */
import { logger } from "./logger";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const TTS_TIMEOUT_MS = 60_000; // 60s — per-turn generation rarely takes >15s
const VOICES_TIMEOUT_MS = 10_000;

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  description?: string;
}

export interface TextToSpeechOptions {
  /** Voice ID from ElevenLabs — listed via /voices */
  voiceId: string;
  /** Text to synthesize. Max length enforced by the caller (Zod limits). */
  text: string;
  /** Model ID — defaults to eleven_flash_v2_5 for lower latency/cost. */
  modelId?: string;
  /** Output format — mp3_44100_128 (default) | pcm_16000 | etc. */
  outputFormat?: string;
  /** Voice stability (0-1). Lower = more expressive, higher = more consistent. */
  stability?: number;
  /** Similarity boost (0-1). Controls adherence to the reference voice. */
  similarityBoost?: number;
}

export interface TtsResult {
  audio: Buffer;
  /** Character count billed by ElevenLabs (== text.length for most cases). */
  characterCount: number;
  latencyMs: number;
}

export class ElevenLabsClient {
  private apiKey: string;
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || "";
    if (!this.apiKey) {
      logger.warn(
        "ELEVENLABS_API_KEY is not set — Simulated Call Generator TTS will fail when invoked",
      );
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set — set it in .env to use the Simulated Call Generator",
      );
    }
    return this.apiKey;
  }

  /**
   * Fetch the list of available voices on the API key's account.
   * Results are intended to be cached at the route layer (LFU/TTL).
   */
  async listVoices(): Promise<ElevenLabsVoice[]> {
    const apiKey = this.requireKey();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VOICES_TIMEOUT_MS);
    try {
      const res = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
        headers: { "xi-api-key": apiKey, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs /voices failed: ${res.status} — ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
      return data.voices ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Synthesize one turn of text into MP3 audio. Returns a Buffer + the
   * billed character count for usage tracking.
   *
   * Retries once on 429 (rate limit) after a 2s wait. Other errors surface
   * to the caller and should fail the job.
   */
  async textToSpeech(options: TextToSpeechOptions): Promise<TtsResult> {
    const apiKey = this.requireKey();
    const model = options.modelId ?? "eleven_flash_v2_5";
    const output = options.outputFormat ?? "mp3_44100_128";

    const body = {
      text: options.text,
      model_id: model,
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
      },
    };

    const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${encodeURIComponent(output)}`;
    const start = Date.now();

    const attempt = async (): Promise<Response> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS);
      try {
        return await fetch(url, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res = await attempt();
    if (res.status === 429) {
      logger.warn("ElevenLabs 429 — retrying after 2s", { voiceId: options.voiceId });
      await new Promise((r) => setTimeout(r, 2000));
      res = await attempt();
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${res.status} — ${txt.slice(0, 200)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      characterCount: options.text.length,
      latencyMs: Date.now() - start,
    };
  }
}

export const elevenLabsClient = new ElevenLabsClient();

/**
 * Per-character cost for a given ElevenLabs tier. Defaults to standard
 * ($0.30 per 1000 chars). Override via ELEVENLABS_COST_PER_CHAR env var.
 */
export function estimateElevenLabsCost(characterCount: number): number {
  const perChar = Number(process.env.ELEVENLABS_COST_PER_CHAR);
  const rate = Number.isFinite(perChar) && perChar > 0 ? perChar : 0.0003;
  return Math.round(characterCount * rate * 10000) / 10000; // 4 decimals
}
