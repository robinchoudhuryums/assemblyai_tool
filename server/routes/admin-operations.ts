import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { escapeCsvValue } from "./utils";
import { generateReport, getReports, getReport } from "../services/scheduled-reports";
import { bedrockBatchService, type BatchJob } from "../services/bedrock-batch";
import { metrics, logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { analyzeScoreDistribution, getLatestCalibrationSnapshot } from "../services/auto-calibration";
import { getCorrectionStats, getScoringQualityAlerts } from "../services/scoring-feedback";
import { getDroppedAuditEntryCount, getPendingAuditEntryCount } from "../services/audit-log";
import { getRagCacheMetrics, isRagEnabled } from "../services/rag-client";
import { getBedrockCircuitBreakerState } from "../services/bedrock";
import { is8x8Enabled } from "../services/telephony-8x8";
import { getPool } from "../db/pool";
import { getPipelineSettingsWithMeta, setPipelineSettings } from "../services/pipeline-settings";
import {
  MODEL_TIERS,
  getAllTierSnapshots,
  setTierOverride,
  clearTierOverride,
  type ModelTier,
} from "../services/model-tiers";
import { getSearchAnalytics } from "../services/search-analytics";
import { z } from "zod";

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

      // Phase E follow-on: count distinct viewer/manager accounts that
      // have fired user_employee_link_unresolved in the last 7 days.
      // Signal of "how many viewers are chronically unlinked" — higher
      // number = more support-puzzle surface area. Throttled to once per
      // user per UTC day at the emit site, so the count is days-unique
      // across the window. Gracefully degrades to null when no DB.
      const pool = getPool();
      let chronicallyUnlinkedLast7d: number | null = null;
      if (pool) {
        try {
          const { rows } = await pool.query<{ cnt: string }>(
            `SELECT COUNT(DISTINCT username)::text AS cnt
             FROM audit_log
             WHERE event = 'user_employee_link_unresolved'
               AND timestamp >= NOW() - INTERVAL '7 days'`,
          );
          chronicallyUnlinkedLast7d = parseInt(rows[0]?.cnt ?? "0", 10);
        } catch (err) {
          // Table may not exist in a fresh deploy, or DB temporarily
          // unavailable. Don't fail the whole health endpoint.
          logger.warn("health-deep: unlinked-login query failed", { error: (err as Error).message });
        }
      }

      // Overall status: "healthy" / "degraded" / "unhealthy"
      let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
      const issues: string[] = [];

      if (auditDropped > 0) { issues.push(`${auditDropped} audit entries dropped`); overallStatus = "degraded"; }
      if (auditPending > 100) { issues.push(`${auditPending} audit entries pending flush`); overallStatus = "degraded"; }
      if (bedrockCircuitState === "open") { issues.push("Bedrock circuit breaker OPEN"); overallStatus = "unhealthy"; }
      if (bedrockCircuitState === "half-open") { issues.push("Bedrock circuit breaker half-open (testing)"); overallStatus = "degraded"; }
      if (queueStats.failedToday > 10) { issues.push(`${queueStats.failedToday} jobs failed today`); overallStatus = "degraded"; }
      if (qualityAlerts.some(a => a.severity === "critical")) { issues.push("Critical scoring quality alert"); overallStatus = "degraded"; }
      // Onboarding: flag at 3+ chronic unlinked users so small teams don't
      // get noisy alerts but larger teams see the signal before support
      // tickets pile up.
      if (chronicallyUnlinkedLast7d !== null && chronicallyUnlinkedLast7d >= 3) {
        issues.push(`${chronicallyUnlinkedLast7d} viewers/managers unlinked for 7d+`);
      }

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
          onboarding: {
            chronicallyUnlinkedLast7d,
            healthy: chronicallyUnlinkedLast7d === null || chronicallyUnlinkedLast7d === 0,
          },
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
      logger.error("report generation error", { error: (error as Error).message });
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
      logger.error("calibration analysis error", { error: (error as Error).message });
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
      logger.error("calibration apply error", { error: (error as Error).message });
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

  // ==================== PIPELINE QUALITY-GATE SETTINGS ====================
  // Runtime-tunable thresholds that control when the audio-processing
  // pipeline skips Bedrock analysis. Admins can relax these (e.g. to run
  // AI on low-confidence synthetic calls) or tighten them (to save spend
  // on borderline recordings). Persisted to S3; survives restarts.

  router.get("/api/admin/pipeline-settings", requireRole("admin"), (_req, res) => {
    res.json(getPipelineSettingsWithMeta());
  });

  // Use z.null() to allow the caller to clear an override and fall back
  // to the env/default baseline. `undefined` on a key means "unchanged".
  const pipelineSettingsPatchSchema = z.object({
    minCallDurationSec: z.number().min(0).max(600).nullable().optional(),
    minTranscriptLength: z.number().min(0).max(10_000).nullable().optional(),
    minTranscriptConfidence: z.number().min(0).max(1).nullable().optional(),
  }).strict();

  router.patch("/api/admin/pipeline-settings", requireRole("admin"), async (req, res) => {
    const parsed = pipelineSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid pipeline settings patch",
        errors: parsed.error.flatten(),
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
      });
    }
    // Normalize: z.null() means "clear override" → pass undefined to the service.
    const patch: Partial<Record<"minCallDurationSec" | "minTranscriptLength" | "minTranscriptConfidence", number | undefined>> = {};
    (Object.keys(parsed.data) as Array<keyof typeof parsed.data>).forEach((key) => {
      const v = parsed.data[key];
      if (v === null) patch[key] = undefined;
      else if (typeof v === "number") patch[key] = v;
    });
    try {
      const updated = await setPipelineSettings(patch, req.user?.username || "admin");
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "update_pipeline_settings",
        resourceType: "pipeline_settings",
        detail: JSON.stringify(patch),
      });
      res.json(updated);
    } catch (err) {
      logger.error("pipeline-settings: PATCH failed", { error: (err as Error).message });
      res.status(500).json({ message: "Failed to update pipeline settings" });
    }
  });

  // ==================== MODEL TIER OVERRIDES ====================
  // Runtime per-tier model ID overrides, backed by S3. Three tiers
  // (strong / fast / reasoning) cover the entire app's use of Anthropic
  // models. Overriding the "strong" tier also propagates to the
  // aiProvider singleton + bedrockBatchService via the tier service's
  // notifySingletonsOfChange hook.

  router.get("/api/admin/model-tiers", requireRole("admin"), (_req, res) => {
    res.json({ tiers: getAllTierSnapshots() });
  });

  const modelTiersPatchSchema = z.object({
    tier: z.enum(["strong", "fast", "reasoning"]),
    // `null` clears the override and falls back through env / default.
    // String = set new override.
    model: z.string().min(1).max(500).nullable(),
    reason: z.string().max(500).optional(),
  }).strict();

  router.patch("/api/admin/model-tiers", requireRole("admin"), async (req, res) => {
    const parsed = modelTiersPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid model-tiers patch",
        errors: parsed.error.flatten(),
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
      });
    }
    const { tier, model, reason } = parsed.data;
    const updatedBy = req.user?.username || "admin";
    try {
      if (model === null) {
        await clearTierOverride(tier as ModelTier, updatedBy);
      } else {
        await setTierOverride(tier as ModelTier, model, updatedBy, reason);
      }
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: model === null ? "clear_model_tier_override" : "set_model_tier_override",
        resourceType: "model_tier",
        resourceId: tier,
        detail: model === null ? `cleared ${tier}` : `set ${tier} to ${model}${reason ? ` (${reason})` : ""}`,
      });
      res.json({ tiers: getAllTierSnapshots() });
    } catch (err) {
      logger.error("model-tiers: PATCH failed", { error: (err as Error).message });
      res.status(500).json({ message: "Failed to update model tier" });
    }
  });
  // Suppress "unused" warning for MODEL_TIERS if Zod enum is used instead of it.
  void MODEL_TIERS;

  // Search analytics — FAQ-style aggregation of manager keyword +
  // semantic searches over the last N entries (in-memory ring buffer,
  // see services/search-analytics.ts). Surfaces repeated searches and
  // zero-result queries as concrete data/docs gaps.
  router.get("/api/admin/search-analytics", requireRole("admin"), (_req, res) => {
    res.json(getSearchAnalytics());
  });
}
