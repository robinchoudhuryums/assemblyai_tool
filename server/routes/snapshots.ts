/**
 * Performance Snapshot Routes
 *
 * API endpoints for generating, viewing, and managing periodic performance
 * snapshots at employee, team, department, and company levels.
 */

import type { Router } from "express";
import { randomUUID } from "crypto";
import type { JobQueue } from "../services/job-queue";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { logger } from "../services/logger";
import { validateParams } from "./utils";
import {
  aggregateMetrics,
  buildSnapshotSummaryPrompt,
  saveSnapshot,
  getSnapshots,
  getLatestSnapshot,
  getAllSnapshotsForLevel,
  resetSnapshotContext,
  type PerformanceSnapshot,
  type SnapshotLevel,
} from "../services/performance-snapshots";

const COMPANY_NAME = process.env.COMPANY_NAME || "UMS (United Medical Supply)";

// ==================== SNAPSHOT GENERATION (module-level) ====================
// A8/F18: lifted out of registerSnapshotRoutes so the job worker in routes.ts
// can call them. The on-demand routes wrap them as before; the batch route
// enqueues a "batch_snapshots" job which runs runBatchSnapshots() async.

export async function generateEmployeeSnapshot(
  employeeId: string, name: string, role: string | undefined,
  from: string, to: string, generatedBy: string
): Promise<PerformanceSnapshot> {
  const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  const filtered = allCalls.filter(c => {
    const d = new Date(c.uploadedAt || 0);
    return d >= fromDate && d <= toDate;
  });

  const metrics = aggregateMetrics(filtered);
  const priorSnapshots = await getSnapshots("employee", employeeId, 6);

  let aiSummary: string | null = null;
  if (aiProvider.isAvailable && aiProvider.generateText && metrics.totalCalls > 0) {
    const prompt = buildSnapshotSummaryPrompt({
      level: "employee",
      targetName: name,
      periodLabel: `${from} to ${to}`,
      metrics,
      priorSnapshots,
      role,
    });
    try {
      aiSummary = await aiProvider.generateText(prompt);
    } catch (err) {
      logger.warn("snapshot AI summary failed", { level: "employee", name, error: (err as Error).message });
    }
  }

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    level: "employee",
    targetId: employeeId,
    targetName: name,
    periodStart: from,
    periodEnd: to,
    metrics,
    aiSummary,
    priorSnapshotIds: priorSnapshots.slice(0, 6).map(s => s.id),
    generatedBy,
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  return snapshot;
}

export async function generateTeamSnapshot(
  teamName: string, from: string, to: string, generatedBy: string
): Promise<PerformanceSnapshot> {
  const employees = await storage.getAllEmployees();
  const teamMembers = employees.filter(e => e.subTeam === teamName && e.status === "Active");

  const allCalls = await storage.getCallsWithDetails({ status: "completed" });
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);
  const teamMemberIds = new Set(teamMembers.map(e => e.id));

  const filtered = allCalls.filter(c => {
    if (!c.employeeId || !teamMemberIds.has(c.employeeId)) return false;
    const d = new Date(c.uploadedAt || 0);
    return d >= fromDate && d <= toDate;
  });

  const metrics = aggregateMetrics(filtered);
  const priorSnapshots = await getSnapshots("team", teamName, 6);

  let aiSummary: string | null = null;
  if (aiProvider.isAvailable && aiProvider.generateText && metrics.totalCalls > 0) {
    const prompt = buildSnapshotSummaryPrompt({
      level: "team",
      targetName: teamName,
      periodLabel: `${from} to ${to}`,
      metrics,
      priorSnapshots,
      memberCount: teamMembers.length,
    });
    try {
      aiSummary = await aiProvider.generateText(prompt);
    } catch (err) {
      logger.warn("snapshot AI summary failed", { level: "team", teamName, error: (err as Error).message });
    }
  }

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    level: "team",
    targetId: teamName,
    targetName: teamName,
    periodStart: from,
    periodEnd: to,
    metrics,
    aiSummary,
    priorSnapshotIds: priorSnapshots.slice(0, 6).map(s => s.id),
    generatedBy,
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  return snapshot;
}

