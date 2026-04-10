/**
 * Batch Inference Scheduler
 *
 * Manages the lifecycle of AWS Bedrock batch inference jobs:
 * 1. Periodically checks active batch jobs for completion
 * 2. Collects pending items and submits new batch jobs
 * 3. Recovers orphaned calls stuck in "awaiting_analysis"
 *
 * Extracted from routes.ts for testability and separation of concerns.
 */
import { storage } from "../storage";
import { bedrockBatchService, type PendingBatchItem, type BatchJob } from "./bedrock-batch";
import { assemblyAIService } from "./assemblyai";
import { broadcastCallUpdate } from "./websocket";
import { estimateBedrockCost, computeConfidenceScore, autoAssignEmployee } from "../routes/utils";
import type { UsageRecord } from "@shared/schema";
import { randomUUID } from "crypto";
import { logger } from "./logger";

const ORPHAN_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const ORPHAN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const MIN_BATCH_SIZE = 5;

// Track interval IDs for graceful shutdown
let batchCycleInterval: ReturnType<typeof setInterval> | null = null;
let batchCycleTimeout: ReturnType<typeof setTimeout> | null = null;
let orphanCheckInterval: ReturnType<typeof setInterval> | null = null;
let orphanCheckTimeout: ReturnType<typeof setTimeout> | null = null;

// Guard against concurrent batch cycles (setInterval fires regardless of
// whether the previous async cycle has completed)
let batchCycleRunning = false;

/**
 * Process a completed batch job: parse results, store analyses, update calls.
 */
async function processBatchResults(
  job: BatchJob,
  jobKey: string,
  s3Client: NonNullable<ReturnType<typeof storage.getObjectStorageClient>>,
): Promise<void> {
  const status = await bedrockBatchService.getJobStatus(job.jobArn);
  logger.info("Batch job status", { jobId: job.jobId, status: status.status });

  if (status.status === "Completed") {
    const results = await bedrockBatchService.readBatchOutput(job.outputS3Uri);
    logger.info("Batch job completed, processing results", { jobId: job.jobId, resultCount: results.size });

    for (const [callId, analysis] of results) {
      try {
        const pendingData = await s3Client.downloadJson<any>(`batch-inference/pending/${callId}.json`);
        const transcriptResponse = pendingData?.transcriptResponse;

        if (!transcriptResponse) {
          logger.warn("Batch: no transcript data found for call, skipping", { callId });
          continue;
        }

        // A4/F06: derive agent speaker label from detected name + early words
        let agentSpeakerLabel: string | undefined;
        const words = transcriptResponse.words as Array<{ text: string; speaker?: string }> | undefined;
        if (analysis.detected_agent_name && words && words.length > 0) {
          const detectedName = analysis.detected_agent_name.toLowerCase();
          const earlyWords = words.slice(0, 50);
          for (let i = 0; i < earlyWords.length; i++) {
            const w = earlyWords[i];
            if (w.text.toLowerCase().includes(detectedName) ||
                (i > 0 && `${earlyWords[i - 1].text} ${w.text}`.toLowerCase().includes(detectedName))) {
              agentSpeakerLabel = w.speaker || undefined;
              break;
            }
          }
        }

        const { analysis: updatedAnalysis } =
          assemblyAIService.processTranscriptData(transcriptResponse, analysis, callId, agentSpeakerLabel);

        const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
        const { score: confidenceScore, factors: confidenceFactors } = computeConfidenceScore(
          {
            transcriptConfidence: transcriptResponse.confidence || 0,
            wordCount: transcriptResponse.words?.length || 0,
            callDurationSeconds: callDuration,
            hasAiAnalysis: true,
          },
        );

        updatedAnalysis.confidenceScore = confidenceScore.toFixed(3);
        updatedAnalysis.confidenceFactors = confidenceFactors;

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

        if (analysis.detected_agent_name) {
          await autoAssignEmployee(callId, analysis.detected_agent_name, storage, `[BATCH] `);
        }

        // Track Bedrock usage (at batch pricing — 50% off)
        try {
          const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
          const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
          const estimatedOutputTokens = 800;
          const bedrockCost = (estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) ?? 0) * 0.5;

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
        } catch (usageErr) {
          logger.warn("Batch: failed to record usage", { callId, error: (usageErr as Error).message });
        }

        broadcastCallUpdate(callId, "completed", { label: "Batch analysis complete" });
        logger.info("Batch: call analysis stored successfully", { callId });
      } catch (callErr) {
        logger.warn("Batch: failed to process result, marking call failed", { callId, error: (callErr as Error).message });
        try {
          await storage.updateCall(callId, { status: "failed" });
          broadcastCallUpdate(callId, "failed", { label: "Batch result processing failed" });
        } catch { /* best-effort status update */ }
      } finally {
        // Always clean up the pending item so it doesn't get stuck in S3 forever.
        // If storage writes failed above, the call is marked failed; leaving the
        // pending item would prevent orphan recovery from detecting it.
        try {
          await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
        } catch (delErr) {
          logger.warn("Batch: failed to delete pending item", { callId, error: (delErr as Error).message });
        }
      }
    }

    await s3Client.deleteObject(jobKey);
  } else if (status.status === "Failed" || status.status === "Stopped" || status.status === "Expired") {
    logger.error("Batch job failed", { jobId: job.jobId, reason: status.message || status.status });
    for (const callId of job.callIds) {
      try {
        await storage.updateCall(callId, { status: "failed" });
        broadcastCallUpdate(callId, "failed", { label: "Batch analysis failed" });
        await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
      } catch (failErr) {
        logger.warn("Batch: error marking call as failed", { callId, error: (failErr as Error).message });
      }
    }
    await s3Client.deleteObject(jobKey);
  }
}

