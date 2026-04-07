import type { Router } from "express";
import { requireAuth, requireRole } from "../auth";
import { getRecentAlerts, acknowledgeAlert, getSecuritySummary, createBreachReport, updateBreachStatus, getAllBreachReports } from "../services/security-monitor";
import { getWAFStats, blockIP, unblockIP, temporaryBlockIP } from "../middleware/waf";
import { runVulnerabilityScan, getLatestScanReport, getScanHistory, acceptFinding } from "../services/vulnerability-scanner";
import {
  declareIncident, advanceIncidentPhase, addIncidentTimelineEntry, addActionItem, updateActionItem,
  updateIncidentDetails, getAllIncidents, getIncident, getEscalationContacts, getResponseProcedures,
} from "../services/incident-response";
import { logPhiAccess } from "../services/audit-log";
import { validateParams, sendValidationError } from "./utils";
import { z } from "zod";

// A9: Zod schemas for WAF mutation endpoints. durationMs has an upper bound of
// 30 days to prevent operators from accidentally creating effectively-permanent
// "temporary" blocks (and to keep the LRU eviction story honest).
const MAX_BLOCK_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const blockIpSchema = z.object({
  ip: z.string().min(1),
  reason: z.string().min(1).max(500),
  durationMs: z.number().int().positive().max(MAX_BLOCK_DURATION_MS).optional(),
});
const unblockIpSchema = z.object({ ip: z.string().min(1) });

const validateSafeId = validateParams({ id: "safeId" });
const validateIncidentParams = validateParams({ incidentId: "safeId", itemId: "safeId" });
const validateFindingId = validateParams({ findingId: "safeId" });

