import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { escapeCsvValue } from "./utils";
import { generateReport, getReports, getReport } from "../services/scheduled-reports";
import { bedrockBatchService, type BatchJob } from "../services/bedrock-batch";
import { metrics } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { analyzeScoreDistribution, getLatestCalibrationSnapshot } from "../services/auto-calibration";
import { getCorrectionStats, getScoringQualityAlerts } from "../services/scoring-feedback";
import { getDroppedAuditEntryCount, getPendingAuditEntryCount } from "../services/audit-log";
import { getRagCacheMetrics, isRagEnabled } from "../services/rag-client";
import { getBedrockCircuitBreakerState } from "../services/bedrock";
import { is8x8Enabled } from "../services/telephony-8x8";

export function registerOperationsRoutes(
  router: Router,
  deps: {
    getJobQueue: () => any;
    shouldUseBatchMode: (override?: string) => boolean;
  }
) {
  const { getJobQueue, shouldUseBatchMode } = deps;

  // ==================== ADMIN: OPERATIONAL HEALTH ====================
  // Aggregates subsystem health into a single response for the admin dashboard.
  router.get("/api/admin/health-deep", requireRole("admin"), async (_req, res) => {
    try {
      // Audit log health
      const auditDropped = getDroppedAuditEntryCount();
      const auditPending = getPendingAuditEntryCount();

      // Job queue health
      const jobQueue = getJobQueue();
      let queueStats = { pending: 0, running: 0, completedToday: 0, failedToday: 0, backend: "none" as string };
      if (jobQueue) {
        try { queueStats = await jobQueue.getStats(); } catch { /* queue unavailable */ }
      }

      // Bedrock circuit breaker
      const bedrockCircuitState = getBedrockCircuitBreakerState();

      // RAG cache
      const ragEnabled = isRagEnabled();
      const ragCache = ragEnabled ? getRagCacheMetrics() : null;

      // Batch inference
      const batchMode = shouldUseBatchMode();

      // Scoring quality
      const correctionStats = getCorrectionStats();
      const qualityAlerts = getScoringQualityAlerts();

      // Calibration
      let calibrationSnapshot = null;
      try { calibrationSnapshot = await getLatestCalibrationSnapshot(); } catch { /* unavailable */ }

      // 8x8 telephony
      const telephonyEnabled = is8x8Enabled();

      // Overall status: "healthy" / "degraded" / "unhealthy"
      let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
      const issues: string[] = [];

      if (auditDropped > 0) { issues.push(`${auditDropped} audit entries dropped`); overallStatus = "degraded"; }
      if (auditPending > 100) { issues.push(`${auditPending} audit entries pending flush`); overallStatus = "degraded"; }
      if (bedrockCircuitState === "open") { issues.push("Bedrock circuit breaker OPEN"); overallStatus = "unhealthy"; }
      if (bedrockCircuitState === "half-open") { issues.push("Bedrock circuit breaker half-open (testing)"); overallStatus = "degraded"; }
      if (queueStats.failedToday > 10) { issues.push(`${queueStats.failedToday} jobs failed today`); overallStatus = "degraded"; }
      if (qualityAlerts.some(a => a.severity === "critical")) { issues.push("Critical scoring quality alert"); overallStatus = "degraded"; }

      res.json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        issues,
        subsystems: {
          auditLog: { droppedEntries: auditDropped, pendingEntries: auditPending, healthy: auditDropped === 0 },
          jobQueue: queueStats,
          bedrockAI: { circuitState: bedrockCircuitState, healthy: bedrockCircuitState === "closed" },
          ragKnowledgeBase: ragEnabled ? { enabled: true, cache: ragCache } : { enabled: false },
          batchInference: { enabled: batchMode },
          scoringQuality: { ...correctionStats, alerts: qualityAlerts },
          calibration: { lastSnapshot: calibrationSnapshot?.timestamp || null, driftDetected: calibrationSnapshot?.driftDetected || false },
          telephony8x8: { enabled: telephonyEnabled },
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute system health" });
    }
  });

  // ==================== ADMIN: QUEUE STATUS ====================
  router.get("/api/admin/queue-status", requireRole("admin"), async (_req, res) => {
    try {
      const jobQueue = getJobQueue();
      if (jobQueue) {
        const stats = await jobQueue.getStats();
        res.json(stats);
      } else {
        res.json({ pending: 0, running: 0, completedToday: 0, failedToday: 0, backend: "in-memory" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get queue status" });
    }
  });

  // ==================== ADMIN: DEAD-LETTER QUEUE ====================

  router.get("/api/admin/dead-jobs", requireRole("admin"), async (_req, res) => {
    try {
      const jobQueue = getJobQueue();
      if (jobQueue) {
        const deadJobs = await jobQueue.getDeadJobs();
        res.json(deadJobs);
      } else {
        res.json([]);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get dead-letter jobs" });
    }
  });

  router.post("/api/admin/dead-jobs/:id/retry", requireRole("admin"), async (req, res) => {
    try {
      const jobQueue = getJobQueue();
      if (!jobQueue) {
        res.status(400).json({ message: "Job queue not available (no database configured)" });
        return;
      }
      const retried = await jobQueue.retryJob(req.params.id);
      if (retried) {
        // HIPAA: Audit admin retry of dead-letter jobs
        logPhiAccess({
          timestamp: new Date().toISOString(),
          event: "admin_dead_job_retry",
          username: req.user!.username,
          resourceType: "admin",
          resourceId: req.params.id,
          detail: "Admin retried dead-letter job",
        });
        res.json({ message: "Job re-queued for processing" });
      } else {
        res.status(404).json({ message: "Dead job not found or already retried" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  // ==================== EXPORT: CSV DOWNLOAD ====================

  const EXPORT_ROW_LIMIT = 10_000;
  router.get("/api/export/calls", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { status, sentiment, employee } = req.query;
      const allCalls = await storage.getCallsWithDetails({
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
      });
      // Bulk-exfiltration guard: cap rows; client must narrow filters if exceeded
      if (allCalls.length > EXPORT_ROW_LIMIT) {
        return res.status(413).json({
          message: `Export exceeds ${EXPORT_ROW_LIMIT} row limit (${allCalls.length} matched). Narrow your filters.`,
        });
      }
      const calls = allCalls;

      const header = "Date,Employee,Duration (s),Sentiment,Score,Party Type,Status,Flags,Summary\n";
      const rows = calls.map(c => {
        const date = c.uploadedAt ? new Date(c.uploadedAt).toISOString() : "";
        const employee = c.employee?.name || "Unassigned";
        const duration = String(c.duration || "");
        const sentiment = c.sentiment?.overallSentiment || "";
        const score = String(c.analysis?.performanceScore || "");
        const party = c.analysis?.callPartyType || "";
        const status = c.status || "";
        const flags = Array.isArray(c.analysis?.flags) ? (c.analysis.flags as string[]).join("; ") : "";
        const summary = (typeof c.analysis?.summary === "string" ? c.analysis.summary : "").replace(/\n/g, " ");
        return [date, employee, duration, sentiment, score, party, status, flags, summary].map(escapeCsvValue).join(",");
      }).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="calls-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(header + rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to export calls" });
    }
  });

  // ==================== ADMIN: BATCH INFERENCE STATUS ====================
  router.get("/api/admin/batch-status", requireRole("admin"), async (_req, res) => {
    try {
      const s3Client = storage.getObjectStorageClient();
      if (!s3Client || !bedrockBatchService.isAvailable) {
        res.json({ enabled: false, message: "Batch mode not enabled. Set BEDROCK_BATCH_MODE=true and BEDROCK_BATCH_ROLE_ARN." });
        return;
      }

      const pendingKeys = await s3Client.listObjects("batch-inference/pending/");
      const activeJobs = await s3Client.listAndDownloadJson<BatchJob>("batch-inference/active-jobs/");

      const scheduleStart = process.env.BATCH_SCHEDULE_START || null;
      const scheduleEnd = process.env.BATCH_SCHEDULE_END || null;

      res.json({
        enabled: true,
        currentMode: shouldUseBatchMode() ? "batch" : "immediate",
        schedule: scheduleStart && scheduleEnd
          ? { start: scheduleStart, end: scheduleEnd, description: `Batch from ${scheduleStart} to ${scheduleEnd}, immediate otherwise` }
          : { description: "Always batch (no schedule set — set BATCH_SCHEDULE_START/END for time-based)" },
        pendingItems: pendingKeys.length,
        activeJobs: activeJobs.map((j: BatchJob) => ({
          jobId: j.jobId,
          status: j.status,
          callCount: j.callIds.length,
          createdAt: j.createdAt,
        })),
        batchIntervalMinutes: parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10),
        costSavings: "50% on Bedrock inference",
        perUploadOverride: "Uploads can include processingMode='immediate' or 'batch' to override schedule",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get batch status" });
    }
  });

  // ==================== SCHEDULED REPORTS ====================

  router.get("/api/admin/reports", requireRole("manager", "admin"), async (_req, res) => {
    res.json(getReports());
  });

  router.get("/api/admin/reports/:id", requireRole("manager", "admin"), async (req, res) => {
    const report = await getReport(req.params.id);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    res.json(report);
  });

  router.post("/api/admin/reports/generate", requireRole("manager", "admin"), async (req, res) => {
    try {
      const type = req.body.type === "monthly" ? "monthly" : "weekly";
      const report = await generateReport(type, req.user!.username);
      res.json(report);
    } catch (error) {
      console.error("Report generation error:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // ==================== ADMIN: APPLICATION METRICS ====================
  router.get("/api/admin/metrics", requireRole("admin"), (_req, res) => {
    res.json(metrics.snapshot());
  });

  // ==================== ADMIN: SCORE CALIBRATION ====================

  // GET /api/admin/calibration — latest calibration snapshot + scoring quality alerts
  router.get("/api/admin/calibration", requireRole("admin"), async (_req, res) => {
    try {
      const snapshot = await getLatestCalibrationSnapshot();
      const correctionStats = getCorrectionStats();
      const qualityAlerts = getScoringQualityAlerts();
      res.json({ snapshot, available: snapshot !== null, correctionStats, qualityAlerts });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch calibration data" });
    }
  });

  // POST /api/admin/calibration/analyze — trigger manual calibration analysis
  router.post("/api/admin/calibration/analyze", requireRole("admin"), async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || undefined;
      const snapshot = await analyzeScoreDistribution(days);
      if (!snapshot) {
        return res.json({ message: "Insufficient data for calibration analysis", snapshot: null });
      }
      res.json({ snapshot });
    } catch (error) {
      console.error("Calibration analysis error:", (error as Error).message);
      res.status(500).json({ message: "Failed to run calibration analysis" });
    }
  });

  // POST /api/admin/calibration/apply — apply recommended calibration values
  router.post("/api/admin/calibration/apply", requireRole("admin"), async (req, res) => {
    try {
      const { aiModelMean, center, spread } = req.body;
      if (typeof aiModelMean !== "number" || typeof spread !== "number") {
        return res.status(400).json({ message: "aiModelMean and spread are required numbers" });
      }

      // Guard rails: max shift ±0.5 per application from current values
      const { getCalibrationConfig, setRuntimeCalibration } = await import("../services/scoring-calibration");
      const current = getCalibrationConfig();
      const MAX_SHIFT = 0.5;
      if (Math.abs(aiModelMean - current.aiModelMean) > MAX_SHIFT) {
        return res.status(400).json({ message: `aiModelMean shift exceeds ±${MAX_SHIFT} guard rail (current: ${current.aiModelMean}, requested: ${aiModelMean})` });
      }
      if (Math.abs(spread - current.spread) > MAX_SHIFT) {
        return res.status(400).json({ message: `spread shift exceeds ±${MAX_SHIFT} guard rail (current: ${current.spread}, requested: ${spread})` });
      }

      const overrides = {
        enabled: true,
        aiModelMean,
        center: typeof center === "number" ? center : current.center,
        spread,
      };
      setRuntimeCalibration(overrides);

      // Persist to S3
      const s3Client = storage.getObjectStorageClient();
      if (s3Client) {
        await s3Client.uploadJson("calibration/active-config.json", overrides);
        await s3Client.uploadJson(`calibration/history/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, {
          ...overrides,
          appliedAt: new Date().toISOString(),
          appliedBy: req.user?.username,
          previousConfig: current,
        });
      }

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "calibration_applied",
        resourceType: "calibration",
        detail: JSON.stringify(overrides),
      });

      res.json({ message: "Calibration applied", config: getCalibrationConfig() });
    } catch (error) {
      console.error("Calibration apply error:", (error as Error).message);
      res.status(500).json({ message: "Failed to apply calibration" });
    }
  });

  // ==================== ADMIN: TELEPHONY INTEGRATION STATUS ====================

  // GET /api/admin/telephony/status — 8x8 integration status
  router.get("/api/admin/telephony/status", requireRole("admin"), (_req, res) => {
    res.json({
      provider: "8x8",
      enabled: is8x8Enabled(),
      configured: !!(process.env.TELEPHONY_8X8_API_KEY && process.env.TELEPHONY_8X8_SUBACCOUNT_ID),
      pollIntervalMinutes: parseInt(process.env.TELEPHONY_8X8_POLL_MINUTES || "15", 10),
    });
  });
}
