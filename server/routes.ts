import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { getPool } from "./db/pool";
import { JobQueue, type Job } from "./services/job-queue";
import { broadcastCallUpdate } from "./services/websocket";
import { timingSafeEqual, createHash } from "crypto";
import { logger } from "./services/logger";

// Route modules
import { registerAuthRoutes } from "./routes/auth";
import { registerCallRoutes } from "./routes/calls";
import { registerAdminRoutes } from "./routes/admin";
import { requireMFASetup } from "./auth";
import { register as registerDashboardRoutes } from "./routes/dashboard";
import { register as registerEmployeeRoutes } from "./routes/employees";
import { registerReportRoutes } from "./routes/reports";
import { register as registerAnalyticsRoutes, registerHeatmapRoutes } from "./routes/analytics";
import { register as registerCoachingRoutes } from "./routes/coaching";
import { register as registerInsightRoutes } from "./routes/insights";
import { registerUserRoutes } from "./routes/users";
import { registerSnapshotRoutes } from "./routes/snapshots";
import { registerGamificationRoutes } from "./routes/gamification";
import { registerConfigRoutes } from "./routes/config";
import { registerSimulatedCallRoutes } from "./routes/simulated-calls";

// Pipeline
import { processAudioFile, shouldUseBatchMode } from "./routes/pipeline";
import { handleAssemblyAIWebhook, isWebhookModeEnabled } from "./services/assemblyai";
import { setWebhookRetryEnqueuer, redeliverWebhook } from "./services/webhooks";

// Batch scheduler (extracted for testability)
import { startBatchScheduler } from "./services/batch-scheduler";
import { startTranscribingReaper } from "./services/transcribing-reaper";

// Auto-calibration and telephony
import { startCalibrationScheduler } from "./services/auto-calibration";
import { startTelephonyScheduler } from "./services/telephony-8x8";
import { startAgentDeclineScheduler } from "./services/agent-decline-alert";

