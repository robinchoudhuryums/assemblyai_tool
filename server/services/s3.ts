/**
 * Lightweight AWS S3 client using REST API + SigV4 signing.
 * No SDK dependency — matches the GcsClient interface for drop-in swap.
 *
 * Authentication (in priority order):
 *   1. AWS env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   2. EC2 instance profile via IMDSv2 (automatic on EC2)
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials)
 *
 * HIPAA: S3 is HIPAA-eligible under the AWS BAA.
 */
import { getAwsCredentials, type AwsCredentials } from "./aws-credentials.js";
import { signRequest, sha256Buffer, EMPTY_PAYLOAD_HASH, generatePresignedUrl, encodeCanonicalUri } from "./sigv4.js";
import { logger } from "./logger.js";

const S3_TIMEOUT_MS = 60_000; // 60 seconds — prevents indefinite hangs on S3 operations

/**
 * Audio-archive resilience (post-incident: batch-of-5 upload lost all
 * audio because concurrent S3 PUTs hit transient throttling and the
 * pipeline's silent-warn-and-continue masked the failure).
 *
 * Retry budget for S3 PUTs only: 3 attempts with 200ms / 800ms / 3200ms
 * backoff. ~4 seconds total worst case before final failure. We retry
 * on any throw (network errors, 5xx, 429) — the request() helper above
 * already classifies non-200 responses as throws, so this catches them
 * uniformly. Idempotent uploads (same key + same content) are safe to
 * retry per AWS S3 semantics.
 */
const S3_PUT_RETRY_DELAYS_MS = [200, 800, 3200];

/**
 * 24h rolling counter of S3 PUT failures that exhausted all retries.
 * Categorized by object-key prefix so /admin/health-deep can surface
 * audio-archive failures separately (the original incident driver) from
 * other PUT failures (batch tracking, calibration snapshots, etc.).
 * Hour-bucketed, prunes lazily on read. Mirrors the
 * bedrock_access_denied counter pattern.
 */
const S3_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const s3FailureBuckets: { ts: number; objectName: string; category: string }[] = [];

function categorizeKey(objectName: string): string {
  if (objectName.startsWith("audio/")) return "audio";
  if (objectName.startsWith("batch-inference/")) return "batch_inference";
  if (objectName.startsWith("calibration/")) return "calibration";
  if (objectName.startsWith("ab-tests/")) return "ab_test";
  if (objectName.startsWith("usage/")) return "usage";
  return "other";
}

function recordS3Failure(objectName: string): void {
  const now = Date.now();
  while (s3FailureBuckets.length > 0 && now - s3FailureBuckets[0].ts > S3_FAILURE_WINDOW_MS) {
    s3FailureBuckets.shift();
  }
  const hourBucket = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
  s3FailureBuckets.push({ ts: hourBucket, objectName, category: categorizeKey(objectName) });
}

/**
 * Operator pull surface for /admin/health-deep. Returns total +
 * per-category breakdown + a small sample of recent failure keys for
 * triage. Audio-specific count is the operator-facing signal that
 * matches the original incident ("missing playback after batch
 * upload"); other categories are also surfaced because a batch-
 * tracking PUT failure has its own ops impact (orphaned AWS Bedrock
 * batch jobs).
 */
export function getS3UploadFailureStats(): {
  total: number;
  byCategory: Record<string, number>;
  recentKeys: string[];
} {
  const now = Date.now();
  while (s3FailureBuckets.length > 0 && now - s3FailureBuckets[0].ts > S3_FAILURE_WINDOW_MS) {
    s3FailureBuckets.shift();
  }
  const byCategory: Record<string, number> = {};
  for (const b of s3FailureBuckets) {
    byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
  }
  return {
    total: s3FailureBuckets.length,
    byCategory,
    recentKeys: s3FailureBuckets.slice(-10).map(b => b.objectName),
  };
}

/** Test seam. */
export function _resetS3FailureCounter(): void {
  s3FailureBuckets.length = 0;
}

/**
 * A12/F16: S3 ListObjectsV2 XML-encodes object keys that contain reserved XML
 * characters (&, <, >, ', "). Without decoding, a key like `audio/foo&bar.wav`
 * comes back as `audio/foo&amp;bar.wav` and subsequent GET/DELETE requests
 * silently 404. Decode the five XML predefined entities before returning keys.
 * Numeric entities are not used by S3, but are decoded too for safety.
 */
