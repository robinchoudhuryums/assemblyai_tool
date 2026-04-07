import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import createMemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import type { Express, RequestHandler } from "express";
import { logPhiAccess } from "./services/audit-log";
import { recordFailedLogin } from "./services/security-monitor";
import { getPool } from "./db/pool";
import { getMFASecret, isMFARoleRequired } from "./services/totp";
import { storage } from "./storage";

const scryptAsync = promisify(scrypt);

// HIPAA: Password complexity requirements
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REQUIREMENTS = [
  { regex: /[A-Z]/, message: "at least one uppercase letter" },
  { regex: /[a-z]/, message: "at least one lowercase letter" },
  { regex: /[0-9]/, message: "at least one number" },
  { regex: /[^A-Za-z0-9]/, message: "at least one special character" },
];

export function validatePasswordComplexity(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`minimum ${PASSWORD_MIN_LENGTH} characters`);
  }
  for (const req of PASSWORD_REQUIREMENTS) {
    if (!req.regex.test(password)) errors.push(req.message);
  }
  return { valid: errors.length === 0, errors };
}

// HIPAA: Login attempt tracking for account lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>();

// Periodic cleanup: remove expired lockout entries to prevent unbounded memory growth
// (dictionary attacks with random usernames would otherwise leak memory indefinitely)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts) {
    // Remove if lockout expired or entry is stale (no activity for 2× lockout window)
    if ((record.lockedUntil && now > record.lockedUntil) ||
        (now - record.lastAttempt > LOCKOUT_DURATION_MS * 2)) {
      loginAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // every 5 minutes, don't prevent exit

function isAccountLocked(username: string): boolean {
  const record = loginAttempts.get(username);
  if (!record?.lockedUntil) return false;
  if (Date.now() > record.lockedUntil) {
    // Lockout expired — reset
    loginAttempts.delete(username);
    return false;
  }
  return true;
}

function recordFailedAttempt(username: string, ip?: string): void {
  const record = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`[SECURITY] Account "${username}" locked after ${record.count} failed attempts.`);
  }
  loginAttempts.set(username, record);
  // Feed into security monitor for pattern detection
  if (ip) recordFailedLogin(username, ip);
}

function clearFailedAttempts(username: string): void {
  loginAttempts.delete(username);
}

/**
 * Users are defined via the AUTH_USERS environment variable.
 * Format: username:password:role:displayName (comma-separated for multiple users)
 * Example: admin:SecurePass123!:admin:Admin User,viewer:ViewerPass456:viewer:Jane Doe
 */

interface EnvUser {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
}

// In-memory store of hashed user credentials parsed from env vars
const envUsers: EnvUser[] = [];

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const parts = stored.split(".");
  if (parts.length !== 2) {
    console.error("[AUTH] Corrupted password hash format (expected hash.salt)");
    return false;
  }
  const [hashedPassword, salt] = parts;
  const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
  const suppliedPasswordBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
}

/** Exposed for user management routes (server/routes/users.ts) */
export const hashPasswordForDb = hashPassword;
export const comparePasswordsRaw = comparePasswords;

/** HIPAA: Password history — prevent reuse of last N passwords. */
export const PASSWORD_HISTORY_SIZE = 5;

export async function isPasswordReused(password: string, currentHash: string, history: string[]): Promise<boolean> {
  // Check against current password
  if (await comparePasswords(password, currentHash)) return true;
  // Check against previous passwords
  for (const oldHash of history) {
    if (await comparePasswords(password, oldHash)) return true;
  }
  return false;
}

async function loadUsersFromEnv(): Promise<void> {
  const authUsersRaw = process.env.AUTH_USERS;
  if (!authUsersRaw) {
    console.warn("AUTH_USERS not set. No users will be able to log in.");
    return;
  }

  const userEntries = authUsersRaw.split(",").map((s) => s.trim()).filter(Boolean);

  for (const entry of userEntries) {
    const parts = entry.split(":");
    if (parts.length < 3) {
      console.warn(`Skipping malformed AUTH_USERS entry (expected username:password:role[:displayName]): ${parts[0] || entry}`);
      continue;
    }

    const [username, password, role, ...nameParts] = parts;
    const displayName = nameParts.length > 0 ? nameParts.join(":") : username;

    // HIPAA: Enforce password complexity — reject weak passwords in ALL environments.
    // Weak dev passwords can leak to production via .env files.
    const complexity = validatePasswordComplexity(password);
    if (!complexity.valid) {
      console.error(`[SECURITY] Rejecting AUTH_USERS entry "${username}": weak password (missing ${complexity.errors.join(", ")}). HIPAA requires strong passwords.`);
      continue; // Skip this user entirely
    }

    const passwordHash = await hashPassword(password);
    envUsers.push({
      id: randomBytes(8).toString("hex"),
      username,
      passwordHash,
      name: displayName,
      role,
    });

    console.log(`Loaded user from AUTH_USERS: ${username} (${role})`);
  }
}

