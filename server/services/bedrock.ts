/**
 * AWS Bedrock + Claude provider for call analysis.
 *
 * Authentication (in priority order):
 *   1. AWS env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   2. EC2 instance profile via IMDSv2 (automatic on EC2)
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials / IAM roles)
 *
 * HIPAA: Bedrock is HIPAA-eligible under the AWS BAA.
 * Just ensure your AWS account has a BAA in place.
 *
 * Uses the Bedrock "Converse" API (no SDK needed, plain fetch + SigV4).
 */
import { createHash } from "crypto";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildAnalysisPrompt, parseJsonResponse } from "./ai-provider";
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials.js";
import { CircuitBreaker } from "./resilience";
import { withSpan } from "./trace-span";
import { signRequest, sha256Buffer } from "./sigv4.js";
import { logger } from "./logger";

// LRU cache for embeddings — avoids redundant Bedrock calls on re-analysis/retries.
// Keyed by content hash (SHA-256 of input text). Max 200 entries (~50KB per 256-dim vector).
const EMBEDDING_CACHE_MAX = 200;
const embeddingCache = new Map<string, number[]>();

function getEmbeddingCacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
const DEFAULT_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";
const DEFAULT_REGION = "us-east-1";

// A9/F12: env-configurable timeouts with NaN-safe defaults
function envIntMs(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const BEDROCK_TIMEOUT_MS = envIntMs("BEDROCK_TIMEOUT_MS", 120_000); // 2 min default
const BEDROCK_EMBEDDING_TIMEOUT_MS = envIntMs("BEDROCK_EMBEDDING_TIMEOUT_MS", 15_000);

// Shared circuit breaker for all Bedrock instances — prevents cascading failures
// when Bedrock is down. 5 failures → open for 30s → half-open test → close on success.
// Exported for use by bedrock-batch.ts so an outage detected on either the
// on-demand or batch path protects both (F-18).
export const bedrockCircuitBreaker = new CircuitBreaker("bedrock", 5, 30_000);

/**
 * F-17: Marker error for Bedrock 4xx (client errors — schema rejection,
 * malformed prompt, etc). The circuit breaker treats these as "not a sign
 * of an unhealthy upstream" and does NOT count them toward the failure
 * threshold. Otherwise a single bad prompt would brownout the entire
 * pipeline for 30 seconds. Surfacing the error to the caller is unchanged.
 */
export class BedrockClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BedrockClientError";
    this.status = status;
  }
}

/**
 * F-17: Predicate the circuit breaker uses to decide whether an error
 * should count toward the failure threshold. Client errors (4xx except
 * 429) are NOT counted; 5xx and 429 ARE counted (those indicate Bedrock
 * itself is unhealthy or rate-limiting us).
 */
export function isCircuitFailure(err: unknown): boolean {
  if (err instanceof BedrockClientError) return false;
  return true;
}

/** Expose circuit breaker state for operational health dashboard. */
export function getBedrockCircuitBreakerState() {
  return bedrockCircuitBreaker.getState();
}

export class BedrockProvider implements AIAnalysisProvider {
  readonly name = "bedrock";
  private credentials: AwsCredentials | null = null;
  private model: string;
  private initialized = false;

