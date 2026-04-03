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
import { signRequest, sha256Buffer } from "./sigv4.js";

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
const BEDROCK_TIMEOUT_MS = 120_000; // 2 minutes — prevents indefinite hangs

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
        console.log(`Bedrock provider initialized (region: ${this.credentials.region}, model: ${this.model})`);
      }
    } else {
      if (!modelOverride) {
        console.log("Bedrock provider: env vars not set, will try IMDS on first request");
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
    throw new Error("Bedrock provider not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or attach an IAM instance profile.");
  }

  /** Create a provider instance targeting a specific Bedrock model (for A/B testing). */
  static createWithModel(modelId: string): BedrockProvider {
    return new BedrockProvider(modelId);
  }

  get modelId(): string {
    return this.model;
  }

  get isAvailable(): boolean {
    // Synchronous check: credentials already loaded, env vars present, or IMDS not yet tried
    return this.credentials !== null
      || !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
      || !this.initialized; // optimistic: IMDS may succeed on first request
  }

  async generateText(prompt: string): Promise<string> {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });

      if (!response.ok) {
        const errorText = await response.text();
        // HIPAA: Log full error server-side, throw sanitized message to prevent
        // AWS internals (account IDs, ARNs, model details) from reaching clients.
        console.error(`[Bedrock] API error (${response.status}): ${errorText.substring(0, 300)}`);
        const statusCategory = response.status >= 500 ? "service unavailable" :
          response.status === 429 ? "rate limited" :
          response.status === 403 ? "access denied" : "request failed";
        throw new Error(`Bedrock API error (${response.status}): ${statusCategory}`);
      }

      const result = await response.json();
      return result.output?.message?.content?.[0]?.text || "";
    } finally {
      clearTimeout(timeout);
    }
  }

  async analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: any, language?: string, callDurationSeconds?: number, hasFlags?: boolean, ragContext?: string): Promise<CallAnalysis> {
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

    console.log(`[${callId}] Calling Bedrock (${this.model}) for analysis...`);

    const headers = this.signBedrockRequest("POST", host, rawPath, body, region, creds);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    let result: any;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        // HIPAA: Log full error server-side, throw sanitized message to prevent
        // AWS internals (account IDs, ARNs, model details) from reaching clients.
        console.error(`[Bedrock] API error (${response.status}): ${errorText.substring(0, 300)}`);
        const statusCategory = response.status >= 500 ? "service unavailable" :
          response.status === 429 ? "rate limited" :
          response.status === 403 ? "access denied" : "request failed";
        throw new Error(`Bedrock API error (${response.status}): ${statusCategory}`);
      }

      result = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

    const analysis = parseJsonResponse(responseText, callId, callDurationSeconds);
    console.log(`[${callId}] Bedrock analysis complete (score: ${analysis.performance_score}/10, sentiment: ${analysis.sentiment})`);
    return analysis;
  }

  /**
   * Generate a text embedding using Amazon Titan Embed v2.
   * Returns a 1024-dimensional float32 vector. Cost: $0.00002/1K tokens.
   * Used for call clustering — compute once per call, store in DB.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      // Check LRU cache first (avoids redundant Bedrock calls on re-analysis)
      const cacheKey = getEmbeddingCacheKey(text);
      const cached = embeddingCache.get(cacheKey);
      if (cached) return cached;

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout for embeddings
      try {
        const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`Embedding API error (${response.status}): ${errorText.substring(0, 200)}`);
          return null;
        }
        const result = await response.json();
        const embedding = result.embedding || null;
        if (embedding) {
          // LRU eviction: delete oldest entry if at capacity
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
    } catch (error) {
      // Non-critical — clustering falls back to TF-IDF
      console.warn("Embedding generation failed (non-critical):", (error as Error).message);
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