// Express.User is declared in server/types.d.ts (A39/F64 — single source of truth).

// Exposed so WebSocket upgrade handler can verify sessions (HIPAA requirement)
export let sessionMiddleware: RequestHandler;

export async function setupAuth(app: Express) {
  // Load users from environment variables on startup
  await loadUsersFromEnv();

  // HIPAA: Session configuration with proper memory store and idle timeout
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: SESSION_SECRET must be set in production");
      process.exit(1);
    }
    console.warn("SESSION_SECRET not set - using random secret (sessions will not persist across restarts)");
  }
  const effectiveSessionSecret = sessionSecret || randomBytes(32).toString("hex");

  // HIPAA: 15-minute idle timeout (addressable requirement, standard in healthcare)
  const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const SESSION_ABSOLUTE_MAX_MS = 8 * 60 * 60 * 1000; // 8 hours absolute max

  // Use PostgreSQL session store if DATABASE_URL is set, otherwise MemoryStore
  let sessionStore: session.Store;
  const dbPool = getPool();
  if (dbPool) {
    const PgSession = connectPgSimple(session);
    sessionStore = new PgSession({
      pool: dbPool,
      tableName: "session",
      pruneSessionInterval: 60, // Prune expired sessions every 60 seconds
    });
    console.log("[AUTH] Using PostgreSQL session store (sessions persist across restarts)");
  } else {
    const MemoryStore = createMemoryStore(session);
    sessionStore = new MemoryStore({
      checkPeriod: 60 * 1000,
    });
    console.log("[AUTH] Using in-memory session store (sessions lost on restart)");
  }

  sessionMiddleware = session({
    secret: effectiveSessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production" && !process.env.DISABLE_SECURE_COOKIE,
      httpOnly: true,
      maxAge: SESSION_IDLE_TIMEOUT_MS,
      sameSite: "lax",
    },
    // HIPAA: rolling=true resets cookie expiry on each request (acts as idle timeout).
    // maxAge=15min means session expires after 15 minutes of inactivity.
    rolling: true,
  });
  app.use(sessionMiddleware);

  // Passport 0.7 + connect-pg-simple compatibility:
  // connect-pg-simple's regenerate() leaves req.session undefined in its async
  // callback, crashing Passport's logIn flow. We must patch the Session prototype
  // so ALL session objects (including those reconstructed by connect-pg-simple)
  // inherit the safe no-op.
  // Patch is applied eagerly on first request that has a session, then the
  // prototype is permanently fixed for all future sessions.
  let sessionPrototypePatched = false;
  app.use((req, _res, next) => {
    if (!sessionPrototypePatched && req.session) {
      const proto = Object.getPrototypeOf(req.session);
      if (proto) {
        proto.regenerate = function (cb: (err?: Error) => void) { cb(); };
        sessionPrototypePatched = true;
      }
    }
    // Fallback: if session exists but prototype wasn't patchable, patch instance
    if (req.session && typeof req.session.regenerate === "function" && !sessionPrototypePatched) {
      (req.session as any).regenerate = (cb: (err?: Error) => void) => cb();
    }
    next();
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy: authenticate against PostgreSQL users FIRST, then fall back to env-var users
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // HIPAA: Check account lockout before attempting authentication
        if (isAccountLocked(username)) {
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: "login_locked",
            username,
            resourceType: "auth",
            detail: "Account locked due to excessive failed attempts",
          });
          return done(null, false, { message: "Account temporarily locked. Try again later." });
        }

        // --- Step 1: Check PostgreSQL users table first ---
        try {
          const dbUser = await storage.getDbUserByUsername(username);
          if (dbUser) {
            // Found in DB — check if active
            if (!dbUser.active) {
              logPhiAccess({
                timestamp: new Date().toISOString(),
                event: "login_failed",
                username,
                resourceType: "auth",
                detail: "Account is deactivated",
              });
              return done(null, false, { message: "Account is deactivated. Contact an administrator." });
            }

            const isValid = await comparePasswords(password, dbUser.passwordHash);
            if (!isValid) {
              recordFailedAttempt(username);
              logPhiAccess({
                timestamp: new Date().toISOString(),
                event: "login_failed",
                username,
                resourceType: "auth",
              });
              return done(null, false, { message: "Invalid username or password" });
            }
            clearFailedAttempts(username);
            logPhiAccess({
              timestamp: new Date().toISOString(),
              event: "login_success",
              userId: dbUser.id,
              username: dbUser.username,
              role: dbUser.role,
              resourceType: "auth",
              detail: "Authenticated via PostgreSQL users table",
            });
            return done(null, {
              id: dbUser.id,
              username: dbUser.username,
              name: dbUser.displayName,
              role: dbUser.role,
            });
          }
        } catch (dbErr) {
          // DB lookup failed (e.g., no DATABASE_URL) — fall through to env users
          console.warn("[AUTH] DB user lookup failed, falling back to env users:", (dbErr as Error).message);
        }

        // --- Step 2: Fall back to AUTH_USERS env var ---
        const user = envUsers.find((u) => u.username === username);
        if (!user) {
          recordFailedAttempt(username);
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: "login_failed",
            username,
            resourceType: "auth",
          });
          return done(null, false, { message: "Invalid username or password" });
        }
        const isValid = await comparePasswords(password, user.passwordHash);
        if (!isValid) {
          recordFailedAttempt(username);
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: "login_failed",
            username,
            resourceType: "auth",
          });
          return done(null, false, { message: "Invalid username or password" });
        }
        clearFailedAttempts(username);
        logPhiAccess({
          timestamp: new Date().toISOString(),
          event: "login_success",
          userId: user.id,
          username: user.username,
          role: user.role,
          resourceType: "auth",
        });
        return done(null, {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        });
      } catch (err) {
        return done(err);
      }
    })
  );

  // Serialize user ID into session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session — check PostgreSQL first, then env users
  passport.deserializeUser(async (id: string, done) => {
    // Try DB users first
    try {
      const dbUser = await storage.getDbUser(id);
      if (dbUser) {
        if (!dbUser.active) {
          return done(null, false);
        }
        return done(null, {
          id: dbUser.id,
          username: dbUser.username,
          name: dbUser.displayName,
          role: dbUser.role,
        });
      }
    } catch {
      // DB lookup failed — fall through to env users
    }

    // Fall back to env users
    const user = envUsers.find((u) => u.id === id);
    if (!user) {
      return done(null, false);
    }
    done(null, {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    });
  });
}

