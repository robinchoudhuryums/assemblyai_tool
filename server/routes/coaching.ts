import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup } from "../auth";
import { insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";
import { triggerWebhook } from "../services/webhooks";
import { validateIdParam, validateParams, sendValidationError } from "./utils";

export function register(router: Router) {
  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  router.get("/api/coaching", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (_req, res) => {
    try {
      const [sessions, employees] = await Promise.all([
        storage.getAllCoachingSessions(),
        storage.getAllEmployees(),
      ]);
      // Build employee lookup map to avoid N+1 queries
      const empMap = new Map(employees.map(e => [e.id, e]));
      const enriched = sessions.map(s => ({
        ...s,
        employeeName: empMap.get(s.employeeId)?.name || "Unknown",
      }));
      res.json(enriched.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Get coaching sessions for a specific employee.
  // F-07: restrict to manager+ — coaching sessions contain performance
  // remediation data that agents should not see for other employees.
  router.get("/api/coaching/employee/:employeeId", requireAuth, requireRole("manager", "admin"), validateParams({ employeeId: "uuid" }), async (req, res) => {
    try {
      const sessions = await storage.getCoachingSessionsByEmployee(req.params.employeeId);
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Create a coaching session (managers and admins)
  router.post("/api/coaching", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        sendValidationError(res, "Invalid coaching data", parsed.error);
        return;
      }
      const session = await storage.createCoachingSession(parsed.data);

      // Trigger coaching.created webhook (non-blocking)
      try {
        const employee = await storage.getEmployee(session.employeeId);
        triggerWebhook("coaching.created", {
          sessionId: session.id,
          employeeId: session.employeeId,
          employeeName: employee?.name,
          title: session.title,
          category: session.category,
          assignedBy: session.assignedBy,
          callId: session.callId || undefined,
        }).catch(() => {});
      } catch {}

      res.status(201).json(session);
    } catch (error) {
      res.status(500).json({ message: "Failed to create coaching session" });
    }
  });

  // Update a coaching session (status, notes, action plan progress)
  const updateCoachingSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "dismissed"]).optional(),
    notes: z.string().optional(),
    actionPlan: z.array(z.object({ task: z.string(), completed: z.boolean() })).optional(),
    title: z.string().min(1).optional(),
    category: z.string().optional(),
    dueDate: z.string().optional(),
  }).strict();

  router.patch("/api/coaching/:id", requireAuth, requireMFASetup, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid update data", parsed.error);
        return;
      }
      const updates: Record<string, any> = { ...parsed.data };
      if (updates.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }
      const updated = await storage.updateCoachingSession(req.params.id, updates);
      if (!updated) {
        res.status(404).json({ message: "Coaching session not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update coaching session" });
    }
  });

  // Agent self-service: toggle a coaching action item's completed status.
  // Agents can only modify their OWN coaching sessions.
  router.patch("/api/coaching/:id/action-item/:index", requireAuth, validateIdParam, async (req, res) => {
    try {
      const sessionId = req.params.id;
      const itemIndex = parseInt(req.params.index, 10);
      if (!Number.isFinite(itemIndex) || itemIndex < 0) {
        return res.status(400).json({ message: "Invalid action item index" });
      }

      const session = await storage.getCoachingSession(sessionId);
      if (!session) return res.status(404).json({ message: "Coaching session not found" });

      // Verify the agent owns this coaching session
      const username = req.user?.username;
      const displayName = req.user?.name;
      const allEmployees = await storage.getAllEmployees();
      const myEmployee = allEmployees.find(e =>
        e.name.toLowerCase() === displayName?.toLowerCase() ||
        e.email?.toLowerCase() === username?.toLowerCase()
      );

      const isOwner = myEmployee && session.employeeId === myEmployee.id;
      const isManagerOrAdmin = req.user?.role === "manager" || req.user?.role === "admin";
      if (!isOwner && !isManagerOrAdmin) {
        return res.status(403).json({ message: "You can only update your own coaching action items" });
      }

      const actionPlan = Array.isArray(session.actionPlan) ? [...session.actionPlan] as Array<{ task: string; completed: boolean }> : [];
      if (itemIndex >= actionPlan.length) {
        return res.status(400).json({ message: "Action item index out of range" });
      }

      actionPlan[itemIndex] = { ...actionPlan[itemIndex], completed: !actionPlan[itemIndex].completed };

      const updated = await storage.updateCoachingSession(sessionId, { actionPlan });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle action item" });
    }
  });
}
