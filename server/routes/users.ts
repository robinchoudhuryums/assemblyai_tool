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
import { validateIdParam, sendError, sendValidationError, fuzzySimilarity } from "./utils";
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

  // ==================== LINK USER TO EMPLOYEE (admin only) ====================
  // Admin clicks "Link to employee" on the unlinked-users banner → this
  // endpoint updates the user's displayName to match the selected employee's
  // name so getUserEmployeeId() resolves on subsequent requests. Intentionally
  // writes the user side (not the employee side) because the user record is
  // auth-only and changing displayName is safer than changing employee email
  // (which may be consumed by other downstream joins). Employee email
  // edits, if needed, remain available via the existing PATCH /api/employees.
  // Writes a HIPAA audit entry `user_employee_link_created`.
  router.post("/api/users/:id/link-employee", requireAuth, requireMFASetup, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const { employeeId } = (req.body ?? {}) as { employeeId?: string };
      if (!employeeId || typeof employeeId !== "string") {
        return sendError(res, 400, "employeeId is required");
      }

      const [user, employee] = await Promise.all([
        storage.getDbUser(req.params.id),
        storage.getEmployee(employeeId),
      ]);
      if (!user) return sendError(res, 404, "User not found");
      if (employee === undefined) return sendError(res, 404, "Employee not found");

      const updated = await storage.updateDbUser(user.id, { displayName: employee.name });
      if (!updated) return sendError(res, 500, "Failed to update user");

      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "user_employee_link_created",
        username: req.user?.username,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        resourceType: "user",
        resourceId: user.id,
        detail: `linked user=${user.username} to employee=${employee.id} via displayName=${employee.name}`,
      });

      res.json(sanitizeUser(updated));
    } catch (error) {
      logger.error("error linking user to employee", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to link user to employee" });
    }
  });

  // ==================== UNLINKED USERS (admin only) ====================
  // Returns active viewer- AND manager-role users whose username (email) and
  // display name don't match any employee row. These users see empty data
  // + 403s with no error — the single most common "looks authenticated but
  // sees nothing" production puzzle. Mirror of getUserEmployeeId()'s matching
  // logic (email → name).
  //
  // Phase E: extended from viewer-only to viewer+manager (both roles hit
  // the per-employee RBAC paths like /snapshots/employee/:id). Admins are
  // excluded because admins are platform-level — they don't need an employee
  // link and there's no signal value in listing them.
  //
  // Each returned user carries a `candidates` array of up to 3 fuzzy-matched
  // employees (similarity > 0.5, sorted desc) so the admin UI can render a
  // "Did you mean Alice Smith?" suggestion above the full-list dropdown.
  // CA users that RAG has NEVER seen via SSO. Useful diagnostic when a
  // user reports "I can't access the knowledge base" — admins can glance
  // here to see if the user has ever hit RAG at all, which narrows
  // down whether the issue is SSO cookie scope (never seen), permissions
  // (seen but blocked), or something else entirely. Degrades to an
  // empty list when RAG is unreachable so the admin page doesn't
  // crash during a partial outage.
  router.get(
    "/api/admin/users/unseen-by-rag",
    requireAuth,
    requireMFASetup,
    requireRole("admin"),
    async (_req, res) => {
      try {
        const { fetchRagSeenUserIds } = await import("../services/rag-sso-client");
        const [users, { reachable, seen }] = await Promise.all([
          storage.getAllDbUsers(),
          fetchRagSeenUserIds(),
        ]);
        const unseen = reachable
          ? users
              .filter((u) => !seen.has(u.id))
              .filter((u) => u.active !== false) // hide deactivated users
              .map((u) => ({
                id: u.id,
                username: u.username,
                name: u.displayName,
                role: u.role,
                createdAt: u.createdAt ?? null,
              }))
          : [];
        res.json({ ragReachable: reachable, unseen });
      } catch (err) {
        res.status(500).json({
          message: "Failed to fetch unseen-by-rag list",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

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

      // Fuzzy candidates: for a given (username, displayName) pair, find the
      // top-3 employees with similarity > 0.5 against EITHER field. This is
      // the "Did you mean?" hint — the existing full-list dropdown stays as
      // a fallback for picks that don't fuzzy-match.
      const activeEmployees = employees.filter(e => e.status !== "Inactive");
      const suggestCandidates = (username: string | undefined, displayName: string | undefined) => {
        if (!username && !displayName) return [];
        const scored = activeEmployees.map(e => {
          const fromUsername = username ? Math.max(
            fuzzySimilarity(username, e.name),
            e.email ? fuzzySimilarity(username, e.email) : 0,
          ) : 0;
          const fromName = displayName ? Math.max(
            fuzzySimilarity(displayName, e.name),
            e.email ? fuzzySimilarity(displayName, e.email) : 0,
          ) : 0;
          return { id: e.id, name: e.name, email: e.email ?? null, similarity: Math.max(fromUsername, fromName) };
        });
        return scored
          .filter(x => x.similarity > 0.5)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 3)
          .map(x => ({ id: x.id, name: x.name, email: x.email, similarity: Math.round(x.similarity * 100) / 100 }));
      };

      const unlinked = users
        .filter(u => u.active !== false)
        .filter(u => u.role === "viewer" || u.role === "manager")
        .map(sanitizeUser)
        .filter((u: any) => {
          const byEmail = u.username ? emailMap.get(u.username.toLowerCase()) : undefined;
          if (byEmail) return false;
          const byName = u.name ? nameMap.get(u.name.toLowerCase()) : undefined;
          return !byName;
        })
        .map((u: any) => ({
          ...u,
          candidates: suggestCandidates(u.username, u.name),
        }));
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

      // Phase E: prevent-at-creation hint. For viewer/manager roles (who
      // depend on an employee link to see any data), check whether the new
      // account has a matching employee. If not, attach fuzzy candidates to
      // the response so the admin UI can immediately prompt "Did you mean
      // Alice Smith?" and one-click link. Purely additive — existing
      // consumers reading the base user fields are unaffected.
      const response: Record<string, unknown> = sanitizeUser(newUser);
      if (role === "viewer" || role === "manager") {
        const employees = await storage.getAllEmployees();
        const matchByEmail = employees.find(e => e.email?.toLowerCase() === username.toLowerCase());
        const matchByName = employees.find(e => e.name.toLowerCase() === displayName.toLowerCase());
        if (!matchByEmail && !matchByName) {
          const active = employees.filter(e => e.status !== "Inactive");
          const scored = active.map(e => {
            const fromUsername = Math.max(
              fuzzySimilarity(username, e.name),
              e.email ? fuzzySimilarity(username, e.email) : 0,
            );
            const fromName = Math.max(
              fuzzySimilarity(displayName, e.name),
              e.email ? fuzzySimilarity(displayName, e.email) : 0,
            );
            return { id: e.id, name: e.name, email: e.email ?? null, similarity: Math.max(fromUsername, fromName) };
          });
          const candidates = scored
            .filter(x => x.similarity > 0.5)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3)
            .map(x => ({ id: x.id, name: x.name, email: x.email, similarity: Math.round(x.similarity * 100) / 100 }));
          response.warning = {
            code: "no_matching_employee",
            message: "User has no matching employee row — they will see empty data until linked.",
            candidates,
          };
        }
      }

      res.status(201).json(response);
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
