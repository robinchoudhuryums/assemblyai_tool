import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, RequestHandler } from "express";

const scryptAsync = promisify(scrypt);

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

  // Session configuration
  const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
  if (!process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET not set - using random secret (sessions will not persist across restarts)");
  }

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Local strategy: authenticate against env-var-defined users
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = envUsers.find((u) => u.username === username);
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        const isValid = await comparePasswords(password, user.passwordHash);
        if (!isValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
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
