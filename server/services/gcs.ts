/**
 * Lightweight Google Cloud Storage client using REST API.
 * Authenticates via service account JSON key (no SDK dependency).
 */
import { createSign } from "crypto";
import fs from "fs";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface GcsListResponse {
  items?: Array<{ name: string; size: string; updated: string }>;
  nextPageToken?: string;
}

export class GcsClient {
  private credentials: ServiceAccountKey;
  private bucketName: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
    this.credentials = this.loadCredentials();
  }

  private loadCredentials(): ServiceAccountKey {
    // Option 1: Inline JSON via env var
    if (process.env.GCS_CREDENTIALS) {
      return JSON.parse(process.env.GCS_CREDENTIALS);
    }
    // Option 2: Path to key file via standard env var
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf-8");
      return JSON.parse(raw);
    }
    throw new Error(
      "GCS authentication not configured. Set GCS_CREDENTIALS (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (file path)."
    );
  }

  private createJwt(): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claimSet = Buffer.from(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: "https://www.googleapis.com/auth/devstorage.full_control",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url");

    const signatureInput = `${header}.${claimSet}`;
    const sign = createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature = sign.sign(this.credentials.private_key, "base64url");

    return `${signatureInput}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 300_000) {
      return this.accessToken;
    }

    const jwt = this.createJwt();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get GCS access token: ${await response.text()}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  private encodeObjectName(name: string): string {
    return encodeURIComponent(name);
  }

  /** Upload a JSON object (GCS encrypts at rest with Google-managed AES-256 by default) */
  async uploadJson(objectName: string, data: unknown): Promise<void> {
    const token = await this.getAccessToken();
    const body = JSON.stringify(data);
    const encoded = this.encodeObjectName(objectName);

    const response = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${this.bucketName}/o?uploadType=media&name=${encoded}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-goog-meta-hipaa-encryption": "google-managed-aes256",
        },
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`GCS upload failed for ${objectName}: ${await response.text()}`);
    }
  }

  /** Upload a binary file (audio, etc.) — GCS encrypts at rest with Google-managed AES-256 by default */
  async uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<void> {
    const token = await this.getAccessToken();
    const encoded = this.encodeObjectName(objectName);

    const response = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${this.bucketName}/o?uploadType=media&name=${encoded}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          "x-goog-meta-hipaa-encryption": "google-managed-aes256",
        },
        body: buffer,
      }
    );

    if (!response.ok) {
      throw new Error(`GCS upload failed for ${objectName}: ${await response.text()}`);
    }
  }

  /** Download and parse a JSON object. Returns undefined if not found. */
  async downloadJson<T>(objectName: string): Promise<T | undefined> {
    const token = await this.getAccessToken();
    const encoded = this.encodeObjectName(objectName);

    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o/${encoded}?alt=media`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`GCS download failed for ${objectName}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  /** Download a raw binary file. Returns undefined if not found. */
  async downloadFile(objectName: string): Promise<Buffer | undefined> {
    const token = await this.getAccessToken();
    const encoded = this.encodeObjectName(objectName);

    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o/${encoded}?alt=media`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`GCS download failed for ${objectName}: ${await response.text()}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /** List all objects with a given prefix */
  async listObjects(prefix: string): Promise<string[]> {
    const token = await this.getAccessToken();
    const names: string[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ prefix });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`GCS list failed for prefix ${prefix}: ${await response.text()}`);
      }

      const data: GcsListResponse = await response.json();
      if (data.items) {
        for (const item of data.items) {
          names.push(item.name);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return names;
  }

  /** List objects with metadata (name, size, updated) */
  async listObjectsWithMetadata(prefix: string): Promise<Array<{ name: string; size: string; updated: string }>> {
    const token = await this.getAccessToken();
    const items: Array<{ name: string; size: string; updated: string }> = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ prefix });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        throw new Error(`GCS list failed for prefix ${prefix}: ${await response.text()}`);
      }

      const data: GcsListResponse = await response.json();
      if (data.items) {
        for (const item of data.items) {
          items.push(item);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

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
    const token = await this.getAccessToken();
    const encoded = this.encodeObjectName(objectName);

    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o/${encoded}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`GCS delete failed for ${objectName}: ${await response.text()}`);
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
}