/**
 * Single batch cycle: check active jobs, collect pending items, submit new batch.
 */
export async function runBatchCycle(): Promise<void> {
  if (batchCycleRunning) {
    logger.info("Batch: previous cycle still running, skipping");
    return;
  }
  batchCycleRunning = true;
  try {
    const s3Client = storage.getObjectStorageClient();
    if (!s3Client) return;

    const batchIntervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10);

    // 1. Check active jobs for completion
    const activeJobKeys = await s3Client.listObjects("batch-inference/active-jobs/");
    for (const jobKey of activeJobKeys) {
      try {
        const job = await s3Client.downloadJson<BatchJob>(jobKey);
        if (!job) continue;
        await processBatchResults(job, jobKey, s3Client);
      } catch (jobErr) {
        logger.warn("Batch: error checking job status", { error: (jobErr as Error).message });
      }
    }

    // 2. Collect pending items and submit new batch if any
    const pendingKeys = await s3Client.listObjects("batch-inference/pending/");
    if (pendingKeys.length === 0) return;

    if (pendingKeys.length < MIN_BATCH_SIZE) {
      const oldestItem = await s3Client.downloadJson<PendingBatchItem>(pendingKeys[0]);
      if (oldestItem) {
        const age = Date.now() - new Date(oldestItem.timestamp).getTime();
        if (age < batchIntervalMinutes * 60 * 1000 * 2) {
          logger.info("Batch: below threshold, waiting", { pendingCount: pendingKeys.length, threshold: MIN_BATCH_SIZE });
          return;
        }
      }
    }

    logger.info("Batch: collecting pending items for submission", { pendingCount: pendingKeys.length });

    const items: PendingBatchItem[] = [];
    for (const key of pendingKeys) {
      const data = await s3Client.downloadJson<PendingBatchItem & { transcriptResponse: any }>(key);
      if (data?.callId && data?.prompt) {
        items.push({ callId: data.callId, prompt: data.prompt, callCategory: data.callCategory, uploadedBy: data.uploadedBy, timestamp: data.timestamp });
      } else {
        logger.warn("Batch: skipping invalid pending item", { key });
      }
    }

    if (items.length === 0) return;

    const { s3Uri, batchId } = await bedrockBatchService.createBatchInput(items);
    const callIds = items.map(i => i.callId);
    const batchJob = await bedrockBatchService.createJob(s3Uri, batchId, callIds);

    await s3Client.uploadJson(`batch-inference/active-jobs/${batchJob.jobId}.json`, batchJob);
    logger.info("Batch: submitted job", { jobId: batchJob.jobId, itemCount: items.length });

  } catch (batchErr) {
    logger.error("Batch cycle error", { error: (batchErr as Error).message });
  } finally {
    batchCycleRunning = false;
  }
}

