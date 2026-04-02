import type { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { assemblyAIService } from "../services/assemblyai";
import { BedrockProvider } from "../services/bedrock";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, insertWebhookConfigSchema, CALL_CATEGORIES, BEDROCK_MODEL_PRESETS, type UsageRecord } from "@shared/schema";
import { validateUrlForSSRF } from "../services/url-validator";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, TaskQueue } from "./utils";
import {
  getAllWebhookConfigs,
  getWebhookConfig,
  createWebhookConfig,
  updateWebhookConfig,
  deleteWebhookConfig,
  triggerWebhook,
  WEBHOOK_EVENTS,
  type WebhookConfig,
} from "../services/webhooks";

const audioProcessingQueue = new TaskQueue(3);

export function registerContentRoutes(
  router: Router,
  uploadMiddleware: any,
) {

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

  router.get("/api/ab-tests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const tests = await storage.getAllABTests();
      res.json(tests);
    } catch (error) {
      console.error("Error fetching A/B tests:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch A/B tests" });
    }
  });

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

  router.post("/api/ab-tests/upload", requireAuth, requireRole("admin"), uploadMiddleware, async (req, res) => {
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

      const abTest = await storage.createABTest({
        fileName: req.file.originalname,
        callCategory: callCategory || undefined,
        baselineModel,
        testModel,
        status: "processing",
        createdBy: user?.username || "admin",
      });

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

  // ==================== WEBHOOK MANAGEMENT ROUTES (admin only) ====================

  router.get("/api/admin/webhooks", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const configs = await getAllWebhookConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch webhook configs" });
    }
  });

  router.post("/api/admin/webhooks", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const parsed = insertWebhookConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid webhook config", errors: parsed.error.flatten() });
        return;
      }
      // SSRF protection: reject webhook URLs targeting internal/private networks
      const urlCheck = await validateUrlForSSRF(parsed.data.url);
      if (!urlCheck.valid) {
        res.status(400).json({ message: urlCheck.error || "Invalid webhook URL" });
        return;
      }
      const invalidEvents = parsed.data.events.filter(e => !WEBHOOK_EVENTS.includes(e as any));
      if (invalidEvents.length > 0) {
        res.status(400).json({ message: `Invalid events: ${invalidEvents.join(", ")}. Valid events: ${WEBHOOK_EVENTS.join(", ")}` });
        return;
      }
      const config: WebhookConfig = {
        ...parsed.data,
        id: randomUUID(),
        createdBy: req.user?.username || "admin",
        createdAt: new Date().toISOString(),
      };
      await createWebhookConfig(config);
      res.status(201).json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to create webhook config" });
    }
  });

  router.patch("/api/admin/webhooks/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      // SSRF protection: validate URL if being updated
      if (req.body.url) {
        const urlCheck = await validateUrlForSSRF(req.body.url);
        if (!urlCheck.valid) {
          res.status(400).json({ message: urlCheck.error || "Invalid webhook URL" });
          return;
        }
      }
      const updated = await updateWebhookConfig(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ message: "Webhook config not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update webhook config" });
    }
  });

  router.delete("/api/admin/webhooks/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const existing = await getWebhookConfig(req.params.id);
      if (!existing) {
        res.status(404).json({ message: "Webhook config not found" });
        return;
      }
      await deleteWebhookConfig(req.params.id);
      res.json({ message: "Webhook config deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete webhook config" });
    }
  });

  router.post("/api/admin/webhooks/:id/test", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const config = await getWebhookConfig(req.params.id);
      if (!config) {
        res.status(404).json({ message: "Webhook config not found" });
        return;
      }
      const testEvent = config.events[0] || "call.completed";
      await triggerWebhook(testEvent, {
        test: true,
        message: "This is a test webhook from CallAnalyzer",
        triggeredBy: req.user?.username,
      });
      res.json({ message: `Test event "${testEvent}" sent to ${config.url}` });
    } catch (error) {
      res.status(500).json({ message: "Failed to send test webhook" });
    }
  });

  // A/B test processing pipeline
  async function processABTest(testId: string, filePath: string, audioBuffer: Buffer, callCategory?: string) {
    console.log(`[AB-${testId}] Starting A/B model comparison...`);
    try {
      const abTest = await storage.getABTest(testId);
      if (!abTest) throw new Error("A/B test record not found");

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

      if (baselineResult.status === "rejected" && testResult.status === "rejected") {
        updates.status = "failed";
      }

      await storage.updateABTest(testId, updates);

      // Track usage/cost for A/B test
      try {
        const audioDuration = transcriptText.length > 0
          ? Math.max(30, Math.ceil(transcriptText.length / 20))
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
