/**
 * TOTP (Time-based One-Time Password) implementation using Node.js built-in crypto.
 * Implements RFC 6238 (TOTP) and RFC 4226 (HOTP) without external dependencies.
 *
 * Used for HIPAA-compliant Multi-Factor Authentication.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getPool } from "../db/pool";

// Base32 alphabet (RFC 4648)
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(length = 20): string {
  const bytes = randomBytes(length);
  return base32Encode(bytes);
}

export function base32Encode(buffer: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[=\s]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code for a given secret and time.
 */
export function generateTOTP(secret: string, timeStep = 30, digits = 6, now?: number): string {
  const time = Math.floor((now ?? Date.now()) / 1000 / timeStep);
  const timeBuffer = Buffer.alloc(8);
  // Write as big-endian 64-bit integer
  timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  timeBuffer.writeUInt32BE(time >>> 0, 4);

  const key = base32Decode(secret);
  const hmac = createHmac("sha1", key).update(timeBuffer).digest();

  // Dynamic truncation (RFC 4226 section 5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
}

/**
 * Verify a TOTP code with a ±1 time step window (±30 seconds).
 */
export function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const now = Date.now();
  // HIPAA: Use timing-safe comparison to prevent timing attacks on TOTP codes.
  // String comparison leaks code length via timing; timingSafeEqual does not.
  const tokenBuf = Buffer.from(token, "utf8");
  for (let i = -window; i <= window; i++) {
    const expected = generateTOTP(secret, 30, 6, now + i * 30000);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf)) return true;
  }
  return false;
}

/**
 * Generate an otpauth:// URI for authenticator apps (Google Authenticator, Authy, etc.)
 */
export function generateOTPAuthURI(username: string, secret: string, issuer = "CallAnalyzer"): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedUser = encodeURIComponent(username);
  return `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

// --- MFA Secret Storage (PostgreSQL or in-memory fallback) ---

interface MFARecord {
  username: string;
  secret: string;
  enabled: boolean;
  createdAt: string;
}

// In-memory fallback (dev only — lost on restart)
const mfaMemoryStore = new Map<string, MFARecord>();

export async function getMFASecret(username: string): Promise<MFARecord | null> {
  const pool = getPool();
  if (pool) {
    const result = await pool.query(
      "SELECT username, secret, enabled, created_at FROM mfa_secrets WHERE username = $1",
      [username]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { username: row.username, secret: row.secret, enabled: row.enabled, createdAt: row.created_at };
  }
  return mfaMemoryStore.get(username) ?? null;
}

export async function saveMFASecret(username: string, secret: string, enabled: boolean): Promise<void> {
  const pool = getPool();
  if (pool) {
    await pool.query(
      `INSERT INTO mfa_secrets (username, secret, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET secret = $2, enabled = $3`,
      [username, secret, enabled]
    );
    return;
  }
  mfaMemoryStore.set(username, { username, secret, enabled, createdAt: new Date().toISOString() });
}

export async function enableMFA(username: string): Promise<void> {
  const pool = getPool();
  if (pool) {
    await pool.query("UPDATE mfa_secrets SET enabled = true WHERE username = $1", [username]);
    return;
  }
  const record = mfaMemoryStore.get(username);
  if (record) record.enabled = true;
}

export async function disableMFA(username: string): Promise<void> {
  const pool = getPool();
  if (pool) {
    await pool.query("DELETE FROM mfa_secrets WHERE username = $1", [username]);
    return;
  }
  mfaMemoryStore.delete(username);
}

export async function listMFAUsers(): Promise<MFARecord[]> {
  const pool = getPool();
  if (pool) {
    const result = await pool.query("SELECT username, secret, enabled, created_at FROM mfa_secrets WHERE enabled = true");
    return result.rows.map((r: any) => ({ username: r.username, secret: r.secret, enabled: r.enabled, createdAt: r.created_at }));
  }
  return Array.from(mfaMemoryStore.values()).filter((r) => r.enabled);
}

/**
 * Check if MFA is required globally (REQUIRE_MFA env var).
 */
export function isMFARequired(): boolean {
  return process.env.REQUIRE_MFA === "true";
}

/**
 * Check if MFA is required for a specific role.
 * Admin and manager roles always require MFA, regardless of REQUIRE_MFA env var.
 */
export function isMFARoleRequired(role: string): boolean {
  return role === "admin" || role === "manager";
}