export async function generateDepartmentSnapshot(
  department: string, from: string, to: string, generatedBy: string
): Promise<PerformanceSnapshot> {
  const employees = await storage.getAllEmployees();
  const deptMembers = employees.filter(e => e.role === department && e.status === "Active");

  const allCalls = await storage.getCallsWithDetails({ status: "completed" });
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);
  const deptMemberIds = new Set(deptMembers.map(e => e.id));

  const filtered = allCalls.filter(c => {
    if (!c.employeeId || !deptMemberIds.has(c.employeeId)) return false;
    const d = new Date(c.uploadedAt || 0);
    return d >= fromDate && d <= toDate;
  });

  const metrics = aggregateMetrics(filtered);
  const priorSnapshots = await getSnapshots("department", department, 6);

  let aiSummary: string | null = null;
  if (aiProvider.isAvailable && aiProvider.generateText && metrics.totalCalls > 0) {
    const prompt = buildSnapshotSummaryPrompt({
      level: "department",
      targetName: department,
      periodLabel: `${from} to ${to}`,
      metrics,
      priorSnapshots,
      memberCount: deptMembers.length,
    });
    try {
      aiSummary = await aiProvider.generateText(prompt);
    } catch (err) {
      logger.warn("snapshot AI summary failed", { level: "department", department, error: (err as Error).message });
    }
  }

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    level: "department",
    targetId: department,
    targetName: department,
    periodStart: from,
    periodEnd: to,
    metrics,
    aiSummary,
    priorSnapshotIds: priorSnapshots.slice(0, 6).map(s => s.id),
    generatedBy,
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  return snapshot;
}

export async function generateCompanySnapshot(
  from: string, to: string, generatedBy: string
): Promise<PerformanceSnapshot> {
  const allCalls = await storage.getCallsWithDetails({ status: "completed" });
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  const filtered = allCalls.filter(c => {
    const d = new Date(c.uploadedAt || 0);
    return d >= fromDate && d <= toDate;
  });

  const employees = await storage.getAllEmployees();
  const activeCount = employees.filter(e => e.status === "Active").length;

  const metrics = aggregateMetrics(filtered);
  const priorSnapshots = await getSnapshots("company", "company", 6);

  let aiSummary: string | null = null;
  if (aiProvider.isAvailable && aiProvider.generateText && metrics.totalCalls > 0) {
    const prompt = buildSnapshotSummaryPrompt({
      level: "company",
      targetName: COMPANY_NAME,
      periodLabel: `${from} to ${to}`,
      metrics,
      priorSnapshots,
      memberCount: activeCount,
    });
    try {
      aiSummary = await aiProvider.generateText(prompt);
    } catch (err) {
      logger.warn("snapshot AI summary failed", { level: "company", error: (err as Error).message });
    }
  }

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    level: "company",
    targetId: "company",
    targetName: COMPANY_NAME,
    periodStart: from,
    periodEnd: to,
    metrics,
    aiSummary,
    priorSnapshotIds: priorSnapshots.slice(0, 6).map(s => s.id),
    generatedBy,
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  return snapshot;
}

export interface BatchSnapshotResults {
  employees: Array<{ id: string; name: string; snapshotId: string }>;
  teams: Array<{ name: string; snapshotId: string }>;
  departments: Array<{ name: string; snapshotId: string }>;
  company: string | null;
  errors: string[];
}

