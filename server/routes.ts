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

// Pipeline
import { processAudioFile, shouldUseBatchMode } from "./routes/pipeline";
import { handleAssemblyAIWebhook, isWebhookModeEnabled } from "./services/assemblyai";

// Batch scheduler (extracted for testability)
import { startBatchScheduler } from "./services/batch-scheduler";

// Auto-calibration and telephony
import { startCalibrationScheduler } from "./services/auto-calibration";
import { startTelephonyScheduler } from "./services/telephony-8x8";

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
        console.error("[WEBHOOK] ASSEMBLYAI_WEBHOOK_SECRET not set — rejecting webhook (set ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED=true for dev override)");
        return res.status(500).json({ message: "Webhook secret not configured" });
      }
      console.warn("[WEBHOOK] ASSEMBLYAI_WEBHOOK_SECRET not set — accepting unverified webhook (dev override)");
    } else {
      const provided = String(req.headers["x-webhook-secret"] || "");
      // Hash both sides to constant-length buffers so length mismatch doesn't
      // leak via early return; constant-time compare on the hashes.
      const secretHash = createHash("sha256").update(secret, "utf8").digest();
      const providedHash = createHash("sha256").update(provided, "utf8").digest();
      if (!timingSafeEqual(secretHash, providedHash)) {
        console.warn("[WEBHOOK] AssemblyAI webhook received with invalid secret");
        return res.status(401).json({ message: "Invalid webhook secret" });
      }
    }

    const { transcript_id, status, text, confidence, words, sentiment_analysis_results, error } = req.body;
    if (!transcript_id) {
      return res.status(400).json({ message: "Missing transcript_id" });
    }

    console.log(`[WEBHOOK] AssemblyAI callback: transcript ${transcript_id}, status: ${status}`);
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
      console.log(`[WEBHOOK] Transcript ${transcript_id} not in pending map (may be stale). Acknowledged.`);
    }

    res.status(200).json({ received: true });
  });

  if (isWebhookModeEnabled()) {
    console.log(`[ASSEMBLYAI] Webhook mode enabled. Callbacks will be sent to ${process.env.APP_BASE_URL}/api/webhooks/assemblyai`);
  } else {
    console.log("[ASSEMBLYAI] Polling mode (set APP_BASE_URL to enable faster webhook mode).");
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
      console.error(`[DEAD_LETTER_ALERT] Job ${jobId} failed permanently after ${attempts} attempts: ${reason}`);
      broadcastCallUpdate(jobId, "failed", { deadLetter: true, reason, attempts });
    };

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
          console.warn(`[JOB_QUEUE] Failed to stash batch_snapshots results for ${job.id}:`, (err as Error).message);
        }
      } else {
        console.warn(`[JOB_QUEUE] Unknown job type: ${job.type}`);
      }
    });
  }

  // Register all route modules
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

  // Start scheduled report generation
  import("./services/scheduled-reports").then(m => m.startReportScheduler()).catch(err => {
    console.warn("[REPORTS] Failed to start report scheduler:", (err as Error).message);
  });

  // Mount all routes on the app
  app.use(router);

  // Start batch inference scheduler (extracted to services/batch-scheduler.ts)
  startBatchScheduler();

  // Load persisted calibration overrides from S3, then start auto-calibration scheduler
  import("./services/scoring-calibration").then(({ loadPersistedCalibration }) =>
    loadPersistedCalibration(storage.getObjectStorageClient())
  ).catch((err) => {
    console.warn("[CALIBRATION] Failed to load persisted calibration:", (err as Error).message);
  });
  startCalibrationScheduler();

  // Start 8x8 telephony auto-ingestion (if configured)
  startTelephonyScheduler(processAudioFile);

  const httpServer = createServer(app);
  return httpServer;
}
