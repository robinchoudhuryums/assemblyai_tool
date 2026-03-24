import fs from "fs";
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async route handler so unhandled promise rejections are forwarded
 * to Express error middleware. Express 4 doesn't do this natively.
 * Usage: router.get("/api/foo", asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Parse an integer query param with bounds, returning defaultVal on NaN/missing. */
export function clampInt(value: string | undefined, defaultVal: number, min: number, max: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultVal : Math.max(min, Math.min(n, max));
}

/** Parse a date query param, returning undefined if invalid. */
export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Safe parseFloat that returns fallback on NaN. */
export function safeFloat(value: string | undefined | null, fallback = 0): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/** Safe JSON.parse that returns fallback on failure. */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Delete uploaded file after processing */
export async function cleanupFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Failed to cleanup file:', error);
  }
}

// --- Confidence Score Calculation ---
// Shared formula used by both real-time pipeline and batch inference.
// Weights: transcript accuracy (40%) + word density (20%) + call duration (15%) + AI completeness (25%)

export interface ConfidenceInput {
  transcriptConfidence: number;  // 0-1, from AssemblyAI
  wordCount: number;             // number of words in transcript
  callDurationSeconds: number;   // call length in seconds
  hasAiAnalysis: boolean;        // whether AI (Bedrock) analysis was completed
}

export interface ConfidenceResult {
  score: number;
  factors: {
    transcriptConfidence: number;
    wordCount: number;
    callDurationSeconds: number;
    transcriptLength: number;
    aiAnalysisCompleted: boolean;
    overallScore: number;
  };
}

export function computeConfidenceScore(input: ConfidenceInput, transcriptLength: number): ConfidenceResult {
  const { wordCount, callDurationSeconds, hasAiAnalysis } = input;
  // Guard against NaN/undefined inputs — default to 0 so the score degrades gracefully
  const safeTranscriptConf = Number.isFinite(input.transcriptConfidence) ? input.transcriptConfidence : 0;
  const safeWordCount = Number.isFinite(wordCount) ? wordCount : 0;
  const safeDuration = Number.isFinite(callDurationSeconds) ? callDurationSeconds : 0;

  const wordConfidence = Math.min(safeWordCount / 50, 1);
  const durationConfidence = safeDuration > 30 ? 1 : safeDuration / 30;
  const aiConfidence = hasAiAnalysis ? 1 : 0.3;

  const score = (
    safeTranscriptConf * 0.4 +
    wordConfidence * 0.2 +
    durationConfidence * 0.15 +
    aiConfidence * 0.25
  );

  return {
    score,
    factors: {
      transcriptConfidence: Math.round(safeTranscriptConf * 100) / 100,
      wordCount: safeWordCount,
      callDurationSeconds: safeDuration,
      transcriptLength,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(score * 100) / 100,
    },
  };
}

// --- Auto-Assign Employee ---
// Shared logic: detect agent name → find matching employee → atomic assign.

export async function autoAssignEmployee(
  callId: string,
  detectedAgentName: string,
  storage: { findEmployeeByName(name: string): Promise<{ id: string; name: string } | undefined>; atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean> },
  logPrefix = "",
): Promise<{ assigned: boolean; employeeName?: string }> {
  const detectedName = detectedAgentName.trim();
  const matchedEmployee = await storage.findEmployeeByName(detectedName);

  if (!matchedEmployee) {
    console.log(`${logPrefix}Detected agent name "${detectedName}" but no matching employee found.`);
    return { assigned: false };
  }

  const assigned = await storage.atomicAssignEmployee(callId, matchedEmployee.id);
  if (assigned) {
    console.log(`${logPrefix}Auto-assigned to employee: ${matchedEmployee.name} (${matchedEmployee.id})`);
    return { assigned: true, employeeName: matchedEmployee.name };
  }

  console.log(`${logPrefix}Call already assigned, skipping auto-assign.`);
  return { assigned: false };
}

/** Estimate Bedrock cost based on model and token counts. Prices per 1K tokens (input/output).
 *  Note: When BEDROCK_BATCH_MODE=true, actual cost is 50% of these rates. */
export function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, [number, number]> = {
    "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
    "us.anthropic.claude-sonnet-4-20250514": [0.003, 0.015],
    "us.anthropic.claude-haiku-4-5-20251001": [0.001, 0.005],
    "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
    "anthropic.claude-3-5-sonnet-20241022": [0.003, 0.015],
  };
  const [inputRate, outputRate] = pricing[model] || [0.003, 0.015];
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

/** Estimate AssemblyAI cost: base $0.15/hr + sentiment $0.02/hr = $0.17/hr = ~$0.0000472/sec
 *  When sentiment is disabled (non-English): $0.15/hr = ~$0.0000417/sec */
export function estimateAssemblyAICost(durationSeconds: number, sentimentEnabled = true): number {
  const ratePerSecond = sentimentEnabled ? 0.0000472 : 0.0000417;
  return durationSeconds * ratePerSecond;
}

/** Estimate Bedrock Titan Embed cost: $0.00002 per 1K tokens */
export function estimateEmbeddingCost(textLength: number): number {
  const estimatedTokens = Math.ceil(textLength / 4);
  return (estimatedTokens / 1000) * 0.00002;
}

/** Concurrency-limited task queue for expensive async operations. */
export class TaskQueue {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private concurrency: number) {}
  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        fn().then(resolve, reject).finally(() => {
          this.running--;
          if (this.queue.length > 0) this.queue.shift()!();
        });
      };
      if (this.running < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}
