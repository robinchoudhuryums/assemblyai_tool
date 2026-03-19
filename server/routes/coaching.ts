import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";

export function register(router: Router) {
  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  router.get("/api/coaching", requireAuth, requireRole("manager", "admin"), async (_req, res) => {
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

  // Get coaching sessions for a specific employee
  router.get("/api/coaching/employee/:employeeId", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getCoachingSessionsByEmployee(req.params.employeeId);
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Create a coaching session (managers and admins)
  router.post("/api/coaching", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid coaching data", errors: parsed.error.flatten() });
        return;
      }
      const session = await storage.createCoachingSession(parsed.data);
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

  router.patch("/api/coaching/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
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
}
