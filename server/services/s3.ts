/**
 * Lightweight AWS S3 client using REST API + SigV4 signing.
 * No SDK dependency — matches the GcsClient interface for drop-in swap.
 *
 * Authentication via standard AWS env vars:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   (Optional: AWS_SESSION_TOKEN for temporary credentials)
 *
 * HIPAA: S3 is HIPAA-eligible under the AWS BAA.
 */
import { createHmac, createHash } from "crypto";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

export class S3Client {
  private credentials: AwsCredentials;
  private bucketName: string;
  private region: string;
  private host: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
    this.region = process.env.AWS_REGION || "us-east-1";
    this.host = `${bucketName}.s3.${this.region}.amazonaws.com`;

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("S3 authentication not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.");
    }

    this.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: this.region,
    };
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
        names.push(match[1]);
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
        const key = content.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "";
        const size = content.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || "0";
        const lastModified = content.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || "";
        items.push({ name: key, size, updated: lastModified });
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

    // Download in parallel batches of 10
    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            return await this.downloadJson<T>(name);
          } catch {
            return undefined;
          }
        })
      );
      for (const result of batchResults) {
        if (result) results.push(result);
      }
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

  private async putObject(objectName: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.request("PUT", `/${objectName}`, undefined, body, contentType);
    if (!response.ok) {
      throw new Error(`S3 upload failed for ${objectName}: ${await response.text()}`);
    }
  }

  private async getObject(objectName: string): Promise<Response | undefined> {
    const response = await this.request("GET", `/${objectName}`);
    if (response.status === 404 || response.status === 403) return undefined;
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
    const url = queryString
      ? `https://${this.host}${path}?${queryString}`
      : `https://${this.host}${path}`;

    const headers = this.sign(method, path, queryString || "", body, contentType);
    return fetch(url, {
      method,
      headers,
      body: body || undefined,
    });
  }

  // --- AWS Signature V4 ---

  private sign(
    method: string,
    rawPath: string,
    queryString: string,
    body?: Buffer,
    contentType?: string,
  ): Record<string, string> {
    const creds = this.credentials;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);

    // S3 requires x-amz-content-sha256 header
    const payloadHash = body
      ? createHash("sha256").update(body).digest("hex")
      : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256 of empty string

    // Canonical URI: URI-encode each path segment
    const canonicalUri = rawPath
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");

    // Build headers (must be sorted alphabetically)
    const headerEntries: [string, string][] = [
      ["host", this.host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
    ];
    if (contentType) {
      headerEntries.push(["content-type", contentType]);
    }
    if (creds.sessionToken) {
      headerEntries.push(["x-amz-security-token", creds.sessionToken]);
    }
    headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
    const signedHeaders = headerEntries.map(([k]) => k).join(";");

    const canonicalRequest = [
      method,
      canonicalUri,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
    ].join("\n");

    const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, this.region, "s3");
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const result: Record<string, string> = {
      "Host": this.host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      "Authorization": authHeader,
    };
    if (contentType) result["Content-Type"] = contentType;
    if (creds.sessionToken) result["X-Amz-Security-Token"] = creds.sessionToken;

    return result;
  }
}

// --- Crypto helpers ---

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
