/**
 * Simulated Call Generator routes. Admin-only, MFA-gated via the parent
 * `/api/admin/*` mount in server/routes.ts.
 *
 * Endpoints:
 *   POST   /api/admin/simulated-calls/generate    — enqueue a generation job
 *   GET    /api/admin/simulated-calls             — list my generated calls
 *   GET    /api/admin/simulated-calls/:id         — get one
 *   DELETE /api/admin/simulated-calls/:id         — delete one
 *   POST   /api/admin/simulated-calls/:id/analyze — send to real analysis pipeline
 *   GET    /api/admin/simulated-calls/:id/audio   — stream the stitched MP3
 *   GET    /api/admin/simulated-calls/voices      — proxy ElevenLabs voice list (cached)
 */
import type { Router } from "express";
import { requireAuth, requireRole, requireMFASetup } from "../auth";
import { logger } from "../services/logger";
import { validateIdParam, sendError, sendValidationError } from "./utils";
import { storage } from "../storage";
import type { JobQueue } from "../services/job-queue";
import { logPhiAccess, auditContext } from "../services/audit-log";
import {
  createSimulatedCall,
  getSimulatedCall,
  listSimulatedCalls,
  listCalibrationPresets,
  updateSimulatedCall,
  deleteSimulatedCall,
  countSimulatedCallsToday,
  isSimulatedCallsAvailable,
  warnSimulatedCallsUnavailableOnce,
  sendSimulatedCallToAnalysis,
  SendToAnalysisError,
} from "../services/simulated-call-storage";
import {
  generateSimulatedCallRequestSchema,
  circumstanceSchema,
} from "@shared/simulated-call-schema";
import { elevenLabsClient, type ElevenLabsVoice } from "../services/elevenlabs-client";
import { isFfmpegAvailable } from "../services/audio-stitcher";
import { broadcastSimulatedCallUpdate } from "../services/websocket";
import { rewriteScript, generateScriptFromScenario, ScriptRewriterError } from "../services/script-rewriter";
import { z } from "zod";

const DAILY_GENERATION_CAP = Math.max(
  1,
  Math.min(parseInt(process.env.SIMULATED_CALL_DAILY_CAP || "20", 10), 500),
);

/** Upper bound on circumstances per /rewrite call. Keeps prompt size + cost bounded. */
const CIRCUMSTANCE_LIMIT_PER_REWRITE = 4;

