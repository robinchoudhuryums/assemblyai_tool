import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, validatePasswordComplexity, hashPasswordForDb, comparePasswordsRaw, isPasswordReused, PASSWORD_HISTORY_SIZE } from "../auth";
import { logPhiAccess } from "../services/audit-log";
import {
  createDbUserSchema,
  updateDbUserSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "@shared/schema";
import { validateIdParam, sendError, sendValidationError } from "./utils";

/**
 * Strips password_hash and mfa_secret from a DB user object before returning to API clients.
 */
function sanitizeUser(user: any) {
  const { passwordHash, mfaSecret, ...safe } = user;
  return safe;
}

export function registerUserRoutes(router: Router) {

  // ==================== LIST ALL USERS (admin only) ====================
  router.get("/api/users", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const users = await storage.getAllDbUsers();
      res.json(users.map(sanitizeUser));
    } catch (error) {
      console.error("Error fetching users:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // ==================== CREATE USER (admin only) ====================
  router.post("/api/users", requireAuth, requireRole("admin"), async (req, res) => {
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
      console.error("Error creating user:", (error as Error).message);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // ==================== UPDATE USER (admin only) ====================
  router.patch("/api/users/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
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
      console.error("Error updating user:", (error as Error).message);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // ==================== DEACTIVATE USER (admin only, soft delete) ====================
  router.delete("/api/users/:id", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
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
      console.error("Error deactivating user:", (error as Error).message);
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });

  // ==================== ADMIN RESET PASSWORD (admin only) ====================
  router.post("/api/users/:id/reset-password", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
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
      console.error("Error resetting password:", (error as Error).message);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ==================== SELF-SERVICE PASSWORD CHANGE (any authenticated user) ====================
  router.patch("/api/users/me/password", requireAuth, async (req, res) => {
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
      console.error("Error changing password:", (error as Error).message);
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}
