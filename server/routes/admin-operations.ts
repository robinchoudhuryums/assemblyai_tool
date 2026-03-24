import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { generateReport, getReports, getReport } from "../services/scheduled-reports";
import { bedrockBatchService, type BatchJob } from "../services/bedrock-batch";
import { metrics } from "../services/logger";
import { logPhiAccess } from "../services/audit-log";

export function registerOperationsRoutes(
  router: Router,
  deps: {
    getJobQueue: () => any;
    shouldUseBatchMode: (override?: string) => boolean;
  }
) {
  const { getJobQueue, shouldUseBatchMode } = deps;

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
          username: req.user?.username || "unknown",
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

  router.get("/api/export/calls", requireAuth, async (req, res) => {
    try {
      const { status, sentiment, employee } = req.query;
      const calls = await storage.getCallsWithDetails({
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
      });

      const header = "Date,Employee,Duration (s),Sentiment,Score,Party Type,Status,Flags,Summary\n";
      const rows = calls.map(c => {
        const date = c.uploadedAt ? new Date(c.uploadedAt).toISOString() : "";
        const employee = (c.employee?.name || "Unassigned").replace(/"/g, '""');
        const duration = c.duration || "";
        const sentiment = c.sentiment?.overallSentiment || "";
        const score = c.analysis?.performanceScore || "";
        const party = c.analysis?.callPartyType || "";
        const status = c.status || "";
        const flags = Array.isArray(c.analysis?.flags) ? (c.analysis.flags as string[]).join("; ") : "";
        const summary = (typeof c.analysis?.summary === "string" ? c.analysis.summary : "").replace(/"/g, '""').replace(/\n/g, " ");
        return `"${date}","${employee}","${duration}","${sentiment}","${score}","${party}","${status}","${flags}","${summary}"`;
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
    const report = getReport(req.params.id);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    res.json(report);
  });

  router.post("/api/admin/reports/generate", requireRole("manager", "admin"), async (req, res) => {
    try {
      const type = req.body.type === "monthly" ? "monthly" : "weekly";
      const report = await generateReport(type, req.user?.username || "unknown");
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
}
