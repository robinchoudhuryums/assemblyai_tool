import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, RequestHandler } from "express";
import { logPhiAccess } from "./services/audit-log";

const scryptAsync = promisify(scrypt);

// HIPAA: Login attempt tracking for account lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>();

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

function recordFailedAttempt(username: string): void {
  const record = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`[SECURITY] Account "${username}" locked after ${record.count} failed attempts.`);
  }
  loginAttempts.set(username, record);
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
  const [hashedPassword, salt] = stored.split(".");
  const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
  const suppliedPasswordBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
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
    if (parts.length < 2) {
      console.warn(`Skipping malformed AUTH_USERS entry: ${entry}`);
      continue;
    }

    const [username, password, role = "viewer", ...nameParts] = parts;
    const displayName = nameParts.length > 0 ? nameParts.join(":") : username;

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

// Extend Express types for session user
declare global {
  namespace Express {
    interface User {
      id: string;
      username: string;
      name: string;
      role: string;
    }
  }
}

export async function setupAuth(app: Express) {
  // Load users from environment variables on startup
  await loadUsersFromEnv();

  // HIPAA: Session configuration with proper memory store and idle timeout
  const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET not set - using random secret (sessions will not persist across restarts)");
  }

  // Use MemoryStore to prevent memory leaks and support session expiry
  const MemoryStore = createMemoryStore(session);

  // HIPAA: 15-minute idle timeout (addressable requirement, standard in healthcare)
  const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const SESSION_ABSOLUTE_MAX_MS = 8 * 60 * 60 * 1000; // 8 hours absolute max

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({
        checkPeriod: 60 * 1000, // Prune expired entries every minute
      }),
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: SESSION_IDLE_TIMEOUT_MS,
        sameSite: "lax",
      },
      // HIPAA: rolling=true resets cookie expiry on each request (acts as idle timeout).
      // maxAge=15min means session expires after 15 minutes of inactivity.
      rolling: true,
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy: authenticate against env-var-defined users
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

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
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
export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
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
    if (allowedRoles.includes(userRole)) {
      return next();
    }
    // Admin always has access
    if (userRole === "admin") {
      return next();
    }
    return res.status(403).json({ message: "Insufficient permissions" });
  };
}
