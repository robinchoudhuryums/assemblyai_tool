import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { assemblyAIService, buildSpeakerLabeledTranscript, computeUtteranceMetrics } from "../services/assemblyai";
import { aiProvider } from "../services/ai-factory";
import { BedrockClientError } from "../services/bedrock";
import { calibrateScore, calibrateSubScores, getCalibrationConfig } from "../services/scoring-calibration";
import { buildAnalysisPrompt } from "../services/ai-provider";
import { fetchRagContext, buildRagQuery, isRagEnabled, type RagSource } from "../services/rag-client";
import { detectTranscriptInjection, detectOutputAnomaly } from "../services/prompt-guard";
import { broadcastCallUpdate } from "../services/websocket";
import { bedrockBatchService, type PendingBatchItem } from "../services/bedrock-batch";
import { type UsageRecord } from "@shared/schema";
import { randomUUID } from "crypto";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, TaskQueue, computeConfidenceScore, autoAssignEmployee, warnOnUnknownBedrockModel } from "./utils";
import {
  MIN_CALL_DURATION_FOR_AI_SEC,
  HAIKU_SHORT_CALL_MAX_SEC,
  HAIKU_SHORT_CALL_MAX_TOKENS,
} from "../constants";
import { checkAndCreateCoachingAlert } from "../services/coaching-alerts";
import { triggerWebhook } from "../services/webhooks";
import { captureException } from "../services/sentry";
import { evaluateBadges } from "../services/gamification";
import { logger } from "../services/logger";
import { getPipelineSettings } from "../services/pipeline-settings";
import { getModelForTier } from "../services/model-tiers";

// Limit concurrent audio processing to 3 parallel jobs (fallback when no DB)
export const audioProcessingQueue = new TaskQueue(3);

/**
 * Determine if batch processing should be used for a given upload.
 * Considers: BEDROCK_BATCH_MODE env var, time-of-day schedule, and per-upload override.
 */
// A26/F53: parse and validate BATCH_SCHEDULE_* once at module load. Invalid
// values (non-HH:MM, out-of-range hours/minutes) are logged and ignored —
// the schedule window check is skipped in that case rather than silently
// mis-computing minutes from NaN.
function parseScheduleTime(raw: string | undefined, label: string): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) {
    logger.warn("batch schedule env var not HH:MM format — window disabled", { label, value: raw });
    return null;
  }
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    logger.warn("batch schedule env var out of range — window disabled", { label, value: raw });
    return null;
  }
  return h * 60 + mm;
}

const BATCH_SCHEDULE_START_MIN = parseScheduleTime(process.env.BATCH_SCHEDULE_START, "BATCH_SCHEDULE_START");
const BATCH_SCHEDULE_END_MIN = parseScheduleTime(process.env.BATCH_SCHEDULE_END, "BATCH_SCHEDULE_END");

export function shouldUseBatchMode(perUploadOverride?: string): boolean {
  if (perUploadOverride === "immediate") return false;
  if (perUploadOverride === "batch") return bedrockBatchService.isAvailable;
  if (!bedrockBatchService.isAvailable) return false;

  if (BATCH_SCHEDULE_START_MIN !== null && BATCH_SCHEDULE_END_MIN !== null) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = BATCH_SCHEDULE_START_MIN;
    const endMinutes = BATCH_SCHEDULE_END_MIN;

    if (startMinutes <= endMinutes) {
      if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
    } else {
      if (currentMinutes >= endMinutes && currentMinutes < startMinutes) return false;
    }
  }

  return true;
}

export interface ProcessAudioOptions {
  originalName: string;
  mimeType: string;
  callCategory?: string;
  uploadedBy?: string;
  processingMode?: string;
  language?: string;
  /** Optional filesystem path to the audio file for cleanup on finish. */
  filePath?: string;
}

