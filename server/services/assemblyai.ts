import { InsertTranscript, InsertSentimentAnalysis, InsertCallAnalysis } from "@shared/schema";
import type { CallAnalysis } from "./ai-provider";

import { calibrateScore, calibrateSubScores, getScoreFlags, getCalibrationConfig } from "./scoring-calibration.js";
import { logger } from "./logger";

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface AssemblyAIResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  confidence?: number;
  words?: TranscriptWord[];
  sentiment_analysis_results?: Array<{
    text: string;
    sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    confidence: number;
    start: number;
    end: number;
  }>;
  auto_chapters?: Array<{
    summary: string;
    headline: string;
    start: number;
    end: number;
  }>;
  iab_categories_result?: {
    summary: Record<string, number>;
  };
  error?: string;
}


/**
 * Pending webhook transcripts — when webhook mode is active, transcription results
 * are delivered via POST callback instead of polling. This map holds Promise resolvers
 * keyed by transcript ID.
 */
const pendingWebhookTranscripts = new Map<string, {
  resolve: (response: AssemblyAIResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/** Whether webhook mode is available (APP_BASE_URL is set) */
export function isWebhookModeEnabled(): boolean {
  return !!(process.env.APP_BASE_URL && process.env.ASSEMBLYAI_API_KEY);
}

/**
 * Handle an incoming AssemblyAI webhook callback.
 * Called from the webhook route handler.
 */
export function handleAssemblyAIWebhook(transcriptId: string, response: AssemblyAIResponse): boolean {
  const pending = pendingWebhookTranscripts.get(transcriptId);
  if (!pending) {
    logger.warn("AssemblyAI webhook callback for unknown transcript", { transcriptId });
    return false;
  }

  clearTimeout(pending.timeout);
  pendingWebhookTranscripts.delete(transcriptId);

  if (response.status === "error") {
    pending.reject(new Error(`Transcription failed: ${response.error || "Unknown error"}`));
  } else {
    pending.resolve(response);
  }
  return true;
}

export class AssemblyAIService {
  private config: AssemblyAIConfig;

  constructor() {
    this.config = {
      apiKey: process.env.ASSEMBLYAI_API_KEY || "",
      baseUrl: 'https://api.assemblyai.com/v2'
    };
    if (!this.config.apiKey) {
      logger.warn("ASSEMBLYAI_API_KEY is not set — audio processing will fail");
    }
  }

  async uploadAudioFile(audioBuffer: Buffer, fileName: string): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/upload`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(audioBuffer)
    });
    if (!response.ok) throw new Error(`Failed to upload audio file: ${await response.text()}`);
    return (await response.json()).upload_url;
  }

  async transcribeAudio(audioUrl: string, wordBoost?: string[], language?: string): Promise<string> {
    // Cost optimization: skip AssemblyAI sentiment for non-English (saves $0.02/hr)
    // AI analysis provides sentiment anyway; AssemblyAI sentiment is less accurate for non-English
    const isNonEnglish = language && language !== "en";

    const body: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_models: ["universal-3-pro", "universal-2"],
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      sentiment_analysis: !isNonEnglish, // Skip for non-English (12% cost savings)
      auto_chapters: true,
    };

    if (isNonEnglish) {
      body.language_code = language;
    }

    // Word boost: provide correct spellings of agent names and company-specific terms
    // This tells AssemblyAI to prefer these exact spellings when the audio is ambiguous
    if (wordBoost && wordBoost.length > 0) {
      body.word_boost = wordBoost;
      body.boost_param = "high"; // "low", "default", or "high"
    }

    // Webhook mode: if APP_BASE_URL is set, tell AssemblyAI to POST results back to us
    const appBaseUrl = process.env.APP_BASE_URL;
    if (appBaseUrl) {
      const webhookUrl = `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/assemblyai`;
      body.webhook_url = webhookUrl;
      // Include auth token in webhook URL for verification
      if (process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
        body.webhook_auth_header_name = "X-Webhook-Secret";
        body.webhook_auth_header_value = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
      }
    }

    const response = await fetch(`${this.config.baseUrl}/transcript`, {
      method: 'POST',
      headers: { 'Authorization': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Failed to start transcription: ${await response.text()}`);
    return (await response.json()).id;
  }

  async getTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    const response = await fetch(`${this.config.baseUrl}/transcript/${transcriptId}`, {
      headers: { 'Authorization': this.config.apiKey }
    });
    if (!response.ok) throw new Error(`Failed to get transcript: ${await response.text()}`);
    return await response.json();
  }

  /**
   * Wait for transcript completion — uses webhook if APP_BASE_URL is set, falls back to polling.
   * Webhook mode is faster (no polling delay) and uses fewer API calls.
   */
  async waitForTranscript(transcriptId: string): Promise<AssemblyAIResponse> {
    if (isWebhookModeEnabled()) {
      logger.info("Waiting for AssemblyAI webhook callback (timeout 10 min)", { transcriptId });
      try {
        const result = await new Promise<AssemblyAIResponse>((resolve, reject) => {
          const WEBHOOK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
          const timeout = setTimeout(() => {
            pendingWebhookTranscripts.delete(transcriptId);
            reject(new Error("Webhook timeout — falling back to polling"));
          }, WEBHOOK_TIMEOUT_MS);

          pendingWebhookTranscripts.set(transcriptId, { resolve, reject, timeout });
        });
        logger.info("AssemblyAI webhook callback received", { transcriptId, status: result.status });
        return result;
      } catch (webhookErr) {
        logger.warn("AssemblyAI webhook failed, falling back to polling", { transcriptId, error: (webhookErr as Error).message });
        // Fall through to polling
      }
    }
    return this.pollTranscript(transcriptId);
  }

  async pollTranscript(transcriptId: string, maxAttempts?: number): Promise<AssemblyAIResponse> {
    // A9/F13: env-configurable poll ceiling. Attempts run at 3s×10 + 5s×N ≈ 30s + 5s per extra.
    // ASSEMBLYAI_POLL_MAX_MINUTES * 12 gives the attempt count (since average ≈ 5s).
    if (maxAttempts === undefined) {
      const parsed = Number(process.env.ASSEMBLYAI_POLL_MAX_MINUTES);
      const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
      maxAttempts = Math.max(10, Math.ceil(minutes * 12));
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transcript = await this.getTranscript(transcriptId);

      if (transcript.status === 'completed') {
        return transcript;
      }
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error || 'Unknown error'}`);
      }

      // Wait with backoff: 3s for first 10 attempts, then 5s
      const delay = attempt < 10 ? 3000 : 5000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Transcription polling timed out');
  }

  processTranscriptData(
    transcriptResponse: AssemblyAIResponse,
    aiAnalysis: CallAnalysis | null,
    callId: string,
    agentSpeakerLabel?: string,
  ): { transcript: InsertTranscript; sentiment: InsertSentimentAnalysis; analysis: InsertCallAnalysis } {
    // Build transcript record
    const transcript: InsertTranscript = {
      callId,
      text: transcriptResponse.text || '',
      confidence: transcriptResponse.confidence?.toString(),
      words: transcriptResponse.words || [],
    };

    // Determine sentiment: prefer AI analysis, fall back to AssemblyAI sentiment results
    let overallSentiment = aiAnalysis?.sentiment || 'neutral';
    let overallScore = aiAnalysis?.sentiment_score ?? 0.5;

    // If no AI analysis, derive sentiment from AssemblyAI's built-in sentiment results
    if (!aiAnalysis && transcriptResponse.sentiment_analysis_results?.length) {
      const sentiments = transcriptResponse.sentiment_analysis_results;
      const positiveCount = sentiments.filter(s => s.sentiment === 'POSITIVE').length;
      const negativeCount = sentiments.filter(s => s.sentiment === 'NEGATIVE').length;
      const total = sentiments.length;

      if (positiveCount > total * 0.5) overallSentiment = 'positive';
      else if (negativeCount > total * 0.3) overallSentiment = 'negative';
      else overallSentiment = 'neutral';

      const avgConfidence = total > 0
        ? sentiments.reduce((sum, s) => {
            const weight = s.sentiment === 'POSITIVE' ? s.confidence : s.sentiment === 'NEGATIVE' ? (1 - s.confidence) : 0.5;
            return sum + weight;
          }, 0) / total
        : 0.5;
      overallScore = Math.round(avgConfidence * 100) / 100;
    }

    const sentiment: InsertSentimentAnalysis = {
      callId,
      overallSentiment,
      overallScore: overallScore.toString(),
      segments: transcriptResponse.sentiment_analysis_results || [],
    };

    // Build analysis record
    const rawScore = aiAnalysis?.performance_score ?? 5.0;
    const calConfig = getCalibrationConfig();
    const performanceScore = calibrateScore(rawScore, calConfig);
    const calibratedSubScores = aiAnalysis?.sub_scores
      ? calibrateSubScores(aiAnalysis.sub_scores, calConfig)
      : undefined;
    const words = transcriptResponse.words || [];

    // Calculate talk time ratio only when we know which speaker is the agent.
    // A4/F06: previously assumed Speaker A was always the agent, producing
    // misleading 0.5 fallbacks. Returns null when the agent label is unknown.
    let talkTimeRatio: number | null = null;
    if (agentSpeakerLabel && words.length > 0) {
      const agentTime = words
        .filter((w: TranscriptWord) => w.speaker === agentSpeakerLabel)
        .reduce((sum: number, w: TranscriptWord) => sum + (w.end - w.start), 0);
      const totalTime = words[words.length - 1].end - words[0].start;
      if (totalTime > 0) {
        talkTimeRatio = Math.round((agentTime / totalTime) * 100) / 100;
      }
    }

    // Determine flags (using calibrated score thresholds)
    const flags: string[] = aiAnalysis?.flags || [];
    const scoreFlags = getScoreFlags(performanceScore, calConfig);
    for (const flag of scoreFlags) {
      if (!flags.includes(flag)) flags.push(flag);
    }

    // Normalize array fields from AI — coerce any objects to strings
    const normalizeStringArray = (arr: unknown, fieldName?: string): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr.map((item: unknown) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.name === "string") return obj.name;
          if (typeof obj.task === "string") return obj.task;
          // Unknown object shape — log for debugging, stringify as fallback
          logger.warn("Unexpected object shape in AI array field", { callId, field: fieldName || "array", keys: Object.keys(obj) });
          return JSON.stringify(item);
        }
        return String(item ?? "");
      });
    };

    const analysis: InsertCallAnalysis = {
      callId,
      performanceScore: performanceScore.toString(),
      talkTimeRatio: talkTimeRatio !== null ? talkTimeRatio.toString() : undefined,
      responseTime: undefined,
      keywords: normalizeStringArray(aiAnalysis?.topics, "topics"),
      topics: normalizeStringArray(aiAnalysis?.topics, "topics"),
      summary: typeof aiAnalysis?.summary === "string" ? aiAnalysis.summary : (aiAnalysis?.summary ? JSON.stringify(aiAnalysis.summary) : transcriptResponse.text?.slice(0, 500) || ''),
      actionItems: normalizeStringArray(aiAnalysis?.action_items, "action_items"),
      feedback: aiAnalysis?.feedback
        ? {
            strengths: (aiAnalysis.feedback.strengths || []).map(
              (s: unknown) => typeof s === "string" ? s : (s && typeof s === "object" && "text" in (s as Record<string, unknown>) ? (s as { text: string }).text : JSON.stringify(s))
            ),
            suggestions: (aiAnalysis.feedback.suggestions || []).map(
              (s: unknown) => typeof s === "string" ? s : (s && typeof s === "object" && "text" in (s as Record<string, unknown>) ? (s as { text: string }).text : JSON.stringify(s))
            ),
          }
        : { strengths: [], suggestions: [] },
      lemurResponse: undefined,
      callPartyType: typeof aiAnalysis?.call_party_type === "string" ? aiAnalysis.call_party_type : undefined,
      flags: flags.length > 0 ? normalizeStringArray(flags) : undefined,
    };

    return { transcript, sentiment, analysis };
  }
}

/**
 * Build a speaker-labeled transcript from word-level data.
 * Groups consecutive words by the same speaker into utterances.
 * Returns formatted text like "Speaker A: Hello, how can I help?\nSpeaker B: Hi, I need..."
 */
export function buildSpeakerLabeledTranscript(words: TranscriptWord[]): string {
  if (!words || words.length === 0) return "";

  const lines: string[] = [];
  let currentSpeaker = words[0].speaker || "?";
  let currentWords: string[] = [words[0].text];

  for (let i = 1; i < words.length; i++) {
    const speaker = words[i].speaker || "?";
    if (speaker !== currentSpeaker) {
      lines.push(`Speaker ${currentSpeaker}: ${currentWords.join(" ")}`);
      currentSpeaker = speaker;
      currentWords = [words[i].text];
    } else {
      currentWords.push(words[i].text);
    }
  }
  lines.push(`Speaker ${currentSpeaker}: ${currentWords.join(" ")}`);

  return lines.join("\n");
}

/**
 * Utterance-level metrics computed from word-level speaker/timing data.
 */
export interface UtteranceMetrics {
  interruptionCount: number;
  avgResponseLatencyMs: number;
  monologueSegments: number; // segments > 60s by one speaker
  questionCount: number;
  speakerATalkTimeMs: number;
  speakerBTalkTimeMs: number;
}

/**
 * Compute utterance-level metrics from word-level data.
 * - Interruption: speaker changes while previous speaker's word gap < 200ms
 * - Response latency: gap between last word of speaker A and first word of speaker B
 * - Monologue: continuous speech by one speaker > 60 seconds
 * - Question density: count of sentences ending with "?"
 */
export function computeUtteranceMetrics(words: TranscriptWord[]): UtteranceMetrics {
  if (!words || words.length < 2) {
    return { interruptionCount: 0, avgResponseLatencyMs: 0, monologueSegments: 0, questionCount: 0, speakerATalkTimeMs: 0, speakerBTalkTimeMs: 0 };
  }

  // NaN-safe env reads (A5/F01)
  const parsedMonologue = Number(process.env.MONOLOGUE_DURATION_MS);
  const monologueDurationMs = Number.isFinite(parsedMonologue) && parsedMonologue > 0 ? parsedMonologue : 60000;
  const parsedGap = Number(process.env.INTERRUPTION_GAP_MS);
  const interruptionGapMs = Number.isFinite(parsedGap) && parsedGap >= 0 ? parsedGap : 200;

  let interruptionCount = 0;
  const responseTimes: number[] = [];
  let monologueSegments = 0;
  let questionCount = 0;

  // Track speaker talk time
  let speakerATalkTimeMs = 0;
  let speakerBTalkTimeMs = 0;

  // Track current speaker segment
  let segmentStart = words[0].start;
  let segmentSpeaker = words[0].speaker || "?";
  let lastWordEnd = words[0].end;

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const speaker = word.speaker || "?";

    if (speaker !== segmentSpeaker) {
      // Speaker changed — compute segment duration
      const segmentDuration = lastWordEnd - segmentStart;
      if (segmentSpeaker === "A") speakerATalkTimeMs += segmentDuration;
      else speakerBTalkTimeMs += segmentDuration;

      if (segmentDuration > monologueDurationMs) monologueSegments++;

      // Check for interruption: overlap or very short gap
      const gap = word.start - lastWordEnd;
      if (gap < interruptionGapMs) {
        interruptionCount++;
      }

      // Response latency (only count positive gaps)
      if (gap > 0) {
        responseTimes.push(gap);
      }

      segmentStart = word.start;
      segmentSpeaker = speaker;
    }

    lastWordEnd = word.end;

    // Count questions
    if (word.text.endsWith("?")) {
      questionCount++;
    }
  }

  // Final segment
  const finalDuration = lastWordEnd - segmentStart;
  if (segmentSpeaker === "A") speakerATalkTimeMs += finalDuration;
  else speakerBTalkTimeMs += finalDuration;
  if (finalDuration > monologueDurationMs) monologueSegments++;

  const avgResponseLatencyMs = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  return {
    interruptionCount,
    avgResponseLatencyMs,
    monologueSegments,
    questionCount,
    speakerATalkTimeMs,
    speakerBTalkTimeMs,
  };
}

export const assemblyAIService = new AssemblyAIService();
