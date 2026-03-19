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
import { createHmac, createHash } from "crypto";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildAnalysisPrompt, parseJsonResponse } from "./ai-provider";
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials.js";

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";
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
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
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
    // Synchronous check: env vars set OR IMDS credentials already cached
    return this.credentials !== null || (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SECRET_ACCESS_KEY && !this.initialized);
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

    const headers = this.signRequest("POST", host, rawPath, body, region, creds);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });

      if (!response.ok) {
        const errorText = await response.text();
        // HIPAA: Truncate error to avoid leaking PHI in logs
        throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      return result.output?.message?.content?.[0]?.text || "";
    } finally {
      clearTimeout(timeout);
    }
  }

  async analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: any, language?: string): Promise<CallAnalysis> {
    const creds = await this.ensureCredentials();

    const prompt = buildAnalysisPrompt(transcriptText, callCategory, promptTemplate, language);
    const region = creds.region;
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    // Raw path for the HTTP request (no encoding — colons in model IDs are fine)
    const rawPath = `/model/${this.model}/converse`;
    const url = `https://${host}${rawPath}`;

    const body = JSON.stringify({
      messages: [
        { role: "user", content: [{ text: prompt }] },
      ],
      inferenceConfig: {
        temperature: 0.3,
        maxTokens: 2048,
      },
    });

    console.log(`[${callId}] Calling Bedrock (${this.model}) for analysis...`);

    const headers = this.signRequest("POST", host, rawPath, body, region, creds);
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
        // HIPAA: Truncate error to avoid leaking PHI in logs
        throw new Error(`Bedrock API error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      result = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    // Converse API response shape:
    // { output: { message: { role: "assistant", content: [{ text: "..." }] } } }
    const responseText = result.output?.message?.content?.[0]?.text || "";

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
    creds?: AwsCredentials,
  ): Record<string, string> {
    if (!creds) creds = this.credentials!;
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
