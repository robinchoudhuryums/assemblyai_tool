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
