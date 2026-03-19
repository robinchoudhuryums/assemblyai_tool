import type { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { assemblyAIService } from "../services/assemblyai";
import { BedrockProvider } from "../services/bedrock";
import { getRecentAlerts, acknowledgeAlert, getSecuritySummary, createBreachReport, updateBreachStatus, getAllBreachReports } from "../services/security-monitor";
import { bedrockBatchService, type BatchJob } from "../services/bedrock-batch";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, CALL_CATEGORIES, BEDROCK_MODEL_PRESETS, type UsageRecord } from "@shared/schema";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, TaskQueue } from "./utils";
import type { S3Client as S3ClientType } from "../services/s3";

const audioProcessingQueue = new TaskQueue(3);

export function registerAdminRoutes(
  router: Router,
  uploadMiddleware: any,
  deps: {
    getJobQueue: () => any;
    shouldUseBatchMode: (override?: string) => boolean;
  }
) {
  const { getJobQueue, shouldUseBatchMode } = deps;

  // ==================== SECURITY ROUTES (admin only) ====================

  // Security dashboard summary
  router.get("/api/admin/security-summary", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getSecuritySummary());
  });

  // Recent security alerts
  router.get("/api/admin/security-alerts", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getRecentAlerts());
  });

  // Acknowledge a security alert
  router.patch("/api/admin/security-alerts/:id", requireAuth, requireRole("admin"), (req, res) => {
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

  router.patch("/api/admin/breach-reports/:id", requireAuth, requireRole("admin"), async (req, res) => {
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

  // ==================== PROMPT TEMPLATE ROUTES (admin only) ====================

  router.get("/api/prompt-templates", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const templates = await storage.getAllPromptTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch prompt templates" });
    }
  });

  router.post("/api/prompt-templates", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: parsed.error.flatten() });
        return;
      }
      const template = await storage.createPromptTemplate({
        ...parsed.data,
        updatedBy: req.user?.username,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to create prompt template" });
    }
  });

  router.patch("/api/prompt-templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      // Validate the update: allow only known template fields
      const { updatedBy: _ignore, id: _ignoreId, ...bodyWithoutMeta } = req.body;
      const templateUpdateParsed = insertPromptTemplateSchema.partial().safeParse(bodyWithoutMeta);
      if (!templateUpdateParsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: templateUpdateParsed.error.flatten() });
        return;
      }
      const updated = await storage.updatePromptTemplate(req.params.id, {
        ...templateUpdateParsed.data,
        updatedBy: req.user?.username,
      });
      if (!updated) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update prompt template" });
    }
  });

  router.delete("/api/prompt-templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePromptTemplate(req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ==================== USAGE TRACKING ROUTES (admin only) ====================

  router.get("/api/usage", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const records = await storage.getAllUsageRecords();
      res.json(records);
    } catch (error) {
      console.error("Error fetching usage records:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch usage data" });
    }
  });

  // ==================== A/B MODEL TESTING ROUTES (admin only) ====================

  // List all A/B tests
  router.get("/api/ab-tests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const tests = await storage.getAllABTests();
      res.json(tests);
    } catch (error) {
      console.error("Error fetching A/B tests:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch A/B tests" });
    }
  });

  // Get a single A/B test
  router.get("/api/ab-tests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      res.json(test);
    } catch (error) {
      console.error("Error fetching A/B test:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch A/B test" });
    }
  });

  // Upload audio for A/B model comparison
  router.post("/api/ab-tests/upload", requireAuth, requireRole("admin"), uploadMiddleware.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { testModel } = req.body;
      const validModels = BEDROCK_MODEL_PRESETS.map(m => m.value) as string[];
      if (!testModel || !validModels.includes(testModel)) {
        await cleanupFile(req.file.path);
        res.status(400).json({ message: `Invalid model. Must be one of: ${validModels.join(", ")}` });
        return;
      }
      const abValidCategories = CALL_CATEGORIES.map(c => c.value) as string[];
      const callCategory = abValidCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;

      const user = req.user as any;
      const baselineModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";

      // Create the A/B test record
      const abTest = await storage.createABTest({
        fileName: req.file.originalname,
        callCategory: callCategory || undefined,
        baselineModel,
        testModel,
        status: "processing",
        createdBy: user?.username || "admin",
      });

      // Read file and kick off async processing
      const audioBuffer = await fs.promises.readFile(req.file.path);
      const filePath = req.file.path;

      audioProcessingQueue.add(() => processABTest(abTest.id, filePath, audioBuffer, callCategory))
        .catch(async (error) => {
          console.error(`[AB-${abTest.id}] Processing failed:`, (error as Error).message);
          try {
            await storage.updateABTest(abTest.id, { status: "failed" });
          } catch (updateErr) {
            console.error(`[AB-${abTest.id}] Failed to mark as failed:`, (updateErr as Error).message);
          }
        });

      res.status(201).json(abTest);
    } catch (error) {
      console.error("Error starting A/B test:", (error as Error).message);
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to start A/B test" });
    }
  });

  // Delete an A/B test
  router.delete("/api/ab-tests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      await storage.deleteABTest(req.params.id);
      res.json({ message: "A/B test deleted" });
    } catch (error) {
      console.error("Error deleting A/B test:", (error as Error).message);
      res.status(500).json({ message: "Failed to delete A/B test" });
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

  // List dead-letter jobs (failed after max retries)
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

  // Retry a dead-letter job
  router.post("/api/admin/dead-jobs/:id/retry", requireRole("admin"), async (req, res) => {
    try {
      const jobQueue = getJobQueue();
      if (!jobQueue) {
        res.status(400).json({ message: "Job queue not available (no database configured)" });
        return;
      }
      const retried = await jobQueue.retryJob(req.params.id);
      if (retried) {
        res.json({ message: "Job re-queued for processing" });
      } else {
        res.status(404).json({ message: "Dead job not found or already retried" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  // ==================== EXPORT: CSV DOWNLOAD ====================

  // Export calls as CSV
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
      const s3Client: S3ClientType | undefined = (storage as any).audioClient || (storage as any).client;
      if (!s3Client || !bedrockBatchService.isAvailable) {
        res.json({ enabled: false, message: "Batch mode not enabled. Set BEDROCK_BATCH_MODE=true and BEDROCK_BATCH_ROLE_ARN." });
        return;
      }

      // Count pending items
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

  // A/B test processing pipeline
  async function processABTest(testId: string, filePath: string, audioBuffer: Buffer, callCategory?: string) {
    console.log(`[AB-${testId}] Starting A/B model comparison...`);
    try {
      const abTest = await storage.getABTest(testId);
      if (!abTest) throw new Error("A/B test record not found");

      // Step 1: Upload to AssemblyAI and transcribe
      console.log(`[AB-${testId}] Step 1: Uploading to AssemblyAI...`);
      const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
      const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

      if (!transcriptResponse || transcriptResponse.status !== 'completed') {
        throw new Error(`Transcription failed. Status: ${transcriptResponse?.status}`);
      }

      const transcriptText = transcriptResponse.text || "";
      await storage.updateABTest(testId, { transcriptText, status: "analyzing" });
      console.log(`[AB-${testId}] Transcription complete (${transcriptText.length} chars)`);

      // Load prompt template if applicable
      let promptTemplate = undefined;
      if (callCategory) {
        try {
          const tmpl = await storage.getPromptTemplateByCategory(callCategory);
          if (tmpl) {
            promptTemplate = {
              evaluationCriteria: tmpl.evaluationCriteria,
              requiredPhrases: tmpl.requiredPhrases,
              scoringWeights: tmpl.scoringWeights,
              additionalInstructions: tmpl.additionalInstructions,
            };
          }
        } catch (e) {
          console.warn(`[AB-${testId}] Failed to load prompt template:`, (e as Error).message);
        }
      }

      // Step 2: Run both models in parallel
      console.log(`[AB-${testId}] Step 2: Running analysis with both models...`);
      const baselineProvider = BedrockProvider.createWithModel(abTest.baselineModel);
      const testProvider = BedrockProvider.createWithModel(abTest.testModel);

      const [baselineResult, testResult] = await Promise.allSettled([
        (async () => {
          const start = Date.now();
          const analysis = await baselineProvider.analyzeCallTranscript(transcriptText, `ab-baseline-${testId}`, callCategory, promptTemplate);
          return { analysis, latencyMs: Date.now() - start };
        })(),
        (async () => {
          const start = Date.now();
          const analysis = await testProvider.analyzeCallTranscript(transcriptText, `ab-test-${testId}`, callCategory, promptTemplate);
          return { analysis, latencyMs: Date.now() - start };
        })(),
      ]);

      const updates: Record<string, any> = { status: "completed" };

      if (baselineResult.status === "fulfilled") {
        updates.baselineAnalysis = baselineResult.value.analysis;
        updates.baselineLatencyMs = baselineResult.value.latencyMs;
        console.log(`[AB-${testId}] Baseline (${abTest.baselineModel}): score=${baselineResult.value.analysis.performance_score}, ${baselineResult.value.latencyMs}ms`);
      } else {
        console.error(`[AB-${testId}] Baseline model failed:`, baselineResult.reason?.message);
        updates.baselineAnalysis = { error: baselineResult.reason?.message || "Analysis failed" };
      }

      if (testResult.status === "fulfilled") {
        updates.testAnalysis = testResult.value.analysis;
        updates.testLatencyMs = testResult.value.latencyMs;
        console.log(`[AB-${testId}] Test (${abTest.testModel}): score=${testResult.value.analysis.performance_score}, ${testResult.value.latencyMs}ms`);
      } else {
        console.error(`[AB-${testId}] Test model failed:`, testResult.reason?.message);
        updates.testAnalysis = { error: testResult.reason?.message || "Analysis failed" };
      }

      // If both failed, mark as failed
      if (baselineResult.status === "rejected" && testResult.status === "rejected") {
        updates.status = "failed";
      }

      await storage.updateABTest(testId, updates);

      // Track usage/cost for A/B test
      try {
        const audioDuration = transcriptText.length > 0
          ? Math.max(30, Math.ceil(transcriptText.length / 20)) // rough estimate from text length
          : 60;
        const assemblyaiCost = estimateAssemblyAICost(audioDuration);
        const estimatedInputTokens = Math.ceil(transcriptText.length / 4) + 500;
        const estimatedOutputTokens = 800;

        let baselineCost = 0;
        let testCost = 0;
        const services: UsageRecord["services"] = {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
        };

        if (baselineResult.status === "fulfilled") {
          baselineCost = estimateBedrockCost(abTest.baselineModel, estimatedInputTokens, estimatedOutputTokens);
          services.bedrock = {
            model: abTest.baselineModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(baselineCost * 10000) / 10000,
            latencyMs: baselineResult.value.latencyMs,
          };
        }
        if (testResult.status === "fulfilled") {
          testCost = estimateBedrockCost(abTest.testModel, estimatedInputTokens, estimatedOutputTokens);
          services.bedrockSecondary = {
            model: abTest.testModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(testCost * 10000) / 10000,
            latencyMs: testResult.value.latencyMs,
          };
        }

        const usageRecord: UsageRecord = {
          id: randomUUID(),
          callId: testId,
          type: "ab-test",
          timestamp: new Date().toISOString(),
          user: abTest.createdBy,
          services,
          totalEstimatedCost: Math.round((assemblyaiCost + baselineCost + testCost) * 10000) / 10000,
        };
        await storage.createUsageRecord(usageRecord);
      } catch (usageErr) {
        console.warn(`[AB-${testId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
      }

      await cleanupFile(filePath);
      broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete" });
      console.log(`[AB-${testId}] A/B comparison complete.`);

    } catch (error) {
      console.error(`[AB-${testId}] Processing error:`, (error as Error).message);
      await storage.updateABTest(testId, { status: "failed" });
      await cleanupFile(filePath);
    }
  }
}