  constructor(modelOverride?: string) {
    this.model = modelOverride || process.env.BEDROCK_MODEL || DEFAULT_MODEL;

    // Synchronous check for env vars (fast path)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
        region: process.env.AWS_REGION || DEFAULT_REGION,
      };
      this.initialized = true;
      if (!modelOverride) {
        logger.info("Bedrock provider initialized", { region: this.credentials.region, model: this.model });
      }
    } else {
      if (!modelOverride) {
        logger.info("Bedrock provider: env vars not set, will try IMDS on first request");
      }
    }
  }

  /** Ensure credentials are loaded (env vars or IMDS). */
  private async ensureCredentials(): Promise<AwsCredentials> {
    // Re-fetch to pick up refreshed IMDS credentials
    const creds = await getAwsCredentials();
    if (creds) {
      this.credentials = creds;
      this.initialized = true;
      return creds;
    }
    // Refresh failed — fall back to last known good credentials if available
    // (mirrors the S3Client pattern for transient IMDS failures)
    if (this.credentials) {
      logger.warn("Bedrock credential refresh failed, using cached credentials", { model: this.model });
      return this.credentials;
    }
    throw new Error("Bedrock provider not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or attach an IAM instance profile.");
  }

  /** Create a provider instance targeting a specific Bedrock model (for A/B testing). */
  static createWithModel(modelId: string): BedrockProvider {
    return new BedrockProvider(modelId);
  }

  /**
   * Swap the underlying model at runtime (for A/B test promotion flow).
   * Credentials are preserved; only the `modelId` used in subsequent Converse
   * calls changes. Callers are expected to validate the model id against the
   * BEDROCK_MODEL_PRESETS whitelist before calling.
   */
  setModel(modelId: string): void {
    if (!modelId || typeof modelId !== "string") {
      throw new Error("setModel: modelId must be a non-empty string");
    }
    const prev = this.model;
    this.model = modelId;
    logger.info("Bedrock provider model updated", { previous: prev, next: modelId });
  }

  get modelId(): string {
    return this.model;
  }

  get isAvailable(): boolean {
    // A8/F07: honest check — credentials must already be loaded or env vars present.
    // Previous "optimistic" branch returned true when IMDS had not yet been tried,
    // which made callers log "AI provider not configured" only after a real request failed.
    return this.credentials !== null
      || !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  }

  async generateText(prompt: string): Promise<string> {
    return withSpan("bedrock.generateText", { model: this.model, promptChars: prompt.length }, async () => {
    const creds = await this.ensureCredentials();

    const region = creds.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
    });

    const headers = this.signBedrockRequest("POST", host, rawPath, body, region, creds);

    return bedrockCircuitBreaker.execute(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
      try {
        const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });

        if (!response.ok) {
          const errorText = await response.text();
          // HIPAA: Log full error server-side, throw sanitized message to prevent
          // AWS internals (account IDs, ARNs, model details) from reaching clients.
          logger.error("Bedrock API error", { status: response.status, error: errorText.substring(0, 300) });
          const statusCategory = response.status >= 500 ? "service unavailable" :
            response.status === 429 ? "rate limited" :
            response.status === 403 ? "access denied" : "request failed";
          // F-17: 4xx (except 429 throttling) signals a client problem — bad
          // prompt, schema rejection, etc. Throw BedrockClientError so the
          // circuit breaker doesn't count it toward the open threshold.
          // 5xx + 429 stay as plain Error so they DO count as upstream-health
          // failures.
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new BedrockClientError(response.status, `Bedrock API error (${response.status}): ${statusCategory}`);
          }
          throw new Error(`Bedrock API error (${response.status}): ${statusCategory}`);
        }

        const result = await response.json();
        return result.output?.message?.content?.[0]?.text || "";
      } finally {
        clearTimeout(timeout);
      }
    }, isCircuitFailure);
    }); // end withSpan
  }

  async analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: any, language?: string, callDurationSeconds?: number, hasFlags?: boolean, ragContext?: string): Promise<CallAnalysis> {
    return withSpan("bedrock.analyze", { callId, model: this.model, transcriptChars: transcriptText.length, hasRagContext: !!ragContext }, async (span) => {
    const creds = await this.ensureCredentials();

    const prompt = buildAnalysisPrompt(transcriptText, callCategory, promptTemplate, language, ragContext);
    const region = creds.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    // Raw path for the HTTP request (no encoding — colons in model IDs are fine)
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    // Conditional token limit: 4096 for long (>10min) or flagged calls, 2048 for routine
    const maxTokens = ((callDurationSeconds && callDurationSeconds > 600) || hasFlags) ? 4096 : 2048;

    const body = JSON.stringify({
      messages: [
        { role: "user", content: [{ text: prompt }] },
      ],
      inferenceConfig: {
        temperature: 0.3,
        maxTokens,
      },
    });

    logger.info("Calling Bedrock for analysis", { callId, model: this.model });

    const headers = this.signBedrockRequest("POST", host, rawPath, body, region, creds);

    const result = await bedrockCircuitBreaker.execute(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Bedrock API error", { status: response.status, error: errorText.substring(0, 300) });
          const statusCategory = response.status >= 500 ? "service unavailable" :
            response.status === 429 ? "rate limited" :
            response.status === 403 ? "access denied" : "request failed";
          throw new Error(`Bedrock API error (${response.status}): ${statusCategory}`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }, isCircuitFailure);

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

    const analysis = parseJsonResponse(responseText, callId, callDurationSeconds);
    span.setAttribute("score", analysis.performance_score || 0);
    span.setAttribute("sentiment", analysis.sentiment || "unknown");
    logger.info("Bedrock analysis complete", { callId, score: analysis.performance_score, sentiment: analysis.sentiment });
    return analysis;
    }); // end withSpan
  }

  /**
   * Generate a text embedding using Amazon Titan Embed v2.
   * Returns a 1024-dimensional float32 vector. Cost: $0.00002/1K tokens.
   * Used for call clustering — compute once per call, store in DB.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      // Check LRU cache first (avoids redundant Bedrock calls on re-analysis)
      // A13/F20: true LRU — delete-then-set on hit moves the entry to the
      // most-recently-used end (Map iteration order = insertion order).
      const cacheKey = getEmbeddingCacheKey(text);
      const cached = embeddingCache.get(cacheKey);
      if (cached) {
        embeddingCache.delete(cacheKey);
        embeddingCache.set(cacheKey, cached);
        return cached;
      }

      const creds = await this.ensureCredentials();
      const region = creds.region;
      const host = `bedrock-runtime.${region}.amazonaws.com`;
      const embeddingModel = process.env.BEDROCK_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
      const rawPath = `/model/${embeddingModel}/invoke`;
      const url = `https://${host}${rawPath}`;

      // Titan Embed v2 accepts up to 8192 tokens; truncate to ~6000 chars to stay safe
      const truncated = text.length > 6000 ? text.slice(0, 3000) + "\n...\n" + text.slice(-3000) : text;

      const body = JSON.stringify({
        inputText: truncated,
        dimensions: 256, // 256-dim is cheaper and sufficient for clustering
        normalize: true,
      });

      const headers = this.signBedrockRequest("POST", host, rawPath, body, region, creds);

      return bedrockCircuitBreaker.execute(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), BEDROCK_EMBEDDING_TIMEOUT_MS);
        try {
          const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
          if (!response.ok) {
            const errorText = await response.text();
            logger.warn("Bedrock embedding API error", { status: response.status, error: errorText.substring(0, 200) });
            return null;
          }
          const result = await response.json();
          const embedding = result.embedding || null;
          if (embedding) {
            if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
              const oldest = embeddingCache.keys().next().value;
              if (oldest) embeddingCache.delete(oldest);
            }
            embeddingCache.set(cacheKey, embedding);
          }
          return embedding;
        } finally {
          clearTimeout(timeout);
        }
      }, isCircuitFailure);
    } catch (error) {
      // Non-critical — clustering falls back to TF-IDF
      logger.warn("Bedrock embedding generation failed (non-critical)", { error: (error as Error).message });
      return null;
    }
  }

  // --- AWS Signature V4 (delegated to shared sigv4.ts) ---

  private signBedrockRequest(
    method: string,
    host: string,
    rawPath: string,
    body: string,
    region: string,
    creds?: AwsCredentials,
  ): Record<string, string> {
    if (!creds) creds = this.credentials!;
    return signRequest({
      method,
      host,
      rawPath,
      service: "bedrock",
      region,
      creds,
      body,
      extraHeaders: [["content-type", "application/json"]],
    });
  }
}