function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#(x[0-9a-fA-F]+|[0-9]+));/g, (_, entity: string) => {
    switch (entity) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const cp = parseInt(entity.slice(2), 16);
          return Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : `&${entity};`;
        }
        if (entity.startsWith("#")) {
          const cp = parseInt(entity.slice(1), 10);
          return Number.isFinite(cp) && cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : `&${entity};`;
        }
        return `&${entity};`;
    }
  });
}

export class S3Client {
  private credentials: AwsCredentials | null = null;
  private bucketName: string;
  private region: string;
  private host: string;
  private initialized = false;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
    this.region = process.env.AWS_REGION || "us-east-1";
    this.host = `${bucketName}.s3.${this.region}.amazonaws.com`;
  }

  /** Initialize credentials from env vars or IMDS. Called lazily on first operation. */
  private async ensureCredentials(): Promise<AwsCredentials> {
    if (this.initialized) {
      // Re-fetch to pick up refreshed IMDS credentials (tokens expire)
      const creds = await getAwsCredentials();
      if (creds) {
        this.credentials = creds;
        return creds;
      }
      // Refresh failed — fall back to last known good credentials if available
      if (this.credentials) {
        logger.warn("S3 credential refresh failed, using cached credentials", { bucket: this.bucketName });
        return this.credentials;
      }
      throw new Error("S3 credentials expired and refresh failed. Check IAM instance profile or AWS env vars.");
    }

    // First initialization — only mark initialized after credential fetch succeeds,
    // so a transient failure (e.g. IMDS hiccup at boot) doesn't permanently flip
    // this client into the "refresh-only" code path with no cached credentials.
    const creds = await getAwsCredentials();
    if (creds) {
      this.credentials = creds;
      this.initialized = true;
      return creds;
    }
    throw new Error("S3 authentication not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or attach an IAM instance profile.");
  }

  /** Upload a JSON object */
  async uploadJson(objectName: string, data: unknown): Promise<void> {
    const body = JSON.stringify(data);
    await this.putObject(objectName, Buffer.from(body, "utf-8"), "application/json");
  }

  /** Upload a binary file (audio, etc.) */
  async uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<void> {
    // Retry transient failures (5xx, 429, network) with exponential backoff.
    // See S3_PUT_RETRY_DELAYS_MS comment above for rationale.
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= S3_PUT_RETRY_DELAYS_MS.length; attempt++) {
      try {
        await this.putObject(objectName, buffer, contentType);
        if (attempt > 0) {
          // Recovered after one or more retries — useful signal for
          // calibrating retry budget if we see this often.
          logger.info("s3: upload succeeded after retry", {
            objectName,
            attempt,
            totalAttempts: attempt + 1,
          });
        }
        return;
      } catch (err) {
        lastErr = err as Error;
        const isLastAttempt = attempt === S3_PUT_RETRY_DELAYS_MS.length;
        if (isLastAttempt) break;
        const delayMs = S3_PUT_RETRY_DELAYS_MS[attempt];
        logger.warn("s3: upload failed, retrying", {
          objectName,
          attempt: attempt + 1,
          totalAttempts: S3_PUT_RETRY_DELAYS_MS.length + 1,
          delayMs,
          error: lastErr.message,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    // All retries exhausted. Promote to error + structured alert tag so
    // CloudWatch metric filters can surface this. The category field
    // lets operators split audio-archive failures (user-facing impact)
    // from batch-tracking failures (cost-leak risk) etc. Counter feeds
    // /admin/health-deep. Then re-throw so callers can decide whether
    // to fail the operation or continue with degraded behavior.
    const category = categorizeKey(objectName);
    recordS3Failure(objectName);
    logger.error("s3: upload failed after all retries", {
      alert: "s3_upload_failed",
      category,
      objectName,
      totalAttempts: S3_PUT_RETRY_DELAYS_MS.length + 1,
      error: lastErr?.message ?? "unknown",
    });
    throw lastErr ?? new Error(`S3 upload failed for ${objectName} (no error captured)`);
  }

  /** Download and parse a JSON object. Returns undefined if not found. */
  async downloadJson<T>(objectName: string): Promise<T | undefined> {
    const response = await this.getObject(objectName);
    if (!response) return undefined;
    return (await response.json()) as T;
  }

  /** Download a raw binary file. Returns undefined if not found. */
  async downloadFile(objectName: string): Promise<Buffer | undefined> {
    const response = await this.getObject(objectName);
    if (!response) return undefined;
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Stream a binary object. Returns the raw fetch `Response` so callers
   * can pipe `response.body` directly to a destination (e.g. an Express
   * `res`) without buffering the full payload in Node heap. Returns
   * undefined for 404.
   *
   * When `range` is provided, forwards it as the HTTP `Range` request
   * header so S3 returns 206 + only the requested bytes. S3 also responds
   * with 416 (Range Not Satisfiable) for malformed/out-of-range requests;
   * both 206 and 416 are returned to the caller untouched so the caller
   * can propagate them to the client without re-parsing.
   *
   * HIPAA: this method does not alter the access-control / audit-logging
   * surface. Callers must perform `canViewerAccessCall` + `logPhiAccess`
   * before invoking it, exactly as for the buffered `downloadFile` path.
   */
  async streamObject(objectName: string, range?: string): Promise<Response | undefined> {
    return this.getObject(objectName, range);
  }

  /** List all objects with a given prefix */
  async listObjects(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let continuationToken: string | undefined;

    do {
      const params = new URLSearchParams({
        "list-type": "2",
        prefix,
      });
      if (continuationToken) params.set("continuation-token", continuationToken);

      const response = await this.request("GET", "/", params.toString());
      if (!response.ok) {
        throw new Error(`S3 list failed for prefix ${prefix}: ${await response.text()}`);
      }

      const xml = await response.text();

      // Parse <Key>...</Key> from each <Contents> block
      const keyMatches = Array.from(xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g));
      for (const match of keyMatches) {
        names.push(decodeXmlEntities(match[1]));
      }

      // Check for pagination
      const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
      if (truncatedMatch?.[1] === "true") {
        const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
        continuationToken = tokenMatch?.[1];
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken);

    return names;
  }

  /** List objects with metadata (name, size, updated) */
  async listObjectsWithMetadata(prefix: string): Promise<Array<{ name: string; size: string; updated: string }>> {
    const items: Array<{ name: string; size: string; updated: string }> = [];
    let continuationToken: string | undefined;

    do {
      const params = new URLSearchParams({
        "list-type": "2",
        prefix,
      });
      if (continuationToken) params.set("continuation-token", continuationToken);

      const response = await this.request("GET", "/", params.toString());
      if (!response.ok) {
        throw new Error(`S3 list failed for prefix ${prefix}: ${await response.text()}`);
      }

      const xml = await response.text();

      const contentBlocks = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g));
      for (const block of contentBlocks) {
        const content = block[1];
        const rawKey = content.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "";
        const size = content.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || "0";
        const lastModified = content.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || "";
        items.push({ name: decodeXmlEntities(rawKey), size, updated: lastModified });
      }

      const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
      if (truncatedMatch?.[1] === "true") {
        const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
        continuationToken = tokenMatch?.[1];
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken);

    return items;
  }

  /** List and download all JSON objects with a given prefix */
  async listAndDownloadJson<T>(prefix: string): Promise<T[]> {
    const names = await this.listObjects(prefix);
    const results: T[] = [];
    let failCount = 0;

    // Download in parallel batches of 10
    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            return await this.downloadJson<T>(name);
          } catch {
            failCount++;
            return undefined;
          }
        })
      );
      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    // F-11: warn when a significant fraction of downloads fail so operators
    // know data is being silently dropped. Previously fully silent.
    if (failCount > 0 && names.length > 0) {
      const failPct = Math.round((failCount / names.length) * 100);
      logger.warn("listAndDownloadJson: partial download failure", { failCount, totalCount: names.length, failPct, prefix });
    }

    return results;
  }

  /** Delete an object. Ignores 404 (already deleted). */
  async deleteObject(objectName: string): Promise<void> {
    const response = await this.request("DELETE", `/${objectName}`);
    // S3 DELETE returns 204 on success, doesn't error on missing objects
    if (!response.ok && response.status !== 204 && response.status !== 404) {
      throw new Error(`S3 delete failed for ${objectName}: ${await response.text()}`);
    }
  }

  /** Delete all objects with a given prefix */
  async deleteByPrefix(prefix: string): Promise<void> {
    const names = await this.listObjects(prefix);
    await Promise.all(names.map((name) => this.deleteObject(name)));
  }

  get bucket() {
    return this.bucketName;
  }

  // --- Core S3 operations ---

  /**
   * Generate a pre-signed GET URL for an S3 object.
   * This allows external services (e.g. AssemblyAI) to fetch the file directly
   * from S3 without needing AWS credentials, avoiding double-buffering.
   */
  async getPresignedUrl(objectName: string, expiresInSeconds = 3600): Promise<string> {
    const creds = await this.ensureCredentials();
    return generatePresignedUrl({
      host: this.host,
      objectName,
      region: this.region,
      creds,
      expiresInSeconds,
    });
  }

  private async putObject(objectName: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.request("PUT", `/${objectName}`, undefined, body, contentType);
    if (!response.ok) {
      throw new Error(`S3 upload failed for ${objectName}: ${await response.text()}`);
    }
  }

  private async getObject(objectName: string, range?: string): Promise<Response | undefined> {
    const response = await this.request("GET", `/${objectName}`, undefined, undefined, undefined, range);
    if (response.status === 404) return undefined;
    if (response.status === 403) {
      throw new Error(`S3 access denied (403) for ${objectName} in bucket ${this.bucketName} — check IAM permissions`);
    }
    // 206 (Partial Content) and 416 (Range Not Satisfiable) are valid
    // responses to range-suffixed requests. Return them so the streaming
    // caller can forward them verbatim to the HTTP client.
    if (response.status === 206 || response.status === 416) {
      return response;
    }
    if (!response.ok) {
      throw new Error(`S3 download failed for ${objectName}: ${await response.text()}`);
    }
    return response;
  }

  private async request(
    method: string,
    path: string,
    queryString?: string,
    body?: Buffer,
    contentType?: string,
    rangeHeader?: string,
  ): Promise<Response> {
    const creds = await this.ensureCredentials();

    // Encode the path ONCE, then use the same encoded string for both the
    // fetch URL and the SigV4 canonical URI. Previously `path` (raw, with
    // literal special chars like spaces in 8x8 telephony filenames) was
    // passed to fetch — which percent-encodes per the WHATWG URL spec —
    // AND to the signer, which percent-encodes via encodeURIComponent.
    // The two encoders disagree on which characters need encoding (e.g.
    // WHATWG keeps `! ' ( ) *` literal; encodeURIComponent escapes them),
    // and on edge cases like a literal space the actual divergence
    // surfaces as `SignatureDoesNotMatch` from S3 because the wire path
    // and the signed canonical URI aren't byte-identical. Encoding once
    // upstream and telling the signer not to re-encode (with
    // pathAlreadyEncoded:true) eliminates the entire class of mismatches.
    const encodedPath = encodeCanonicalUri(path);
    const url = queryString
      ? `https://${this.host}${encodedPath}?${queryString}`
      : `https://${this.host}${encodedPath}`;

    const headers = this.sign(method, encodedPath, queryString || "", body, contentType, creds, rangeHeader);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), S3_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- AWS Signature V4 (delegated to shared sigv4.ts) ---

  private sign(
    method: string,
    rawPath: string,
    queryString: string,
    body?: Buffer,
    contentType?: string,
    creds?: AwsCredentials,
    rangeHeader?: string,
  ): Record<string, string> {
    if (!creds) creds = this.credentials!;

    // S3 requires x-amz-content-sha256 header
    const payloadHash = body ? sha256Buffer(body) : EMPTY_PAYLOAD_HASH;

    const extraHeaders: [string, string][] = [
      ["x-amz-content-sha256", payloadHash],
    ];
    if (contentType) {
      extraHeaders.push(["content-type", contentType]);
    }
    // HIPAA: Enforce server-side encryption at rest for all uploaded objects
    if (method === "PUT") {
      extraHeaders.push(["x-amz-server-side-encryption", "AES256"]);
    }
    // Range requests (streaming audio playback). Signed so the signature
    // covers it — unsigned passthrough also works with S3, but signing is
    // the more conservative posture and the SigV4 cost is negligible.
    if (rangeHeader) {
      extraHeaders.push(["range", rangeHeader]);
    }

    return signRequest({
      method,
      host: this.host,
      // request() above hands us an already-encoded path (single source
      // of truth for the path string, shared with the fetch URL). Skip
      // the signer's re-encoding step so we don't double-encode.
      rawPath,
      pathAlreadyEncoded: true,
      queryString,
      service: "s3",
      region: this.region,
      creds,
      payloadHash,
      extraHeaders,
    });
  }
}
