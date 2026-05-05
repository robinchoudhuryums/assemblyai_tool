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
import { getBedrockCircuitBreakerState, getBedrockAccessBlockedStats } from "../services/bedrock";
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
import { getAwsCredentials } from "../services/aws-credentials";
import { isPgvectorAvailable } from "../db/pool";
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

      // Bedrock access-blocked counter (24h rolling). Surfaces 403 budget
      // actions / 429 quota throttles separately from the circuit breaker
      // (which intentionally doesn't trip on these — INV-32). Operators
      // see this as the "AWS is silently blocking our analyses" signal.
      const bedrockAccessBlocked = getBedrockAccessBlockedStats();

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

      // Spend-cap visibility: surface AWS-side blocking events so operators
      // see budget-action denials / quota throttles in the same place as
      // the rest of system health. Threshold of 5 in 24h promotes to an
      // issue line — small teams with occasional throttling don't get
      // noisy alerts; sustained blocking does.
      if (bedrockAccessBlocked.total >= 5) {
        const breakdown = Object.entries(bedrockAccessBlocked.byClassification)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ");
        issues.push(`Bedrock blocked ${bedrockAccessBlocked.total}× in last 24h (${breakdown})`);
        if (overallStatus === "healthy") overallStatus = "degraded";
      }

      res.json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        issues,
        subsystems: {
          auditLog: { droppedEntries: auditDropped, pendingEntries: auditPending, healthy: auditDropped === 0 },
          jobQueue: queueStats,
          bedrockAI: {
            circuitState: bedrockCircuitState,
            healthy: bedrockCircuitState === "closed" && bedrockAccessBlocked.total === 0,
            accessBlocked24h: bedrockAccessBlocked,
          },
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

  // Pipeline trends — aggregate operations view of audio-processing health.
  // Compares "today" vs. "trailing 7-day" for: completed call count,
  // failure rate, avg AI processing duration (jobs.completed_at -
  // jobs.created_at), avg cost per call (usage_records.total_estimated_cost).
  // Plus a 7-day daily series for the cost trend.
  //
  // Designed to make the "the pipeline is silently slowing down" failure
  // mode visible. The existing /admin/system-health shows runtime SIGNALS
  // (queue depth, breaker state, audit drops); this shows TREND deltas.
  // Single SQL roundtrip; falls through to a zeros/null response when
  // DATABASE_URL is unset (memorystore dev).
  router.get("/api/admin/pipeline-trends", requireRole("admin"), async (_req, res) => {
    const pool = getPool();
    if (!pool) {
      res.json({
        backendAvailable: false,
        today: { completed: 0, failed: 0, avgDurationSec: null, avgCost: null },
        trailing7d: { completed: 0, failed: 0, avgDurationSec: null, avgCost: null },
        deltas: { completedPctChange: null, failureRatePctChange: null, durationPctChange: null, costPctChange: null },
        dailyCostSeries: [],
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    try {
      // One query per metric — kept separate so a failure on one doesn't
      // tank the whole response. Each query is bounded by indexed
      // timestamp ranges, so cost is roughly constant regardless of
      // total table size.
      const [todayJobsRes, weekJobsRes, todayCostRes, weekCostRes, dailyCostRes] = await Promise.all([
        // Today: completed + failed audio jobs
        pool.query<{ status: string; cnt: string; avg_dur_sec: string | null }>(
          `SELECT status,
                  COUNT(*)::text AS cnt,
                  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric, 2)::text AS avg_dur_sec
           FROM jobs
           WHERE type = 'process_audio'
             AND created_at >= NOW() - INTERVAL '1 day'
             AND status IN ('completed', 'dead', 'failed')
           GROUP BY status`,
        ),
        // Trailing 7 days excluding today
        pool.query<{ status: string; cnt: string; avg_dur_sec: string | null }>(
          `SELECT status,
                  COUNT(*)::text AS cnt,
                  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric, 2)::text AS avg_dur_sec
           FROM jobs
           WHERE type = 'process_audio'
             AND created_at >= NOW() - INTERVAL '8 days'
             AND created_at <  NOW() - INTERVAL '1 day'
             AND status IN ('completed', 'dead', 'failed')
           GROUP BY status`,
        ),
        // Today: avg cost per call
        pool.query<{ avg_cost: string | null; cnt: string }>(
          `SELECT ROUND(AVG(total_estimated_cost)::numeric, 4)::text AS avg_cost,
                  COUNT(*)::text AS cnt
           FROM usage_records
           WHERE timestamp >= NOW() - INTERVAL '1 day'
             AND type = 'call'`,
        ),
        // Trailing 7 days excluding today: avg cost per call
        pool.query<{ avg_cost: string | null; cnt: string }>(
          `SELECT ROUND(AVG(total_estimated_cost)::numeric, 4)::text AS avg_cost,
                  COUNT(*)::text AS cnt
           FROM usage_records
           WHERE timestamp >= NOW() - INTERVAL '8 days'
             AND timestamp <  NOW() - INTERVAL '1 day'
             AND type = 'call'`,
        ),
        // Last 7 days: per-day cost series for the sparkline
        pool.query<{ day: string; total_cost: string; calls: string }>(
          `SELECT TO_CHAR(date_trunc('day', timestamp), 'YYYY-MM-DD') AS day,
                  ROUND(SUM(total_estimated_cost)::numeric, 4)::text AS total_cost,
                  COUNT(*)::text AS calls
           FROM usage_records
           WHERE timestamp >= NOW() - INTERVAL '7 days'
             AND type = 'call'
           GROUP BY date_trunc('day', timestamp)
           ORDER BY day ASC`,
        ),
      ]);

      const summarize = (rows: Array<{ status: string; cnt: string; avg_dur_sec: string | null }>) => {
        let completed = 0, failed = 0;
        let weightedDurationSum = 0, durationWeight = 0;
        for (const r of rows) {
          const cnt = parseInt(r.cnt, 10) || 0;
          if (r.status === "completed") {
            completed += cnt;
            const avg = r.avg_dur_sec ? parseFloat(r.avg_dur_sec) : NaN;
            if (Number.isFinite(avg)) {
              weightedDurationSum += avg * cnt;
              durationWeight += cnt;
            }
          } else {
            // dead OR failed both count as failures from a pipeline perspective
            failed += cnt;
          }
        }
        const avgDurationSec = durationWeight > 0 ? weightedDurationSum / durationWeight : null;
        return { completed, failed, avgDurationSec };
      };

      const today = summarize(todayJobsRes.rows);
      const trailing = summarize(weekJobsRes.rows);

      const todayAvgCost = todayCostRes.rows[0]?.avg_cost ? parseFloat(todayCostRes.rows[0].avg_cost) : null;
      const weekAvgCost = weekCostRes.rows[0]?.avg_cost ? parseFloat(weekCostRes.rows[0].avg_cost) : null;

      const todayCallCount = parseInt(todayCostRes.rows[0]?.cnt ?? "0", 10);
      const weekCallCount = parseInt(weekCostRes.rows[0]?.cnt ?? "0", 10);

      // Trailing-week values are 7-day totals; convert to per-day for fair comparison.
      const trailingPerDayCompleted = trailing.completed / 7;
      const trailingPerDayFailed = trailing.failed / 7;

      const pctChange = (current: number | null, prior: number | null): number | null => {
        if (current == null || prior == null || prior === 0) return null;
        return Math.round(((current - prior) / prior) * 1000) / 10; // one decimal
      };

      const todayFailureRate = (today.completed + today.failed) > 0
        ? today.failed / (today.completed + today.failed)
        : null;
      const weekFailureRate = (trailing.completed + trailing.failed) > 0
        ? trailing.failed / (trailing.completed + trailing.failed)
        : null;

      res.json({
        backendAvailable: true,
        today: {
          completed: today.completed,
          failed: today.failed,
          avgDurationSec: today.avgDurationSec,
          avgCost: todayAvgCost,
          callCount: todayCallCount,
        },
        trailing7d: {
          completed: trailing.completed,
          failed: trailing.failed,
          avgDurationSec: trailing.avgDurationSec,
          avgCost: weekAvgCost,
          callCount: weekCallCount,
        },
        deltas: {
          completedPctChange: pctChange(today.completed, trailingPerDayCompleted),
          failureRatePctChange: pctChange(todayFailureRate, weekFailureRate),
          durationPctChange: pctChange(today.avgDurationSec, trailing.avgDurationSec),
          costPctChange: pctChange(todayAvgCost, weekAvgCost),
        },
        dailyCostSeries: dailyCostRes.rows.map(r => ({
          day: r.day,
          totalCost: parseFloat(r.total_cost),
          calls: parseInt(r.calls, 10),
        })),
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("pipeline-trends: query failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to compute pipeline trends" });
    }
  });

  // Soft-fail operator-state dashboard. Enumerates the items in CLAUDE.md's
  // Operator State Checklist (25+ silent-degradation paths) and reports
  // live state for each. The existing /api/admin/health-deep focuses on
  // in-process runtime signals (queue, breaker, cache); this endpoint
  // covers the "silent boot-time / config-time degradation" vectors that
  // don't show up in runtime health (e.g. RAG_ENABLED with no URL, MFA
  // required but no admin enrolled, unlinked viewer users, missing prompt
  // templates per category).
  //
  // Fast path only — no blocking network checks. Each item is an env-var
  // inspection, a single-query DB lookup, or a cached in-process flag.
  // Designed to be refreshable on a 30s poll cycle from the admin page.
  router.get("/api/admin/soft-fail-status", requireRole("admin"), async (_req, res) => {
    type Status = "ok" | "warning" | "error" | "unknown";
    interface Check {
      id: string;
      label: string;
      category: "credentials" | "storage" | "ai" | "auth" | "data" | "runtime";
      status: Status;
      message: string;
      fixHint?: string;
    }
    const checks: Check[] = [];
    const pool = getPool();

    // --- Credentials + env ---
    checks.push({
      id: "session-secret",
      label: "SESSION_SECRET set",
      category: "credentials",
      status: process.env.SESSION_SECRET ? "ok" : "error",
      message: process.env.SESSION_SECRET
        ? "Session signing key present."
        : "SESSION_SECRET is not set — sessions are ephemeral.",
      fixHint: "Set SESSION_SECRET (32+ chars) in .env; production boot hard-fails without it.",
    });

    checks.push({
      id: "audit-hmac-secret",
      label: "AUDIT_HMAC_SECRET set",
      category: "credentials",
      status: process.env.AUDIT_HMAC_SECRET
        ? "ok"
        : (process.env.NODE_ENV === "production" ? "error" : "warning"),
      message: process.env.AUDIT_HMAC_SECRET
        ? "Dedicated audit HMAC secret present."
        : "Falling back to SESSION_SECRET — rotating SESSION_SECRET will break the audit integrity chain.",
      fixHint: "Set AUDIT_HMAC_SECRET to a dedicated 32+ char secret (HIPAA §164.312(b)).",
    });

    checks.push({
      id: "assemblyai-key",
      label: "AssemblyAI API key",
      category: "credentials",
      status: process.env.ASSEMBLYAI_API_KEY ? "ok" : "error",
      message: process.env.ASSEMBLYAI_API_KEY
        ? "Transcription credentials configured."
        : "No ASSEMBLYAI_API_KEY — every call upload will queue at 'processing' and never complete.",
      fixHint: "Set ASSEMBLYAI_API_KEY in .env.",
    });

    let awsCredStatus: Status = "unknown";
    let awsCredMsg = "Could not resolve AWS credentials.";
    try {
      const creds = await getAwsCredentials();
      if (creds) {
        awsCredStatus = "ok";
        awsCredMsg = "AWS credentials resolved (env vars or IMDS).";
      } else {
        awsCredStatus = "error";
        awsCredMsg = "No AWS credentials available — S3 uploads and Bedrock analysis will fail.";
      }
    } catch (err) {
      awsCredStatus = "error";
      awsCredMsg = `AWS credential resolution threw: ${(err as Error).message}`;
    }
    checks.push({
      id: "aws-credentials",
      label: "AWS credentials",
      category: "credentials",
      status: awsCredStatus,
      message: awsCredMsg,
      fixHint: "Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in .env, or run on an EC2 instance with an instance profile.",
    });

    // --- Storage ---
    const s3BucketSet = !!process.env.S3_BUCKET;
    const dbUrlSet = !!process.env.DATABASE_URL;
    checks.push({
      id: "storage-backend",
      label: "Storage backend",
      category: "storage",
      status: dbUrlSet && s3BucketSet ? "ok" : dbUrlSet ? "error" : s3BucketSet ? "warning" : "warning",
      message: dbUrlSet && s3BucketSet
        ? "PostgreSQL (metadata) + S3 (audio) — production configuration."
        : dbUrlSet && !s3BucketSet
        ? "DATABASE_URL set but S3_BUCKET missing — production boot will hard-fail; dev uses memorystore."
        : !dbUrlSet && s3BucketSet
        ? "S3 configured but no DATABASE_URL — running against S3-only legacy backend (deprecated) or memorystore."
        : "Neither DATABASE_URL nor S3_BUCKET set — running against in-memory storage (data lost on restart).",
      fixHint: "For production, set both DATABASE_URL (RDS) and S3_BUCKET.",
    });

    checks.push({
      id: "pgvector",
      label: "pgvector extension",
      category: "storage",
      status: !pool ? "unknown" : isPgvectorAvailable() ? "ok" : "warning",
      message: !pool
        ? "No DATABASE_URL — skipping pgvector check."
        : isPgvectorAvailable()
        ? "pgvector enabled — SQL-native cosine search available."
        : "pgvector not available — semantic search falls back to O(n) in-memory scoring.",
      fixHint: "Upgrade to PostgreSQL ≥15.2 (RDS) or install the pgvector extension.",
    });

    // --- AI / RAG ---
    const ragEnabledFlag = process.env.RAG_ENABLED === "true";
    const ragUrl = process.env.RAG_SERVICE_URL;
    checks.push({
      id: "rag-config",
      label: "RAG knowledge base",
      category: "ai",
      status: !ragEnabledFlag ? "warning" : !ragUrl ? "error" : isRagEnabled() ? "ok" : "warning",
      message: !ragEnabledFlag
        ? "RAG_ENABLED is not 'true' — AI runs on generic prompts without company-specific context."
        : !ragUrl
        ? "RAG_ENABLED is 'true' but RAG_SERVICE_URL is missing — feature silently disabled."
        : isRagEnabled()
        ? "RAG client initialized."
        : "RAG client failed to initialize (check boot log).",
      fixHint: "Set RAG_SERVICE_URL + RAG_API_KEY, or set RAG_ENABLED=false to suppress this warning.",
    });

    checks.push({
      id: "elevenlabs",
      label: "ElevenLabs TTS (Simulated Calls)",
      category: "ai",
      status: process.env.ELEVENLABS_API_KEY ? "ok" : "warning",
      message: process.env.ELEVENLABS_API_KEY
        ? "Simulated Call Generator is functional."
        : "ELEVENLABS_API_KEY not set — the admin Simulated Calls page is visible but /generate will 503.",
      fixHint: "Set ELEVENLABS_API_KEY in .env if the Simulated Calls feature is in use.",
    });

    // --- Auth / MFA ---
    const requireMfa = process.env.REQUIRE_MFA === "true";
    let unenrolledAdmins = 0;
    let mfaCheckError: string | null = null;
    if (requireMfa && pool) {
      try {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM users u
           LEFT JOIN mfa_secrets m ON m.username = u.username AND m.enabled = TRUE
           WHERE u.active = TRUE
             AND u.role IN ('admin', 'manager')
             AND m.username IS NULL`,
        );
        unenrolledAdmins = parseInt(rows[0]?.cnt ?? "0", 10);
      } catch (err) {
        mfaCheckError = (err as Error).message;
      }
    }
    checks.push({
      id: "mfa-enrollment",
      label: "MFA enrollment",
      category: "auth",
      status: !requireMfa
        ? "ok"
        : mfaCheckError
        ? "unknown"
        : unenrolledAdmins > 0
        ? "error"
        : "ok",
      message: !requireMfa
        ? "REQUIRE_MFA=false — MFA is optional."
        : mfaCheckError
        ? `MFA enrollment query failed: ${mfaCheckError}`
        : unenrolledAdmins > 0
        ? `REQUIRE_MFA=true but ${unenrolledAdmins} admin/manager account(s) have no MFA — they cannot mutate /api/admin/* and are locked out of password changes.`
        : "All admin/manager accounts have MFA enrolled.",
      fixHint: unenrolledAdmins > 0
        ? "Have affected users enroll via /api/auth/mfa/setup + /api/auth/mfa/enable immediately."
        : undefined,
    });

    // Unlinked viewers — copies the 7-day distinct-username query from
    // /api/admin/health-deep so this page doesn't depend on that endpoint.
    let unlinkedUsersCount: number | null = null;
    if (pool) {
      try {
        const { rows } = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM users u
           WHERE u.active = TRUE
             AND u.role = 'viewer'
             AND NOT EXISTS (
               SELECT 1 FROM employees e
               WHERE LOWER(e.email) = LOWER(u.username)
                  OR LOWER(e.name) = LOWER(u.display_name)
             )`,
        );
        unlinkedUsersCount = parseInt(rows[0]?.cnt ?? "0", 10);
      } catch { /* DB unavailable */ }
    }
    checks.push({
      id: "unlinked-viewers",
      label: "Unlinked viewer users",
      category: "auth",
      status: unlinkedUsersCount == null
        ? "unknown"
        : unlinkedUsersCount === 0
        ? "ok"
        : unlinkedUsersCount > 5
        ? "error"
        : "warning",
      message: unlinkedUsersCount == null
        ? "Could not check (DB unavailable)."
        : unlinkedUsersCount === 0
        ? "Every viewer has a matching employee row."
        : `${unlinkedUsersCount} viewer user(s) have no linked employee — they see empty lists with no data.`,
      fixHint: unlinkedUsersCount != null && unlinkedUsersCount > 0
        ? "Visit the admin Users tab → Onboarding banner → Link to employee."
        : undefined,
    });

    // --- Data ---
    let promptTemplateCount = 0;
    if (pool) {
      try {
        const { rows } = await pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM prompt_templates`);
        promptTemplateCount = parseInt(rows[0]?.cnt ?? "0", 10);
      } catch { /* table missing / DB unavailable */ }
    }
    checks.push({
      id: "prompt-templates",
      label: "Prompt templates seeded",
      category: "data",
      status: promptTemplateCount === 0 ? "warning" : "ok",
      message: promptTemplateCount === 0
        ? "No prompt templates in DB — pipeline falls back to the generic default prompt. Scores are not company-specific."
        : `${promptTemplateCount} prompt template(s) in DB.`,
      fixHint: "Author per-category templates via the admin Prompt Templates page.",
    });

    // --- Runtime (lightweight echoes of health-deep) ---
    const bedrockState = getBedrockCircuitBreakerState();
    checks.push({
      id: "bedrock-circuit",
      label: "Bedrock circuit breaker",
      category: "runtime",
      status: bedrockState === "closed" ? "ok" : bedrockState === "half-open" ? "warning" : "error",
      message: bedrockState === "closed"
        ? "Closed — Bedrock calls proceed normally."
        : bedrockState === "half-open"
        ? "Half-open — testing recovery; one probe call allowed."
        : "OPEN — Bedrock calls are short-circuited for 30s after 5 consecutive failures.",
      fixHint: bedrockState !== "closed"
        ? "Check pm2 logs for the underlying AWS error; breaker auto-recovers once Bedrock responds."
        : undefined,
    });

    checks.push({
      id: "audit-queue",
      label: "Audit log write-ahead queue",
      category: "runtime",
      status: getDroppedAuditEntryCount() > 0
        ? "error"
        : getPendingAuditEntryCount() > 100
        ? "warning"
        : "ok",
      message: getDroppedAuditEntryCount() > 0
        ? `${getDroppedAuditEntryCount()} audit entries dropped — stdout log retains them for manual reconciliation.`
        : getPendingAuditEntryCount() > 100
        ? `${getPendingAuditEntryCount()} audit entries pending flush — DB may be slow.`
        : "Queue draining normally.",
      fixHint: getDroppedAuditEntryCount() > 0
        ? "Investigate DB write throughput; drop-oldest discards the oldest queued rows, not the stdout chain."
        : undefined,
    });

    // --- Summary ---
    const counts = {
      ok: checks.filter(c => c.status === "ok").length,
      warning: checks.filter(c => c.status === "warning").length,
      error: checks.filter(c => c.status === "error").length,
      unknown: checks.filter(c => c.status === "unknown").length,
    };
    const overall: Status = counts.error > 0 ? "error" : counts.warning > 0 ? "warning" : "ok";

    res.json({
      overall,
      counts,
      checks,
      generatedAt: new Date().toISOString(),
    });
  });
}
