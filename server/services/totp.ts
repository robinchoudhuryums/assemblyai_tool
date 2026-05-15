/**
 * TOTP (Time-based One-Time Password) implementation using Node.js built-in crypto.
 * Implements RFC 6238 (TOTP) and RFC 4226 (HOTP) without external dependencies.
 *
 * Used for HIPAA-compliant Multi-Factor Authentication.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { getPool } from "../db/pool";

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

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
  // A13: writeBigUInt64BE handles the full 64-bit range natively. The old
  // split-into-two-UInt32 dance was correct for now but fragile (the high
  // half used JS float division which lost precision past 2^53).
  timeBuffer.writeBigUInt64BE(BigInt(time), 0);

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
 * Replay protection: tracks recently used TOTP codes per secret to prevent
 * a captured code from being reused within the same time window.
 * Key: "secret:timeStep", auto-cleaned every 2 minutes.
 */
const usedTokens = new Map<string, number>(); // key → timestamp of use

// Clean expired entries every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000; // codes expire after 2 min (covers ±1 window)
  for (const [key, ts] of usedTokens) {
    if (ts < cutoff) usedTokens.delete(key);
  }
}, 120_000).unref();

/** Exported for testing only — clears the replay cache. */
export function _resetReplayCache(): void {
  usedTokens.clear();
}

/**
 * Verify a TOTP code with a ±1 time step window (±30 seconds).
 * Includes replay protection: each code can only be used once per time window.
 */
export function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const now = Date.now();
  // HIPAA: Use timing-safe comparison to prevent timing attacks on TOTP codes.
  // String comparison leaks code length via timing; timingSafeEqual does not.
  const tokenBuf = Buffer.from(token, "utf8");
  for (let i = -window; i <= window; i++) {
    const stepTime = now + i * 30000;
    const expected = generateTOTP(secret, 30, 6, stepTime);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf)) {
      // Replay protection: reject if this exact code was already used
      const timeStep = Math.floor(stepTime / 1000 / 30);
      const replayKey = `${secret}:${timeStep}`;
      if (usedTokens.has(replayKey)) return false;
      usedTokens.set(replayKey, now);
      return true;
    }
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

// --- MFA Recovery Codes ---
//
// Recovery codes are single-use 10-character alphanumeric tokens that let a
// user complete MFA verification without their authenticator app (e.g. lost
// device). They're generated once at setup, shown to the user exactly once,
// and stored as scrypt hashes — the plaintext is never recoverable.
//
// Format: 10 chars from [A-Z0-9] (no ambiguous 0/O, 1/I excluded for
// human-readability). Presented as XXXXX-XXXXX groups in the UI.

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars
const RECOVERY_CODE_SALT_PREFIX = "mfa-recovery-v1:";
const RECOVERY_CODE_KEYLEN = 32;

interface RecoveryCodeRecord {
  hash: string;       // scrypt(code, username-salt)
  used: boolean;
  usedAt?: string;
}

function generateOneRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_COUNT);
  let out = "";
  for (const b of bytes) {
    out += RECOVERY_CODE_ALPHABET[b % RECOVERY_CODE_ALPHABET.length];
  }
  return out;
}

async function hashRecoveryCode(code: string, username: string): Promise<string> {
  const buf = await scrypt(code.toUpperCase(), RECOVERY_CODE_SALT_PREFIX + username, RECOVERY_CODE_KEYLEN);
  return buf.toString("hex");
}

/**
 * Generate a fresh set of recovery codes for the user, store hashed, and
 * return the plaintext codes (the only time the user will ever see them).
 *
 * Overwrites any existing codes. Call this at MFA enable and when the user
 * explicitly requests regeneration (prior codes become invalid).
 */
export async function generateRecoveryCodes(username: string): Promise<string[]> {
  const plaintexts: string[] = [];
  const records: RecoveryCodeRecord[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateOneRecoveryCode();
    plaintexts.push(code);
    records.push({ hash: await hashRecoveryCode(code, username), used: false });
  }
  const pool = getPool();
  if (pool) {
    await pool.query(
      "UPDATE mfa_secrets SET recovery_codes = $2 WHERE username = $1",
      [username, JSON.stringify(records)]
    );
  } else {
    const existing = mfaMemoryStore.get(username);
    if (existing) {
      (existing as any).recoveryCodes = records;
    }
  }
  return plaintexts;
}

