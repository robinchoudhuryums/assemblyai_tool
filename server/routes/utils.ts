import fs from "fs";
import type { Request, Response, NextFunction, RequestHandler } from "express";

// ── Path Parameter Validation ────────────────────────────────────────
// Reusable middleware to reject malformed route params early, before they
// reach database queries. Prevents timing attacks, confusing DB errors,
// and potential injection via params that bypass body validation.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[\w-]{1,255}$/; // alphanumeric, underscores, hyphens
const SAFE_NAME_RE = /^[\w\s.'\-,&()]{1,255}$/; // team/employee names (allows spaces, punctuation)

/** Validate that specific req.params match expected formats. */
export function validateParams(
  specs: Record<string, "uuid" | "safeId" | "safeName">
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const [param, format] of Object.entries(specs)) {
      const value = req.params[param];
      if (value === undefined) continue; // optional param not present

      let valid = false;
      switch (format) {
        case "uuid":
          valid = UUID_RE.test(value);
          break;
        case "safeId":
          valid = SAFE_ID_RE.test(value);
          break;
        case "safeName":
          try {
            valid = SAFE_NAME_RE.test(decodeURIComponent(value));
          } catch {
            // Malformed percent-encoding (URIError) → reject as invalid
            valid = false;
          }
          break;
      }

      if (!valid) {
        res.status(400).json({ message: `Invalid ${param} parameter` });
        return;
      }
    }
    next();
  };
}

/** Shorthand: validate that :id is a valid UUID. */
export const validateIdParam = validateParams({ id: "uuid" });

// ── Standardized Error Responses ─────────────────────────────────────
// All API error responses follow a consistent shape:
//   { message: string, errors?: unknown }
// This makes client-side error handling predictable.

import { type ZodError } from "zod";

/** Send a JSON error response with a consistent shape. */
export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

/** Send a 400 with Zod validation errors (always uses .flatten() for consistency). */
export function sendValidationError(res: Response, message: string, zodError: ZodError): void {
  res.status(400).json({ message, errors: zodError.flatten() });
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

/** Safe parseFloat that returns fallback on NaN. Accepts string or number input. */
export function safeFloat(value: string | number | undefined | null, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseFloat(value);
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

// --- Shared Route Helpers ---
// Extracted from duplicate implementations across routes to ensure consistency.

/**
 * Escape a value for CSV output, preventing formula injection.
 * Prefixes formula-triggering characters (=, +, -, @, tab, CR) with a single quote,
 * then wraps in double quotes if the value contains commas, quotes, or newlines.
 */
export function escapeCsvValue(val: unknown): string {
  let s = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(s)) { s = "'" + s; }
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Filter calls by date range (in-memory). Adjusts `to` date to end-of-day.
 * Used by reports, snapshots, and search — the single source of truth for date filtering.
 */
export function filterCallsByDateRange<T extends { uploadedAt?: string | null }>(
  calls: T[],
  from?: string | Date,
  to?: string | Date,
): T[] {
  let result = calls;
  const fromDate = from ? (from instanceof Date ? from : parseDate(from as string)) : undefined;
  const toDate = to ? (to instanceof Date ? to : parseDate(to as string)) : undefined;

  if (fromDate) {
    result = result.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
  }
  if (toDate) {
    const endOfDay = new Date(toDate);
    endOfDay.setHours(23, 59, 59, 999);
    result = result.filter(c => new Date(c.uploadedAt || 0) <= endOfDay);
  }
  return result;
}

/** Count frequency of items in a string array. Returns top N entries sorted by count. */
export function countFrequency(arr: string[], limit = 10): Array<{ text: string; count: number }> {
  const freq = new Map<string, number>();
  for (const item of arr) {
    const normalized = item.trim().toLowerCase();
    if (normalized) freq.set(normalized, (freq.get(normalized) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

/** Calculate sentiment breakdown from an array of calls with sentiment data. */
export function calculateSentimentBreakdown(calls: Array<{ sentiment?: { overallSentiment?: string } | null }>): { positive: number; neutral: number; negative: number } {
  const result = { positive: 0, neutral: 0, negative: 0 };
  for (const c of calls) {
    const s = c.sentiment?.overallSentiment as keyof typeof result | undefined;
    if (s && s in result) result[s]++;
  }
  return result;
}

/** Calculate average score from an array of values, with configurable decimal places. Returns null if no valid scores. */
export function calculateAvgScore(scores: number[], decimals = 2): number | null {
  const valid = scores.filter(s => Number.isFinite(s) && s > 0);
  if (valid.length === 0) return null;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const factor = Math.pow(10, decimals);
  return Math.round(avg * factor) / factor;
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

/**
 * Concurrency-limited task queue for expensive async operations.
 *
 * Bounds (A11/F16/F76):
 * - `concurrency`: max parallel tasks
 * - `maxQueueSize`: max queued (non-running) tasks; new add() rejects with
 *   QueueFullError when exceeded — backpressure for callers (return 503).
 * - `taskTimeoutMs`: per-task wall clock; rejects with TaskTimeoutError on
 *   expiry. Tasks needing >10min should use the durable PostgreSQL job queue.
 */
export class QueueFullError extends Error {
  constructor() { super("Task queue is full"); this.name = "QueueFullError"; }
}
export class TaskTimeoutError extends Error {
  constructor() { super("Task exceeded timeout"); this.name = "TaskTimeoutError"; }
}

export class TaskQueue {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(
    private concurrency: number,
    private maxQueueSize: number = 1000,
    private taskTimeoutMs: number = 10 * 60 * 1000,
  ) {}
  add<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency && this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new QueueFullError());
    }
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new TaskTimeoutError()), this.taskTimeoutMs);
        });
        Promise.race([fn(), timeoutPromise])
          .then(resolve as (v: unknown) => void, reject)
          .finally(() => {
            if (timer) clearTimeout(timer);
            this.running--;
            if (this.queue.length > 0) this.queue.shift()!();
          });
      };
      if (this.running < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}
