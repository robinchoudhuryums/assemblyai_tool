/**
 * AWS Bedrock Batch Inference Service.
 *
 * When BEDROCK_BATCH_MODE=true, call analyses are deferred and processed
 * in batch at 50% cost reduction vs on-demand pricing.
 *
 * Flow:
 *   1. After transcription, the call prompt is saved to S3 as a pending batch item
 *   2. A scheduler runs every BATCH_INTERVAL_MINUTES (default 15), collects pending items,
 *      writes a JSONL input file to S3, and submits a CreateModelInvocationJob
 *   3. A poller checks running jobs; when complete, reads output from S3,
 *      parses results, and stores analyses for each call
 *
 * Requires IAM permissions: bedrock:CreateModelInvocationJob, bedrock:GetModelInvocationJob
 * Uses the Converse API format for batch input/output.
 */
import { createHmac, createHash } from "crypto";
import { randomUUID } from "crypto";
import { parseJsonResponse } from "./ai-provider";
import type { CallAnalysis } from "./ai-provider";

const BATCH_TIMEOUT_MS = 30_000; // 30s for batch management API calls

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

export interface PendingBatchItem {
  callId: string;
  prompt: string;
  callCategory?: string;
  uploadedBy?: string;
  timestamp: string;
}

export interface BatchJob {
  jobId: string;
  jobArn: string;
  status: "Submitted" | "InProgress" | "Completed" | "Failed" | "Stopping" | "Stopped" | "Expired" | "Validating" | "Scheduled";
  inputS3Uri: string;
  outputS3Uri: string;
  callIds: string[]; // track which calls are in this batch
  createdAt: string;
}

export class BedrockBatchService {
  private credentials: AwsCredentials | null = null;
  private model: string;
  private bucketName: string;

