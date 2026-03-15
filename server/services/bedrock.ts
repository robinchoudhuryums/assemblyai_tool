/**
 * AWS Bedrock + Claude provider for call analysis.
 *
 * Authentication — uses AWS Signature V4 via standard env vars:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials / IAM roles)
 *
 * HIPAA: Bedrock is HIPAA-eligible under the AWS BAA.
 * Just ensure your AWS account has a BAA in place.
 *
 * Uses the Bedrock "Converse" API (no SDK needed, plain fetch + SigV4).
 */
import { createHmac, createHash } from "crypto";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildAnalysisPromptParts, parseJsonResponse } from "./ai-provider";

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
const DEFAULT_REGION = "us-east-1";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

export class BedrockProvider implements AIAnalysisProvider {
  readonly name = "bedrock";
  private credentials: AwsCredentials | null = null;
  private model: string;

  constructor(modelOverride?: string) {
    this.model = modelOverride || process.env.BEDROCK_MODEL || DEFAULT_MODEL;

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
        region: process.env.AWS_REGION || DEFAULT_REGION,
      };
      if (!modelOverride) {
        console.log(`Bedrock provider initialized (region: ${this.credentials.region}, model: ${this.model})`);
      }
    } else {
      console.warn("Bedrock provider: AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.");
    }
  }

  /** Create a provider instance targeting a specific Bedrock model (for A/B testing). */
  static createWithModel(modelId: string): BedrockProvider {
    return new BedrockProvider(modelId);
  }

  get modelId(): string {
    return this.model;
  }

  get isAvailable(): boolean {
    return this.credentials !== null;
  }

  async generateText(prompt: string): Promise<string> {
    if (!this.credentials) {
      throw new Error("Bedrock provider not configured");
    }

    const region = this.credentials.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
    });

    const headers = this.signRequest("POST", host, rawPath, body, region);
    const response = await fetch(url, { method: "POST", headers, body });

    if (!response.ok) {
      const errorText = await response.text();
      // HIPAA: Truncate error to avoid leaking PHI in logs
      throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    return result.output?.message?.content?.[0]?.text || "";
  }

  async analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: any): Promise<CallAnalysis> {
    if (!this.credentials) {
      throw new Error("Bedrock provider not configured");
    }

    const { system, user } = buildAnalysisPromptParts(transcriptText, callCategory, promptTemplate);
    const region = this.credentials.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    // Raw path for the HTTP request (no encoding — colons in model IDs are fine)
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    // Use Converse API system messages with cachePoint for prompt caching.
    // The static system instructions are identical across calls with the same
    // category/template, so Bedrock can cache and reuse them — reducing latency
    // and cost (cached input tokens are 90% cheaper).
    const body = JSON.stringify({
      system: [
        { text: system },
        { cachePoint: { type: "default" } },
      ],
      messages: [
        { role: "user", content: [{ text: user }] },
      ],
      inferenceConfig: {
        temperature: 0.3,
        maxTokens: 2048,
      },
    });

    console.log(`[${callId}] Calling Bedrock (${this.model}) for analysis (prompt caching enabled)...`);

    const headers = this.signRequest("POST", host, rawPath, body, region);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // HIPAA: Truncate error to avoid leaking PHI in logs
      throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

    // Log cache usage if available (Bedrock returns cache hit/miss metrics)
    const usage = result.usage;
    if (usage) {
      const cacheInfo = usage.cacheReadInputTokens
        ? `cache hit: ${usage.cacheReadInputTokens} tokens`
        : usage.cacheWriteInputTokens
          ? `cache write: ${usage.cacheWriteInputTokens} tokens`
          : "no cache";
      console.log(`[${callId}] Bedrock usage — input: ${usage.inputTokens || 0}, output: ${usage.outputTokens || 0}, ${cacheInfo}`);
    }

    const analysis = parseJsonResponse(responseText, callId);
    console.log(`[${callId}] Bedrock analysis complete (score: ${analysis.performance_score}/10, sentiment: ${analysis.sentiment})`);
    return analysis;
  }

  // --- AWS Signature V4 ---

  private signRequest(
    method: string,
    host: string,
    rawPath: string,
    body: string,
    region: string,
  ): Record<string, string> {
    const creds = this.credentials!;
    const service = "bedrock";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = sha256(body);

    // SigV4: canonical URI must have each path segment URI-encoded once
    const canonicalUri = rawPath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");

    // Headers must be sorted alphabetically by name for canonical form
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      (creds.sessionToken ? `x-amz-security-token:${creds.sessionToken}\n` : "");

    const signedHeaders = creds.sessionToken
      ? "content-type;host;x-amz-date;x-amz-security-token"
      : "content-type;host;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      "", // query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, service);
    const signature = hmacHex(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Host": host,
      "X-Amz-Date": amzDate,
      "Authorization": authHeader,
    };
    if (creds.sessionToken) {
      headers["X-Amz-Security-Token"] = creds.sessionToken;
    }
    return headers;
  }
}

// --- Crypto helpers ---

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