// Simple in-memory cache for the ElevenLabs voices list. 24h TTL; the list
// rarely changes. Shared across all admins.
let voicesCache: { at: number; voices: ElevenLabsVoice[] } | null = null;
const VOICES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function registerSimulatedCallRoutes(
  router: Router,
  getJobQueue: () => JobQueue | null,
) {
  // ── Voice list (cached proxy) ──────────────────────────────
  router.get(
    "/api/admin/simulated-calls/voices",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      if (!elevenLabsClient.isAvailable) {
        return sendError(res, 503, "ELEVENLABS_API_KEY is not configured");
      }
      const now = Date.now();
      if (voicesCache && now - voicesCache.at < VOICES_CACHE_TTL_MS) {
        return res.json({ voices: voicesCache.voices, cached: true });
      }
      try {
        const voices = await elevenLabsClient.listVoices();
        voicesCache = { at: now, voices };
        res.json({ voices, cached: false });
      } catch (err) {
        logger.warn("failed to list ElevenLabs voices", {
          error: (err as Error).message,
        });
        sendError(res, 502, "Failed to fetch voices from ElevenLabs");
      }
    },
  );

  // ── List my generations ────────────────────────────────────
  router.get(
    "/api/admin/simulated-calls",
    requireAuth,
    requireRole("admin"),
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        warnSimulatedCallsUnavailableOnce();
        return res.json({ calls: [], dailyUsed: 0, dailyCap: DAILY_GENERATION_CAP });
      }
      try {
        const username = req.user!.username;
        const limit = Math.max(
          1,
          Math.min(parseInt(req.query.limit as string) || 50, 200),
        );
        const [calls, dailyUsed] = await Promise.all([
          listSimulatedCalls({ createdBy: username, limit }),
          countSimulatedCallsToday(username),
        ]);
        res.json({ calls, dailyUsed, dailyCap: DAILY_GENERATION_CAP });
      } catch (err) {
        logger.error("failed to list simulated calls", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to list simulated calls");
      }
    },
  );

  // ── Calibration suite (#1 roadmap) ─────────────────────────
  // Read-only report: lists every simulated-call preset that has an
  // `expectedScoreRange` in its config, pulls each preset's most-recently
  // analyzed score (from calls.analyses via simulated_calls.sent_to_analysis_call_id),
  // and reports pass/fail + summary counts. Operators use this as a
  // regression-detection dashboard after prompt template edits or model
  // swaps: if the model drifted, presets that previously passed now fail.
  //
  // This endpoint is deliberately read-only. Regenerating + re-analyzing
  // all presets is an expensive async operation (~30 min for 12 presets);
  // operators can manually re-run individual presets via the existing
  // /analyze endpoint and then refresh this report.
  router.get(
    "/api/admin/simulated-calls/calibration-suite",
    requireAuth,
    requireRole("admin"),
    async (_req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return res.json({ presets: [], summary: { total: 0, passed: 0, failed: 0, notRun: 0 } });
      }
      try {
        const presets = await listCalibrationPresets();
        const report: Array<{
          id: string;
          title: string;
          qualityTier: string | null | undefined;
          expectedMin: number;
          expectedMax: number;
          actualScore: number | null;
          sentToAnalysisCallId: string | null | undefined;
          analyzedAt: string | null;
          status: "pass" | "fail" | "not_run";
          /** Score delta vs. nearest range boundary (0 when in range). */
          delta: number | null;
        }> = [];

        let passed = 0;
        let failed = 0;
        let notRun = 0;

        for (const preset of presets) {
          const range = preset.config.expectedScoreRange;
          if (!range) continue; // Shouldn't happen given the listCalibrationPresets filter, but defensive.
          let actualScore: number | null = null;
          let analyzedAt: string | null = null;

          if (preset.sentToAnalysisCallId) {
            try {
              const analysis = await storage.getCallAnalysis(preset.sentToAnalysisCallId);
              if (analysis?.performanceScore) {
                const parsed = parseFloat(String(analysis.performanceScore));
                if (Number.isFinite(parsed)) {
                  actualScore = parsed;
                  analyzedAt = analysis.createdAt ?? null;
                }
              }
            } catch (lookupErr) {
              logger.warn("calibration-suite: failed to load analysis", {
                presetId: preset.id,
                callId: preset.sentToAnalysisCallId,
                error: (lookupErr as Error).message,
              });
            }
          }

          let status: "pass" | "fail" | "not_run";
          let delta: number | null = null;
          if (actualScore === null) {
            status = "not_run";
            notRun++;
          } else if (actualScore >= range.min && actualScore <= range.max) {
            status = "pass";
            delta = 0;
            passed++;
          } else {
            status = "fail";
            delta = actualScore < range.min ? actualScore - range.min : actualScore - range.max;
            failed++;
          }

          report.push({
            id: preset.id,
            title: preset.title,
            qualityTier: preset.qualityTier,
            expectedMin: range.min,
            expectedMax: range.max,
            actualScore,
            sentToAnalysisCallId: preset.sentToAnalysisCallId,
            analyzedAt,
            status,
            delta,
          });
        }

        res.json({
          presets: report,
          summary: { total: report.length, passed, failed, notRun },
        });
      } catch (err) {
        logger.error("calibration-suite: failed to build report", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to build calibration suite report");
      }
    },
  );

  // ── Calibration suite runner (Tier A #1) ──────────────────
  // Re-analyzes every preset with an expectedScoreRange against the CURRENT
  // prompt template + AI model. Does NOT regenerate audio (TTS cost + 15min
  // per preset would make the feature too slow to be useful); the existing
  // audioS3Key is reused. Operators run this after prompt template edits or
  // model promotions to detect scoring drift before it affects real agents.
  //
  // Strategy per preset:
  //   1. Delete the prior analyzed call row (if any) so externalId
  //      "sim:<presetId>" can be re-used. Transcript / sentiment / analysis
  //      rows cascade via FK ON DELETE CASCADE. Previous analyses are NOT
  //      retained — calibration is always "latest prompt vs latest run".
  //   2. Clear preset.sentToAnalysisCallId.
  //   3. Call sendSimulatedCallToAnalysis() which creates a fresh calls row
  //      and enqueues process_audio. The audio file in S3 stays put and is
  //      re-analyzed with the current pipeline configuration.
  //
  // Returns immediately with counts; the analyses complete asynchronously
  // over the next few minutes. Operators refresh the calibration report
  // to see updated pass/fail results.
  router.post(
    "/api/admin/simulated-calls/calibration-suite/run",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      const jobQueue = getJobQueue();
      if (!jobQueue) {
        return sendError(res, 503, "Job queue is not running");
      }

      try {
        const presets = await listCalibrationPresets();
        const eligible = presets.filter(p => p.audioS3Key && p.status === "ready");

        let queued = 0;
        let skipped = 0;
        const skippedReasons: Array<{ id: string; title: string; reason: string }> = [];

        for (const preset of eligible) {
          try {
            // Delete prior analyzed call (if any) — required so we can reuse
            // externalId "sim:<presetId>" without tripping the unique index.
            if (preset.sentToAnalysisCallId) {
              try {
                await storage.deleteCall(preset.sentToAnalysisCallId);
              } catch (delErr) {
                logger.warn("calibration-suite: failed to delete prior call (continuing)", {
                  presetId: preset.id,
                  callId: preset.sentToAnalysisCallId,
                  error: (delErr as Error).message,
                });
              }
            }
            // Also check for orphaned calls with the same externalId (defensive
            // against a prior run that crashed mid-sequence).
            const orphan = await storage.findCallByExternalId(`sim:${preset.id}`);
            if (orphan && orphan.id !== preset.sentToAnalysisCallId) {
              try {
                await storage.deleteCall(orphan.id);
              } catch {
                /* best effort */
              }
            }
            await updateSimulatedCall(preset.id, { sentToAnalysisCallId: null });

            await sendSimulatedCallToAnalysis({
              simulatedCallId: preset.id,
              uploadedBy: req.user!.username,
              jobQueue,
              storage,
            });
            queued++;
          } catch (err) {
            skipped++;
            const reason = err instanceof SendToAnalysisError ? err.code : (err as Error).message;
            skippedReasons.push({ id: preset.id, title: preset.title, reason });
            logger.warn("calibration-suite: skipped preset", {
              presetId: preset.id,
              title: preset.title,
              reason,
            });
          }
        }

        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "calibration_suite_run",
          resourceType: "simulated_call",
          detail: `presetsEnqueued=${queued} skipped=${skipped}`,
        });

        res.status(202).json({
          presetsTotal: presets.length,
          presetsEligible: eligible.length,
          queued,
          skipped,
          skippedReasons,
        });
      } catch (err) {
        logger.error("calibration-suite: runner failed", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to run calibration suite");
      }
    },
  );

  // ── Get one ────────────────────────────────────────────────
  router.get(
    "/api/admin/simulated-calls/:id",
    requireAuth,
    requireRole("admin"),
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");
      res.json(row);
    },
  );

  // ── Generate a new one ─────────────────────────────────────
  router.post(
    "/api/admin/simulated-calls/generate",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      if (!isFfmpegAvailable()) {
        return sendError(res, 503, "ffmpeg not available on this server");
      }
      if (!elevenLabsClient.isAvailable) {
        return sendError(res, 503, "ELEVENLABS_API_KEY is not configured");
      }

      const parsed = generateSimulatedCallRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid request", parsed.error);
      }
      const { script, config } = parsed.data;
      const username = req.user!.username;

      // Daily generation cap — avoid accidental spend spikes.
      const used = await countSimulatedCallsToday(username);
      if (used >= DAILY_GENERATION_CAP) {
        return sendError(
          res,
          429,
          `Daily generation cap reached (${DAILY_GENERATION_CAP}). Try again tomorrow.`,
        );
      }

      const jobQueue = getJobQueue();
      if (!jobQueue) {
        return sendError(res, 503, "Job queue is not running");
      }

      try {
        const row = await createSimulatedCall({
          title: script.title,
          scenario: script.scenario,
          qualityTier: script.qualityTier,
          equipment: script.equipment,
          script,
          config,
          createdBy: username,
        });

        // Low-priority job so real call analyses don't get blocked behind
        // long-running generation jobs. Real uploads default to priority 0;
        // setting -10 here makes generations yield to them.
        await jobQueue.enqueue(
          "generate_simulated_call",
          { simulatedCallId: row.id, uploadedBy: username },
          -10,
        );

        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "generate_simulated_call",
          resourceType: "simulated_call",
          resourceId: row.id,
          detail: `turns=${script.turns.length}; tier=${script.qualityTier}`,
        });

        broadcastSimulatedCallUpdate(row.id, "pending", {
          title: row.title,
          createdBy: username,
        });

        res.status(202).json({
          simulatedCallId: row.id,
          status: "pending",
          dailyUsed: used + 1,
          dailyCap: DAILY_GENERATION_CAP,
        });
      } catch (err) {
        logger.error("failed to enqueue simulated call generation", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to enqueue generation");
      }
    },
  );

  // ── Send a generated call to the real analysis pipeline ────
  router.post(
    "/api/admin/simulated-calls/:id/analyze",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }

      try {
        const result = await sendSimulatedCallToAnalysis({
          simulatedCallId: req.params.id,
          uploadedBy: req.user!.username,
          jobQueue: getJobQueue(),
          storage,
        });

        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "simulated_call_sent_to_analysis",
          resourceType: "simulated_call",
          resourceId: result.simulatedCallId,
          detail: `callId=${result.callId}`,
        });

        res.status(202).json({
          simulatedCallId: result.simulatedCallId,
          callId: result.callId,
          status: "processing",
        });
      } catch (err) {
        if (err instanceof SendToAnalysisError) {
          const statusByCode: Record<string, number> = {
            not_found: 404,
            not_ready: 400,
            already_sent: 409,
            no_job_queue: 503,
          };
          return sendError(res, statusByCode[err.code] ?? 500, err.message);
        }
        logger.error("failed to send simulated call to analysis", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to send to analysis");
      }
    },
  );

  // ── Create variant via Bedrock rewriter (Phase B) ──────────
  // Returns a rewritten script as a PREVIEW. The admin can then submit
  // that script to `POST /generate` to create + queue a new simulated_call.
  // Intentionally does NOT persist anything — this keeps the UI two-step
  // (preview → confirm + generate) so admins see what they're paying for
  // before spending TTS credits.
  const rewriteBodySchema = z.object({
    circumstances: z.array(circumstanceSchema).min(1).max(CIRCUMSTANCE_LIMIT_PER_REWRITE),
    targetQualityTier: z.enum(["poor", "acceptable", "excellent"]).optional(),
  });

  router.post(
    "/api/admin/simulated-calls/:id/rewrite",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      const parsed = rewriteBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid rewrite request", parsed.error);
      }
      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");

      try {
        const result = await rewriteScript({
          baseScript: row.script,
          circumstances: parsed.data.circumstances,
          targetQualityTier: parsed.data.targetQualityTier,
        });
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "rewrite_simulated_call",
          resourceType: "simulated_call",
          resourceId: row.id,
          detail: `circumstances=${parsed.data.circumstances.join(",")}; tier=${parsed.data.targetQualityTier ?? "inherit"}`,
        });
        res.json({
          sourceId: row.id,
          script: result.script,
          promptChars: result.promptChars,
          responseChars: result.responseChars,
        });
      } catch (err) {
        if (err instanceof ScriptRewriterError) {
          const statusByStage: Record<typeof err.stage, number> = {
            unavailable: 503,
            model_error: 502,
            parse_error: 502,
            validation_error: 502,
          };
          return sendError(res, statusByStage[err.stage], err.message);
        }
        logger.error("failed to rewrite simulated call", {
          id: row.id,
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to rewrite script");
      }
    },
  );

  // ── Generate turns from title + scenario (cold start) ──────
  // Returns a script populated with AI-generated turns. The admin uses
  // this from the Generate form when they have a scenario description
  // but don't want to write the dialogue manually. Response is a PREVIEW
  // — the frontend merges the turns into the script state and the admin
  // still submits via the existing /generate endpoint. No persistence
  // happens here.
  const generateFromScenarioBodySchema = z.object({
    title: z.string().min(1).max(500),
    scenario: z.string().max(2000).optional(),
    equipment: z.string().max(255).optional(),
    qualityTier: z.enum(["poor", "acceptable", "excellent"]),
    voices: z.object({
      agent: z.string().min(1),
      customer: z.string().min(1),
    }),
    targetTurnCount: z.number().int().min(4).max(30).optional(),
    useSonnet: z.boolean().optional(),
  });

  router.post(
    "/api/admin/simulated-calls/generate-from-scenario",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    async (req, res) => {
      const parsed = generateFromScenarioBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendValidationError(res, "Invalid generate-from-scenario request", parsed.error);
      }

      try {
        const result = await generateScriptFromScenario(parsed.data);
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "generate_script_from_scenario",
          resourceType: "simulated_call",
          detail: `title=${parsed.data.title.slice(0, 60)}; tier=${parsed.data.qualityTier}; turns=${parsed.data.targetTurnCount ?? 10}; sonnet=${parsed.data.useSonnet ? "true" : "false"}`,
        });
        res.json({
          script: result.script,
          promptChars: result.promptChars,
          responseChars: result.responseChars,
          // Actual model tier used — may differ from what the admin requested
          // if Haiku wasn't accessible and the generator fell back.
          modelTier: result.modelUsed ?? (parsed.data.useSonnet ? "sonnet" : "haiku"),
          fellBackFromHaiku: result.fellBackFromHaiku === true,
        });
      } catch (err) {
        if (err instanceof ScriptRewriterError) {
          const statusByStage: Record<typeof err.stage, number> = {
            unavailable: 503,
            model_error: 502,
            parse_error: 502,
            validation_error: 400,
          };
          return sendError(res, statusByStage[err.stage], err.message);
        }
        logger.error("failed to generate script from scenario", {
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to generate script");
      }
    },
  );

  // ── Retry a failed generation ──────────────────────────────
  // When a generation ends in `status: "failed"` (e.g. ElevenLabs credits
  // exhausted, ffmpeg crash, transient network issue), the operator can
  // re-run the job without rebuilding the script from scratch. The row's
  // script + config are preserved; only status transitions back to
  // "pending" and a fresh generate_simulated_call job is enqueued.
  //
  // Daily cap still applies — a retry counts the same as a fresh
  // generation against SIMULATED_CALL_DAILY_CAP. This prevents a user
  // from burning through their daily budget via repeated retries.
  router.post(
    "/api/admin/simulated-calls/:id/retry",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      if (!isFfmpegAvailable()) {
        return sendError(res, 503, "ffmpeg not available on this server");
      }
      if (!elevenLabsClient.isAvailable) {
        return sendError(res, 503, "ELEVENLABS_API_KEY is not configured");
      }

      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");
      if (row.status !== "failed") {
        return sendError(
          res,
          409,
          `Only failed generations can be retried (current status: ${row.status})`,
        );
      }

      const username = req.user!.username;

      // Daily cap guard — same as /generate. Retries count toward spend.
      const used = await countSimulatedCallsToday(username);
      if (used >= DAILY_GENERATION_CAP) {
        return sendError(
          res,
          429,
          `Daily generation cap reached (${DAILY_GENERATION_CAP}). Try again tomorrow.`,
        );
      }

      const jobQueue = getJobQueue();
      if (!jobQueue) {
        return sendError(res, 503, "Job queue is not running");
      }

      // Transition: failed → pending. Clear the prior error so the UI
      // doesn't show a stale failure reason once the new job starts.
      await updateSimulatedCall(row.id, { status: "pending", error: null });

      // Same priority as the initial /generate path so retries don't
      // preempt real-call analyses.
      await jobQueue.enqueue(
        "generate_simulated_call",
        { simulatedCallId: row.id, uploadedBy: username },
        -10,
      );

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "retry_simulated_call",
        resourceType: "simulated_call",
        resourceId: row.id,
        detail: `retry from failed; tier=${row.qualityTier}`,
      });

      broadcastSimulatedCallUpdate(row.id, "pending", {
        title: row.title,
        createdBy: username,
      });

      res.status(202).json({
        simulatedCallId: row.id,
        status: "pending",
        dailyUsed: used + 1,
        dailyCap: DAILY_GENERATION_CAP,
      });
    },
  );

  // ── Delete ─────────────────────────────────────────────────
  router.delete(
    "/api/admin/simulated-calls/:id",
    requireAuth,
    requireRole("admin"),
    requireMFASetup,
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");

      // Best-effort S3 cleanup. Database delete runs regardless.
      if (row.audioS3Key) {
        const s3 = storage.getObjectStorageClient();
        if (s3) {
          try {
            await s3.deleteObject(row.audioS3Key);
          } catch (err) {
            logger.warn("failed to delete simulated-call audio from S3", {
              id: row.id,
              error: (err as Error).message,
            });
          }
        }
      }

      await deleteSimulatedCall(req.params.id);
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "delete_simulated_call",
        resourceType: "simulated_call",
        resourceId: req.params.id,
      });
      res.status(204).end();
    },
  );

  // ── Stream the generated audio ─────────────────────────────
  router.get(
    "/api/admin/simulated-calls/:id/audio",
    requireAuth,
    requireRole("admin"),
    validateIdParam,
    async (req, res) => {
      if (!isSimulatedCallsAvailable()) {
        return sendError(res, 503, "Simulated calls require DATABASE_URL");
      }
      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");
      if (!row.audioS3Key) return sendError(res, 404, "Audio not ready");

      const s3 = storage.getObjectStorageClient();
      if (!s3) return sendError(res, 503, "Object storage not configured");

      try {
        const buf = await s3.downloadFile(row.audioS3Key);
        if (!buf) return sendError(res, 404, "Audio file missing in S3");
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", String(buf.length));
        res.setHeader("Content-Disposition", `inline; filename="${row.id}.mp3"`);
        res.send(buf);
      } catch (err) {
        logger.error("failed to stream simulated-call audio", {
          id: req.params.id,
          error: (err as Error).message,
        });
        sendError(res, 500, "Failed to stream audio");
      }
    },
  );
}