/**
 * Recover orphaned calls stuck in "awaiting_analysis" with no matching pending batch item.
 */
export async function recoverOrphans(): Promise<void> {
  try {
    const s3Client = storage.getObjectStorageClient();
    if (!s3Client) return;

    // A7/F14: indexed status lookup replaces full-table scan
    const awaitingCalls = await storage.getCallsByStatus("awaiting_analysis");
    if (awaitingCalls.length === 0) return;

    const pendingKeys = new Set(
      (await s3Client.listObjects("batch-inference/pending/"))
        .map(k => k.replace("batch-inference/pending/", "").replace(".json", ""))
    );

    let recovered = 0;
    for (const call of awaitingCalls) {
      // F05: If uploadedAt is missing, treat as infinitely old so the call is
      // recovered rather than silently stuck forever. The prior fallback to
      // Date.now() produced age ≈ 0, preventing recovery.
      const uploadedTime = call.uploadedAt ? new Date(call.uploadedAt).getTime() : 0;
      const age = Date.now() - uploadedTime;
      if (age > ORPHAN_THRESHOLD_MS && !pendingKeys.has(call.id)) {
        await storage.updateCall(call.id, { status: "failed" });
        broadcastCallUpdate(call.id, "failed", { label: "Orphaned: batch analysis never completed" });
        recovered++;
      }
    }
    if (recovered > 0) {
      logger.warn("Batch: recovered orphaned calls stuck in awaiting_analysis", { count: recovered });
    }
  } catch (err) {
    logger.warn("Batch: orphan recovery error", { error: (err as Error).message });
  }
}

/**
 * Start the batch inference scheduler with configurable intervals.
 * Returns a shutdown function that clears all timers.
 */
export function startBatchScheduler(): () => void {
  if (!bedrockBatchService.isAvailable) return () => {};

  const batchIntervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10);
  logger.info("Batch inference mode enabled", { intervalMinutes: batchIntervalMinutes });

  // First run after 1 minute, then on interval
  batchCycleTimeout = setTimeout(runBatchCycle, 60_000);
  batchCycleInterval = setInterval(runBatchCycle, batchIntervalMinutes * 60 * 1000);

  // Orphan recovery: first run after 5 minutes, then every 30 minutes
  orphanCheckTimeout = setTimeout(recoverOrphans, 5 * 60 * 1000);
  orphanCheckInterval = setInterval(recoverOrphans, ORPHAN_CHECK_INTERVAL_MS);

  return stopBatchScheduler;
}

/**
 * Stop all batch scheduler timers. Safe to call multiple times.
 */
export function stopBatchScheduler(): void {
  if (batchCycleTimeout) { clearTimeout(batchCycleTimeout); batchCycleTimeout = null; }
  if (batchCycleInterval) { clearInterval(batchCycleInterval); batchCycleInterval = null; }
  if (orphanCheckTimeout) { clearTimeout(orphanCheckTimeout); orphanCheckTimeout = null; }
  if (orphanCheckInterval) { clearInterval(orphanCheckInterval); orphanCheckInterval = null; }
  logger.info("Batch scheduler stopped");
}
