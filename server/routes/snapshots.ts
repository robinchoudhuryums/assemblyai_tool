/**
 * Performance Snapshot Routes
 *
 * API endpoints for generating, viewing, and managing periodic performance
 * snapshots at employee, team, department, and company levels.
 */

import type { Router } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { aiProvider } from "../services/ai-factory";
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

export function registerSnapshotRoutes(router: Router) {

  // ==================== GENERATE SNAPSHOTS ====================

  /**
   * Generate a performance snapshot for an employee.
   * Body: { from: string, to: string }
   */
  router.post("/api/snapshots/employee/:employeeId", requireAuth, requireRole("manager"), async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ message: "Employee not found" });

      const snapshot = await generateEmployeeSnapshot(employeeId, employee.name, employee.role, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      console.error("Failed to generate employee snapshot:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a snapshot for a sub-team.
   * Body: { from: string, to: string, teamName: string }
   */
  router.post("/api/snapshots/team", requireAuth, requireRole("manager"), async (req, res) => {
    try {
      const { from, to, teamName } = req.body;
      if (!from || !to || !teamName) return res.status(400).json({ message: "Date range and teamName are required" });

      const snapshot = await generateTeamSnapshot(teamName, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      console.error("Failed to generate team snapshot:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a snapshot for a department (by role).
   * Body: { from: string, to: string, department: string }
   */
  router.post("/api/snapshots/department", requireAuth, requireRole("manager"), async (req, res) => {
    try {
      const { from, to, department } = req.body;
      if (!from || !to || !department) return res.status(400).json({ message: "Date range and department are required" });

      const snapshot = await generateDepartmentSnapshot(department, from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      console.error("Failed to generate department snapshot:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Generate a company-wide snapshot.
   * Body: { from: string, to: string }
   */
  router.post("/api/snapshots/company", requireAuth, requireRole("manager"), async (req, res) => {
    try {
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const snapshot = await generateCompanySnapshot(from, to, req.user!.username);
      res.status(201).json(snapshot);
    } catch (error) {
      console.error("Failed to generate company snapshot:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate snapshot" });
    }
  });

  /**
   * Batch generate: create snapshots for ALL employees + all teams + company
   * for a given period. Useful for monthly review cycles.
   * Body: { from: string, to: string }
   */
  router.post("/api/snapshots/batch", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { from, to } = req.body;
      if (!from || !to) return res.status(400).json({ message: "Date range (from, to) is required" });

      const results = await generateBatchSnapshots(from, to, req.user!.username);
      res.status(201).json(results);
    } catch (error) {
      console.error("Failed to generate batch snapshots:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate batch snapshots" });
    }
  });

  // ==================== VIEW SNAPSHOTS ====================

  /** Get snapshots for a specific employee. */
  router.get("/api/snapshots/employee/:employeeId", requireAuth, async (req, res) => {
    const snapshots = await getSnapshots("employee", req.params.employeeId);
    res.json(snapshots);
  });

  /** Get snapshots for a team. */
  router.get("/api/snapshots/team/:teamName", requireAuth, async (req, res) => {
    const snapshots = await getSnapshots("team", req.params.teamName);
    res.json(snapshots);
  });

  /** Get snapshots for a department. */
  router.get("/api/snapshots/department/:department", requireAuth, async (req, res) => {
    const snapshots = await getSnapshots("department", req.params.department);
    res.json(snapshots);
  });

  /** Get company-wide snapshots. */
  router.get("/api/snapshots/company", requireAuth, async (req, res) => {
    const snapshots = await getSnapshots("company", "company");
    res.json(snapshots);
  });

  /** Get all snapshots for a level (admin overview). */
  router.get("/api/snapshots/all/:level", requireAuth, requireRole("manager"), async (req, res) => {
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
  router.delete("/api/snapshots/:level/:targetId/reset", requireAuth, requireRole("admin"), async (req, res) => {
    const level = req.params.level as SnapshotLevel;
    if (!["employee", "team", "department", "company"].includes(level)) {
      return res.status(400).json({ message: "Level must be employee, team, department, or company" });
    }
    const removed = await resetSnapshotContext(level, req.params.targetId, req.user!.username);
    res.json({ message: `Context reset: ${removed} snapshot(s) removed`, removed });
  });

  // ==================== SNAPSHOT GENERATION LOGIC ====================

  async function generateEmployeeSnapshot(
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
        console.warn(`Snapshot AI summary failed for ${name}:`, (err as Error).message);
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

  async function generateTeamSnapshot(
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
        console.warn(`Snapshot AI summary failed for team ${teamName}:`, (err as Error).message);
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

  async function generateDepartmentSnapshot(
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
        console.warn(`Snapshot AI summary failed for dept ${department}:`, (err as Error).message);
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

  async function generateCompanySnapshot(
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
        console.warn("Snapshot AI summary failed for company:", (err as Error).message);
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

  async function generateBatchSnapshots(from: string, to: string, generatedBy: string) {
    const results = {
      employees: [] as Array<{ id: string; name: string; snapshotId: string }>,
      teams: [] as Array<{ name: string; snapshotId: string }>,
      departments: [] as Array<{ name: string; snapshotId: string }>,
      company: null as string | null,
      errors: [] as string[],
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
}
