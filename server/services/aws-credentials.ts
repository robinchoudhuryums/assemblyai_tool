/**
 * AWS credential provider with IMDSv2 support for EC2 instance profiles.
 *
 * Resolution order:
 *   1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
 *   2. EC2 Instance Metadata Service v2 (IMDSv2)
 *
 * IMDS credentials are cached and automatically refreshed 5 minutes before expiration.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

const IMDS_BASE = "http://169.254.169.254";
const IMDS_TOKEN_TTL = 300; // seconds
const IMDS_TIMEOUT_MS = 2_000; // short timeout — IMDS should respond instantly
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiration

let cachedCredentials: AwsCredentials | null = null;
let cachedExpiration: number | null = null; // epoch ms
let imdsAvailable: boolean | null = null; // null = not yet checked

/**
 * Get AWS credentials from env vars or EC2 instance profile (IMDSv2).
 * Returns null if neither source is available.
 */
export async function getAwsCredentials(): Promise<AwsCredentials | null> {
  const region = process.env.AWS_REGION || "us-east-1";

  // 1. Environment variables take priority
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region,
    };
  }

  // 2. Check if cached IMDS credentials are still valid
  if (cachedCredentials && cachedExpiration) {
    const now = Date.now();
    if (now < cachedExpiration - REFRESH_BUFFER_MS) {
      return cachedCredentials;
    }
    // Credentials are expiring soon — refresh below
  }

  // 3. Try IMDSv2
  try {
    const creds = await fetchIMDSCredentials(region);
    if (creds) {
      return creds;
    }
  } catch (err) {
    // IMDS not available (not on EC2, or IMDS disabled)
    if (imdsAvailable === null) {
      console.log("[AWS] IMDS not available — not running on EC2 or instance profile not attached");
    }
    imdsAvailable = false;
  }

  return null;
}

/**
 * Check whether IMDS has been successfully contacted.
 * Returns false before the first call to getAwsCredentials() or if IMDS is unreachable.
 */
export function isIMDSAvailable(): boolean {
  return imdsAvailable === true;
}

async function fetchIMDSCredentials(region: string): Promise<AwsCredentials | null> {
  // Step 1: Get IMDSv2 session token
  const tokenRes = await fetchWithTimeout(`${IMDS_BASE}/latest/api/token`, {
    method: "PUT",
    headers: { "X-aws-ec2-metadata-token-ttl-seconds": String(IMDS_TOKEN_TTL) },
  });
  if (!tokenRes.ok) {
    throw new Error(`IMDS token request failed: ${tokenRes.status}`);
  }
  const token = await tokenRes.text();

  const imdsHeaders = { "X-aws-ec2-metadata-token": token };

  // Step 2: Get the IAM role name
  const roleRes = await fetchWithTimeout(
    `${IMDS_BASE}/latest/meta-data/iam/security-credentials/`,
    { headers: imdsHeaders },
  );
  if (!roleRes.ok) {
    throw new Error(`IMDS role listing failed: ${roleRes.status}`);
  }
  const roleName = (await roleRes.text()).trim().split("\n")[0];
  if (!roleName) {
    throw new Error("No IAM role found on instance profile");
  }

  // Step 3: Get credentials for the role
  const credRes = await fetchWithTimeout(
    `${IMDS_BASE}/latest/meta-data/iam/security-credentials/${roleName}`,
    { headers: imdsHeaders },
  );
  if (!credRes.ok) {
    throw new Error(`IMDS credential fetch failed: ${credRes.status}`);
  }
  const credData = await credRes.json() as {
    AccessKeyId: string;
    SecretAccessKey: string;
    Token: string;
    Expiration: string;
  };

  if (!credData.AccessKeyId || !credData.SecretAccessKey) {
    throw new Error("IMDS returned incomplete credentials");
  }

  imdsAvailable = true;
  cachedExpiration = new Date(credData.Expiration).getTime();
  cachedCredentials = {
    accessKeyId: credData.AccessKeyId,
    secretAccessKey: credData.SecretAccessKey,
    sessionToken: credData.Token,
    region,
  };

  console.log(`[AWS] Obtained IMDS credentials (role: ${roleName}, expires: ${credData.Expiration})`);
  return cachedCredentials;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMDS_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
