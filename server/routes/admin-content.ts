import type { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { logger } from "../services/logger";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { assemblyAIService } from "../services/assemblyai";
import { BedrockProvider } from "../services/bedrock";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, insertWebhookConfigSchema, updateWebhookConfigSchema, CALL_CATEGORIES, BEDROCK_MODEL_PRESETS, type UsageRecord } from "@shared/schema";
import { validateUrlForSSRF } from "../services/url-validator";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, sendError, sendValidationError, validateIdParam } from "./utils";
import { audioProcessingQueue } from "./pipeline";
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
        sendValidationError(res, "Invalid template data", parsed.error);
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

  router.patch("/api/prompt-templates/:id", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const { updatedBy: _ignore, id: _ignoreId, ...bodyWithoutMeta } = req.body;
      const templateUpdateParsed = insertPromptTemplateSchema.partial().safeParse(bodyWithoutMeta);
      if (!templateUpdateParsed.success) {
        sendValidationError(res, "Invalid template data", templateUpdateParsed.error);
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

  router.delete("/api/prompt-templates/:id", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      await storage.deletePromptTemplate(req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // Back-test a prompt template against the last N completed calls in its category.
  // Re-runs AI analysis with the candidate template against existing transcripts
  // so admins can see score deltas before publishing. Test results are NOT persisted
  // and do NOT affect stored analyses, metrics, coaching, or gamification.
  router.post("/api/prompt-templates/:id/test", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const template = await storage.getPromptTemplate(req.params.id);
      if (!template) {
        res.status(404).json({ message: "Template not found" });
        return;
      }

      // Cap sample size: 1-10 calls, default 5. Each call is a full Bedrock analysis
      // so the upper bound protects against cost blow-up.
      const requestedSample = typeof req.body?.sampleSize === "number" ? req.body.sampleSize : 5;
      const sampleSize = Math.max(1, Math.min(10, Math.floor(requestedSample)));

      // Pull completed calls in the template's category, newest first.
      const allCalls = await storage.getCallsWithDetails({ status: "completed" });
      const categoryCalls = allCalls
        .filter(c => (c.callCategory || "") === template.callCategory)
        .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
        .slice(0, sampleSize);

      if (categoryCalls.length === 0) {
        res.json({
          templateId: template.id,
          templateName: template.name,
          callCategory: template.callCategory,
          sampleSize: 0,
          results: [],
          summary: { avgCurrentScore: null, avgTestScore: null, avgDelta: null, scoreDirection: "unknown", successfulRuns: 0 },
          message: `No completed calls in category "${template.callCategory}" to test against.`,
        });
        return;
      }

      const candidateTemplate = {
        evaluationCriteria: template.evaluationCriteria,
        requiredPhrases: template.requiredPhrases,
        scoringWeights: template.scoringWeights,
        additionalInstructions: template.additionalInstructions,
      };
      const testProvider = new BedrockProvider();

      // Run candidate analyses in parallel. Bounded above to 10 samples.
      const results = await Promise.all(
        categoryCalls.map(async (call) => {
          const transcript = await storage.getTranscript(call.id);
          const transcriptText = transcript?.text || "";
          if (!transcriptText || transcriptText.length < 10) {
            return {
              callId: call.id,
              fileName: call.fileName,
              currentScore: call.analysis?.performanceScore
                ? parseFloat(String(call.analysis.performanceScore))
                : null,
              testScore: null,
              delta: null,
              currentSummary: (call.analysis?.summary as string) || null,
              testSummary: null,
              error: "Transcript unavailable or too short",
            };
          }

          try {
            const candidate = await testProvider.analyzeCallTranscript(
              transcriptText,
              `template-test-${template.id}-${call.id}`,
              template.callCategory,
              candidateTemplate,
            );
            const currentScore = call.analysis?.performanceScore
              ? parseFloat(String(call.analysis.performanceScore))
              : null;
            const testScoreRaw = (candidate as any)?.performance_score;
            const testScore = typeof testScoreRaw === "number" ? testScoreRaw : null;
            const delta = currentScore !== null && testScore !== null
              ? Math.round((testScore - currentScore) * 100) / 100
              : null;
            return {
              callId: call.id,
              fileName: call.fileName,
              currentScore,
              testScore,
              delta,
              currentSummary: (call.analysis?.summary as string) || null,
              testSummary: typeof (candidate as any)?.summary === "string" ? (candidate as any).summary : null,
              error: null,
            };
          } catch (err) {
            return {
              callId: call.id,
              fileName: call.fileName,
              currentScore: call.analysis?.performanceScore
                ? parseFloat(String(call.analysis.performanceScore))
                : null,
              testScore: null,
              delta: null,
              currentSummary: (call.analysis?.summary as string) || null,
              testSummary: null,
              error: (err as Error).message || "Analysis failed",
            };
          }
        })
      );

      // Summary stats across successful runs only.
      const successful = results.filter(r => r.testScore !== null && r.currentScore !== null);
      const avgCurrentScore = successful.length > 0
        ? Math.round((successful.reduce((s, r) => s + (r.currentScore || 0), 0) / successful.length) * 100) / 100
        : null;
      const avgTestScore = successful.length > 0
        ? Math.round((successful.reduce((s, r) => s + (r.testScore || 0), 0) / successful.length) * 100) / 100
        : null;
      const avgDelta = avgCurrentScore !== null && avgTestScore !== null
        ? Math.round((avgTestScore - avgCurrentScore) * 100) / 100
        : null;
      const scoreDirection = avgDelta === null
        ? "unknown"
        : Math.abs(avgDelta) < 0.1
          ? "neutral"
          : avgDelta > 0
            ? "higher"
            : "lower";

      res.json({
        templateId: template.id,
        templateName: template.name,
        callCategory: template.callCategory,
        sampleSize: categoryCalls.length,
        results,
        summary: {
          avgCurrentScore,
          avgTestScore,
          avgDelta,
          scoreDirection,
          successfulRuns: successful.length,
        },
      });
    } catch (error) {
      logger.error("error back-testing prompt template", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to back-test template" });
    }
  });

  // ==================== USAGE TRACKING ROUTES (admin only) ====================

  router.get("/api/usage", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const records = await storage.getAllUsageRecords();
      res.json(records);
    } catch (error) {
      logger.error("error fetching usage records", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch usage data" });
    }
  });

  // ==================== A/B MODEL TESTING ROUTES (admin only) ====================

  router.get("/api/ab-tests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const tests = await storage.getAllABTests();
      res.json(tests);
    } catch (error) {
      logger.error("error fetching A/B tests", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch A/B tests" });
    }
  });

  router.get("/api/ab-tests/:id", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      res.json(test);
    } catch (error) {
      logger.error("error fetching A/B test", { error: (error as Error).message });
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

      const user = req.user;
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
          logger.error("A/B test processing failed", { id: abTest.id, error: (error as Error).message });
          try {
            await storage.updateABTest(abTest.id, { status: "failed" });
          } catch (updateErr) {
            logger.error("failed to mark A/B test as failed", { id: abTest.id, error: (updateErr as Error).message });
          }
        });

      res.status(201).json(abTest);
    } catch (error) {
      logger.error("error starting A/B test", { error: (error as Error).message });
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to start A/B test" });
    }
  });

  router.delete("/api/ab-tests/:id", requireAuth, requireRole("admin"), validateIdParam, async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      await storage.deleteABTest(req.params.id);
      res.json({ message: "A/B test deleted" });
    } catch (error) {
      logger.error("error deleting A/B test", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to delete A/B test" });
    }
  });

  // Aggregate A/B test results — compares accumulated test runs across all
  // model pairs. Returns: per-model-pair summary with avg score delta, avg
  // latency delta, win count, sample size. Drives the promotion UI.
  router.get("/api/ab-tests/aggregate", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const tests = await storage.getAllABTests();
      const completed = tests.filter(t => t.status === "completed");

      // Group by (baselineModel, testModel) pair
      interface Accumulator {
        baselineModel: string;
        testModel: string;
        sampleSize: number;
        baselineWins: number;
        testWins: number;
        ties: number;
        baselineScoreSum: number;
        testScoreSum: number;
        baselineScoreCount: number;
        testScoreCount: number;
        baselineLatencySum: number;
        testLatencySum: number;
        latencySampleSize: number;
      }
      const groups = new Map<string, Accumulator>();

      for (const t of completed) {
        const baseline = t.baselineAnalysis as any;
        const test = t.testAnalysis as any;
        if (!baseline || !test) continue;
        if (baseline.error || test.error) continue;

        const key = `${t.baselineModel}||${t.testModel}`;
        let acc = groups.get(key);
        if (!acc) {
          acc = {
            baselineModel: t.baselineModel,
            testModel: t.testModel,
            sampleSize: 0,
            baselineWins: 0,
            testWins: 0,
            ties: 0,
            baselineScoreSum: 0,
            testScoreSum: 0,
            baselineScoreCount: 0,
            testScoreCount: 0,
            baselineLatencySum: 0,
            testLatencySum: 0,
            latencySampleSize: 0,
          };
          groups.set(key, acc);
        }

        acc.sampleSize++;

        const baselineScoreRaw = baseline.performance_score;
        const testScoreRaw = test.performance_score;
        const baselineScore = typeof baselineScoreRaw === "number" ? baselineScoreRaw : null;
        const testScore = typeof testScoreRaw === "number" ? testScoreRaw : null;

        if (baselineScore !== null) {
          acc.baselineScoreSum += baselineScore;
          acc.baselineScoreCount++;
        }
        if (testScore !== null) {
          acc.testScoreSum += testScore;
          acc.testScoreCount++;
        }

        if (baselineScore !== null && testScore !== null) {
          const diff = testScore - baselineScore;
          if (Math.abs(diff) < 0.25) acc.ties++;
          else if (diff > 0) acc.testWins++;
          else acc.baselineWins++;
        }

        if (typeof t.baselineLatencyMs === "number" && typeof t.testLatencyMs === "number") {
          acc.baselineLatencySum += t.baselineLatencyMs;
          acc.testLatencySum += t.testLatencyMs;
          acc.latencySampleSize++;
        }
      }

      const aggregates = Array.from(groups.values()).map(acc => {
        const avgBaselineScore = acc.baselineScoreCount > 0
          ? Math.round((acc.baselineScoreSum / acc.baselineScoreCount) * 100) / 100
          : null;
        const avgTestScore = acc.testScoreCount > 0
          ? Math.round((acc.testScoreSum / acc.testScoreCount) * 100) / 100
          : null;
        const avgScoreDelta = avgBaselineScore !== null && avgTestScore !== null
          ? Math.round((avgTestScore - avgBaselineScore) * 100) / 100
          : null;
        const avgBaselineLatency = acc.latencySampleSize > 0
          ? Math.round(acc.baselineLatencySum / acc.latencySampleSize)
          : null;
        const avgTestLatency = acc.latencySampleSize > 0
          ? Math.round(acc.testLatencySum / acc.latencySampleSize)
          : null;
        const avgLatencyDelta = avgBaselineLatency !== null && avgTestLatency !== null
          ? avgTestLatency - avgBaselineLatency
          : null;

        // Recommendation rules:
        //  - at least 3 samples needed
        //  - test model wins if avg delta ≥ 0.2 points (meaningful)
        //  - baseline wins if avg delta ≤ -0.2 points
        //  - otherwise inconclusive
        let recommendation: "promote_test" | "keep_baseline" | "inconclusive" | "insufficient_data";
        if (acc.sampleSize < 3) {
          recommendation = "insufficient_data";
        } else if (avgScoreDelta === null) {
          recommendation = "inconclusive";
        } else if (avgScoreDelta >= 0.2) {
          recommendation = "promote_test";
        } else if (avgScoreDelta <= -0.2) {
          recommendation = "keep_baseline";
        } else {
          recommendation = "inconclusive";
        }

        return {
          baselineModel: acc.baselineModel,
          testModel: acc.testModel,
          sampleSize: acc.sampleSize,
          baselineWins: acc.baselineWins,
          testWins: acc.testWins,
          ties: acc.ties,
          avgBaselineScore,
          avgTestScore,
          avgScoreDelta,
          avgBaselineLatencyMs: avgBaselineLatency,
          avgTestLatencyMs: avgTestLatency,
          avgLatencyDeltaMs: avgLatencyDelta,
          recommendation,
        };
      });

      // Sort: promotable winners first, then by sample size
      aggregates.sort((a, b) => {
        const rank = (r: string) => r === "promote_test" ? 0 : r === "inconclusive" ? 1 : r === "keep_baseline" ? 2 : 3;
        const byRec = rank(a.recommendation) - rank(b.recommendation);
        if (byRec !== 0) return byRec;
        return b.sampleSize - a.sampleSize;
      });

      // Current active model (env var or persisted override after startup)
      const { getCurrentActiveModel } = await import("../services/active-model");
      const currentActiveModel = getCurrentActiveModel();

      res.json({ aggregates, currentActiveModel });
    } catch (error) {
      logger.error("error computing A/B test aggregates", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to compute aggregates" });
    }
  });

  // Promote a model to production (update aiProvider singleton + persist to S3).
  // Requires the model to be in BEDROCK_MODEL_PRESETS whitelist — we do NOT
  // accept arbitrary model IDs here, because a typo would silently cost-bomb.
  router.post("/api/ab-tests/promote", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { model, baselineModel, sampleSize, avgDelta } = req.body || {};

      if (!model || typeof model !== "string") {
        res.status(400).json({ message: "model (string) is required" });
        return;
      }

      const whitelist = BEDROCK_MODEL_PRESETS.map(m => m.value) as string[];
      if (!whitelist.includes(model)) {
        res.status(400).json({
          message: `Model "${model}" is not in the allowed presets. Use one of: ${whitelist.join(", ")}`,
        });
        return;
      }

      const { promoteActiveModel } = await import("../services/active-model");
      await promoteActiveModel({
        model,
        promotedBy: req.user?.username || "admin",
        promotedAt: new Date().toISOString(),
        baselineModel: typeof baselineModel === "string" ? baselineModel : undefined,
        sampleSize: typeof sampleSize === "number" ? sampleSize : undefined,
        avgDelta: typeof avgDelta === "number" ? avgDelta : null,
      });

      // HIPAA audit trail: promotion affects scoring of every future call
      const { logPhiAccess } = await import("../services/audit-log");
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "ab_test_promote_model",
        userId: req.user?.id,
        username: req.user?.username,
        role: req.user?.role,
        resourceType: "ab_test",
        detail: `Promoted ${model}${baselineModel ? ` over ${baselineModel}` : ""}${typeof sampleSize === "number" ? ` (${sampleSize} samples)` : ""}`,
      });

      res.json({ message: "Model promoted successfully", model });
    } catch (error) {
      logger.error("error promoting model", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to promote model" });
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
        sendValidationError(res, "Invalid webhook config", parsed.error);
        return;
      }
      // SSRF protection: reject webhook URLs targeting internal/private networks
      const urlCheck = await validateUrlForSSRF(parsed.data.url);
      if (!urlCheck.valid) {
        res.status(400).json({ message: urlCheck.error || "Invalid webhook URL" });
        return;
      }
      const invalidEvents = parsed.data.events.filter(e => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
      if (invalidEvents.length > 0) {
        res.status(400).json({ message: `Invalid events: ${invalidEvents.join(", ")}. Valid events: ${WEBHOOK_EVENTS.join(", ")}` });
        return;
      }
      const config: WebhookConfig = {
        ...parsed.data,
        id: randomUUID(),
        createdBy: req.user!.username,
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
      const parsed = updateWebhookConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid webhook update", parsed.error);
        return;
      }
      // SSRF protection: validate URL if being updated
      if (parsed.data.url) {
        const urlCheck = await validateUrlForSSRF(parsed.data.url);
        if (!urlCheck.valid) {
          res.status(400).json({ message: urlCheck.error || "Invalid webhook URL" });
          return;
        }
      }
      const updated = await updateWebhookConfig(req.params.id, parsed.data);
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
    logger.info("starting A/B model comparison", { id: testId });
    try {
      const abTest = await storage.getABTest(testId);
      if (!abTest) throw new Error("A/B test record not found");

      logger.info("step 1: uploading to AssemblyAI", { id: testId });
      const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
      const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

      if (!transcriptResponse || transcriptResponse.status !== 'completed') {
        throw new Error(`Transcription failed. Status: ${transcriptResponse?.status}`);
      }

      const transcriptText = transcriptResponse.text || "";
      await storage.updateABTest(testId, { transcriptText, status: "analyzing" });
      logger.info("transcription complete", { id: testId, chars: transcriptText.length });

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
          logger.warn("failed to load prompt template", { id: testId, error: (e as Error).message });
        }
      }

      logger.info("step 2: running analysis with both models", { id: testId });
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
        logger.info("baseline analysis complete", { id: testId, model: abTest.baselineModel, score: baselineResult.value.analysis.performance_score, latencyMs: baselineResult.value.latencyMs });
      } else {
        logger.error("baseline model failed", { id: testId, error: baselineResult.reason?.message });
        updates.baselineAnalysis = { error: baselineResult.reason?.message || "Analysis failed" };
      }

      if (testResult.status === "fulfilled") {
        updates.testAnalysis = testResult.value.analysis;
        updates.testLatencyMs = testResult.value.latencyMs;
        logger.info("test analysis complete", { id: testId, model: abTest.testModel, score: testResult.value.analysis.performance_score, latencyMs: testResult.value.latencyMs });
      } else {
        logger.error("test model failed", { id: testId, error: testResult.reason?.message });
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
          baselineCost = estimateBedrockCost(abTest.baselineModel, estimatedInputTokens, estimatedOutputTokens) ?? 0;
          services.bedrock = {
            model: abTest.baselineModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(baselineCost * 10000) / 10000,
            latencyMs: baselineResult.value.latencyMs,
          };
        }
        if (testResult.status === "fulfilled") {
          testCost = estimateBedrockCost(abTest.testModel, estimatedInputTokens, estimatedOutputTokens) ?? 0;
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
        logger.warn("failed to record usage (non-blocking)", { id: testId, error: (usageErr as Error).message });
      }

      await cleanupFile(filePath);
      broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete" });
      logger.info("A/B comparison complete", { id: testId });

    } catch (error) {
      logger.error("A/B test processing error", { id: testId, error: (error as Error).message });
      await storage.updateABTest(testId, { status: "failed" });
      await cleanupFile(filePath);
    }
  }
}
