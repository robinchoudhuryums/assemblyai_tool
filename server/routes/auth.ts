import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { sendValidationError } from "./utils";
import { createHash, randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup, getSessionFingerprint, getUserEmployeeId } from "../auth";
import { getMFASecret, saveMFASecret, enableMFA, disableMFA, generateSecret, generateOTPAuthURI, verifyTOTP, isMFARequired, isMFARoleRequired, listMFAUsers, generateRecoveryCodes, countRemainingRecoveryCodes } from "../services/totp";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { logger } from "../services/logger";
import { insertAccessRequestSchema } from "@shared/schema";

/** Stamp session with fingerprint at login — uses the shared getSessionFingerprint() to guarantee
 *  the same hash is computed at login and verification time (single source of truth). */
function bindSessionFingerprint(req: import("express").Request): void {
  (req.session as typeof req.session & { fingerprint?: string }).fingerprint = getSessionFingerprint(req);
}

/**
 * Phase E: emit `user_employee_link_unresolved` audit event when a viewer or
 * manager logs in without a matching employee row. Fires at most once per
 * user per UTC day so the audit log accumulates a time-series signal rather
 * than getting spammed by every request. Purely observational — does not
 * block login. Admins are skipped because they don't need employee linkage.
 *
 * The dedup set is in-memory; a restart will refire the audit once for each
 * active unlinked user on their next login that day. Acceptable trade-off
 * vs. adding a new DB table just for this cheap signal.
 */
const unlinkedLoginAuditDedup = new Set<string>();
// Clean the dedup set daily to prevent unbounded growth.
setInterval(() => unlinkedLoginAuditDedup.clear(), 24 * 60 * 60 * 1000).unref();

function fireUnlinkedLoginAuditIfNeeded(
  req: import("express").Request,
  user: Express.User,
): void {
  // Fire-and-forget. No await — must not block login response.
  void (async () => {
    try {
      if (user.role !== "viewer" && user.role !== "manager") return;
      const employeeId = await getUserEmployeeId(user.username, user.name);
      if (employeeId) return;
      const dayKey = `${user.username}:${new Date().toISOString().slice(0, 10)}`;
      if (unlinkedLoginAuditDedup.has(dayKey)) return;
      unlinkedLoginAuditDedup.add(dayKey);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_employee_link_unresolved",
        ...auditContext(req),
        username: user.username,
        resourceType: "user",
        resourceId: user.id,
        detail: `role=${user.role}; displayName="${user.name}"`,
      });
    } catch (err) {
      logger.warn("unlinked-login audit failed", { error: (err as Error).message });
    }
  })();
}

