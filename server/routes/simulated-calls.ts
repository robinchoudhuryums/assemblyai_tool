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
import { rewriteScript, ScriptRewriterError } from "../services/script-rewriter";
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
