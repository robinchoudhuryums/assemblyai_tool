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
import { buildAnalysisPrompt, parseJsonResponse } from "./ai-provider";

const DEFAULT_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
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

  constructor() {
    this.model = process.env.BEDROCK_MODEL || DEFAULT_MODEL;

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
        region: process.env.AWS_REGION || DEFAULT_REGION,
      };
      console.log(`Bedrock provider initialized (region: ${this.credentials.region}, model: ${this.model})`);
    } else {
      console.warn("Bedrock provider: AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.");
    }
  }

  get isAvailable(): boolean {
    return this.credentials !== null;
  }

  async analyzeCallTranscript(transcriptText: string, callId: string): Promise<CallAnalysis> {
    if (!this.credentials) {
      throw new Error("Bedrock provider not configured");
    }

    const prompt = buildAnalysisPrompt(transcriptText);
    const region = this.credentials.region;
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
        maxTokens: 4096,
      },
    });

    console.log(`[${callId}] Calling Bedrock (${this.model}) for analysis...`);

    const headers = this.signRequest("POST", host, rawPath, body, region);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bedrock API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

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
