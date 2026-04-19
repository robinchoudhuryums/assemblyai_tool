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
import { estimateBedrockCost, warnOnUnknownBedrockModel, computeConfidenceScore, autoAssignEmployee } from "../routes/utils";
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
        // Overwrite guard: if the call already advanced to "completed" (e.g.
        // a manager edited the analysis, or an on-demand re-run produced a
        // fresh result, or the batch was submitted twice for the same call),
        // do NOT overwrite. The batch result would clobber the manager's
        // corrections. Still clean up the pending item + tracking file.
        const existingCall = await storage.getCall(callId).catch(() => null);
        if (existingCall && existingCall.status === "completed") {
          logger.warn("Batch: skipping result — call already completed (likely manager-edited or re-run)", { callId });
          try {
            await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
          } catch { /* best effort */ }
          continue;
        }

        const pendingData = await s3Client.downloadJson<any>(`batch-inference/pending/${callId}.json`);
        const transcriptResponse = pendingData?.transcriptResponse;

        if (!transcriptResponse) {
          // F-06: Previously this just `continue`d with a warn — the call
          // stayed in `awaiting_analysis` forever until orphan recovery
          // (default 2h threshold) caught it. Mark the call failed
          // explicitly, broadcast the status update so the UI updates
          // immediately, and clean up the pending S3 item in the finally
          // block below so we don't loop on it.
          logger.warn("Batch: pending item missing transcript data, marking call failed", { callId });
          try {
            await storage.updateCall(callId, { status: "failed" });
            broadcastCallUpdate(callId, "failed", { label: "Batch: transcript data missing" });
          } catch (markErr) {
            logger.warn("Batch: failed to mark call as failed", { callId, error: (markErr as Error).message });
          }
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
          // F-09: validate sub-scores are numbers clamped to [0, 10]. AI may
          // return strings ("high") or out-of-range values; coerce or default
          // to 0 to prevent NaN propagation into DB aggregations.
          const safeSubScore = (v: unknown): number => {
            const n = typeof v === "string" ? parseFloat(v) : Number(v);
            if (!Number.isFinite(n)) return 0;
            return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
          };
          updatedAnalysis.subScores = {
            compliance: safeSubScore(analysis.sub_scores.compliance),
            customerExperience: safeSubScore(analysis.sub_scores.customer_experience),
            communication: safeSubScore(analysis.sub_scores.communication),
            resolution: safeSubScore(analysis.sub_scores.resolution),
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

        // INV-35 defense-in-depth: synthetic calls must never trigger
        // auto-assignment to a real employee. The simulated-call storage
        // hard-codes processingMode:"immediate" so synthetic calls don't
        // normally enter batch mode, but any future caller that omits the
        // flag would leak employee assignments without this guard. We
        // already fetched existingCall at line 56 for the overwrite-guard;
        // reuse it to avoid a second read.
        const isSynthetic = existingCall?.synthetic === true;
        if (isSynthetic) {
          logger.info("Batch: synthetic call — skipping auto-assign", { callId });
        } else if (analysis.detected_agent_name) {
          await autoAssignEmployee(callId, analysis.detected_agent_name, storage, `[BATCH] `);
        }

        // Track Bedrock usage (at batch pricing — 50% off)
        try {
          const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
          const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
          const estimatedOutputTokens = 800;
          const rawBedrockCost = estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens);
          // F-04: warn on unknown model so operators know cost tracking is broken.
          // Previously silently recorded $0 via ?? 0 without any warning.
          if (rawBedrockCost === null) {
            warnOnUnknownBedrockModel(bedrockModel, { callId, phase: "batch_usage_tracking" });
          }
          const bedrockCost = (rawBedrockCost ?? 0) * 0.5;

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

    // 0. Promote any tracking files that ended up in orphaned-submissions/
    //    during a prior cycle's S3 write failure. This must run before the
    //    active-jobs scan so a newly-promoted file is immediately picked up.
    await promoteOrphanedSubmissions(s3Client);

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

    // CRITICAL: the AWS batch job is now running and billable. The only link
    // between the running job and CallAnalyzer is the tracking file we're
    // about to write. If this write fails, the job becomes an orphan — AWS
    // processes it, charges for it, and the results are never collected.
    //
    // Recovery strategy (in order of preference):
    //  1. Retry the primary write 3x with exponential backoff.
    //  2. On persistent failure, fall back to `orphaned-submissions/` so the
    //     job is still findable in S3 under a known prefix.
    //  3. In ALL failure cases, emit a logger.error with the jobId + jobArn —
    //     those are the manual-recovery keys an operator uses in the AWS
    //     console (CloudWatch alarm fires on "batch-orphan-escalation").
    await persistBatchJobTracking(s3Client, batchJob, items.length);

  } catch (batchErr) {
    logger.error("Batch cycle error", { error: (batchErr as Error).message });
  } finally {
    batchCycleRunning = false;
  }
}

/**
 * Persist the batch-job tracking file with retry + orphan fallback.
 *
 * The AWS Bedrock batch job has already been submitted at this point; losing
 * the tracking file means the job runs invisibly until a human spots it in
 * the AWS console. This function ensures the job is recorded SOMEWHERE even
 * under partial S3 failure.
 */