// Middleware to require authentication on API routes
/**
 * HIPAA: Session fingerprinting — bind sessions to user-agent to detect hijacking.
 * If the user-agent changes mid-session, destroy the session and force re-login.
 */
export function getSessionFingerprint(req: import("express").Request): string {
  // HIPAA: Bind session to browser characteristics to detect hijacking.
  // Uses user-agent + accept-language (stable across requests).
  // IP is intentionally excluded: mobile networks and VPNs rotate IPs frequently,
  // causing false-positive session kills for legitimate users.
  const ua = req.headers["user-agent"] || "";
  const lang = req.headers["accept-language"] || "";
  return createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 16);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }

  // HIPAA: Session fingerprinting — bind sessions to browser characteristics.
  // Set fingerprint on first authenticated request; reject mismatches thereafter.
  const currentFp = getSessionFingerprint(req);
  const sess = req.session as typeof req.session & { fingerprint?: string };
  const sessionFp = sess.fingerprint;
  if (!sessionFp) {
    // First request with this session — stamp the fingerprint
    sess.fingerprint = currentFp;
  } else if (sessionFp !== currentFp) {
    // Fingerprint changed mid-session — possible session hijacking
    logPhiAccess({
      timestamp: new Date().toISOString(),
      event: "session_fingerprint_mismatch",
      username: req.user?.username || "unknown",
      resourceType: "auth",
      detail: "Session destroyed: user-agent fingerprint mismatch",
    });
    req.logout(() => {});
    req.session.destroy((err) => {
      if (err) {
        console.error("[AUTH] Failed to destroy hijacked session:", (err as Error).message);
      }
    });
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  next();
};

// HIPAA: Role-based access control middleware
// Roles hierarchy: admin > manager > viewer
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  manager: 2,
  viewer: 1,
};

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const userRole = req.user.role || "viewer";
    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] ?? 0));
    if (userLevel >= requiredLevel) {
      return next();
    }
    return res.status(403).json({ message: "Insufficient permissions" });
  };
}

/**
 * Middleware to enforce MFA setup for roles that require it (admin, manager).
 * Returns 403 if the user's role requires MFA but they haven't set it up yet.
 * Use on sensitive admin/manager routes to block access until MFA is configured.
 */
export const requireMFASetup: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const userRole = req.user.role || "viewer";
  if (!isMFARoleRequired(userRole)) {
    return next();
  }
  try {
    const mfaRecord = await getMFASecret(req.user.username);
    if (mfaRecord?.enabled) {
      return next();
    }
    return res.status(403).json({ message: "MFA setup required for your role" });
  } catch {
    return res.status(500).json({ message: "Failed to verify MFA status" });
  }
};