export async function generateBatchSnapshots(
  from: string, to: string, generatedBy: string,
): Promise<BatchSnapshotResults> {
  const results: BatchSnapshotResults = {
    employees: [],
    teams: [],
    departments: [],
    company: null,
    errors: [],
  };

  const employees = await storage.getAllEmployees();
  const activeEmployees = employees.filter(e => e.status === "Active");

  // Generate employee snapshots
  for (const emp of activeEmployees) {
    try {
      const snap = await generateEmployeeSnapshot(emp.id, emp.name, emp.role, from, to, generatedBy);
      results.employees.push({ id: emp.id, name: emp.name, snapshotId: snap.id });
    } catch (err) {
      results.errors.push(`Employee ${emp.name}: ${(err as Error).message}`);
    }
  }

  // Generate team snapshots (unique sub-teams)
  const teams = [...new Set(activeEmployees.map(e => e.subTeam).filter(Boolean))] as string[];
  for (const team of teams) {
    try {
      const snap = await generateTeamSnapshot(team, from, to, generatedBy);
      results.teams.push({ name: team, snapshotId: snap.id });
    } catch (err) {
      results.errors.push(`Team ${team}: ${(err as Error).message}`);
    }
  }

  // Generate department snapshots (unique roles)
  const departments = [...new Set(activeEmployees.map(e => e.role).filter(Boolean))] as string[];
  for (const dept of departments) {
    try {
      const snap = await generateDepartmentSnapshot(dept, from, to, generatedBy);
      results.departments.push({ name: dept, snapshotId: snap.id });
    } catch (err) {
      results.errors.push(`Department ${dept}: ${(err as Error).message}`);
    }
  }

  // Generate company snapshot
  try {
    const snap = await generateCompanySnapshot(from, to, generatedBy);
    results.company = snap.id;
  } catch (err) {
    results.errors.push(`Company: ${(err as Error).message}`);
  }

  return results;
}

