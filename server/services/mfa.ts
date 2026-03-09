/**
 * MFA (Multi-Factor Authentication) service using TOTP (Time-based One-Time Passwords).
 *
 * MFA secrets are stored in S3 alongside other config data.
 * Each user's TOTP secret + recovery codes are stored as a JSON object
 * at the S3 key: config/mfa/{username}.json
 */
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { logPhiAccess } from "./audit-log";

const scryptAsync = promisify(scrypt);

// In-memory cache of MFA configs, loaded from S3 on startup
const mfaStore = new Map<string, MfaConfig>();

interface MfaConfig {
  /** Base32-encoded TOTP secret */
  secret: string;
  /** Whether MFA setup is complete (user has verified a code) */
  enabled: boolean;
  /** One-time recovery codes, stored as scrypt hashes (format: hash.salt) */
  recoveryCodes: string[];
  /** Timestamp of when MFA was enabled */
  enabledAt?: string;
}

const ISSUER = "CallAnalyzer";
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 8;

function createTOTP(secret: string, username: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** Generate a new TOTP secret for a user (does not enable MFA yet) */
export function generateMfaSecret(username: string): { secret: string; otpauthUrl: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  return {
    secret: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

/** Generate a QR code data URL from an otpauth URL */
export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Hash a recovery code using scrypt (same approach as password hashing) */
async function hashRecoveryCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(code.toUpperCase().trim(), salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

/** Compare a plaintext recovery code against a stored hash (timing-safe) */
async function compareRecoveryCode(supplied: string, stored: string): Promise<boolean> {
  const [hashedCode, salt] = stored.split(".");
  if (!hashedCode || !salt) return false;
  const hashedCodeBuf = Buffer.from(hashedCode, "hex");
  const suppliedBuf = (await scryptAsync(supplied.toUpperCase().trim(), salt, 64)) as Buffer;
  return timingSafeEqual(hashedCodeBuf, suppliedBuf);
}

/** Generate random recovery codes. Returns { plaintext, hashed } for display and storage. */
async function generateRecoveryCodes(): Promise<{ plaintext: string[]; hashed: string[] }> {
  const plaintext: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = randomBytes(4).toString("hex").toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plaintext.push(code);
    hashed.push(await hashRecoveryCode(code));
  }
  return { plaintext, hashed };
}

/** Verify a TOTP code for a user. Allows 1-step window drift. */
export function verifyTotpCode(username: string, code: string): boolean {
  const config = mfaStore.get(username);
  if (!config?.enabled) return false;

  const totp = createTOTP(config.secret, username);
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/** Check a recovery code. If valid, consume it (one-time use). */
export async function verifyRecoveryCode(username: string, code: string): Promise<boolean> {
  const config = mfaStore.get(username);
  if (!config?.enabled) return false;

  // Find the matching hashed recovery code
  let matchIndex = -1;
  for (let i = 0; i < config.recoveryCodes.length; i++) {
    if (await compareRecoveryCode(code, config.recoveryCodes[i])) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex === -1) return false;

  // Consume the recovery code
  config.recoveryCodes.splice(matchIndex, 1);
  mfaStore.set(username, config);

  // Persist change (fire-and-forget)
  saveMfaConfig(username, config).catch(() => {});

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "mfa_recovery_code_used",
    username,
    resourceType: "auth",
    detail: `Recovery code consumed. ${config.recoveryCodes.length} remaining.`,
  });

  return true;
}

/** Begin MFA setup: generate secret and recovery codes, store pending config */
export async function setupMfa(username: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}> {
  const { secret, otpauthUrl } = generateMfaSecret(username);
  const { plaintext, hashed } = await generateRecoveryCodes();

  // Store hashed recovery codes (not plaintext) — plaintext is returned to user once
  const config: MfaConfig = {
    secret,
    enabled: false,
    recoveryCodes: hashed,
  };
  mfaStore.set(username, config);
  await saveMfaConfig(username, config);

  const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUrl);

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "mfa_setup_initiated",
    username,
    resourceType: "auth",
  });

  // Return plaintext codes to user (only time they'll see them)
  return { secret, otpauthUrl, qrCodeDataUrl, recoveryCodes: plaintext };
}

/** Confirm MFA setup by verifying an initial TOTP code */
export async function confirmMfaSetup(username: string, code: string): Promise<boolean> {
  const config = mfaStore.get(username);
  if (!config) return false;

  const totp = createTOTP(config.secret, username);
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;

  config.enabled = true;
  config.enabledAt = new Date().toISOString();
  mfaStore.set(username, config);
  await saveMfaConfig(username, config);

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "mfa_enabled",
    username,
    resourceType: "auth",
  });

  return true;
}

/** Disable MFA for a user */
export async function disableMfa(username: string): Promise<void> {
  mfaStore.delete(username);
  await deleteMfaConfig(username);

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "mfa_disabled",
    username,
    resourceType: "auth",
  });
}

/** Check if a user has MFA enabled */
export function isMfaEnabled(username: string): boolean {
  const config = mfaStore.get(username);
  return config?.enabled === true;
}

/** Get MFA status for a user */
export function getMfaStatus(username: string): { enabled: boolean; enabledAt?: string; recoveryCodesRemaining: number } {
  const config = mfaStore.get(username);
  if (!config?.enabled) {
    return { enabled: false, recoveryCodesRemaining: 0 };
  }
  return {
    enabled: true,
    enabledAt: config.enabledAt,
    recoveryCodesRemaining: config.recoveryCodes.length,
  };
}

// ============== S3 Persistence ==============

// Dynamic import of storage to avoid circular dependencies
let objectClient: any = null;

async function getObjectClient() {
  if (!objectClient) {
    const mod = await import("../storage");
    const s = mod.storage as any;
    // CloudStorage exposes getObjectClient(); MemStorage doesn't have one
    objectClient = s.getObjectClient ? s.getObjectClient() : null;
  }
  return objectClient;
}

async function saveMfaConfig(username: string, config: MfaConfig): Promise<void> {
  try {
    const client = await getObjectClient();
    if (client?.uploadJson) {
      await client.uploadJson(`config/mfa/${username}.json`, config);
    }
  } catch (err) {
    console.warn(`[MFA] Failed to persist MFA config for ${username}:`, (err as Error).message);
  }
}

async function deleteMfaConfig(username: string): Promise<void> {
  try {
    const client = await getObjectClient();
    if (client?.deleteObject) {
      await client.deleteObject(`config/mfa/${username}.json`);
    }
  } catch (err) {
    console.warn(`[MFA] Failed to delete MFA config for ${username}:`, (err as Error).message);
  }
}

/** Load all MFA configs from storage on startup */
export async function loadMfaConfigs(): Promise<void> {
  try {
    const client = await getObjectClient();
    if (!client?.listObjects) return;

    const keys: string[] = await client.listObjects("config/mfa/");
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      try {
        const config = await client.downloadJson(key);
        if (config?.secret) {
          const username = key.replace("config/mfa/", "").replace(".json", "");
          mfaStore.set(username, config as MfaConfig);
          console.log(`[MFA] Loaded MFA config for user: ${username}`);
        }
      } catch {
        // Skip malformed configs
      }
    }
  } catch (err) {
    console.warn("[MFA] Failed to load MFA configs from storage:", (err as Error).message);
  }
}
