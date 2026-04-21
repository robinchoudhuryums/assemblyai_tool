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

  // Coaching outcomes: compare sub-score averages in N calls before vs N calls
  // after a coaching session to measure effectiveness. Restricted to manager+
  // because coaching session data is manager-only.
  router.get("/api/coaching/:id/outcome", requireAuth, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const session = await storage.getCoachingSession(req.params.id);
      if (!session) return res.status(404).json({ message: "Coaching session not found" });

      // Default window of 10 calls before/after. Clamped to [1, 50].
      const nRaw = parseInt((req.query.n as string) || "10", 10);
      const N = Math.max(1, Math.min(Number.isFinite(nRaw) ? nRaw : 10, 50));

      const sessionCreatedAt = new Date(session.createdAt || 0).getTime();
      if (!sessionCreatedAt || !Number.isFinite(sessionCreatedAt)) {
        return res.status(400).json({ message: "Coaching session has no valid createdAt timestamp" });
      }

      // Load all completed calls for the employee, ordered by uploadedAt.
      const allCalls = await storage.getCallsWithDetails({
        status: "completed",
        employee: session.employeeId,
      });
      // Split into before/after buckets by session creation time.
      const withTs = allCalls
        .map(c => ({ call: c, ts: new Date(c.uploadedAt || 0).getTime() }))
        .filter(x => Number.isFinite(x.ts) && x.ts > 0)
        .sort((a, b) => a.ts - b.ts);
      const beforeAll = withTs.filter(x => x.ts < sessionCreatedAt);
      const afterAll = withTs.filter(x => x.ts >= sessionCreatedAt);
      // Take the N closest to the session boundary (most recent before, earliest after).
      const beforeWindow = beforeAll.slice(-N).map(x => x.call);
      const afterWindow = afterAll.slice(0, N).map(x => x.call);

      const avgField = (calls: typeof allCalls, getField: (c: typeof allCalls[number]) => number | undefined): number | null => {
        const vals = calls.map(getField).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (vals.length === 0) return null;
        return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
      };

      const buildWindow = (calls: typeof allCalls) => ({
        callCount: calls.length,
        avgScore: avgField(calls, c => parseFloat(c.analysis?.performanceScore || "")),
        subScores: {
          compliance: avgField(calls, c => (c.analysis?.subScores as { compliance?: number } | undefined)?.compliance),
          customerExperience: avgField(calls, c => (c.analysis?.subScores as { customerExperience?: number } | undefined)?.customerExperience),
          communication: avgField(calls, c => (c.analysis?.subScores as { communication?: number } | undefined)?.communication),
          resolution: avgField(calls, c => (c.analysis?.subScores as { resolution?: number } | undefined)?.resolution),
        },
      });

      const before = buildWindow(beforeWindow);
      const after = buildWindow(afterWindow);

      const delta = (a: number | null, b: number | null): number | null => {
        if (a === null || b === null) return null;
        return Math.round((b - a) * 100) / 100;
      };

      // Flag insufficient data: require at least 3 calls in each window for a
      // meaningful comparison. Fewer calls → "insufficient_data" signal to UI.
      const MIN_WINDOW = 3;
      const insufficient = before.callCount < MIN_WINDOW || after.callCount < MIN_WINDOW;

      res.json({
        coachingSessionId: session.id,
        employeeId: session.employeeId,
        coachingCreatedAt: session.createdAt,
        windowSize: N,
        minWindow: MIN_WINDOW,
        insufficientData: insufficient,
        before,
        after,
        deltas: {
          overall: delta(before.avgScore, after.avgScore),
          compliance: delta(before.subScores.compliance, after.subScores.compliance),
          customerExperience: delta(before.subScores.customerExperience, after.subScores.customerExperience),
          communication: delta(before.subScores.communication, after.subScores.communication),
          resolution: delta(before.subScores.resolution, after.subScores.resolution),
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute coaching outcome" });
    }
  });

  // Aggregate coaching effectiveness across all sessions in a time window.
  // Reuses the same before/after window logic as /api/coaching/:id/outcome
  // but rolls up the results so managers can see program-wide impact at a
  // glance instead of clicking into each session.
  router.get("/api/coaching/outcomes-summary", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (req, res) => {
    try {
      const windowDaysRaw = parseInt((req.query.days as string) || "90", 10);
      const windowDays = Math.max(7, Math.min(Number.isFinite(windowDaysRaw) ? windowDaysRaw : 90, 365));
      const perSessionN = 10;
      const MIN_WINDOW = 3;
      const cutoff = Date.now() - windowDays * 86400000;

      const sessions = await storage.getAllCoachingSessions();
      const windowedSessions = sessions.filter(s => {
        const t = new Date(s.createdAt || 0).getTime();
        return Number.isFinite(t) && t > 0 && t >= cutoff;
      });

      // Group completed calls per employee so we don't re-query inside the loop.
      const byEmployee = new Map<string, { call: any; ts: number }[]>();
      for (const s of windowedSessions) {
        if (byEmployee.has(s.employeeId)) continue;
        const empCalls = await storage.getCallsWithDetails({
          status: "completed",
          employee: s.employeeId,
        });
        const withTs = empCalls
          .map(c => ({ call: c, ts: new Date(c.uploadedAt || 0).getTime() }))
          .filter(x => Number.isFinite(x.ts) && x.ts > 0)
          .sort((a, b) => a.ts - b.ts);
        byEmployee.set(s.employeeId, withTs);
      }

      const avgScore = (window: { call: any }[]): number | null => {
        const vals = window
          .map(x => parseFloat(x.call.analysis?.performanceScore || ""))
          .filter((v): v is number => Number.isFinite(v));
        if (vals.length === 0) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      };

      let measured = 0;
      let insufficient = 0;
      let positive = 0;
      let neutral = 0;
      let negative = 0;
      let deltaSum = 0;
      let deltaCount = 0;

      for (const s of windowedSessions) {
        const sessionTs = new Date(s.createdAt || 0).getTime();
        const empCalls = byEmployee.get(s.employeeId) || [];
        const before = empCalls.filter(x => x.ts < sessionTs).slice(-perSessionN);
        const after = empCalls.filter(x => x.ts >= sessionTs).slice(0, perSessionN);
        if (before.length < MIN_WINDOW || after.length < MIN_WINDOW) {
          insufficient++;
          continue;
        }
        const bAvg = avgScore(before);
        const aAvg = avgScore(after);
        if (bAvg === null || aAvg === null) {
          insufficient++;
          continue;
        }
        measured++;
        const d = aAvg - bAvg;
        deltaSum += d;
        deltaCount++;
        if (d >= 0.5) positive++;
        else if (d <= -0.5) negative++;
        else neutral++;
      }

      res.json({
        windowDays,
        totalSessions: windowedSessions.length,
        measured,
        insufficientData: insufficient,
        positiveCount: positive,
        neutralCount: neutral,
        negativeCount: negative,
        avgOverallDelta: deltaCount > 0 ? Math.round((deltaSum / deltaCount) * 100) / 100 : null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute outcomes summary" });
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

      // F-18: verify the agent owns this coaching session. Prioritize email→username
      // match (more unique) over display-name match (can collide across employees).
      const username = req.user?.username;
      const displayName = req.user?.name;
      const allEmployees = await storage.getAllEmployees();
      const myEmployee =
        allEmployees.find(e => e.email?.toLowerCase() === username?.toLowerCase()) ||
        allEmployees.find(e => e.name.toLowerCase() === displayName?.toLowerCase()) ||
        null;

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