export function registerSnapshotRoutes(router: Router, deps?: { getJobQueue?: () => JobQueue | null }) {
  const getJobQueue = deps?.getJobQueue;

  // ==================== GENERATE SNAPSHOTS ====================

  /**
   * Generate a performance snapshot for an employee.
   * Body: { from: string, to: string }
   */
  router.post("/api/snapshots/employee/:employeeId", requireAuth, requireMFASetup, requireRole("manager"), validateParams({ employeeId: "uuid" }), async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ message: "Employee not found" });

      const snapshot = await generateEmployeeSnapshot(employeeId, employee.name, employee.role, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      logger.error("employee snapshot generation failed", {
        employeeId: req.params.employeeId,
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a snapshot for a sub-team.
   * Body: { from: string, to: string, teamName: string }
   */
  router.post("/api/snapshots/team", requireAuth, requireMFASetup, requireRole("manager"), async (req, res) => {
    try {
      const { from, to, teamName } = req.body;
      if (!from || !to || !teamName) return res.status(400).json({ message: "Date range and teamName are required" });

      const snapshot = await generateTeamSnapshot(teamName, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      logger.error("team snapshot generation failed", {
        teamName: req.body?.teamName,
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a snapshot for a department (by role).
   * Body: { from: string, to: string, department: string }
   */
  router.post("/api/snapshots/department", requireAuth, requireMFASetup, requireRole("manager"), async (req, res) => {
    try {
      const { from, to, department } = req.body;
      if (!from || !to || !department) return res.status(400).json({ message: "Date range and department are required" });

      const snapshot = await generateDepartmentSnapshot(department, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      logger.error("department snapshot generation failed", {
        department: req.body?.department,
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a company-wide snapshot.
   * Body: { from: string, to: string }
   */
  router.post("/api/snapshots/company", requireAuth, requireMFASetup, requireRole("manager"), async (req, res) => {
    try {
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const snapshot = await generateCompanySnapshot(from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      logger.error("company snapshot generation failed", {
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Batch generate: create snapshots for ALL employees + all teams + company
   * for a given period. Useful for monthly review cycles.
   * Body: { from: string, to: string }
   *
   * A8/F18: when a job queue is configured (DATABASE_URL set), this enqueues
   * a "batch_snapshots" job and returns 202 with the job id immediately.
   * Clients poll GET /api/admin/jobs/:id for completion. Without a queue,
   * we fall back to running synchronously (legacy behavior). For large
   * orgs the synchronous path can take minutes and risks request timeouts.
   */
  router.post("/api/snapshots/batch", requireAuth, requireMFASetup, requireRole("admin"), async (req, res) => {
    try {
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const queue = getJobQueue?.();
      if (queue) {
        const jobId = await queue.enqueue("batch_snapshots", {
          from,
          to,
          generatedBy: req.user!.username,
        });
        return res.status(202).json({
          jobId,
          statusUrl: `/api/admin/jobs/${jobId}`,
          message: "Batch snapshot generation enqueued. Poll the statusUrl for completion.",
        });
      }

      // Synchronous fallback (no DB → no job queue)
      const results = await generateBatchSnapshots(from, to, req.user!.username);
      res.status(201).json(results);
    } catch (error) {
      logger.error("batch snapshot generation failed", {
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to generate batch snapshots" });
    }
  });

  // ==================== VIEW SNAPSHOTS ====================

  /** Get snapshots for a specific employee. */
  router.get("/api/snapshots/employee/:employeeId", requireAuth, validateParams({ employeeId: "uuid" }), async (req, res) => {
    const snapshots = await getSnapshots("employee", req.params.employeeId);
    res.json(snapshots);
  });

  /** Get snapshots for a team. */
  router.get("/api/snapshots/team/:teamName", requireAuth, validateParams({ teamName: "safeName" }), async (req, res) => {
    const snapshots = await getSnapshots("team", decodeURIComponent(req.params.teamName));
    res.json(snapshots);
  });

  /** Get snapshots for a department. */
  router.get("/api/snapshots/department/:department", requireAuth, validateParams({ department: "safeName" }), async (req, res) => {
    const snapshots = await getSnapshots("department", decodeURIComponent(req.params.department));
    res.json(snapshots);
  });

  /** Get company-wide snapshots. */
  router.get("/api/snapshots/company", requireAuth, async (req, res) => {
    const snapshots = await getSnapshots("company", "company");
    res.json(snapshots);
  });

  /** Get all snapshots for a level (admin overview). */
  router.get("/api/snapshots/all/:level", requireAuth, requireMFASetup, requireRole("manager"), validateParams({ level: "safeId" }), async (req, res) => {
    const level = req.params.level as SnapshotLevel;
    if (!["employee", "team", "department", "company"].includes(level)) {
      return res.status(400).json({ message: "Level must be employee, team, department, or company" });
    }
    const snapshots = await getAllSnapshotsForLevel(level);
    res.json(snapshots);
  });

  // ==================== AI CONTEXT RESET ====================

  /**
   * Reset AI context for a target — deletes all stored snapshots so the
   * next AI summary starts fresh. Useful when employees change roles,
   * transfer teams, or historical context becomes misleading.
   */
  router.delete("/api/snapshots/:level/:targetId/reset", requireAuth, requireMFASetup, requireRole("admin"), validateParams({ level: "safeId", targetId: "safeName" }), async (req, res) => {
    const level = req.params.level as SnapshotLevel;
    if (!["employee", "team", "department", "company"].includes(level)) {
      return res.status(400).json({ message: "Level must be employee, team, department, or company" });
    }
    const removed = await resetSnapshotContext(level, decodeURIComponent(req.params.targetId), req.user!.username);
    res.json({ message: `Context reset: ${removed} snapshot(s) removed`, removed });
  });

  // ==================== JOB STATUS LOOKUP (A8/F18) ====================
  /**
   * Generic job status endpoint. Used by clients that enqueue async work
   * (e.g. POST /api/snapshots/batch when a job queue is available) to poll
   * for completion. Returns 404 if no job queue is configured or job is
   * unknown. Admin-only.
   */
  router.get("/api/admin/jobs/:id", requireAuth, requireMFASetup, requireRole("admin"), validateParams({ id: "uuid" }), async (req, res) => {
    const queue = getJobQueue?.();
    if (!queue) {
      return res.status(503).json({ message: "Job queue not configured (no DATABASE_URL)" });
    }
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      failedReason: job.failedReason,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      // payload may include the input parameters; results live in the
      // batch_snapshots payload after the worker writes them back.
      payload: job.payload,
    });
  });

}