// Ensure uploads directory exists. A42/F63: absolute path — cwd-relative
// "uploads" broke when pm2 or dev scripts ran from a different directory.
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
  },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg', '.webm'];
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/flac', 'audio/x-flac',
      'audio/ogg', 'audio/vorbis', 'video/mp4', 'audio/webm', 'video/webm',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    if (allowedTypes.includes(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type "${ext}" (${file.mimetype}). Accepted: MP3, WAV, M4A, MP4, FLAC, OGG, WebM.`));
    }
  }
});

// Durable job queue (initialized if PostgreSQL is available)
let jobQueue: JobQueue | null = null;

/**
 * Accessor for the JobQueue singleton so the graceful-shutdown handler in
 * server/index.ts can drain in-flight jobs before the DB pool closes.
 * Returns null when PostgreSQL is not configured (in-memory TaskQueue fallback
 * path — nothing to stop).
 */
export function getJobQueue(): JobQueue | null {
  return jobQueue;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const router = Router();

  // AssemblyAI webhook endpoint (no auth — verified by shared secret)
  // This receives transcript completion callbacks when APP_BASE_URL is configured
  router.post("/api/webhooks/assemblyai", (req, res) => {
    // Verify webhook secret (timing-safe to prevent side-channel leaks)
    const secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    if (!secret) {
      // Default-deny: reject in all environments unless explicit dev opt-in.
      // Set ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED=true in local dev only.
      if (process.env.ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED !== "true") {
        logger.error("ASSEMBLYAI_WEBHOOK_SECRET not set — rejecting webhook (set ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED=true for dev override)");
        return res.status(500).json({ message: "Webhook secret not configured" });
      }
      logger.warn("ASSEMBLYAI_WEBHOOK_SECRET not set — accepting unverified webhook (dev override)");
    } else {
      const provided = String(req.headers["x-webhook-secret"] || "");
      // Hash both sides to constant-length buffers so length mismatch doesn't
      // leak via early return; constant-time compare on the hashes.
      const secretHash = createHash("sha256").update(secret, "utf8").digest();
      const providedHash = createHash("sha256").update(provided, "utf8").digest();
      if (!timingSafeEqual(secretHash, providedHash)) {
        logger.warn("AssemblyAI webhook received with invalid secret");
        return res.status(401).json({ message: "Invalid webhook secret" });
      }
    }

    const { transcript_id, status, text, confidence, words, sentiment_analysis_results, error } = req.body;
    if (!transcript_id) {
      return res.status(400).json({ message: "Missing transcript_id" });
    }

    logger.info("AssemblyAI webhook callback", { transcript_id, status });
    const handled = handleAssemblyAIWebhook(transcript_id, {
      id: transcript_id,
      status,
      text,
      confidence,
      words,
      sentiment_analysis_results,
      error,
    });

    if (!handled) {
      // Not in our pending map — may be a late delivery or from a previous server instance.
      // Fetch the full transcript via API so we don't lose it.
      logger.info("Transcript not in pending map (may be stale), acknowledged", { transcript_id });
    }

    res.status(200).json({ received: true });
  });

  if (isWebhookModeEnabled()) {
    logger.info("AssemblyAI webhook mode enabled", { callbackUrl: `${process.env.APP_BASE_URL}/api/webhooks/assemblyai` });
  } else {
    logger.info("AssemblyAI polling mode (set APP_BASE_URL to enable faster webhook mode)");
  }

  // ==================== JOB QUEUE INITIALIZATION ====================
  // A19/F21: init BEFORE route registration so the upload route never sees
  // a null jobQueue during the startup race window.
  const dbPool = getPool();
  if (dbPool) {
    const concurrency = parseInt(process.env.JOB_CONCURRENCY || "5", 10);
    const pollInterval = parseInt(process.env.JOB_POLL_INTERVAL_MS || "5000", 10);
    jobQueue = new JobQueue(dbPool, concurrency, pollInterval);

    jobQueue.onDeadLetter = (jobId, reason, attempts) => {
      logger.error("Job failed permanently (dead letter)", { jobId, attempts, reason });
      broadcastCallUpdate(jobId, "failed", { deadLetter: true, reason, attempts });
    };

    // Wire the persistent-retry handoff for webhooks. When a webhook delivery
    // exhausts its in-process retries, the webhook service enqueues a
    // `deliver_webhook` job here so the attempt survives process restart.
    //
    // Delay the first job-level retry by 60s to give the receiver room to
    // recover from whatever caused the in-process retries (4 attempts over
    // ~30s) to exhaust. If the job itself fails, JobQueue.failJob applies
    // its own exponential backoff (10s, 30s, 60s) before dead-letter, so
    // total delivery budget is ~5 minutes across all retry layers before
    // the payload is declared undeliverable. Hammering a down receiver
    // every 5s (poll interval) is specifically what this guards against.
    setWebhookRetryEnqueuer(async (payload) => {
      if (!jobQueue) return;
      await jobQueue.enqueue("deliver_webhook", payload, { delayMs: 60_000 });
    });

    jobQueue.start(async (job: Job) => {
      if (job.type === "process_audio") {
        const { callId, filePath, originalName, mimeType, callCategory, uploadedBy, processingMode, language } = job.payload as {
          callId: string; filePath: string; originalName: string;
          mimeType: string; callCategory?: string; uploadedBy?: string; processingMode?: string; language?: string;
        };

        const audioFiles = await storage.getAudioFiles(callId);
        let audioBuffer: Buffer | undefined;
        if (audioFiles.length > 0) {
          audioBuffer = await storage.downloadAudio(audioFiles[0]);
        }

        if (!audioBuffer) {
          if (filePath && fs.existsSync(filePath)) {
            audioBuffer = await fs.promises.readFile(filePath);
          } else {
            throw new Error(`No audio data available for call ${callId}`);
          }
        }

        await processAudioFile(callId, audioBuffer, {
          originalName,
          mimeType,
          callCategory,
          uploadedBy,
          processingMode,
          language,
          filePath,
        });
      } else if (job.type === "generate_simulated_call") {
        // Simulated Call Generator — renders TTS + stitches the MP3 + uploads
        // to S3. Failures set status='failed' + error on the simulated_calls
        // row; the job queue still counts this as a success if we caught the
        // error, or a retryable failure if we let it throw.
        const { simulatedCallId } = job.payload as { simulatedCallId: string; uploadedBy?: string };
        const uploadedBy = (job.payload as { uploadedBy?: string }).uploadedBy ?? "system";
        const { runSimulator } = await import("./services/call-simulator");
        const {
          updateSimulatedCall,
          getSimulatedCall,
          sendSimulatedCallToAnalysis,
          SendToAnalysisError,
        } = await import("./services/simulated-call-storage");
        const { broadcastSimulatedCallUpdate } = await import("./services/websocket");
        try {
          broadcastSimulatedCallUpdate(simulatedCallId, "generating");
          await runSimulator(simulatedCallId);
          broadcastSimulatedCallUpdate(simulatedCallId, "ready");

          // Post-generation hook: auto-send to the real analysis pipeline if
          // the config requested it. Non-blocking relative to the generation
          // job's success — even if the analyze-enqueue fails, the generated
          // call still stays in 'ready' status and can be analyzed manually.
          const finalRow = await getSimulatedCall(simulatedCallId);
          if (finalRow?.config?.analyzeAfterGeneration === true) {
            try {
              const result = await sendSimulatedCallToAnalysis({
                simulatedCallId,
                uploadedBy,
                jobQueue,
                storage,
              });
              logger.info("auto-analyze enqueued after generation", {
                simulatedCallId,
                callId: result.callId,
              });
            } catch (analyzeErr) {
              if (analyzeErr instanceof SendToAnalysisError) {
                logger.warn("auto-analyze skipped", {
                  simulatedCallId,
                  code: analyzeErr.code,
                  message: analyzeErr.message,
                });
              } else {
                logger.error("auto-analyze failed", {
                  simulatedCallId,
                  error: (analyzeErr as Error).message,
                });
              }
            }
          }
        } catch (err) {
          const message = (err as Error).message;
          logger.error("simulator job failed", { simulatedCallId, error: message });
          await updateSimulatedCall(simulatedCallId, {
            status: "failed",
            error: message.slice(0, 1000),
          });
          broadcastSimulatedCallUpdate(simulatedCallId, "failed", { error: message });
          throw err; // let the JobQueue apply retry/dead-letter semantics
        }
      } else if (job.type === "deliver_webhook") {
        // Persistent webhook retry. The webhook service's in-process retries
        // already exhausted (4 attempts with exponential backoff). The job
        // queue adds 3 more attempts with its own retry/dead-letter logic so
        // transient receiver outages across a deploy are survivable.
        const { webhookId, event, body, previousAttempts } = job.payload as {
          webhookId: string; event: string; body: string; previousAttempts?: number;
        };
        await redeliverWebhook({ webhookId, event, body, previousAttempts });
      } else if (job.type === "batch_snapshots") {
        // A8/F18: batch snapshot generation runs as a background job so the
        // request that triggers it doesn't sit waiting for minutes. Results
        // are persisted via saveSnapshot inside generateBatchSnapshots; the
        // caller polls /api/admin/jobs/:id for status.
        const { from, to, generatedBy } = job.payload as {
          from: string; to: string; generatedBy: string;
        };
        const { generateBatchSnapshots } = await import("./routes/snapshots");
        const results = await generateBatchSnapshots(from, to, generatedBy);
        // Best-effort: stash results back onto the job payload so the
        // status endpoint can return them. Errors are logged + tolerated.
        try {
          await dbPool.query(
            `UPDATE jobs SET payload = jsonb_set(payload, '{results}', $2::jsonb) WHERE id = $1`,
            [job.id, JSON.stringify(results)],
          );
        } catch (err) {
          logger.warn("Failed to stash batch_snapshots results", { jobId: job.id, error: (err as Error).message });
        }
      } else {
        logger.warn("Unknown job type", { jobType: job.type });
      }
    });
  }

  // Register all route modules
  registerConfigRoutes(router);
  registerAuthRoutes(router);
  registerDashboardRoutes(router);
  registerEmployeeRoutes(router);
  registerCallRoutes(router, upload.single('audioFile'), processAudioFile, () => jobQueue);
  registerReportRoutes(router);
  registerAnalyticsRoutes(router);
  registerHeatmapRoutes(router);
  registerCoachingRoutes(router);
  registerInsightRoutes(router);
  registerUserRoutes(router);
  registerSnapshotRoutes(router, { getJobQueue: () => jobQueue });
  registerGamificationRoutes(router);
  // HIPAA: enforce MFA enrollment on /api/admin/* before any admin handler runs.
  // Mounted directly before registerAdminRoutes so it intercepts all admin paths
  // that get registered below. The MFA setup endpoints live under /api/auth/mfa/*
  // and are unaffected, so admins without MFA can still enroll.
  router.use("/api/admin", requireMFASetup);
  registerAdminRoutes(router, upload.single('audioFile'), {
    getJobQueue: () => jobQueue,
    shouldUseBatchMode,
  });
  // Simulated Call Generator (admin-only, inherits the /api/admin MFA gate).
  registerSimulatedCallRoutes(router, () => jobQueue);

  // Start scheduled report generation
  import("./services/scheduled-reports").then(m => m.startReportScheduler()).catch(err => {
    logger.warn("Failed to start report scheduler", { error: (err as Error).message });
  });

  // Mount all routes on the app
  app.use(router);

  // Start batch inference scheduler (extracted to services/batch-scheduler.ts)
  startBatchScheduler();

  // Start transcribing-state orphan reaper. Runs regardless of batch mode
  // — handles the "server restart mid-transcribe" failure mode where the
  // pending AssemblyAI promise is lost and the call stays "transcribing"
  // indefinitely. Symmetric with batch-scheduler.recoverOrphans.
  startTranscribingReaper();

  // Load persisted calibration overrides from S3, then start auto-calibration scheduler
  import("./services/scoring-calibration").then(({ loadPersistedCalibration }) =>
    loadPersistedCalibration(storage.getObjectStorageClient())
  ).catch((err) => {
    logger.warn("Failed to load persisted calibration", { error: (err as Error).message });
  });
  startCalibrationScheduler();

  // Start 8x8 telephony auto-ingestion (if configured)
  startTelephonyScheduler(processAudioFile);

  // Start agent-decline alert scheduler (if AGENT_DECLINE_CHECK_ENABLED=true)
  startAgentDeclineScheduler();

  const httpServer = createServer(app);
  return httpServer;
}
