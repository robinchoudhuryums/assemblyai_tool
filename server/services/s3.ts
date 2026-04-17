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
import { signRequest, sha256Buffer, EMPTY_PAYLOAD_HASH, generatePresignedUrl } from "./sigv4.js";
import { logger } from "./logger.js";

const S3_TIMEOUT_MS = 60_000; // 60 seconds — prevents indefinite hangs on S3 operations

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
    await this.putObject(objectName, buffer, contentType);
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

  private async getObject(objectName: string): Promise<Response | undefined> {
    const response = await this.request("GET", `/${objectName}`);
    if (response.status === 404) return undefined;
    if (response.status === 403) {
      throw new Error(`S3 access denied (403) for ${objectName} in bucket ${this.bucketName} — check IAM permissions`);
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
  ): Promise<Response> {
    const creds = await this.ensureCredentials();
    const url = queryString
      ? `https://${this.host}${path}?${queryString}`
      : `https://${this.host}${path}`;

    const headers = this.sign(method, path, queryString || "", body, contentType, creds);
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

    return signRequest({
      method,
      host: this.host,
      rawPath,
      queryString,
      service: "s3",
      region: this.region,
      creds,
      payloadHash,
      extraHeaders,
    });
  }
}
