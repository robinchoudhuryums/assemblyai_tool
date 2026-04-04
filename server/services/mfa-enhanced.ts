/**
 * Enhanced MFA Service — WebAuthn passkeys + backup codes + trusted devices.
 *
 * Adapted from Observatory QA's comprehensive MFA implementation.
 * Extends the existing TOTP-only MFA with:
 * - WebAuthn/FIDO2 passkeys (phishing-resistant)
 * - Backup codes (for recovery when device is lost)
 * - Trusted device tracking ("remember this device" for 30 days)
 *
 * Existing TOTP functionality (totp.ts) remains unchanged.
 * This module adds supplementary authentication methods.
 */
import { randomBytes, createHash } from "crypto";

// ==================== BACKUP CODES ====================

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

/**
 * Generate a set of single-use backup codes for MFA recovery.
 * Returns the plaintext codes (show to user ONCE) and their hashes (store in DB).
 */
export function generateBackupCodes(): { plaintext: string[]; hashes: string[] } {
  const plaintext: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Format: XXXX-XXXX for readability
    const code = randomBytes(BACKUP_CODE_LENGTH)
      .toString("hex")
      .slice(0, BACKUP_CODE_LENGTH)
      .toUpperCase();
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;

    plaintext.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }

  return { plaintext, hashes };
}

/**
 * Hash a backup code for storage comparison.
 */
export function hashBackupCode(code: string): string {
  // Normalize: remove dashes, uppercase
  const normalized = code.replace(/-/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Verify a backup code against stored hashes. Returns the index of the
 * matched code (for removal) or -1 if no match.
 */
export function verifyBackupCode(code: string, storedHashes: string[]): number {
  const hash = hashBackupCode(code);
  return storedHashes.findIndex((h) => h === hash);
}

// ==================== TRUSTED DEVICES ====================

const TRUSTED_DEVICE_TTL_DAYS = 30;

export interface TrustedDevice {
  tokenHash: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Create a trusted device token. Returns the raw token (set as cookie)
 * and the device record (store in user's profile).
 */
export function createTrustedDevice(deviceName: string): {
  token: string;
  device: TrustedDevice;
} {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + TRUSTED_DEVICE_TTL_DAYS * 86400000);

  return {
    token,
    device: {
      tokenHash,
      name: deviceName,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    },
  };
}

/**
 * Verify a trusted device token against stored devices.
 * Returns true if the token matches a non-expired device.
 */
export function verifyTrustedDevice(token: string, devices: TrustedDevice[]): boolean {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();

  return devices.some(
    (d) => d.tokenHash === tokenHash && new Date(d.expiresAt).getTime() > now,
  );
}

/**
 * Remove expired devices from the list.
 */
export function pruneExpiredDevices(devices: TrustedDevice[]): TrustedDevice[] {
  const now = Date.now();
  return devices.filter((d) => new Date(d.expiresAt).getTime() > now);
}

// ==================== WEBAUTHN CREDENTIAL STORAGE ====================

export interface WebAuthnCredential {
  credentialId: string; // base64url-encoded
  publicKey: string;    // base64url-encoded COSE public key
  counter: number;      // signature counter for replay protection
  transports?: string[];
  name: string;
  createdAt: string;
}

/**
 * Validate that a WebAuthn credential's counter is advancing (replay protection).
 * Returns true if the new counter is greater than the stored counter.
 */
export function validateCounter(stored: number, received: number): boolean {
  return received > stored;
}

/**
 * Format WebAuthn credential for storage (strips sensitive fields).
 */
export function formatCredentialForStorage(params: {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  name: string;
}): WebAuthnCredential {
  return {
    credentialId: params.credentialId,
    publicKey: params.publicKey,
    counter: params.counter,
    transports: params.transports,
    name: params.name,
    createdAt: new Date().toISOString(),
  };
}