export function registerAuthRoutes(router: Router) {

  // Temporary store for MFA-pending logins (password verified, awaiting TOTP).
  // Each token also carries an attempts counter so we can invalidate after
  // MFA_MAX_ATTEMPTS bad TOTP submissions — defense against 6-digit brute
  // force within the token's 5-minute lifetime. The per-IP login limiter
  // (5/15min) still applies at the outer layer.
  const MFA_MAX_ATTEMPTS = 5;
  // LRU cap prevents unbounded growth under sustained legitimate login pressure
  // (e.g., deploy-day login spike) between cleanup intervals. On overflow, evict
  // the oldest (insertion-order) entry — that user will be forced to re-enter
  // their password to obtain a fresh token.
  const MFA_PENDING_TOKENS_MAX = 10_000;
  const mfaPendingTokens = new Map<string, { user: Express.User; expires: number; attempts: number }>();
  function setMfaPendingToken(token: string, data: { user: Express.User; expires: number; attempts: number }): void {
    if (mfaPendingTokens.size >= MFA_PENDING_TOKENS_MAX && !mfaPendingTokens.has(token)) {
      const oldest = mfaPendingTokens.keys().next().value;
      if (oldest !== undefined) mfaPendingTokens.delete(oldest);
    }
    mfaPendingTokens.set(token, data);
  }
  // Cleanup expired MFA tokens every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [token, data] of mfaPendingTokens) {
      if (now > data.expires) mfaPendingTokens.delete(token);
    }
  }, 5 * 60 * 1000).unref();

  // Login (supports MFA two-step flow)
  router.post("/api/auth/login", (req, res, next) => {
    // Step 2: MFA verification (if mfaToken provided)
    const { mfaToken, totpCode } = req.body;
    if (mfaToken && totpCode) {
      const pending = mfaPendingTokens.get(mfaToken);
      if (!pending || Date.now() > pending.expires) {
        mfaPendingTokens.delete(mfaToken);
        logPhiAccess({
          timestamp: new Date().toISOString(),
          event: "mfa_session_expired",
          ...auditContext(req),
          username: pending?.user.username,
          resourceType: "auth",
        });
        return res.status(401).json({
          code: "mfa_session_expired",
          message: "MFA session expired. Please log in again.",
        });
      }
      // Verify TOTP — recovery codes accepted via the same input field.
      // 6-digit numeric → TOTP; 10-character alphanumeric → recovery code.
      (async () => {
        try {
          const mfaRecord = await getMFASecret(pending.user.username);
          const trimmed = String(totpCode).trim();
          let verified = false;
          let verifiedVia: "totp" | "recovery_code" = "totp";
          if (mfaRecord) {
            if (/^\d{6}$/.test(trimmed) && verifyTOTP(mfaRecord.secret, trimmed)) {
              verified = true;
              verifiedVia = "totp";
            } else if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
              const { consumeRecoveryCode } = await import("../services/totp");
              if (await consumeRecoveryCode(pending.user.username, trimmed)) {
                verified = true;
                verifiedVia = "recovery_code";
              }
            }
          }
          if (!verified) {
            pending.attempts++;
            if (pending.attempts >= MFA_MAX_ATTEMPTS) {
              mfaPendingTokens.delete(mfaToken);
              logPhiAccess({
                timestamp: new Date().toISOString(),
                event: "mfa_verification_locked",
                ...auditContext(req),
                username: pending.user.username,
                resourceType: "auth",
                detail: `MFA token invalidated after ${MFA_MAX_ATTEMPTS} failed attempts`,
              });
              return res.status(401).json({
                code: "mfa_session_expired",
                message: "Too many failed attempts. Please log in again.",
              });
            }
            logPhiAccess({
              timestamp: new Date().toISOString(),
              event: "mfa_verification_failed",
              ...auditContext(req),
              username: pending.user.username,
              resourceType: "auth",
              detail: `attempt ${pending.attempts}/${MFA_MAX_ATTEMPTS}`,
            });
            return res.status(401).json({ message: "Invalid verification code" });
          }
          mfaPendingTokens.delete(mfaToken);
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: verifiedVia === "recovery_code" ? "mfa_recovery_code_used" : "mfa_verification_succeeded",
            ...auditContext(req),
            username: pending.user.username,
            resourceType: "auth",
          });
          req.login(pending.user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
            if (loginErr) return next(loginErr);
            bindSessionFingerprint(req);
            fireUnlinkedLoginAuditIfNeeded(req, pending.user);
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
          setMfaPendingToken(token, { user, expires: Date.now() + 5 * 60 * 1000, attempts: 0 }); // 5 min expiry
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: "mfa_challenge_issued",
            ...auditContext(req),
            username: user.username,
            resourceType: "auth",
          });
          return res.json({ mfaRequired: true, mfaToken: token });
        }

        // Check if MFA is required (globally or by role) but not set up
        if ((isMFARequired() || isMFARoleRequired(user.role)) && !mfaRecord?.enabled) {
          // Let them in but flag that MFA setup is needed
          req.login(user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
            if (loginErr) return next(loginErr);
            bindSessionFingerprint(req);
            fireUnlinkedLoginAuditIfNeeded(req, user);
            res.json({ id: user.id, username: user.username, name: user.name, role: user.role, mfaSetupRequired: true });
          });
          return;
        }

        // No MFA — standard login
        req.login(user, { keepSessionInfo: true } as any /* Passport 0.7 option not in types */, (loginErr) => {
          if (loginErr) return next(loginErr);
          bindSessionFingerprint(req);
          fireUnlinkedLoginAuditIfNeeded(req, user);
          res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
        });
      } catch (mfaErr) {
        return next(mfaErr);
      }
    })(req, res, next);
  });

  // Logout
  router.post("/api/auth/logout", (req, res) => {
    const usernameForAudit = req.user?.username;
    const auditCtx = auditContext(req);
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      // Destroy the session so the session ID is immediately invalidated in
      // the session store (PostgreSQL or memory), not just cleared of user data.
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          // Session data is already cleared by req.logout(); log and continue
          logger.warn("Failed to destroy session on logout", { error: (destroyErr as Error).message });
        }
        if (usernameForAudit) {
          logPhiAccess({
            timestamp: new Date().toISOString(),
            event: "logout",
            ...auditCtx,
            username: usernameForAudit,
            resourceType: "auth",
          });
        }
        res.json({ message: "Logged out" });
      });
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
      const enabled = mfaRecord?.enabled ?? false;
      let recoveryCodesRemaining = 0;
      if (enabled) {
        recoveryCodesRemaining = await countRemainingRecoveryCodes(req.user!.username);
      }
      res.json({
        enabled,
        required: isMFARequired() || isMFARoleRequired(req.user!.role),
        recoveryCodesRemaining,
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
      // Generate single-use recovery codes at enable time — shown to the user
      // exactly once. They MUST save them now; we never display them again.
      const recoveryCodes = await generateRecoveryCodes(req.user!.username);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "mfa_enabled",
        ...auditContext(req),
        resourceType: "auth",
        detail: `${recoveryCodes.length} recovery codes generated`,
      });
      res.json({ message: "MFA enabled successfully", recoveryCodes });
    } catch (error) {
      res.status(500).json({ message: "Failed to enable MFA" });
    }
  });

  // Regenerate recovery codes (invalidates prior codes). Must be authenticated
  // and MFA-enabled. Returns the full new plaintext set — display once.
  router.post("/api/auth/mfa/recovery-codes/regenerate", requireAuth, async (req, res) => {
    try {
      const mfaRecord = await getMFASecret(req.user!.username);
      if (!mfaRecord?.enabled) {
        return res.status(400).json({ message: "MFA is not enabled for this user" });
      }
      const recoveryCodes = await generateRecoveryCodes(req.user!.username);
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "mfa_recovery_codes_regenerated",
        ...auditContext(req),
        resourceType: "auth",
        detail: `${recoveryCodes.length} recovery codes regenerated (prior codes invalidated)`,
      });
      res.json({ recoveryCodes });
    } catch (error) {
      res.status(500).json({ message: "Failed to regenerate recovery codes" });
    }
  });

  // Disable MFA (admin or self)
  // INV-14: MFA disable is a high-impact state change. Require the caller
  // to themselves be MFA-enrolled when REQUIRE_MFA is on, otherwise an
  // admin without MFA could call this on another admin to lock them out
  // (privilege escalation surface). requireMFASetup is a no-op when
  // REQUIRE_MFA is unset, so dev/staging are unaffected.
  router.post("/api/auth/mfa/disable", requireAuth, requireMFASetup, async (req, res) => {
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
