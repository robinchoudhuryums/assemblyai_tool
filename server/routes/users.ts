import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup, validatePasswordComplexity, hashPasswordForDb, comparePasswordsRaw, isPasswordReused, PASSWORD_HISTORY_SIZE } from "../auth";
import { logPhiAccess } from "../services/audit-log";
import {
  createDbUserSchema,
  updateDbUserSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "@shared/schema";
import { validateIdParam, sendError, sendValidationError } from "./utils";
import { getPool } from "../db/pool";
import { logger } from "../services/logger";

/**
 * Strips password_hash and mfa_secret from a DB user object before returning to API clients.
 */
function sanitizeUser(user: any) {
  const { passwordHash, mfaSecret, ...safe } = user;
  return safe;
}

export function registerUserRoutes(router: Router) {

  // ==================== LIST ALL USERS (admin only) ====================
  router.get("/api/users", requireAuth, requireMFASetup, requireRole("admin"), async (_req, res) => {
    try {
      const users = await storage.getAllDbUsers();
      res.json(users.map(sanitizeUser));
    } catch (error) {
      logger.error("error fetching users", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // ==================== UNLINKED USERS (admin only) ====================
  // Returns viewer-role users whose username (email) and display name don't
  // match any employee row. These users see empty data + 403s with no error —
  // the single most common "looks authenticated but sees nothing" production
  // puzzle. Mirror of getUserEmployeeId()'s matching logic (email → name).
  router.get("/api/users/unlinked", requireAuth, requireMFASetup, requireRole("admin"), async (_req, res) => {
    try {
      const [users, employees] = await Promise.all([
        storage.getAllDbUsers(),
        storage.getAllEmployees(),
      ]);
      const emailMap = new Map<string, string>();
      const nameMap = new Map<string, string>();
      for (const emp of employees) {
        if (emp.email) emailMap.set(emp.email.toLowerCase(), emp.id);
        nameMap.set(emp.name.toLowerCase(), emp.id);
      }
      const unlinked = users
        .filter(u => u.active !== false)
        .filter(u => u.role === "viewer")
        .map(sanitizeUser)
        .filter((u: any) => {
          const byEmail = u.username ? emailMap.get(u.username.toLowerCase()) : undefined;
          if (byEmail) return false;
          const byName = u.name ? nameMap.get(u.name.toLowerCase()) : undefined;
          return !byName;
        });
      res.json({ count: unlinked.length, users: unlinked });
    } catch (error) {
      logger.error("error fetching unlinked users", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch unlinked users" });
    }
  });

  // ==================== CREATE USER (admin only) ====================
  router.post("/api/users", requireAuth, requireMFASetup, requireRole("admin"), async (req, res) => {
    try {
      const parsed = createDbUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid user data", parsed.error);
      }

      const { username, password, role, displayName } = parsed.data;

      // Validate password complexity
      const complexity = validatePasswordComplexity(password);
      if (!complexity.valid) {
        return res.status(400).json({
          message: "Password does not meet complexity requirements",
          errors: complexity.errors,
        });
      }

      // Check if username already exists
      const existing = await storage.getDbUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const passwordHash = await hashPasswordForDb(password);
      const newUser = await storage.createDbUser({
        username,
        passwordHash,
        role,
        displayName,
      });

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_created",
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        resourceType: "user",
        resourceId: newUser.id,
        detail: `Created user "${username}" with role "${role}"`,
      });

      res.status(201).json(sanitizeUser(newUser));
    } catch (error) {
      logger.error("error creating user", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // ==================== UPDATE USER (admin only) ====================
  router.patch("/api/users/:id", requireAuth, requireMFASetup, requireRole("admin"), async (req, res, next) => {
    try {
      // Prevent route collision with /api/users/me/password
      if (req.params.id === "me") return next();

      // Validate UUID format (can't use middleware because "me" must pass through first)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid id parameter" });
      }

      const parsed = updateDbUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid update data", parsed.error);
      }

      const targetUser = await storage.getDbUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const updated = await storage.updateDbUser(req.params.id, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      const changes: string[] = [];
      if (parsed.data.role !== undefined) changes.push(`role=${parsed.data.role}`);
      if (parsed.data.displayName !== undefined) changes.push(`displayName="${parsed.data.displayName}"`);
      if (parsed.data.active !== undefined) changes.push(`active=${parsed.data.active}`);

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_updated",
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        resourceType: "user",
        resourceId: req.params.id,
        detail: `Updated user "${targetUser.username}": ${changes.join(", ")}`,
      });

      res.json(sanitizeUser(updated));
    } catch (error) {
      logger.error("error updating user", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // ==================== DEACTIVATE USER (admin only, soft delete) ====================
  router.delete("/api/users/:id", requireAuth, requireMFASetup, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const targetUser = await storage.getDbUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Prevent admin from deactivating themselves
      if (targetUser.username === req.user!.username) {
        return res.status(400).json({ message: "Cannot deactivate your own account" });
      }

      const updated = await storage.updateDbUser(req.params.id, { active: false });
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      // F-12: immediately kill all active sessions for the deactivated user
      // so they cannot continue accessing PHI until idle timeout (up to 15 min).
      // The session table stores passport user ID in sess::jsonb->'passport'->>'user'.
      try {
        const pool = getPool();
        if (pool) {
          const { rowCount } = await pool.query(
            `DELETE FROM session WHERE sess::jsonb->'passport'->>'user' = $1`,
            [req.params.id],
          );
          if (rowCount && rowCount > 0) {
            logger.info("auth: purged sessions for deactivated user", {
              targetUsername: targetUser.username,
              sessionsDeleted: rowCount,
            });
          }
        }
      } catch (sessionErr) {
        // Non-blocking — deserializeUser already checks active flag on next request.
        // Log so operators know the purge failed and there's a residual window.
        logger.warn("auth: failed to purge sessions for deactivated user", {
          targetUsername: targetUser.username,
          error: (sessionErr as Error).message,
        });
      }

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_deactivated",
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        resourceType: "user",
        resourceId: req.params.id,
        detail: `Deactivated user "${targetUser.username}"`,
      });

      res.json({ message: "User deactivated", user: sanitizeUser(updated) });
    } catch (error) {
      logger.error("error deactivating user", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });

  // ==================== ADMIN RESET PASSWORD (admin only) ====================
  router.post("/api/users/:id/reset-password", requireAuth, requireMFASetup, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid password data", parsed.error);
      }

      const { newPassword } = parsed.data;

      // Validate password complexity
      const complexity = validatePasswordComplexity(newPassword);
      if (!complexity.valid) {
        return res.status(400).json({
          message: "Password does not meet complexity requirements",
          errors: complexity.errors,
        });
      }

      const targetUser = await storage.getDbUser(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // HIPAA: Check password history (prevent reuse of last N passwords)
      const history = await storage.getDbUserPasswordHistory(req.params.id);
      if (await isPasswordReused(newPassword, targetUser.passwordHash, history)) {
        return res.status(400).json({
          message: `Cannot reuse any of the user's last ${PASSWORD_HISTORY_SIZE} passwords.`,
        });
      }

      const passwordHash = await hashPasswordForDb(newPassword);
      const success = await storage.updateDbUserPassword(req.params.id, passwordHash, targetUser.passwordHash);
      if (!success) {
        return res.status(500).json({ message: "Failed to reset password" });
      }

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_password_reset",
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        resourceType: "user",
        resourceId: req.params.id,
        detail: `Admin reset password for user "${targetUser.username}"`,
      });

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      logger.error("error resetting password", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ==================== SELF-SERVICE PASSWORD CHANGE (any authenticated user) ====================
  // requireMFASetup is a no-op unless REQUIRE_MFA=true. When MFA is enforced,
  // an admin/manager must have MFA set up to change their own password —
  // consistent with every other manager/admin-gated mutation in the codebase.
  // Viewers are exempt (requireMFASetup only gates admin/manager roles).
  router.patch("/api/users/me/password", requireAuth, requireMFASetup, async (req, res) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid password data", parsed.error);
      }

      const { currentPassword, newPassword } = parsed.data;

      // Validate new password complexity
      const complexity = validatePasswordComplexity(newPassword);
      if (!complexity.valid) {
        return res.status(400).json({
          message: "New password does not meet complexity requirements",
          errors: complexity.errors,
        });
      }

      // Look up the user in the DB
      const dbUser = await storage.getDbUserByUsername(req.user!.username);
      if (!dbUser) {
        return res.status(400).json({
          message: "Password change not available for env-var-based accounts. Contact an administrator.",
        });
      }

      // Verify current password
      const isValid = await comparePasswordsRaw(currentPassword, dbUser.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // HIPAA: Check password history (prevent reuse of last N passwords)
      const history = await storage.getDbUserPasswordHistory(dbUser.id);
      if (await isPasswordReused(newPassword, dbUser.passwordHash, history)) {
        return res.status(400).json({
          message: `Cannot reuse any of your last ${PASSWORD_HISTORY_SIZE} passwords. Choose a different password.`,
        });
      }

      const passwordHash = await hashPasswordForDb(newPassword);
      const success = await storage.updateDbUserPassword(dbUser.id, passwordHash, dbUser.passwordHash);
      if (!success) {
        return res.status(500).json({ message: "Failed to change password" });
      }

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_password_changed",
        userId: req.user!.id,
        username: req.user!.username,
        role: req.user!.role,
        resourceType: "user",
        detail: "User changed their own password",
      });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      logger.error("error changing password", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}
