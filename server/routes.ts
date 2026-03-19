import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { getPool } from "./db/pool";
import { JobQueue, type Job } from "./services/job-queue";
import { bedrockBatchService, type PendingBatchItem, type BatchJob } from "./services/bedrock-batch";
import { assemblyAIService } from "./services/assemblyai";
import { broadcastCallUpdate } from "./services/websocket";
import { estimateBedrockCost } from "./routes/utils";
import type { UsageRecord } from "@shared/schema";
import { randomUUID } from "crypto";
import type { S3Client as S3ClientType } from "./services/s3";

// Route modules
import { registerAuthRoutes } from "./routes/auth";
import { registerCallRoutes } from "./routes/calls";
import { registerAdminRoutes } from "./routes/admin";
import { register as registerDashboardRoutes } from "./routes/dashboard";
import { register as registerEmployeeRoutes } from "./routes/employees";
import { registerReportRoutes } from "./routes/reports";
import { register as registerAnalyticsRoutes, registerHeatmapRoutes } from "./routes/analytics";
import { register as registerCoachingRoutes } from "./routes/coaching";
import { register as registerInsightRoutes } from "./routes/insights";
import { registerUserRoutes } from "./routes/users";
import { registerSnapshotRoutes } from "./routes/snapshots";

// Pipeline
import { processAudioFile, shouldUseBatchMode, audioProcessingQueue } from "./routes/pipeline";

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
  },
  fileFilter: (req, file, cb) => {
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
      cb(new Error(`Invalid file type "${ext}" (${file.mimetype}). Accepted: MP3, WAV, M4A, MP4, FLAC, OGG, WebM.`), false);
    }
  }
});

// Durable job queue (initialized if PostgreSQL is available)
let jobQueue: JobQueue | null = null;

