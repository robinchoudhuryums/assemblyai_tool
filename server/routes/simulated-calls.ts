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
  updateSimulatedCall,
  countSimulatedCallsToday,
  isSimulatedCallsAvailable,
  warnSimulatedCallsUnavailableOnce,
} from "../services/simulated-call-storage";
import { generateSimulatedCallRequestSchema } from "@shared/simulated-call-schema";
import { elevenLabsClient, type ElevenLabsVoice } from "../services/elevenlabs-client";
import { isFfmpegAvailable } from "../services/audio-stitcher";
import { broadcastSimulatedCallUpdate } from "../services/websocket";

const DAILY_GENERATION_CAP = Math.max(
  1,
  Math.min(parseInt(process.env.SIMULATED_CALL_DAILY_CAP || "20", 10), 500),
);

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
          { simulatedCallId: row.id },
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
      const row = await getSimulatedCall(req.params.id);
      if (!row) return sendError(res, 404, "Simulated call not found");
      if (row.status !== "ready" || !row.audioS3Key) {
        return sendError(res, 400, "Simulated call is not ready yet");
      }
      if (row.sentToAnalysisCallId) {
        res.status(409).json({
          message: "Already sent to analysis",
          callId: row.sentToAnalysisCallId,
        });
        return;
      }

      try {
        // Create the `calls` row with synthetic=TRUE and external_id linking
        // back to the simulated_calls id so we can dedupe second clicks.
        const externalId = `sim:${row.id}`;
        const call = await storage.createCall({
          fileName: `${row.title}.mp3`,
          filePath: row.audioS3Key,
          status: "processing",
          synthetic: true,
          externalId,
        });

        // Link back
        await updateSimulatedCall(row.id, { sentToAnalysisCallId: call.id });

        // Enqueue the existing process_audio job — the pipeline will load
        // the audio from S3 via storage.getAudioFiles / downloadAudio.
        const jobQueue = getJobQueue();
        if (jobQueue) {
          await jobQueue.enqueue("process_audio", {
            callId: call.id,
            filePath: "",
            originalName: `${row.title}.mp3`,
            mimeType: "audio/mpeg",
            callCategory: null,
            uploadedBy: req.user!.username,
            processingMode: "immediate",
            language: "en",
          });
        }

        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "simulated_call_sent_to_analysis",
          resourceType: "simulated_call",
          resourceId: row.id,
          detail: `callId=${call.id}`,
        });

        res.status(202).json({
          simulatedCallId: row.id,
          callId: call.id,
          status: "processing",
        });
      } catch (err) {
        const message = (err as Error).message;
        if ((err as { code?: string }).code === "23505") {
          // external_id already exists — another click won the race.
          return sendError(res, 409, "Already sent to analysis");
        }
        logger.error("failed to send simulated call to analysis", { error: message });
        sendError(res, 500, "Failed to send to analysis");
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
