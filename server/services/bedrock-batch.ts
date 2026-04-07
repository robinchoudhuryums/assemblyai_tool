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
import { randomUUID } from "crypto";
import { parseJsonResponse } from "./ai-provider";
import type { CallAnalysis } from "./ai-provider";
import { signRequest, sha256Buffer, EMPTY_PAYLOAD_HASH } from "./sigv4.js";
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials.js";
import { logger } from "./logger";

const BATCH_TIMEOUT_MS = 30_000; // 30s for batch management API calls

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
  private misconfigLogged = false;

  constructor() {
    this.model = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
    this.bucketName = process.env.S3_BUCKET || "ums-call-archive";
  }

  /**
   * Resolve credentials lazily via shared provider (env vars → IMDSv2).
   * A1/F02/F16: previously read env vars directly in constructor, breaking
   * EC2 instance-profile deployments.
   */
  private async ensureCredentials(): Promise<AwsCredentials> {
    if (this.credentials) return this.credentials;
    const creds = await getAwsCredentials();
    if (!creds) {
      throw new Error("Bedrock batch: no AWS credentials available (env vars or IMDS)");
    }
    this.credentials = creds;
    return creds;
  }

  /**
   * A1/F02: fail loudly when batch mode is on but BEDROCK_BATCH_ROLE_ARN is missing.
   * Returns false and logs once so callers gracefully fall back to on-demand instead
   * of submitting jobs that will be rejected by Bedrock with a less obvious error.
   */
  get isAvailable(): boolean {
    if (process.env.BEDROCK_BATCH_MODE !== "true") return false;
    if (!process.env.BEDROCK_BATCH_ROLE_ARN) {
      if (!this.misconfigLogged) {
        logger.error("BEDROCK_BATCH_MODE=true but BEDROCK_BATCH_ROLE_ARN is not set — batch mode disabled");
        this.misconfigLogged = true;
      }
      return false;
    }
    return true;
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

    // Upload JSONL to S3 using raw PUT.
    // A15/F19: Bedrock batch inference JSONL input — content-type per AWS docs:
    // https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-data.html
    await this.s3Put(key, Buffer.from(jsonlContent, "utf-8"), "application/jsonl");
    logger.info("Batch input uploaded", { s3Uri, itemCount: items.length, bytes: jsonlContent.length });

    return { s3Uri, batchId };
  }

  /**
   * Submit a batch inference job to Bedrock.
   */
  async createJob(inputS3Uri: string, batchId: string, callIds: string[]): Promise<BatchJob> {
    const creds = await this.ensureCredentials();
    if (!process.env.BEDROCK_BATCH_ROLE_ARN) {
      throw new Error("Bedrock batch: BEDROCK_BATCH_ROLE_ARN is not set");
    }

    const outputS3Uri = `s3://${this.bucketName}/batch-inference/output/${batchId}/`;
    const region = creds.region;
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

    const headers = signRequest({ method: "POST", host, rawPath: path, service: "bedrock", region, creds, body, extraHeaders: [["content-type", "application/json"]] });
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

      logger.info("Batch job created", { jobId, callCount: callIds.length });

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
    const creds = await this.ensureCredentials();

    const region = creds.region;
    const host = `bedrock.${region}.amazonaws.com`;
    const jobId = jobArn.split("/").pop();
    const path = `/model-invocation-job/${jobId}`;

    const headers = signRequest({ method: "GET", host, rawPath: path, service: "bedrock", region, creds, extraHeaders: [["content-type", "application/json"]] });
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
    logger.info("Batch output files located", { count: outputFiles.length, uriPath });

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
            logger.warn("Batch error for call", { callId: record.recordId, error: record.error });
            continue;
          }

          const responseText = record.modelOutput?.output?.message?.content?.[0]?.text;
          if (!responseText) {
            logger.warn("Batch empty response for call", { callId: record.recordId });
            continue;
          }

          const analysis = parseJsonResponse(responseText, record.recordId);
          results.set(record.recordId, analysis);
        } catch (parseErr) {
          logger.warn("Batch failed to parse output line", { error: (parseErr as Error).message });
        }
      }
    }

    return results;
  }

  // --- S3 helpers (reuse credentials, minimal implementation) ---

  // --- S3 helpers using shared sigv4 signing ---

  private signS3Headers(
    method: string, host: string, rawPath: string, region: string,
    body?: Buffer, contentType?: string, queryString?: string,
  ): Record<string, string> {
    const creds = this.credentials!;
    const payloadHash = body ? sha256Buffer(body) : EMPTY_PAYLOAD_HASH;

    const extraHeaders: [string, string][] = [["x-amz-content-sha256", payloadHash]];
    if (contentType) extraHeaders.push(["content-type", contentType]);
    if (method === "PUT") extraHeaders.push(["x-amz-server-side-encryption", "AES256"]);

    const headers = signRequest({ method, host, rawPath, queryString, service: "s3", region, creds, payloadHash, body, extraHeaders });
    headers["X-Amz-Content-Sha256"] = payloadHash;
    if (method === "PUT") headers["X-Amz-Server-Side-Encryption"] = "AES256";
    return headers;
  }

  private async s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureCredentials();
    const region = this.credentials!.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;
    const path = `/${key}`;

    const headers = this.signS3Headers("PUT", host, path, region, body, contentType);
    const response = await fetch(`https://${host}${path}`, { method: "PUT", headers, body: new Uint8Array(body) });
    if (!response.ok) {
      throw new Error(`S3 PUT failed for ${key}: ${await response.text()}`);
    }
  }

  private async s3Get(key: string): Promise<Buffer | undefined> {
    await this.ensureCredentials();
    const region = this.credentials!.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;
    const path = `/${key}`;

    const headers = this.signS3Headers("GET", host, path, region);
    const response = await fetch(`https://${host}${path}`, { method: "GET", headers });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`S3 GET failed for ${key}: ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async s3List(prefix: string): Promise<string[]> {
    await this.ensureCredentials();
    const region = this.credentials!.region;
    const host = `${this.bucketName}.s3.${region}.amazonaws.com`;

    // A3/F08: paginate via continuation token. Hard safety cap prevents
    // runaway loops if S3 returns an unexpected response shape.
    const MAX_PAGES = 50; // 50 pages × 1000 default = up to 50k keys
    const keys: string[] = [];
    let continuationToken: string | undefined;
    let page = 0;

    while (page < MAX_PAGES) {
      let qs = `list-type=2&prefix=${encodeURIComponent(prefix)}`;
      if (continuationToken) qs += `&continuation-token=${encodeURIComponent(continuationToken)}`;

      const headers = this.signS3Headers("GET", host, "/", region, undefined, undefined, qs);
      const response = await fetch(`https://${host}/?${qs}`, { method: "GET", headers });
      if (!response.ok) throw new Error(`S3 LIST failed: ${await response.text()}`);

      const xml = await response.text();
      const matches = xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g);
      for (const m of matches) keys.push(m[1]);

      const truncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
      const isTruncated = truncatedMatch?.[1] === "true";
      if (!isTruncated) break;

      const nextTokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      if (!nextTokenMatch) break; // truncated but no token — defensive break
      continuationToken = nextTokenMatch[1];
      page++;
    }

    if (page >= MAX_PAGES) {
      logger.warn("s3List hit safety cap; results may be incomplete", { maxPages: MAX_PAGES, prefix });
    }

    return keys;
  }
}

export const bedrockBatchService = new BedrockBatchService();
