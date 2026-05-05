/**
 * Shared AWS Signature V4 signing utilities.
 *
 * Extracted from bedrock.ts and s3.ts to eliminate duplication
 * and centralize cryptographic signing logic.
 */
import { createHmac, createHash } from "crypto";
import type { AwsCredentials } from "./aws-credentials.js";

// SHA-256 hash of an empty string (used as payload hash for bodiless requests)
export const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** SHA-256 hex digest of a string. */
export function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** SHA-256 hex digest of a Buffer. */
export function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** HMAC-SHA256 returning raw Buffer (for key derivation chain). */
export function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** HMAC-SHA256 returning hex string (for final signature). */
export function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/**
 * Derive the SigV4 signing key from the secret access key.
 * Chain: AWS4 + secret → dateStamp → region → service → "aws4_request"
 */
export function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Format a Date into SigV4 amzDate format (e.g. "20260319T120000Z"). */
export function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** URI-encode each segment of a path for canonical URI. */
export function encodeCanonicalUri(rawPath: string): string {
  return rawPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export interface SignRequestOptions {
  method: string;
  host: string;
  /**
   * The path component of the request, used to compute the SigV4
   * canonical URI. By default this is treated as a RAW (unencoded)
   * path and run through `encodeCanonicalUri` (per-segment
   * `encodeURIComponent`). Pass `pathAlreadyEncoded: true` if you've
   * already encoded the path upstream — typical when the same encoded
   * string needs to be shared with the HTTP client (so signer and
   * wire-format URL are byte-identical and signatures actually match).
   */
  rawPath: string;
  /** Skip re-encoding `rawPath`. See `rawPath` comment for rationale. */
  pathAlreadyEncoded?: boolean;
  queryString?: string;
  service: string;
  region: string;
  creds: AwsCredentials;
  /** Sorted [name, value] header pairs to include in signature (beyond the auto-added ones). */
  extraHeaders?: [string, string][];
  /** Pre-computed payload hash. If not provided, body is hashed. */
  payloadHash?: string;
  body?: string | Buffer;
}

/**
 * Sign an AWS API request using Signature V4.
 * Returns the headers to include in the HTTP request.
 */
export function signRequest(opts: SignRequestOptions): Record<string, string> {
  const { method, host, rawPath, queryString = "", service, region, creds } = opts;

  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  // Compute payload hash
  let payloadHash = opts.payloadHash;
  if (!payloadHash) {
    if (opts.body) {
      payloadHash = typeof opts.body === "string" ? sha256(opts.body) : sha256Buffer(opts.body);
    } else {
      payloadHash = EMPTY_PAYLOAD_HASH;
    }
  }

  const canonicalUri = opts.pathAlreadyEncoded ? rawPath : encodeCanonicalUri(rawPath);

  // Build header entries — sorted alphabetically for canonical form
  const headerEntries: [string, string][] = [
    ["host", host],
    ["x-amz-date", amzDate],
  ];

  if (opts.extraHeaders) {
    headerEntries.push(...opts.extraHeaders);
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

  // Build output headers (use canonical casing for HTTP)
  const result: Record<string, string> = {
    Host: host,
    "X-Amz-Date": amzDate,
    Authorization: authHeader,
  };

  // Add extra headers with proper casing
  for (const [name, value] of opts.extraHeaders || []) {
    // Convert canonical lowercase to HTTP header case
    const httpName = name.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("-");
    result[httpName] = value;
  }

  if (creds.sessionToken) {
    result["X-Amz-Security-Token"] = creds.sessionToken;
  }

  return result;
}

/**
 * Generate a pre-signed URL for an S3 GET request (query-string based signing).
 */
export function generatePresignedUrl(opts: {
  host: string;
  objectName: string;
  region: string;
  creds: AwsCredentials;
  expiresInSeconds?: number;
}): string {
  const { host, objectName, region, creds, expiresInSeconds = 3600 } = opts;

  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  const canonicalUri = encodeCanonicalUri(`/${objectName}`);

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  });
  if (creds.sessionToken) {
    queryParams.set("X-Amz-Security-Token", creds.sessionToken);
  }

  const sortedParams = [...queryParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQueryString = sortedParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(creds.secretAccessKey, dateStamp, region, "s3");
  const signature = hmacHex(signingKey, stringToSign);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