  constructor() {
    this.model = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
    this.bucketName = process.env.S3_BUCKET || "ums-call-archive";

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
        region: process.env.AWS_REGION || "us-east-1",
      };
    }
  }

  get isAvailable(): boolean {
    return this.credentials !== null && process.env.BEDROCK_BATCH_MODE === "true";
  }

  /**
   * Build a JSONL input file from pending batch items and upload to S3.
   * Each line is a Converse API format request with a recordId.
   */
  async createBatchInput(items: PendingBatchItem[]): Promise<{ s3Uri: string; batchId: string }> {
    const batchId = `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const lines = items.map(item => JSON.stringify({
      recordId: item.callId,
      modelInput: {
        messages: [{ role: "user", content: [{ text: item.prompt }] }],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      },
    }));

    const jsonlContent = lines.join("\n");
    const key = `batch-inference/input/${batchId}.jsonl`;
    const s3Uri = `s3://${this.bucketName}/${key}`;

    // Upload JSONL to S3 using raw PUT
    await this.s3Put(key, Buffer.from(jsonlContent, "utf-8"), "application/jsonl");
    console.log(`[BATCH] Uploaded input file: ${s3Uri} (${items.length} items, ${jsonlContent.length} bytes)`);

    return { s3Uri, batchId };
  }

  /**
   * Submit a batch inference job to Bedrock.
   */
  async createJob(inputS3Uri: string, batchId: string, callIds: string[]): Promise<BatchJob> {
    if (!this.credentials) throw new Error("Bedrock batch not configured");

    const outputS3Uri = `s3://${this.bucketName}/batch-inference/output/${batchId}/`;
    const region = this.credentials.region;
    const host = `bedrock.${region}.amazonaws.com`;
    const path = "/model-invocation-job";

    const body = JSON.stringify({
      jobName: batchId,
      modelId: this.model,
      roleArn: process.env.BEDROCK_BATCH_ROLE_ARN,
      inputDataConfig: {
        s3InputDataConfig: {
          s3Uri: inputS3Uri,
          s3InputFormat: "JSONL",
        },
      },
      outputDataConfig: {
        s3OutputDataConfig: {
          s3Uri: outputS3Uri,
        },
      },
      modelInvocationType: "Converse",
    });

    const headers = this.signRequest("POST", host, path, body, region, "bedrock");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

    try {
      const response = await fetch(`https://${host}${path}`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bedrock CreateModelInvocationJob failed (${response.status}): ${errorText.substring(0, 300)}`);
      }

      const result = await response.json() as { jobArn: string };
      const jobId = result.jobArn.split("/").pop() || batchId;

      console.log(`[BATCH] Job created: ${jobId} (${callIds.length} calls)`);

      return {
        jobId,
        jobArn: result.jobArn,
        status: "Submitted",
        inputS3Uri,
        outputS3Uri,
        callIds,
        createdAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check the status of a batch inference job.
   */
  async getJobStatus(jobArn: string): Promise<{ status: BatchJob["status"]; message?: string }> {
    if (!this.credentials) throw new Error("Bedrock batch not configured");

    const region = this.credentials.region;
    const host = `bedrock.${region}.amazonaws.com`;
    const jobId = jobArn.split("/").pop();
    const path = `/model-invocation-job/${jobId}`;

    const headers = this.signRequest("GET", host, path, "", region, "bedrock");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

    try {
      const response = await fetch(`https://${host}${path}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bedrock GetModelInvocationJob failed (${response.status}): ${errorText.substring(0, 300)}`);
      }

      const result = await response.json() as { status: BatchJob["status"]; message?: string };
      return { status: result.status, message: result.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Read batch output from S3 and parse results.
   * Returns a map of callId → CallAnalysis.
   */
  async readBatchOutput(outputS3Uri: string): Promise<Map<string, CallAnalysis>> {
    const results = new Map<string, CallAnalysis>();

    // Parse bucket and prefix from s3:// URI
    const uriPath = outputS3Uri.replace(`s3://${this.bucketName}/`, "");

    // List output files (Bedrock writes .jsonl.out files)
    const outputFiles = await this.s3List(uriPath);
    console.log(`[BATCH] Found ${outputFiles.length} output files under ${uriPath}`);

    for (const file of outputFiles) {
      if (!file.endsWith(".jsonl.out")) continue;

      const content = await this.s3Get(file);
      if (!content) continue;

      const lines = content.toString("utf-8").split("\n").filter(l => l.trim());
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as {
            recordId: string;
            modelOutput?: { output?: { message?: { content?: Array<{ text: string }> } } };
            error?: string;
          };

          if (record.error) {
            console.warn(`[BATCH] Error for call ${record.recordId}: ${record.error}`);
            continue;
          }

          const responseText = record.modelOutput?.output?.message?.content?.[0]?.text;
          if (!responseText) {
            console.warn(`[BATCH] Empty response for call ${record.recordId}`);
            continue;
          }

          const analysis = parseJsonResponse(responseText, record.recordId);
          results.set(record.recordId, analysis);
        } catch (parseErr) {
          console.warn(`[BATCH] Failed to parse output line: ${(parseErr as Error).message}`);
        }
      }
    }

    return results;
  }

  // --- S3 helpers (reuse credentials, minimal implementation) ---

  private async s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.credentials) throw new Error("Not configured");
    const region = this.credentials.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;
    const path = `/${key}`;

    const headers = this.signS3Request("PUT", host, path, region, body, contentType);
    const response = await fetch(`https://${host}${path}`, { method: "PUT", headers, body });
    if (!response.ok) {
      throw new Error(`S3 PUT failed for ${key}: ${await response.text()}`);
    }
  }

  private async s3Get(key: string): Promise<Buffer | undefined> {
    if (!this.credentials) throw new Error("Not configured");
    const region = this.credentials.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;
    const path = `/${key}`;

    const headers = this.signS3Request("GET", host, path, region);
    const response = await fetch(`https://${host}${path}`, { method: "GET", headers });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`S3 GET failed for ${key}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async s3List(prefix: string): Promise<string[]> {
    if (!this.credentials) throw new Error("Not configured");
    const region = this.credentials.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;
    const qs = `list-type=2&prefix=${encodeURIComponent(prefix)}`;

    const headers = this.signS3Request("GET", host, "/", region, undefined, undefined, qs);
    const response = await fetch(`https://${host}/?${qs}`, { method: "GET", headers });
    if (!response.ok) throw new Error(`S3 LIST failed: ${await response.text()}`);

    const xml = await response.text();
    const keys: string[] = [];
    const matches = xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g);
    for (const m of matches) keys.push(m[1]);
    return keys;
  }

  // --- SigV4 signing ---

  private signRequest(
    method: string, host: string, rawPath: string, body: string,
    region: string, service: string,
  ): Record<string, string> {
    const creds = this.credentials!;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(body);

    const canonicalUri = rawPath.split("/").map(seg => encodeURIComponent(seg)).join("/");

    const canonicalHeaders =
      `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n` +
      (creds.sessionToken ? `x-amz-security-token:${creds.sessionToken}\n` : "");

    const signedHeaders = creds.sessionToken
      ? "content-type;host;x-amz-date;x-amz-security-token"
      : "content-type;host;x-amz-date";

    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, service);
    const signature = hmacHex(signingKey, stringToSign);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Host": host,
      "X-Amz-Date": amzDate,
      "Authorization": `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (creds.sessionToken) headers["X-Amz-Security-Token"] = creds.sessionToken;
    return headers;
  }

  private signS3Request(
    method: string, host: string, rawPath: string, region: string,
    body?: Buffer, contentType?: string, queryString?: string,
  ): Record<string, string> {
    const creds = this.credentials!;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = body
      ? createHash("sha256").update(body).digest("hex")
      : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const canonicalUri = rawPath.split("/").map(seg => encodeURIComponent(seg)).join("/");

    const headerEntries: [string, string][] = [
      ["host", host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
    ];
    if (contentType) headerEntries.push(["content-type", contentType]);
    if (creds.sessionToken) headerEntries.push(["x-amz-security-token", creds.sessionToken]);
    if (method === "PUT") headerEntries.push(["x-amz-server-side-encryption", "AES256"]);
    headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
    const signedHeaders = headerEntries.map(([k]) => k).join(";");

    const canonicalRequest = [method, canonicalUri, queryString || "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, "s3");
    const signature = hmacHex(signingKey, stringToSign);

    const result: Record<string, string> = {
      "Host": host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      "Authorization": `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (contentType) result["Content-Type"] = contentType;
    if (creds.sessionToken) result["X-Amz-Security-Token"] = creds.sessionToken;
    if (method === "PUT") result["X-Amz-Server-Side-Encryption"] = "AES256";
    return result;
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

export const bedrockBatchService = new BedrockBatchService();