async function persistBatchJobTracking(
  s3Client: ReturnType<NonNullable<typeof storage.getObjectStorageClient>>,
  batchJob: BatchJob,
  itemCount: number,
): Promise<void> {
  if (!s3Client) {
    logger.error("Batch: S3 client vanished after job submission — job is orphaned on AWS", {
      jobId: batchJob.jobId,
      jobArn: batchJob.jobArn,
    });
    escalateOrphanedJob(batchJob, "s3_client_unavailable");
    return;
  }

  const primaryKey = `batch-inference/active-jobs/${batchJob.jobId}.json`;
  const BATCH_TRACK_RETRIES = 3;
  const BATCH_TRACK_BASE_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= BATCH_TRACK_RETRIES; attempt++) {
    try {
      await s3Client.uploadJson(primaryKey, batchJob);
      logger.info("Batch: submitted job", { jobId: batchJob.jobId, itemCount, attempt });
      return;
    } catch (err) {
      const isLast = attempt === BATCH_TRACK_RETRIES;
      logger.warn("Batch: tracking-file write failed", {
        jobId: batchJob.jobId,
        attempt,
        isLast,
        error: (err as Error).message,
      });
      if (!isLast) {
        await new Promise(resolve => setTimeout(resolve, BATCH_TRACK_BASE_DELAY_MS * Math.pow(2, attempt - 1)));
      }
    }
  }

  // Primary retries exhausted — fall back to the orphan prefix so the job
  // data still lives somewhere in S3 that a recovery scan can find.
  const orphanKey = `batch-inference/orphaned-submissions/${batchJob.jobId}.json`;
  try {
    await s3Client.uploadJson(orphanKey, { ...batchJob, orphanedAt: new Date().toISOString(), itemCount });
    logger.error("Batch: tracking-file write fell back to orphan prefix — subsequent cycle will promote to active-jobs", {
      jobId: batchJob.jobId,
      orphanKey,
    });
    escalateOrphanedJob(batchJob, "primary_write_failed_orphan_fallback");
  } catch (orphanErr) {
    logger.error("Batch: tracking-file orphan fallback also failed — job is NOT discoverable in S3", {
      jobId: batchJob.jobId,
      jobArn: batchJob.jobArn,
      error: (orphanErr as Error).message,
    });
    escalateOrphanedJob(batchJob, "primary_and_orphan_write_failed");
  }
}

/**
 * Emit a structured error log with the batch jobId + jobArn. These are the
 * recovery keys an operator uses to find the running job in the AWS Bedrock
 * console and manually reconstruct the active-jobs tracking file.
 *
 * CloudWatch alarm "batch-orphan-escalation" fires on this log line.
 */
function escalateOrphanedJob(batchJob: BatchJob, reason: string): void {
  logger.error("batch-orphan-escalation: tracking-file write failed — job invisible to CallAnalyzer", {
    alert: "batch_orphan_escalation",
    reason,
    jobId: batchJob.jobId,
    jobArn: batchJob.jobArn,
    recoveryHint: `Manually reconstruct batch-inference/active-jobs/${batchJob.jobId}.json with the BatchJob shape from the AWS console.`,
  });
}

/**
 * Scan the orphaned-submissions/ prefix and promote any surviving tracking
 * files back into active-jobs/. Called at the top of each batch cycle so
 * the next run after a transient S3 failure self-heals.
 */
async function promoteOrphanedSubmissions(s3Client: ReturnType<NonNullable<typeof storage.getObjectStorageClient>>): Promise<void> {
  if (!s3Client) return;
  try {
    const orphanKeys = await s3Client.listObjects("batch-inference/orphaned-submissions/");
    if (orphanKeys.length === 0) return;
    for (const key of orphanKeys) {
      try {
        const job = await s3Client.downloadJson<BatchJob>(key);
        if (!job?.jobId) {
          logger.warn("Batch: orphaned-submissions entry missing jobId, skipping", { key });
          continue;
        }
        const activeKey = `batch-inference/active-jobs/${job.jobId}.json`;
        await s3Client.uploadJson(activeKey, job);
        await s3Client.deleteObject(key);
        logger.info("Batch: promoted orphaned submission to active-jobs", { jobId: job.jobId });
      } catch (promoteErr) {
        logger.warn("Batch: failed to promote orphaned submission (will retry next cycle)", {
          key,
          error: (promoteErr as Error).message,
        });
      }
    }
  } catch (err) {
    logger.warn("Batch: failed to list orphaned-submissions prefix", { error: (err as Error).message });
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

  // First run after 1 minute, then on interval. .unref() so a lingering
  // timer can't keep the event loop alive past graceful shutdown.
  batchCycleTimeout = setTimeout(runBatchCycle, 60_000);
  batchCycleTimeout.unref();
  batchCycleInterval = setInterval(runBatchCycle, batchIntervalMinutes * 60 * 1000);
  batchCycleInterval.unref();

  // Orphan recovery: first run after 5 minutes, then every 30 minutes
  orphanCheckTimeout = setTimeout(recoverOrphans, 5 * 60 * 1000);
  orphanCheckTimeout.unref();
  orphanCheckInterval = setInterval(recoverOrphans, ORPHAN_CHECK_INTERVAL_MS);
  orphanCheckInterval.unref();

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