export function registerSecurityRoutes(router: Router) {

  // ==================== SECURITY ROUTES (admin only) ====================

  router.get("/api/admin/security-summary", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getSecuritySummary());
  });

  router.get("/api/admin/security-alerts", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getRecentAlerts());
  });

  router.patch("/api/admin/security-alerts/:id", requireAuth, requireRole("admin"), validateSafeId, (req, res) => {
    const success = acknowledgeAlert(req.params.id, req.user!.username);
    if (!success) return res.status(404).json({ message: "Alert not found" });
    res.json({ message: "Alert acknowledged" });
  });

  // Breach reports
  router.get("/api/admin/breach-reports", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const reports = await getAllBreachReports();
      res.json(reports);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch breach reports" });
    }
  });

  router.post("/api/admin/breach-reports", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { description, affectedIndividuals, dataTypes, discoveryDate, containmentActions } = req.body;
      if (!description || !discoveryDate) {
        return res.status(400).json({ message: "Description and discovery date are required" });
      }
      const report = await createBreachReport({
        reportedBy: req.user!.username,
        description,
        affectedIndividuals: affectedIndividuals || 0,
        dataTypes: dataTypes || [],
        discoveryDate,
        containmentActions: containmentActions || "",
      });
      res.status(201).json(report);
    } catch (error) {
      res.status(500).json({ message: "Failed to create breach report" });
    }
  });

  router.patch("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const { status, action } = req.body;
      if (!status || !action) {
        return res.status(400).json({ message: "Status and action description are required" });
      }
      const report = await updateBreachStatus(req.params.id, status, action, req.user!.username);
      if (!report) return res.status(404).json({ message: "Breach report not found" });
      res.json(report);
    } catch (error) {
      res.status(500).json({ message: "Failed to update breach report" });
    }
  });

  // ==================== WAF ROUTES (admin only) ====================

  router.get("/api/admin/waf-stats", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getWAFStats());
  });

  // A37/F39: validate IP format — prevent hostname-based blocks that would
  // silently fail (isIPBlocked matches by exact string).
  const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
  const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;
  function isValidIpFormat(s: unknown): s is string {
    if (typeof s !== "string" || s.length > 45) return false;
    if (IPV4_RE.test(s)) {
      return s.split(".").every(oct => {
        const n = parseInt(oct, 10);
        return n >= 0 && n <= 255;
      });
    }
    return s.includes(":") && IPV6_RE.test(s);
  }

  router.post("/api/admin/waf/block-ip", requireAuth, requireRole("admin"), (req, res) => {
    const parsed = blockIpSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, "Invalid block-ip request", parsed.error);
    const { ip, reason, durationMs } = parsed.data;
    if (!isValidIpFormat(ip)) {
      return res.status(400).json({ message: "Valid IPv4 or IPv6 address is required" });
    }
    if (durationMs) {
      temporaryBlockIP(ip, durationMs, `Manual block by ${req.user!.username}: ${reason}`);
    } else {
      blockIP(ip, `Manual block by ${req.user!.username}: ${reason}`);
    }
    // HIPAA: Audit admin WAF IP block actions
    logPhiAccess({
      timestamp: new Date().toISOString(),
      event: "admin_waf_block_ip",
      username: req.user!.username,
      resourceType: "admin",
      detail: `Blocked IP ${ip}: ${reason}${durationMs ? ` (${Math.round(durationMs / 1000)}s)` : " (permanent)"}`,
    });
    res.json({ message: `IP ${ip} blocked`, duration: durationMs ? `${Math.round(durationMs / 1000)}s` : "permanent" });
  });

  router.post("/api/admin/waf/unblock-ip", requireAuth, requireRole("admin"), (req, res) => {
    const parsed = unblockIpSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, "Invalid unblock-ip request", parsed.error);
    const { ip } = parsed.data;
    if (!isValidIpFormat(ip)) return res.status(400).json({ message: "Valid IPv4 or IPv6 address is required" });
    const removed = unblockIP(ip);
    if (!removed) return res.status(404).json({ message: "IP not found in blocklist" });
    // HIPAA: Audit admin WAF IP unblock actions
    logPhiAccess({
      timestamp: new Date().toISOString(),
      event: "admin_waf_unblock_ip",
      username: req.user?.username || "unknown",
      resourceType: "admin",
      detail: `Unblocked IP ${ip}`,
    });
    res.json({ message: `IP ${ip} unblocked` });
  });

  // ==================== VULNERABILITY SCANNER ROUTES (admin only) ====================

  router.get("/api/admin/vuln-scan/latest", requireAuth, requireRole("admin"), (_req, res) => {
    const report = getLatestScanReport();
    res.json(report || { message: "No scans have been run yet" });
  });

  router.get("/api/admin/vuln-scan/history", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getScanHistory());
  });

  router.post("/api/admin/vuln-scan/run", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const report = await runVulnerabilityScan();
      res.json(report);
    } catch (error) {
      res.status(500).json({ message: "Vulnerability scan failed" });
    }
  });

  router.post("/api/admin/vuln-scan/accept/:findingId", requireAuth, requireRole("admin"), validateFindingId, (req, res) => {
    acceptFinding(req.params.findingId);
    res.json({ message: "Finding accepted as risk" });
  });

  // ==================== INCIDENT RESPONSE ROUTES (admin only) ====================

  router.get("/api/admin/incidents", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const list = await getAllIncidents();
      res.json(list);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch incidents" });
    }
  });

  router.get("/api/admin/incidents/:id", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const incident = await getIncident(req.params.id);
      if (!incident) return res.status(404).json({ message: "Incident not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch incident" });
    }
  });

  router.post("/api/admin/incidents", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { title, description, severity, category, affectedSystems, phiInvolved, linkedBreachId } = req.body;
      if (!title || !description || !severity || !category) {
        return res.status(400).json({ message: "Title, description, severity, and category are required" });
      }
      const incident = await declareIncident({
        title, description, severity, category,
        declaredBy: req.user!.username,
        affectedSystems, phiInvolved, linkedBreachId,
      });
      res.status(201).json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to declare incident" });
    }
  });

  router.post("/api/admin/incidents/:id/advance", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const { phase, action } = req.body;
      if (!phase || !action) return res.status(400).json({ message: "Phase and action description are required" });
      const incident = await advanceIncidentPhase(req.params.id, phase, action, req.user!.username);
      if (!incident) return res.status(404).json({ message: "Incident not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to advance incident phase" });
    }
  });

  router.post("/api/admin/incidents/:id/timeline", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const { action } = req.body;
      if (!action) return res.status(400).json({ message: "Action description is required" });
      const incident = await addIncidentTimelineEntry(req.params.id, action, req.user!.username);
      if (!incident) return res.status(404).json({ message: "Incident not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to add timeline entry" });
    }
  });

  router.patch("/api/admin/incidents/:id", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const { containmentActions, eradicationActions, recoveryActions, lessonsLearned, affectedUsers, severity } = req.body;
      const incident = await updateIncidentDetails(req.params.id,
        { containmentActions, eradicationActions, recoveryActions, lessonsLearned, affectedUsers, severity },
        req.user!.username);
      if (!incident) return res.status(404).json({ message: "Incident not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to update incident" });
    }
  });

  router.post("/api/admin/incidents/:id/action-items", requireAuth, requireRole("admin"), validateSafeId, async (req, res) => {
    try {
      const { description, assignee, dueDate } = req.body;
      if (!description || !assignee) return res.status(400).json({ message: "Description and assignee are required" });
      const incident = await addActionItem(req.params.id, description, assignee, dueDate);
      if (!incident) return res.status(404).json({ message: "Incident not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to add action item" });
    }
  });

  router.patch("/api/admin/incidents/:incidentId/action-items/:itemId", requireAuth, requireRole("admin"), validateIncidentParams, async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) return res.status(400).json({ message: "Status is required" });
      const incident = await updateActionItem(req.params.incidentId, req.params.itemId, status);
      if (!incident) return res.status(404).json({ message: "Incident or action item not found" });
      res.json(incident);
    } catch (error) {
      res.status(500).json({ message: "Failed to update action item" });
    }
  });

  router.get("/api/admin/incident-response-plan", requireAuth, requireRole("admin"), (_req, res) => {
    res.json({
      escalationContacts: getEscalationContacts(),
      responseProcedures: getResponseProcedures(),
    });
  });
}