/**
 * Attempt to consume a recovery code. Returns true on success and marks the
 * code as used (single-use). Timing-safe on the hash compare — does NOT
 * short-circuit on a wrong hash so an attacker can't distinguish "no such
 * code" from "already used".
 */
export async function consumeRecoveryCode(username: string, plaintext: string): Promise<boolean> {
  const normalized = String(plaintext).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) return false;

  const pool = getPool();
  if (pool) {
    // Sec-F4 / INV-25: SELECT FOR UPDATE only locks within the SAME
    // transaction. Previously this used pool.query() which checks out a
    // fresh connection per call — the row lock died immediately and two
    // concurrent consumeRecoveryCode() calls each saw the same unused
    // record and both wrote `used: true`. Now we acquire a dedicated
    // client, BEGIN, hold the row lock through the read+compute+UPDATE,
    // and COMMIT (or ROLLBACK on error). The second concurrent caller
    // blocks on the row lock and re-reads the already-marked record.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT recovery_codes FROM mfa_secrets WHERE username = $1 FOR UPDATE",
        [username]
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const records = (result.rows[0].recovery_codes as RecoveryCodeRecord[]) || [];

      const candidateHash = await hashRecoveryCode(normalized, username);
      const candidateBuf = Buffer.from(candidateHash, "hex");

      let matchedIdx = -1;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.used) continue;
        const storedBuf = Buffer.from(r.hash, "hex");
        if (storedBuf.length !== candidateBuf.length) continue;
        if (timingSafeEqual(storedBuf, candidateBuf)) {
          matchedIdx = i;
          // Don't break — keep comparing to avoid timing signal on early match.
        }
      }
      if (matchedIdx === -1) {
        await client.query("ROLLBACK");
        return false;
      }

      records[matchedIdx] = { ...records[matchedIdx], used: true, usedAt: new Date().toISOString() };
      await client.query(
        "UPDATE mfa_secrets SET recovery_codes = $2 WHERE username = $1",
        [username, JSON.stringify(records)]
      );
      await client.query("COMMIT");
      return true;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
      throw err;
    } finally {
      client.release();
    }
  } else {
    // Memory backend (dev only) — JS single-thread semantics make the
    // read+compute+write atomic because there are no awaits between
    // candidate selection and the records.set assignment below.
    const rec = mfaMemoryStore.get(username);
    const records = rec ? ((rec as any).recoveryCodes as RecoveryCodeRecord[]) || [] : [];

    const candidateHash = await hashRecoveryCode(normalized, username);
    const candidateBuf = Buffer.from(candidateHash, "hex");

    let matchedIdx = -1;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.used) continue;
      const storedBuf = Buffer.from(r.hash, "hex");
      if (storedBuf.length !== candidateBuf.length) continue;
      if (timingSafeEqual(storedBuf, candidateBuf)) {
        matchedIdx = i;
      }
    }
    if (matchedIdx === -1) return false;

    records[matchedIdx] = { ...records[matchedIdx], used: true, usedAt: new Date().toISOString() };
    if (rec) (rec as any).recoveryCodes = records;
    return true;
  }
}

/**
 * Count remaining (unused) recovery codes. Used to nag the user to
 * regenerate when running low.
 */
export async function countRemainingRecoveryCodes(username: string): Promise<number> {
  const pool = getPool();
  let records: RecoveryCodeRecord[];
  if (pool) {
    const result = await pool.query(
      "SELECT recovery_codes FROM mfa_secrets WHERE username = $1",
      [username]
    );
    if (result.rows.length === 0) return 0;
    records = (result.rows[0].recovery_codes as RecoveryCodeRecord[]) || [];
  } else {
    const rec = mfaMemoryStore.get(username);
    records = rec ? ((rec as any).recoveryCodes as RecoveryCodeRecord[]) || [] : [];
  }
  return records.filter(r => !r.used).length;
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
