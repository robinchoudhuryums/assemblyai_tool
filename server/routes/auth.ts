import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { sendValidationError } from "./utils";
import { createHash, randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole, getSessionFingerprint } from "../auth";
import { getMFASecret, saveMFASecret, enableMFA, disableMFA, generateSecret, generateOTPAuthURI, verifyTOTP, isMFARequired, isMFARoleRequired, listMFAUsers } from "../services/totp";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { insertAccessRequestSchema } from "@shared/schema";

/** Stamp session with fingerprint at login — uses the shared getSessionFingerprint() to guarantee
 *  the same hash is computed at login and verification time (single source of truth). */
function bindSessionFingerprint(req: import("express").Request): void {
  (req.session as typeof req.session & { fingerprint?: string }).fingerprint = getSessionFingerprint(req);
}

export function registerAuthRoutes(router: Router) {

  // Temporary store for MFA-pending logins (password verified, awaiting TOTP)
  const mfaPendingTokens = new Map<string, { user: Express.User; expires: number }>();
  // Cleanup expired MFA tokens every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [token, data] of mfaPendingTokens) {
      if (now > data.expires) mfaPendingTokens.delete(token);
    }
  }, 5 * 60 * 1000);

  // Login (supports MFA two-step flow)
  router.post("/api/auth/login", (req, res, next) => {
    // Step 2: MFA verification (if mfaToken provided)
    const { mfaToken, totpCode } = req.body;
    if (mfaToken && totpCode) {
      const pending = mfaPendingTokens.get(mfaToken);
      if (!pending || Date.now() > pending.expires) {
        mfaPendingTokens.delete(mfaToken);
        return res.status(401).json({ message: "MFA session expired. Please log in again." });
      }
      // Verify TOTP
      (async () => {
        try {
          const mfaRecord = await getMFASecret(pending.user.username);
          if (!mfaRecord || !verifyTOTP(mfaRecord.secret, totpCode)) {
            return res.status(401).json({ message: "Invalid verification code" });
          }
          mfaPendingTokens.delete(mfaToken);
          req.login(pending.user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
            if (loginErr) return next(loginErr);
            bindSessionFingerprint(req);
            res.json({ id: pending.user.id, username: pending.user.username, name: pending.user.name, role: pending.user.role });
          });
        } catch (err) {
          return next(err);
        }
      })();
      return;
    }

    // Step 1: Password authentication
    passport.authenticate("local", async (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }

      try {
        // Check if MFA is enabled for this user
        const mfaRecord = await getMFASecret(user.username);
        if (mfaRecord?.enabled) {
          // MFA required — issue temporary token, don't create session yet
          const token = randomUUID();
          mfaPendingTokens.set(token, { user, expires: Date.now() + 5 * 60 * 1000 }); // 5 min expiry
          return res.json({ mfaRequired: true, mfaToken: token });
        }

        // Check if MFA is required (globally or by role) but not set up
        if ((isMFARequired() || isMFARoleRequired(user.role)) && !mfaRecord?.enabled) {
          // Let them in but flag that MFA setup is needed
          req.login(user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
            if (loginErr) return next(loginErr);
            bindSessionFingerprint(req);
            res.json({ id: user.id, username: user.username, name: user.name, role: user.role, mfaSetupRequired: true });
          });
          return;
        }

        // No MFA — standard login
        req.login(user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
          if (loginErr) return next(loginErr);
          bindSessionFingerprint(req);
          res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
        });
      } catch (mfaErr) {
        return next(mfaErr);
      }
    })(req, res, next);
  });

  // Logout
  router.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      res.json({ message: "Logged out" });
    });
  });

  // Get current session user
  router.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  // ==================== MFA ROUTES (authenticated) ====================

  // Get MFA status for current user
  router.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
    try {
      const mfaRecord = await getMFASecret(req.user!.username);
      res.json({
        enabled: mfaRecord?.enabled ?? false,
        required: isMFARequired() || isMFARoleRequired(req.user!.role),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to check MFA status" });
    }
  });

  // Begin MFA setup — generate secret and return otpauth URI
  router.post("/api/auth/mfa/setup", requireAuth, async (req, res) => {
    try {
      const secret = generateSecret();
      const uri = generateOTPAuthURI(req.user!.username, secret);
      // Save secret but don't enable yet (user must verify first)
      await saveMFASecret(req.user!.username, secret, false);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "mfa_setup_initiated",
        ...auditContext(req),
        resourceType: "auth",
      });
      res.json({ secret, uri });
    } catch (error) {
      res.status(500).json({ message: "Failed to set up MFA" });
    }
  });

  // Verify TOTP code and enable MFA
  router.post("/api/auth/mfa/enable", requireAuth, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code required" });
      }
      const mfaRecord = await getMFASecret(req.user!.username);
      if (!mfaRecord) {
        return res.status(400).json({ message: "Run MFA setup first" });
      }
      if (!verifyTOTP(mfaRecord.secret, code)) {
        return res.status(401).json({ message: "Invalid verification code" });
      }
      await enableMFA(req.user!.username);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "mfa_enabled",
        ...auditContext(req),
        resourceType: "auth",
      });
      res.json({ message: "MFA enabled successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to enable MFA" });
    }
  });

  // Disable MFA (admin or self)
  router.post("/api/auth/mfa/disable", requireAuth, async (req, res) => {
    try {
      const targetUser = req.body.username || req.user!.username;
      // Only admins can disable MFA for other users
      if (targetUser !== req.user!.username && req.user!.role !== "admin") {
        return res.status(403).json({ message: "Only admins can disable MFA for other users" });
      }
      await disableMFA(targetUser);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "mfa_disabled",
        ...auditContext(req),
        resourceType: "auth",
        detail: `MFA disabled for ${targetUser}`,
      });
      res.json({ message: `MFA disabled for ${targetUser}` });
    } catch (error) {
      res.status(500).json({ message: "Failed to disable MFA" });
    }
  });

  // List MFA-enabled users (admin only)
  router.get("/api/auth/mfa/users", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const users = await listMFAUsers();
      res.json(users.map((u) => ({ username: u.username, enabled: u.enabled, createdAt: u.createdAt })));
    } catch (error) {
      res.status(500).json({ message: "Failed to list MFA users" });
    }
  });

  // ==================== ACCESS REQUEST ROUTES (unauthenticated) ====================

  // Submit an access request (public — anyone can request from login page)
  router.post("/api/access-requests", async (req, res) => {
    try {
      const parsed = insertAccessRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid request data", parsed.error);
        return;
      }
      const request = await storage.createAccessRequest(parsed.data);
      res.status(201).json({ message: "Access request submitted. An administrator will review your request.", id: request.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit access request" });
    }
  });

  // ==================== ACCESS REQUEST ADMIN ROUTES (admin only) ====================

  // List all access requests
  router.get("/api/access-requests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const requests = await storage.getAllAccessRequests();
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch access requests" });
    }
  });

  // Approve or deny an access request
  const accessRequestUpdateSchema = z.object({
    status: z.enum(["approved", "denied"]),
  }).strict();

  router.patch("/api/access-requests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const parsed = accessRequestUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Status must be 'approved' or 'denied'" });
        return;
      }
      const updated = await storage.updateAccessRequest(req.params.id, {
        status: parsed.data.status,
        reviewedBy: req.user?.username,
        reviewedAt: new Date().toISOString(),
      });
      if (!updated) {
        res.status(404).json({ message: "Access request not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update access request" });
    }
  });
}