/** Process audio file with AssemblyAI and archive to cloud storage (A22). */
export async function processAudioFile(
  callId: string,
  audioBuffer: Buffer,
  options: ProcessAudioOptions,
) {
  const { originalName, mimeType, callCategory, uploadedBy, processingMode, language, filePath } = options;
  logger.info("pipeline: starting audio processing", { callId });
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." });
  try {
    // Step 1a: Get audio URL for AssemblyAI
    // Prefer pre-signed S3 URL (avoids re-uploading audio buffer to AssemblyAI)
    let audioUrl: string;
    const existingAudioFiles = await storage.getAudioFiles(callId);
    if (existingAudioFiles.length > 0 && storage.getAudioPresignedUrl) {
      const presigned = await storage.getAudioPresignedUrl(existingAudioFiles[0]);
      if (presigned) {
        audioUrl = presigned;
        logger.info("pipeline: step 1/7 using pre-signed S3 URL for AssemblyAI", { callId });
      } else {
        logger.info("pipeline: step 1/7 pre-signed URL unavailable, uploading to AssemblyAI", { callId });
        audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath || originalName));
      }
    } else {
      logger.info("pipeline: step 1/7 uploading audio file to AssemblyAI", { callId });
      audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath || originalName));
    }
    logger.info("pipeline: step 1/7 audio URL ready", { callId });

    // Step 1b: Archive audio to cloud storage (skip if already archived by job queue)
    // A23/F82: reuse existingAudioFiles from step 1a — no mutation between steps.
    if (existingAudioFiles.length === 0) {
      logger.info("pipeline: step 1b/7 archiving audio file to cloud storage", { callId });
      try {
        await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
        logger.info("pipeline: step 1b/7 audio archived", { callId });
      } catch (archiveError) {
        // A23/F83: log the error properly instead of dropping it into stringification
        logger.warn("pipeline: failed to archive audio (continuing)", { callId, error: (archiveError as Error).message });
        captureException(archiveError as Error, { callId, errorType: "audio_archive_failed" });
      }
    } else {
      logger.info("pipeline: step 1b/7 audio already archived, skipping", { callId });
    }

    // Step 2: Start transcription (with agent name word boost for correct spelling)
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." });
    logger.info("pipeline: step 2/7 submitting for transcription", { callId });

    // Build word boost list from employee names
    let wordBoost: string[] | undefined;
    try {
      const allEmployees = await storage.getAllEmployees();
      const nameWords = new Set<string>();
      for (const emp of allEmployees) {
        for (const part of emp.name.split(/\s+/)) {
          if (part.length >= 3) nameWords.add(part);
        }
        if (emp.pseudonym) {
          const cleaned = emp.pseudonym.replace(/[()]/g, " ");
          for (const part of cleaned.split(/\s+/)) {
            if (part.length >= 3) nameWords.add(part);
          }
        }
      }
      // Boost company name/acronym for transcription accuracy
      const companyName = process.env.COMPANY_NAME || "UniversalMed Supply";
      for (const word of companyName.split(/[\s()]+/).filter(Boolean)) {
        nameWords.add(word);
      }
      if (nameWords.size > 0) {
        wordBoost = Array.from(nameWords).slice(0, 100);
      }
    } catch (boostErr) {
      logger.warn("pipeline: failed to build word boost list (non-blocking)", { callId, error: (boostErr as Error).message });
    }

    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl, wordBoost, language);
    logger.info("pipeline: step 2/7 transcription submitted", { callId, transcriptId });

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Wait for transcription completion (webhook if available, polling fallback)
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." });
    logger.info("pipeline: step 3/7 waiting for transcript results", { callId });
    const transcriptResponse = await assemblyAIService.waitForTranscript(transcriptId);

    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    logger.info("pipeline: step 3/7 polling complete", { callId, status: transcriptResponse.status });

    // Compute call duration from word-level data
    const callDurationSeconds = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);

    // Quality gate thresholds — runtime-tunable via the Admin UI
    // (/api/admin/pipeline-settings). Pulled fresh on every pipeline run
    // so changes take effect on the NEXT call without a restart.
    const pipelineSettings = getPipelineSettings();

    // Quality gate: skip AI analysis for empty/near-empty transcripts (prevents wasted Bedrock spend)
    const transcriptText = (transcriptResponse.text || "").trim();
    if (transcriptText.length < pipelineSettings.minTranscriptLength) {
      logger.warn("pipeline: empty transcript — skipping AI analysis", { callId, transcriptLength: transcriptText.length });

      const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId);
      analysis.confidenceScore = "0.000";
      analysis.confidenceFactors = {
        transcriptConfidence: 0,
        wordCount: transcriptResponse.words?.length || 0,
        callDurationSeconds,
        transcriptLength: transcriptText.length,
        aiAnalysisCompleted: false,
        overallScore: 0,
      };
      analysis.flags = ["empty_transcript"];
      analysis.summary = "Transcript was empty or too short for analysis.";
      analysis.performanceScore = "0";

      await storage.createTranscript(transcript);
      await storage.createSentimentAnalysis(sentiment);
      await storage.createCallAnalysis(analysis);
      await storage.updateCall(callId, { status: "completed", duration: callDurationSeconds });
      await cleanupFile(filePath);
      broadcastCallUpdate(callId, "completed", {
        step: 6,
        totalSteps: 6,
        label: "Complete (empty transcript)",
        flags: ["empty_transcript"],
      });
      logger.info("pipeline: completed with empty_transcript flag, AI analysis skipped", { callId });
      return;
    }

    // Quality gate: skip AI analysis for very low-confidence transcripts (#3)
    const transcriptConfidenceValue = transcriptResponse.confidence || 0;
    if (transcriptConfidenceValue < pipelineSettings.minTranscriptConfidence && transcriptConfidenceValue > 0) {
      logger.warn("pipeline: low transcript confidence — skipping AI analysis", { callId, confidencePct: Math.round(transcriptConfidenceValue * 100) });

      const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId);
      analysis.confidenceScore = transcriptConfidenceValue.toFixed(3);
      analysis.confidenceFactors = {
        transcriptConfidence: Math.round(transcriptConfidenceValue * 100) / 100,
        wordCount: transcriptResponse.words?.length || 0,
        callDurationSeconds,
        transcriptLength: (transcriptResponse.text || "").length,
        aiAnalysisCompleted: false,
        overallScore: transcriptConfidenceValue * 0.4,
      };
      const lowQualityFlags = (analysis.flags as string[]) || [];
      lowQualityFlags.push("low_transcript_quality");
      analysis.flags = lowQualityFlags;

      await storage.createTranscript(transcript);
      await storage.createSentimentAnalysis(sentiment);
      await storage.createCallAnalysis(analysis);
      await storage.updateCall(callId, { status: "completed", duration: callDurationSeconds });
      await cleanupFile(filePath);
      broadcastCallUpdate(callId, "completed", {
        step: 6,
        totalSteps: 6,
        label: "Complete (low quality transcript)",
        flags: lowQualityFlags,
      });
      logger.info("pipeline: completed with low_transcript_quality flag, AI analysis skipped", { callId });
      return;
    }

    // Build speaker-labeled transcript for AI analysis (#1)
    let speakerLabeledText = transcriptResponse.text || "";
    if (transcriptResponse.words && transcriptResponse.words.length > 0) {
      const labeled = buildSpeakerLabeledTranscript(transcriptResponse.words);
      if (labeled) {
        speakerLabeledText = labeled;
        logger.info("pipeline: built speaker-labeled transcript", { callId, chars: speakerLabeledText.length });
      }
    }

    // Compute utterance-level metrics (#5)
    const utteranceMetrics = computeUtteranceMetrics(transcriptResponse.words || []);

    // Step 4: AI analysis (Bedrock/Claude — or fall back to defaults)
    broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." });
    let aiAnalysis = null;
    // Spend-cap visibility: when the catch detects a Bedrock 403/429,
    // we set this so the flag-emission block downstream can mark the
    // call's analysis with `ai_unavailable:bedrock_access_denied`.
    // Reviewers viewing the transcript see why the AI fields are
    // empty instead of assuming the AI just gave a generic answer.
    let aiBlockReason: string | null = null;

    // Load custom prompt template for this call category
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
          logger.info("pipeline: using custom prompt template", { callId, templateName: tmpl.name });
        }
      } catch (tmplError) {
        logger.warn("pipeline: failed to load prompt template (using defaults)", { callId, error: (tmplError as Error).message });
      }
    }

    // Parallelize RAG fetch + injection detection (both are independent).
    // RAG fetch is the bottleneck on uncached calls (up to 8s timeout).
    // Running injection detection concurrently saves 1-2ms (fast) but more importantly
    // the RAG result is ready sooner when the AI analysis step needs it.
    let ragContext: string | undefined;
    let ragSources: RagSource[] = [];
    let injectionDetected = false;

    const ragPromise = (async () => {
      if (!isRagEnabled() || !speakerLabeledText) return;
      try {
        const { query: ragQuery, cacheKey } = buildRagQuery(callCategory);
        const ragResult = await fetchRagContext(ragQuery, undefined, cacheKey);
        if (ragResult) {
          ragContext = ragResult.context;
          ragSources = ragResult.sources;
          logger.info("pipeline: RAG context retrieved", { callId, chars: ragContext.length, sources: ragSources.length, confidence: ragResult.confidence });
        }
      } catch (ragErr) {
        logger.warn("pipeline: RAG context fetch failed (non-blocking)", { callId, error: (ragErr as Error).message });
      }
    })();

    // Injection detection runs in parallel with RAG fetch
    if (speakerLabeledText) {
      const injectionCheck = detectTranscriptInjection(speakerLabeledText);
      if (injectionCheck.detected) {
        injectionDetected = true;
        logger.warn("pipeline: prompt injection detected in transcript", { callId, reasons: injectionCheck.reasons });
      }
    }

    // Wait for RAG to complete before AI analysis needs it
    await ragPromise;

    // Batch mode: defer AI analysis for 50% cost savings
    if (shouldUseBatchMode(processingMode) && aiProvider.isAvailable && speakerLabeledText) {
      const prompt = buildAnalysisPrompt(speakerLabeledText, callCategory, promptTemplate, language, ragContext);
      const pendingItem: PendingBatchItem = {
        callId,
        prompt,
        callCategory,
        uploadedBy,
        timestamp: new Date().toISOString(),
      };

      // Track whether the S3 pending item was written so we can clean it up
      // on partial-failure fall-through. Without this, a partial failure
      // leaves an orphan pending item: the batch scheduler later picks it
      // up, submits AWS-billable work, and the INV-28 "already completed"
      // guard only kicks in AFTER the AWS round-trip. Better to delete the
      // pending item on fall-through so batch never sees it.
      let pendingItemUploaded = false;
      const pendingKey = `batch-inference/pending/${callId}.json`;
      try {
        const s3Client = storage.getObjectStorageClient();
        if (s3Client) {
          await s3Client.uploadJson(pendingKey, {
            ...pendingItem,
            transcriptResponse: {
              text: transcriptResponse.text,
              confidence: transcriptResponse.confidence,
              words: transcriptResponse.words,
              sentiment_analysis_results: transcriptResponse.sentiment_analysis_results,
              status: transcriptResponse.status,
            },
          });
          pendingItemUploaded = true;
        }
        logger.info("pipeline: step 4/6 deferred to batch analysis (50% cost savings)", { callId });
        broadcastCallUpdate(callId, "awaiting_analysis", { step: 4, totalSteps: 6, label: "Queued for batch analysis..." });

        const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId);
        await storage.createTranscript(transcript);
        await storage.createSentimentAnalysis(sentiment);
        // Use actual transcription confidence as the placeholder score instead of
        // a misleading hardcoded 0.500. This reflects what we know so far (transcript
        // quality) and will be recomputed with AI factors when the batch completes.
        const batchPlaceholderConfidence = Math.max(0, Math.min(1, transcriptResponse.confidence || 0));
        analysis.confidenceScore = batchPlaceholderConfidence.toFixed(3);
        analysis.confidenceFactors = {
          transcriptConfidence: transcriptResponse.confidence || 0,
          wordCount: transcriptResponse.words?.length || 0,
          callDurationSeconds,
          transcriptLength: (transcriptResponse.text || "").length,
          aiAnalysisCompleted: false,
          overallScore: batchPlaceholderConfidence,
        };
        const existingFlags = (analysis.flags as string[]) || [];
        existingFlags.push("awaiting_batch_analysis");
        analysis.flags = existingFlags;
        await storage.createCallAnalysis(analysis);

        await storage.updateCall(callId, {
          status: "awaiting_analysis",
          duration: callDurationSeconds,
        });

        // Track usage (transcription only)
        try {
          const audioDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
          const assemblyaiCost = estimateAssemblyAICost(audioDuration);
          const usageRecord: UsageRecord = {
            id: randomUUID(),
            callId,
            type: "call",
            timestamp: new Date().toISOString(),
            user: uploadedBy || "unknown",
            services: {
              assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
            },
            totalEstimatedCost: Math.round(assemblyaiCost * 10000) / 10000,
          };
          await storage.createUsageRecord(usageRecord);
        } catch (usageErr) {
          logger.warn("pipeline: failed to record usage (non-blocking)", { callId, error: (usageErr as Error).message });
        }

        await cleanupFile(filePath);
        logger.info("pipeline: transcription complete, awaiting batch analysis", { callId });
        return;
      } catch (batchErr) {
        logger.warn("pipeline: failed to defer to batch (falling back to on-demand)", { callId, error: (batchErr as Error).message });
        // Clean up the orphaned pending item if it made it to S3 before the
        // downstream storage writes failed. If left in place, the batch
        // scheduler would submit the call to AWS Bedrock (billable) only to
        // discover via INV-28 that on-demand already completed it.
        if (pendingItemUploaded) {
          try {
            const s3Client = storage.getObjectStorageClient();
            if (s3Client) await s3Client.deleteObject(pendingKey);
          } catch (cleanupErr) {
            logger.warn("pipeline: failed to clean up orphaned batch pending item", { callId, error: (cleanupErr as Error).message });
          }
        }
      }
    }

    // Skip AI for very short calls — likely noise, voicemail, or misdials.
    // Threshold is runtime-tunable via the Admin UI (Pipeline Settings);
    // the constant-level MIN_CALL_DURATION_FOR_AI_SEC is still imported above
    // for the `../constants` barrel export compat, but this call site now
    // uses the settings singleton so changes take effect without restart.
    const tooShortForAI = callDurationSeconds < pipelineSettings.minCallDurationSec;

    if (tooShortForAI) {
      logger.info("pipeline: step 4/6 skipping AI analysis (call too short)", { callId, callDurationSeconds });
    } else if (aiProvider.isAvailable && speakerLabeledText) {
      try {
        const transcriptCharCount = speakerLabeledText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        logger.info("pipeline: step 4/6 running AI analysis", { callId, provider: aiProvider.name, transcriptChars: transcriptCharCount, estimatedTokens });

        if (estimatedTokens > 100000) {
          logger.warn("pipeline: very long transcript", { callId, estimatedTokens });
        }

        // Cost optimization: use Haiku for short routine calls (≤ 2min, no flags, no custom template)
        // Haiku is 3x cheaper for input, 3x cheaper for output — saves ~67% per call.
        // Haiku model ID is env-configurable via BEDROCK_HAIKU_MODEL because the
        // baked-in default has drifted relative to AWS Bedrock's actual catalog
        // at least once. If the ID is wrong (400 "invalid model identifier"),
        // the try/catch below falls back to the default aiProvider.
        const isRoutineShort = callDurationSeconds <= HAIKU_SHORT_CALL_MAX_SEC && !promptTemplate && estimatedTokens < HAIKU_SHORT_CALL_MAX_TOKENS;
        let analysisProvider = aiProvider;
        let usingHaiku = false;
        if (isRoutineShort && !process.env.BEDROCK_MODEL?.includes("haiku")) {
          try {
            const { BedrockProvider } = await import("../services/bedrock");
            const haikuModel = getModelForTier("fast");
            analysisProvider = BedrockProvider.createWithModel(haikuModel);
            usingHaiku = true;
            logger.info("pipeline: using Haiku for short routine call", { callId, callDurationSeconds, maxSec: HAIKU_SHORT_CALL_MAX_SEC, estimatedTokens, haikuModel });
          } catch (haikuErr) {
            logger.warn("pipeline: Haiku provider creation failed, using default model", { callId, error: (haikuErr as Error).message });
          }
        }

        const invokeAnalysis = async (provider: typeof aiProvider) =>
          provider.analyzeCallTranscript(speakerLabeledText, callId, callCategory, promptTemplate, language, callDurationSeconds, undefined, ragContext);

        try {
          aiAnalysis = await invokeAnalysis(analysisProvider);
        } catch (firstErr) {
          // Haiku fallback: if the Haiku-specialised provider was rejected by
          // Bedrock with a 4xx (except 429), re-run on the default provider.
          // Covers the "invalid model identifier" error class seen when the
          // baked-in Haiku ID drifts ahead of AWS Bedrock's catalog.
          const isHaikuClientError =
            usingHaiku &&
            firstErr instanceof BedrockClientError &&
            (firstErr as InstanceType<typeof BedrockClientError>).status !== 429;
          if (isHaikuClientError) {
            logger.warn("pipeline: Haiku invocation rejected by Bedrock, falling back to default model", {
              callId,
              status: (firstErr as InstanceType<typeof BedrockClientError>).status,
              error: (firstErr as Error).message,
            });
            aiAnalysis = await invokeAnalysis(aiProvider);
          } else {
            // A12/F17: 1-retry budget on parse/schema failures. The first call may
            // have gotten a malformed response that a second try can recover.
            const firstMsg = (firstErr as Error).message || "";
            const isParseFailure = /JSON|parse|schema/i.test(firstMsg) && !/timeout|unavailable|ECONNREFUSED|ETIMEDOUT|throttl/i.test(firstMsg);
            if (isParseFailure) {
              logger.warn("pipeline: AI parse failure on first attempt, retrying once", { callId, error: firstMsg });
              aiAnalysis = await invokeAnalysis(analysisProvider);
            } else {
              throw firstErr;
            }
          }
        }
        logger.info("pipeline: step 4/6 AI analysis complete", { callId });
      } catch (aiError) {
        const errMsg = (aiError as Error).message || "";
        const isParseFailure =
          /JSON|parse|schema/i.test(errMsg) && !/timeout|unavailable|ECONNREFUSED|ETIMEDOUT|throttl/i.test(errMsg);
        // Spend-cap visibility: detect Bedrock 403/429 specifically so we
        // can flag the call with `ai_unavailable:bedrock_access_denied`
        // downstream. Reviewers see "AI was blocked by AWS" instead of
        // "no AI ran for some reason." `BedrockClientError` carries the
        // numeric status; a plain Error from the 429 path doesn't, so we
        // also string-match the message we know `bedrock.ts` emits.
        const isAiBlocked =
          (aiError instanceof BedrockClientError && aiError.status === 403) ||
          /Bedrock API error \(403\)|Bedrock API error \(429\)/.test(errMsg);
        if (isAiBlocked) {
          aiBlockReason = "bedrock_access_denied";
        }
        if (isParseFailure) {
          logger.error("pipeline: AI returned unparseable response after retry (continuing with defaults)", { callId, error: errMsg });
          captureException(aiError as Error, { callId, errorType: "ai_parse_failure" });
        } else {
          logger.warn("pipeline: AI analysis failed (continuing with defaults)", { callId, error: errMsg, blocked: isAiBlocked });
          captureException(aiError as Error, { callId, errorType: isAiBlocked ? "ai_blocked" : "ai_unavailable" });
        }
      }
    } else if (!aiProvider.isAvailable) {
      logger.info("pipeline: step 4/6 AI provider not configured, skipping AI analysis", { callId });
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." });
    logger.info("pipeline: step 5/6 processing combined transcript and analysis data", { callId });

    // A4/F06: Identify agent speaker label *before* processTranscriptData so
    // talkTimeRatio is computed against the correct speaker (or null if unknown).
    let agentSpeakerLabel: string | undefined;
    if (aiAnalysis?.detected_agent_name && transcriptResponse.words && transcriptResponse.words.length > 0) {
      const detectedName = aiAnalysis.detected_agent_name.toLowerCase();
      const earlyWords = transcriptResponse.words.slice(0, 50);
      for (let i = 0; i < earlyWords.length; i++) {
        const w = earlyWords[i];
        if (w.text.toLowerCase().includes(detectedName) ||
            (i > 0 && `${earlyWords[i - 1].text} ${w.text}`.toLowerCase().includes(detectedName))) {
          agentSpeakerLabel = w.speaker || undefined;
          break;
        }
      }
    }

    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId, agentSpeakerLabel);

    // Compute confidence score (shared formula from utils.ts)
    const { score: confidenceScore, factors: confidenceFactors } = computeConfidenceScore({
      transcriptConfidence: transcriptResponse.confidence || 0,
      wordCount: transcriptResponse.words?.length || 0,
      callDurationSeconds,
      hasAiAnalysis: aiAnalysis !== null,
    });

    analysis.confidenceScore = confidenceScore.toFixed(3);
    analysis.confidenceFactors = confidenceFactors;

    if (aiAnalysis?.sub_scores) {
      const calConfig = getCalibrationConfig();
      const calibrated = calibrateSubScores(aiAnalysis.sub_scores, calConfig);
      analysis.subScores = {
        compliance: calibrated.compliance,
        customerExperience: calibrated.customer_experience,
        communication: calibrated.communication,
        resolution: calibrated.resolution,
      };
    }

    if (aiAnalysis?.detected_agent_name) {
      analysis.detectedAgentName = aiAnalysis.detected_agent_name;
      if (agentSpeakerLabel) {
        logger.info("pipeline: agent identified as speaker", { callId, agentName: aiAnalysis.detected_agent_name, speakerLabel: agentSpeakerLabel });
        if (!analysis.confidenceFactors) analysis.confidenceFactors = {};
        (analysis.confidenceFactors as Record<string, unknown>).agentSpeakerLabel = agentSpeakerLabel;
      }
    }

    // Store utterance metrics (#5)
    if (utteranceMetrics) {
      if (!analysis.confidenceFactors) analysis.confidenceFactors = {};
      (analysis.confidenceFactors as Record<string, unknown>).utteranceMetrics = {
        interruptionCount: utteranceMetrics.interruptionCount,
        avgResponseLatencyMs: utteranceMetrics.avgResponseLatencyMs,
        monologueSegments: utteranceMetrics.monologueSegments,
        questionCount: utteranceMetrics.questionCount,
      };
    }

    // Store RAG sources with analysis for reviewer visibility
    if (ragSources.length > 0) {
      if (!analysis.confidenceFactors) analysis.confidenceFactors = {};
      (analysis.confidenceFactors as Record<string, unknown>).ragSources = ragSources.map(s => ({
        documentName: s.documentName,
        pageNumber: s.pageNumber,
        sectionHeader: s.sectionHeader,
        score: s.score,
        text: s.text.slice(0, 300),
      }));
    }

    // Auto-categorize: defer the actual updateCall write to AFTER all storage
    // writes (transcript/sentiment/analysis) so we batch it into the
    // status-completed update below. This avoids a partial update window where
    // the call has a category but no analysis yet (A15/F25).
    let autoCategoryToApply: "inbound" | "outbound" | "internal" | "vendor" | undefined;
    if (!callCategory && aiAnalysis?.call_category) {
      const validCategories = ["inbound", "outbound", "internal", "vendor"] as const;
      type ValidCategory = typeof validCategories[number];
      if (validCategories.includes(aiAnalysis.call_category as ValidCategory)) {
        autoCategoryToApply = aiAnalysis.call_category as ValidCategory;
      }
    }

    if (confidenceScore < 0.7) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push("low_confidence");
      analysis.flags = existingFlags;
    }

    // Spend-cap visibility: if AI was blocked by Bedrock (403 budget action /
    // 429 quota), tag the analysis so reviewers see "AI was unavailable" in
    // the transcript UI instead of an empty rubric they might mistake for
    // a generic AI verdict. Mirrors the `output_anomaly:*` flag convention
    // already used by the prompt guard.
    if (aiBlockReason) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push(`ai_unavailable:${aiBlockReason}`);
      analysis.flags = existingFlags;
    }

    // Prompt injection: flag if injection was detected in transcript
    if (injectionDetected) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push("prompt_injection_detected");
      analysis.flags = existingFlags;
      logger.warn("pipeline: flagged — prompt injection detected in transcript", { callId });
    }

    // Output anomaly: check if AI response shows signs of injection bypass
    if (aiAnalysis && analysis.summary) {
      const rawOutputText = `${analysis.summary || ""} ${(analysis.actionItems || []).join(" ")} ${(analysis.feedback?.strengths || []).join(" ")} ${(analysis.feedback?.suggestions || []).join(" ")}`;
      const outputCheck = detectOutputAnomaly(rawOutputText);
      if (outputCheck.anomaly) {
        const existingFlags = (analysis.flags as string[]) || [];
        existingFlags.push(`output_anomaly:${outputCheck.reason}`);
        analysis.flags = existingFlags;
        logger.warn("pipeline: flagged — output anomaly", { callId, reason: outputCheck.reason });
      }
    }

    logger.info("pipeline: step 5/6 data processing complete", { callId, confidencePct: Math.round(confidenceScore * 100) });

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." });
    logger.info("pipeline: step 6/6 saving analysis results", { callId });
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    // Generate embedding for clustering (non-blocking, fires in background)
    if (aiProvider.isAvailable && speakerLabeledText) {
      const embeddingText = [
        aiAnalysis?.summary || "",
        ...(aiAnalysis?.topics || []).map((t: any) => typeof t === "string" ? t : t?.text || ""),
        ...(aiAnalysis?.action_items || []).slice(0, 3).map((a: any) => typeof a === "string" ? a : a?.text || ""),
      ].filter(Boolean).join(". ");

      if (embeddingText.length > 20) {
        generateCallEmbedding(callId, embeddingText).catch(err => {
          logger.warn("pipeline: embedding generation failed (non-blocking)", { callId, error: err.message });
          captureException(err as Error, { callId, errorType: "embedding_generation" });
        });
      }
    }

    // Synthetic-call isolation: look up the call row early so we can gate
    // learning/reporting side effects below. Simulated calls share the same
    // processing pipeline but must never trigger auto-assignment, badges,
    // coaching alerts, best-practice ingest, or gamification webhooks — those
    // would credit real employees for fake calls and poison the KB/AI.
    const callBeforeUpdates = await storage.getCall(callId);
    const isSynthetic = callBeforeUpdates?.synthetic === true;

    // Auto-assign to employee based on detected agent name (shared logic from utils.ts)
    let autoAssigned = false;
    if (!isSynthetic && aiAnalysis?.detected_agent_name) {
      const result = await autoAssignEmployee(callId, aiAnalysis.detected_agent_name, storage, `[${callId}] `);
      autoAssigned = result.assigned;
    }

    await storage.updateCall(callId, {
      status: "completed",
      duration: callDurationSeconds, // A23/F56 dedup
      ...(autoCategoryToApply ? { callCategory: autoCategoryToApply } : {}),
    });
    if (autoCategoryToApply) {
      logger.info("pipeline: auto-categorized call", { callId, category: autoCategoryToApply });
    }
    logger.info("pipeline: step 6/6 done, status=completed", { callId, autoAssigned });

    // A23/F57: fetch completed call once and reuse across coaching and webhook blocks.
    const completedCall = await storage.getCall(callId);
    const performanceScoreNum = parseFloat(analysis.performanceScore || "0");

    // Auto-generate coaching alerts for low/high scores (non-blocking).
    // Synthetic-call isolation: simulated calls skip ALL of these side
    // effects. The AI analysis still runs and is stored so the admin can
    // review it, but no coaching session gets created, no badges awarded,
    // and the call never lands in the best-practice KB collection.
    try {
      const performanceScore = performanceScoreNum;
      const finalEmployeeId = completedCall?.employeeId;
      const callSummary = (analysis.summary as string) || "";

      if (isSynthetic) {
        logger.info("pipeline: synthetic call — skipping coaching / badges / KB ingest", { callId });
        // Tier C #9: calibration assertion hook — check whether the fresh
        // score lands inside the preset's expectedScoreRange. Fire-and-forget;
        // emits `alert: "calibration_drift"` logger.warn on mismatch so
        // CloudWatch alarms can catch prompt/model regressions automatically.
        // Only synthetic calls get this check; non-synthetic paths skip.
        import("../services/calibration-assertions").then(({ checkCalibrationAssertion }) => {
          checkCalibrationAssertion({ callId, performanceScore: performanceScoreNum }).catch(err => {
            logger.debug("pipeline: calibration assertion check threw (non-blocking)", {
              callId,
              error: (err as Error).message,
            });
          });
        }).catch(() => { /* dynamic import failure is non-critical */ });
      } else {
        // A12/F11/F21: pass the freshly-built analysis through so the
        // coaching service doesn't re-fetch it from storage.
        checkAndCreateCoachingAlert(callId, performanceScore, finalEmployeeId, callSummary, ragSources, {
          feedback: analysis.feedback,
          subScores: analysis.subScores,
          flags: analysis.flags,
        }).catch(err => {
          logger.warn("pipeline: coaching alert failed (non-blocking)", { callId, error: (err as Error).message });
          captureException(err as Error, { callId, errorType: "coaching_alert" });
        });

        // Gamification: evaluate badges (non-blocking)
        if (finalEmployeeId) {
          const subScores = analysis.subScores as { compliance?: number; customerExperience?: number; communication?: number; resolution?: number } | undefined;
          evaluateBadges(callId, finalEmployeeId, performanceScore, subScores).catch(err => {
            logger.warn("pipeline: badge evaluation failed (non-blocking)", { callId, error: (err as Error).message });
            captureException(err as Error, { callId, errorType: "badge_evaluation" });
          });
        }

        // Best practice auto-ingestion: send exceptional calls (≥9.0) to the KB.
        // CRITICAL: a synthetic "perfect" call reaching this branch would become
        // a real reference document that the AI grounds future analyses on.
        //
        // F11: Defense-in-depth against prompt-injection-poisoned KB. Even
        // though `buildAnalysisPrompt` wraps RAG content in
        // `<<<UNTRUSTED_KNOWLEDGE_BASE>>>` delimiters (F-16), we should not
        // knowingly ingest transcripts flagged for prompt injection or output
        // anomaly. A high-score call whose score was inflated by a successful
        // injection payload would otherwise land in the KB and steer future
        // analyses, even if the model ignores the embedded instructions.
        const analysisFlags = Array.isArray(analysis.flags) ? (analysis.flags as string[]) : [];
        const hasInjectionOrAnomalyFlag = analysisFlags.some(f =>
          f === "prompt_injection_detected" ||
          f.startsWith("prompt_injection") ||
          f.startsWith("output_anomaly"),
        );
        if (performanceScore >= 9.0 && hasInjectionOrAnomalyFlag) {
          logger.warn("pipeline: skipping best-practice ingest — injection/anomaly flag present", {
            callId,
            flags: analysisFlags.filter(f => f.startsWith("prompt_injection") || f.startsWith("output_anomaly")),
          });
        }
        if (performanceScore >= 9.0 && !hasInjectionOrAnomalyFlag) {
          import("../services/best-practice-ingest").then(({ ingestBestPractice }) => {
            const feedback = analysis.feedback as { strengths?: Array<string | { text: string }> } | undefined;
            const strengths = (feedback?.strengths || []).map(s => typeof s === "string" ? s : (s as { text: string }).text);
            ingestBestPractice({
              callId,
              callCategory: completedCall?.callCategory || undefined,
              score: performanceScore,
              agentName: analysis.detectedAgentName as string | undefined,
              summary: callSummary,
              transcript: speakerLabeledText?.slice(0, 5000) || "",
              strengths,
            }).catch((err) => {
              logger.warn("pipeline: best-practice ingestion failed (non-blocking)", { callId, error: (err as Error).message });
              captureException(err as Error, { callId, errorType: "best_practice_ingest" });
            });
          }).catch((err) => {
            logger.warn("pipeline: best-practice ingest module import failed", { callId, error: (err as Error).message });
          });
        }
      }
    } catch (alertErr) {
      logger.warn("pipeline: coaching alert check failed (non-blocking)", { callId, error: (alertErr as Error).message });
      captureException(alertErr as Error, { callId, errorType: "coaching_alert_setup" });
    }

    // Trigger webhooks (non-blocking). Synthetic-call isolation: external
    // webhook consumers (Slack alerts, etc.) should not receive score.low
    // / score.exceptional events for simulated calls. Skip the whole block
    // for synthetic to avoid confusing downstream integrations.
    try {
      if (isSynthetic) {
        logger.info("pipeline: synthetic call — skipping webhooks", { callId });
      }
      const employeeId = completedCall?.employeeId;
      let employeeName: string | undefined;
      if (employeeId) {
        try {
          const emp = await storage.getEmployee(employeeId);
          employeeName = emp?.name;
        } catch (empErr) {
          logger.warn("pipeline: failed to look up employee name for webhook", { callId, error: (empErr as Error).message });
        }
      }

      if (!isSynthetic) {
        // call.completed
        triggerWebhook("call.completed", {
          callId,
          score: performanceScoreNum,
          sentiment: sentiment.overallSentiment,
          duration: callDurationSeconds,
          employee: employeeName || undefined,
          fileName: originalName,
        }).catch(err => {
          logger.warn("pipeline: webhook delivery failed", { callId, event: "call.completed", error: (err as Error).message });
          captureException(err as Error, { callId, errorType: "webhook_delivery" });
        });

        // score.low (score <= 4)
        if (performanceScoreNum > 0 && performanceScoreNum <= 4) {
          triggerWebhook("score.low", {
            callId,
            score: performanceScoreNum,
            employee: employeeName || undefined,
            fileName: originalName,
          }).catch(err => {
            logger.warn("pipeline: webhook delivery failed", { callId, event: "score.low", error: (err as Error).message });
            captureException(err as Error, { callId, errorType: "webhook_delivery" });
          });
        }

        // score.exceptional (score >= 9)
        if (performanceScoreNum >= 9) {
          triggerWebhook("score.exceptional", {
            callId,
            score: performanceScoreNum,
            employee: employeeName || undefined,
            fileName: originalName,
          }).catch(err => {
            logger.warn("pipeline: webhook delivery failed", { callId, event: "score.exceptional", error: (err as Error).message });
            captureException(err as Error, { callId, errorType: "webhook_delivery" });
          });
        }
      }
    } catch (webhookErr) {
      logger.warn("pipeline: webhook trigger failed (non-blocking)", { callId, error: (webhookErr as Error).message });
    }

    // Track usage/cost
    try {
      const audioDuration = callDurationSeconds || 0;
      const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
      const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
      const estimatedOutputTokens = 800;
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const rawBedrockCost = (aiAnalysis !== null)
        ? estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens)
        : 0;
      // F6: store null + costPricingMissing=true when the model isn't in
      // BEDROCK_PRICING. Prior coalesce-to-zero made the spend dashboard
      // graph $0 with no signal that pricing was missing, so a typo in
      // BEDROCK_MODEL or a fresh AWS model id silently broke cost tracking.
      const pricingMissing = aiAnalysis !== null && rawBedrockCost === null;
      if (pricingMissing) {
        warnOnUnknownBedrockModel(bedrockModel, { callId, phase: "usage_tracking" });
      }
      const bedrockCostStored = pricingMissing
        ? null
        : (aiAnalysis !== null ? Math.round((rawBedrockCost as number) * 10000) / 10000 : 0);

      const usageRecord: UsageRecord = {
        id: randomUUID(),
        callId,
        type: "call",
        timestamp: new Date().toISOString(),
        user: uploadedBy || "unknown",
        services: {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
          bedrock: (aiAnalysis !== null) ? {
            model: bedrockModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: bedrockCostStored,
            ...(pricingMissing ? { costPricingMissing: true } : {}),
          } : undefined,
        },
        // totalEstimatedCost stays a number; missing-pricing rows underreport
        // the model side but the per-service `costPricingMissing` flag tells
        // the UI to badge the row as "Bedrock cost unknown".
        totalEstimatedCost: Math.round((assemblyaiCost + (bedrockCostStored ?? 0)) * 10000) / 10000,
      };
      await storage.createUsageRecord(usageRecord);
    } catch (usageErr) {
      logger.warn("pipeline: failed to record usage (non-blocking)", { callId, error: (usageErr as Error).message });
    }

    // Include `flags` so the frontend's batch-upload UI can show a per-batch
    // quality summary toast without an extra GET /api/calls/:id/analysis per
    // file. Empty array when the call had no flags — keeps the payload shape
    // stable for clients that already key off `flags?.length`.
    broadcastCallUpdate(callId, "completed", {
      step: 6,
      totalSteps: 6,
      label: "Complete",
      flags: Array.isArray(analysis.flags) ? (analysis.flags as string[]) : [],
    });
    logger.info("pipeline: processing finished successfully", { callId });

  } catch (error) {
    logger.error("pipeline: critical error during audio processing", { callId, error: (error as Error).message });
    captureException(error instanceof Error ? error : new Error(String(error)), { callId, step: "processAudioFile" });

    try {
      await storage.updateCall(callId, { status: "failed" });
    } catch (updateErr) {
      logger.error("pipeline: failed to update call status to failed", { callId, error: (updateErr as Error).message });
    }

    broadcastCallUpdate(callId, "failed", { label: "Processing failed" });

    // Trigger call.failed webhook (non-blocking)
    triggerWebhook("call.failed", {
      callId,
      error: (error as Error).message,
      fileName: originalName,
    }).catch(err => {
        logger.warn("pipeline: webhook delivery failed", { callId, event: "call.failed", error: (err as Error).message });
        captureException(err as Error, { callId, errorType: "webhook_delivery" });
      });
  } finally {
    // Always attempt file cleanup, even if error handling itself fails
    await cleanupFile(filePath);
  }
}

/**
 * Generate and store a Bedrock Titan embedding for a call.
 * Non-blocking — failures don't affect the main pipeline.
 */
async function generateCallEmbedding(callId: string, text: string): Promise<void> {
  const { BedrockProvider } = await import("../services/bedrock");
  const provider = new BedrockProvider();
  const embedding = await provider.generateEmbedding(text);
  if (embedding && embedding.length > 0) {
    const existing = await storage.getCallAnalysis(callId);
    if (existing) {
      await storage.updateCallAnalysis(callId, { embedding });
      logger.info("pipeline: embedding stored", { callId, dim: embedding.length });
    }
  }
}