export async function registerRoutes(app: Express): Promise<Server> {
  const router = Router();

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
  registerSnapshotRoutes(router);
  registerAdminRoutes(router, upload.single('audioFile'), {
    getJobQueue: () => jobQueue,
    shouldUseBatchMode,
  });

  // Start scheduled report generation
  import("./services/scheduled-reports").then(m => m.startReportScheduler()).catch(() => {});

  // Mount all routes on the app
  app.use(router);

  // ==================== BATCH INFERENCE SCHEDULER ====================
  if (bedrockBatchService.isAvailable) {
    const batchIntervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10);
    console.log(`[BATCH] Batch inference mode enabled. Scheduling every ${batchIntervalMinutes} minutes.`);

    const runBatchCycle = async () => {
      try {
        const s3Client: S3ClientType | undefined = (storage as any).audioClient || (storage as any).client;
        if (!s3Client) return;

        // 1. Check active jobs for completion
        const activeJobKeys = await s3Client.listObjects("batch-inference/active-jobs/");
        for (const jobKey of activeJobKeys) {
          try {
            const job = await s3Client.downloadJson<BatchJob>(jobKey);
            if (!job) continue;

            const status = await bedrockBatchService.getJobStatus(job.jobArn);
            console.log(`[BATCH] Job ${job.jobId}: ${status.status}`);

            if (status.status === "Completed") {
              const results = await bedrockBatchService.readBatchOutput(job.outputS3Uri);
              console.log(`[BATCH] Job ${job.jobId} completed. Processing ${results.size} results.`);

              for (const [callId, analysis] of results) {
                try {
                  const pendingData = await s3Client.downloadJson<any>(`batch-inference/pending/${callId}.json`);
                  const transcriptResponse = pendingData?.transcriptResponse;

                  if (!transcriptResponse) {
                    console.warn(`[BATCH] No transcript data found for call ${callId}, skipping.`);
                    continue;
                  }

                  const { transcript: _, sentiment: __, analysis: updatedAnalysis } =
                    assemblyAIService.processTranscriptData(transcriptResponse, analysis, callId);

                  const transcriptConfidence = transcriptResponse.confidence || 0;
                  const wordCount = transcriptResponse.words?.length || 0;
                  const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
                  const wordConfidence = Math.min(wordCount / 50, 1);
                  const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
                  const confidenceScore = transcriptConfidence * 0.4 + wordConfidence * 0.2 + durationConfidence * 0.15 + 0.25;

                  updatedAnalysis.confidenceScore = confidenceScore.toFixed(3);
                  updatedAnalysis.confidenceFactors = {
                    transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
                    wordCount,
                    callDurationSeconds: callDuration,
                    transcriptLength: (transcriptResponse.text || "").length,
                    aiAnalysisCompleted: true,
                    overallScore: Math.round(confidenceScore * 100) / 100,
                  };

                  if (analysis.sub_scores) {
                    updatedAnalysis.subScores = {
                      compliance: analysis.sub_scores.compliance ?? 0,
                      customerExperience: analysis.sub_scores.customer_experience ?? 0,
                      communication: analysis.sub_scores.communication ?? 0,
                      resolution: analysis.sub_scores.resolution ?? 0,
                    };
                  }

                  if (analysis.detected_agent_name) {
                    updatedAnalysis.detectedAgentName = analysis.detected_agent_name;
                  }

                  if (Array.isArray(updatedAnalysis.flags)) {
                    updatedAnalysis.flags = (updatedAnalysis.flags as string[]).filter(f => f !== "awaiting_batch_analysis");
                  }

                  if (confidenceScore < 0.7) {
                    const flags = (updatedAnalysis.flags as string[]) || [];
                    flags.push("low_confidence");
                    updatedAnalysis.flags = flags;
                  }

                  await storage.createCallAnalysis(updatedAnalysis);
                  await storage.updateCall(callId, { status: "completed" });

                  // Auto-assign employee (atomic — only if not already assigned)
                  if (analysis.detected_agent_name) {
                    const matchedEmployee = await storage.findEmployeeByName(analysis.detected_agent_name.trim());
                    if (matchedEmployee) {
                      const assigned = await storage.atomicAssignEmployee(callId, matchedEmployee.id);
                      if (assigned) {
                        console.log(`[BATCH] Auto-assigned call ${callId} to ${matchedEmployee.name}`);
                      }
                    }
                  }

                  // Track Bedrock usage (at batch pricing — 50% off)
                  try {
                    const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
                    const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
                    const estimatedOutputTokens = 800;
                    const bedrockCost = estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) * 0.5;

                    const usageRecord: UsageRecord = {
                      id: randomUUID(),
                      callId,
                      type: "call",
                      timestamp: new Date().toISOString(),
                      user: pendingData?.uploadedBy || "batch",
                      services: {
                        bedrock: {
                          model: bedrockModel,
                          estimatedInputTokens,
                          estimatedOutputTokens,
                          estimatedCost: Math.round(bedrockCost * 10000) / 10000,
                        },
                      },
                      totalEstimatedCost: Math.round(bedrockCost * 10000) / 10000,
                    };
                    await storage.createUsageRecord(usageRecord);
                  } catch {}

                  broadcastCallUpdate(callId, "completed", { label: "Batch analysis complete" });
                  await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
                  console.log(`[BATCH] Call ${callId} analysis stored successfully.`);
                } catch (callErr) {
                  console.warn(`[BATCH] Failed to process result for ${callId}:`, (callErr as Error).message);
                }
              }

              await s3Client.deleteObject(jobKey);
            } else if (status.status === "Failed" || status.status === "Stopped" || status.status === "Expired") {
              console.error(`[BATCH] Job ${job.jobId} failed: ${status.message || status.status}`);
              for (const callId of job.callIds) {
                await storage.updateCall(callId, { status: "failed" });
                broadcastCallUpdate(callId, "failed", { label: "Batch analysis failed" });
                await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
              }
              await s3Client.deleteObject(jobKey);
            }
          } catch (jobErr) {
            console.warn(`[BATCH] Error checking job status:`, (jobErr as Error).message);
          }
        }

        // 2. Collect pending items and submit new batch if any
        const pendingKeys = await s3Client.listObjects("batch-inference/pending/");
        if (pendingKeys.length === 0) return;

        const MIN_BATCH_SIZE = 5;
        if (pendingKeys.length < MIN_BATCH_SIZE) {
          const oldestItem = await s3Client.downloadJson<PendingBatchItem>(pendingKeys[0]);
          if (oldestItem) {
            const age = Date.now() - new Date(oldestItem.timestamp).getTime();
            if (age < batchIntervalMinutes * 60 * 1000 * 2) {
              console.log(`[BATCH] ${pendingKeys.length} pending items (below threshold of ${MIN_BATCH_SIZE}). Waiting for more.`);
              return;
            }
          }
        }

        console.log(`[BATCH] Collecting ${pendingKeys.length} pending items for batch submission.`);

        const items: PendingBatchItem[] = [];
        for (const key of pendingKeys) {
          const data = await s3Client.downloadJson<PendingBatchItem & { transcriptResponse: any }>(key);
          if (data) items.push({ callId: data.callId, prompt: data.prompt, callCategory: data.callCategory, uploadedBy: data.uploadedBy, timestamp: data.timestamp });
        }

        if (items.length === 0) return;

        const { s3Uri, batchId } = await bedrockBatchService.createBatchInput(items);
        const callIds = items.map(i => i.callId);
        const batchJob = await bedrockBatchService.createJob(s3Uri, batchId, callIds);

        await s3Client.uploadJson(`batch-inference/active-jobs/${batchJob.jobId}.json`, batchJob);
        console.log(`[BATCH] Submitted batch job ${batchJob.jobId} with ${items.length} calls.`);

      } catch (batchErr) {
        console.error(`[BATCH] Batch cycle error:`, (batchErr as Error).message);
      }
    };

    setTimeout(runBatchCycle, 60_000);
    setInterval(runBatchCycle, batchIntervalMinutes * 60 * 1000);

    // Orphan recovery: detect calls stuck in "awaiting_analysis" with no matching pending batch item.
    // Runs every 30 minutes. If a call has been awaiting_analysis for >2 hours with no pending
    // batch-inference item, mark it as failed so it's visible to admins.
    const ORPHAN_CHECK_INTERVAL_MS = 30 * 60 * 1000;
    const ORPHAN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    const recoverOrphans = async () => {
      try {
        const s3Client: S3ClientType | undefined = (storage as any).audioClient || (storage as any).client;
        if (!s3Client) return;

        const allCalls = await storage.getAllCalls();
        const awaitingCalls = allCalls.filter(c => c.status === "awaiting_analysis");
        if (awaitingCalls.length === 0) return;

        const pendingKeys = new Set(
          (await s3Client.listObjects("batch-inference/pending/"))
            .map(k => k.replace("batch-inference/pending/", "").replace(".json", ""))
        );

        let recovered = 0;
        for (const call of awaitingCalls) {
          const age = Date.now() - new Date(call.uploadedAt || Date.now()).getTime();
          if (age > ORPHAN_THRESHOLD_MS && !pendingKeys.has(call.id)) {
            await storage.updateCall(call.id, { status: "failed" });
            broadcastCallUpdate(call.id, "failed", { label: "Orphaned: batch analysis never completed" });
            recovered++;
          }
        }
        if (recovered > 0) {
          console.warn(`[BATCH] Recovered ${recovered} orphaned call(s) stuck in awaiting_analysis.`);
        }
      } catch (err) {
        console.warn("[BATCH] Orphan recovery error:", (err as Error).message);
      }
    };
    setTimeout(recoverOrphans, 5 * 60 * 1000); // First run after 5 minutes
    setInterval(recoverOrphans, ORPHAN_CHECK_INTERVAL_MS);
  }

  // ==================== JOB QUEUE INITIALIZATION ====================
  const dbPool = getPool();
  if (dbPool) {
    const concurrency = parseInt(process.env.JOB_CONCURRENCY || "5", 10);
    const pollInterval = parseInt(process.env.JOB_POLL_INTERVAL_MS || "5000", 10);
    jobQueue = new JobQueue(dbPool, concurrency, pollInterval);

    // Alert when a job exhausts all retries (dead letter)
    jobQueue.onDeadLetter = (jobId, reason, attempts) => {
      console.error(`[DEAD_LETTER_ALERT] Job ${jobId} failed permanently after ${attempts} attempts: ${reason}`);
      // Broadcast via WebSocket so admin UI can display alert
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
          if (fs.existsSync(filePath)) {
            audioBuffer = await fs.promises.readFile(filePath);
          } else {
            throw new Error(`No audio data available for call ${callId}`);
          }
        }

        await processAudioFile(callId, filePath, audioBuffer, originalName, mimeType, callCategory, uploadedBy, processingMode, language);
      } else {
        console.warn(`[JOB_QUEUE] Unknown job type: ${job.type}`);
      }
    });
  }

  const httpServer = createServer(app);
  return httpServer;
}
