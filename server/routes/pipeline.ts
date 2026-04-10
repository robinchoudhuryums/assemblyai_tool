import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { assemblyAIService, buildSpeakerLabeledTranscript, computeUtteranceMetrics } from "../services/assemblyai";
import { aiProvider } from "../services/ai-factory";
import { calibrateScore, calibrateSubScores, getCalibrationConfig } from "../services/scoring-calibration";
import { buildAnalysisPrompt } from "../services/ai-provider";
import { fetchRagContext, buildRagQuery, isRagEnabled, type RagSource } from "../services/rag-client";
import { detectTranscriptInjection, detectOutputAnomaly } from "../services/prompt-guard";
import { broadcastCallUpdate } from "../services/websocket";
import { bedrockBatchService, type PendingBatchItem } from "../services/bedrock-batch";
import { type UsageRecord } from "@shared/schema";
import { randomUUID } from "crypto";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, TaskQueue, computeConfidenceScore, autoAssignEmployee } from "./utils";
import {
  MIN_CALL_DURATION_FOR_AI_SEC,
  HAIKU_SHORT_CALL_MAX_SEC,
  HAIKU_SHORT_CALL_MAX_TOKENS,
} from "../constants";
import { checkAndCreateCoachingAlert } from "../services/coaching-alerts";
import { triggerWebhook } from "../services/webhooks";
import { captureException } from "../services/sentry";
import { evaluateBadges } from "../services/gamification";

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
    console.warn(`[STARTUP] ${label}=${raw} is not HH:MM format — batch schedule window disabled.`);
    return null;
  }
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    console.warn(`[STARTUP] ${label}=${raw} is out of range — batch schedule window disabled.`);
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
  console.log(`[${callId}] Starting audio processing...`);
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
        console.log(`[${callId}] Step 1/7: Using pre-signed S3 URL for AssemblyAI (skipping upload).`);
      } else {
        console.log(`[${callId}] Step 1/7: Pre-signed URL unavailable, uploading to AssemblyAI...`);
        audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath || originalName));
      }
    } else {
      console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
      audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath || originalName));
    }
    console.log(`[${callId}] Step 1/7: Audio URL ready.`);

    // Step 1b: Archive audio to cloud storage (skip if already archived by job queue)
    // A23/F82: reuse existingAudioFiles from step 1a — no mutation between steps.
    if (existingAudioFiles.length === 0) {
      console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
      try {
        await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
        console.log(`[${callId}] Step 1b/7: Audio archived.`);
      } catch (archiveError) {
        // A23/F83: log the error properly instead of dropping it into stringification
        console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, (archiveError as Error).message);
        captureException(archiveError as Error, { callId, errorType: "audio_archive_failed" });
      }
    } else {
      console.log(`[${callId}] Step 1b/7: Audio already archived, skipping.`);
    }

    // Step 2: Start transcription (with agent name word boost for correct spelling)
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." });
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);

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
      const companyName = process.env.COMPANY_NAME || "UMS";
      for (const word of companyName.split(/[\s()]+/).filter(Boolean)) {
        nameWords.add(word);
      }
      if (nameWords.size > 0) {
        wordBoost = Array.from(nameWords).slice(0, 100);
      }
    } catch (boostErr) {
      console.warn(`[${callId}] Failed to build word boost list (non-blocking):`, (boostErr as Error).message);
    }

    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl, wordBoost, language);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Wait for transcription completion (webhook if available, polling fallback)
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." });
    console.log(`[${callId}] Step 3/7: Waiting for transcript results...`);
    const transcriptResponse = await assemblyAIService.waitForTranscript(transcriptId);

    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Compute call duration from word-level data
    const callDurationSeconds = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);

    // Quality gate: skip AI analysis for empty/near-empty transcripts (prevents wasted Bedrock spend)
    const transcriptText = (transcriptResponse.text || "").trim();
    if (transcriptText.length < 10) {
      console.warn(`[${callId}] Empty transcript (${transcriptText.length} chars) — skipping AI analysis.`);

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
      broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete (empty transcript)" });
      console.log(`[${callId}] Completed with empty_transcript flag. AI analysis skipped.`);
      return;
    }

    // Quality gate: skip AI analysis for very low-confidence transcripts (#3)
    const transcriptConfidenceValue = transcriptResponse.confidence || 0;
    if (transcriptConfidenceValue < 0.6 && transcriptConfidenceValue > 0) {
      console.warn(`[${callId}] Low transcript confidence (${(transcriptConfidenceValue * 100).toFixed(0)}%) — skipping AI analysis to avoid unreliable scoring.`);

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
      broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete (low quality transcript)" });
      console.log(`[${callId}] Completed with low_transcript_quality flag. AI analysis skipped.`);
      return;
    }

    // Build speaker-labeled transcript for AI analysis (#1)
    let speakerLabeledText = transcriptResponse.text || "";
    if (transcriptResponse.words && transcriptResponse.words.length > 0) {
      const labeled = buildSpeakerLabeledTranscript(transcriptResponse.words);
      if (labeled) {
        speakerLabeledText = labeled;
        console.log(`[${callId}] Built speaker-labeled transcript (${speakerLabeledText.length} chars)`);
      }
    }

    // Compute utterance-level metrics (#5)
    const utteranceMetrics = computeUtteranceMetrics(transcriptResponse.words || []);

    // Step 4: AI analysis (Bedrock/Claude — or fall back to defaults)
    broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." });
    let aiAnalysis = null;

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
          console.log(`[${callId}] Using custom prompt template: ${tmpl.name}`);
        }
      } catch (tmplError) {
        console.warn(`[${callId}] Failed to load prompt template (using defaults):`, (tmplError as Error).message);
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
          console.log(`[${callId}] RAG context retrieved (${ragContext.length} chars, ${ragSources.length} sources, confidence: ${ragResult.confidence})`);
        }
      } catch (ragErr) {
        console.warn(`[${callId}] RAG context fetch failed (non-blocking):`, (ragErr as Error).message);
      }
    })();

    // Injection detection runs in parallel with RAG fetch
    if (speakerLabeledText) {
      const injectionCheck = detectTranscriptInjection(speakerLabeledText);
      if (injectionCheck.detected) {
        injectionDetected = true;
        console.warn(`[${callId}] ⚠ Prompt injection detected in transcript: ${injectionCheck.reasons.join("; ")}`);
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

      try {
        const s3Client = storage.getObjectStorageClient();
        if (s3Client) {
          await s3Client.uploadJson(`batch-inference/pending/${callId}.json`, {
            ...pendingItem,
            transcriptResponse: {
              text: transcriptResponse.text,
              confidence: transcriptResponse.confidence,
              words: transcriptResponse.words,
              sentiment_analysis_results: transcriptResponse.sentiment_analysis_results,
              status: transcriptResponse.status,
            },
          });
        }
        console.log(`[${callId}] Step 4/6: Deferred to batch analysis (50% cost savings).`);
        broadcastCallUpdate(callId, "awaiting_analysis", { step: 4, totalSteps: 6, label: "Queued for batch analysis..." });

        const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId);
        await storage.createTranscript(transcript);
        await storage.createSentimentAnalysis(sentiment);
        analysis.confidenceScore = "0.500"; // A24/F54: batch placeholder — we've verified transcription succeeded, not "unknown"
        analysis.confidenceFactors = {
          transcriptConfidence: transcriptResponse.confidence || 0,
          wordCount: transcriptResponse.words?.length || 0,
          callDurationSeconds,
          transcriptLength: (transcriptResponse.text || "").length,
          aiAnalysisCompleted: false,
          overallScore: 0.5,
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
          console.warn(`[${callId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
        }

        await cleanupFile(filePath);
        console.log(`[${callId}] Transcription complete, awaiting batch analysis.`);
        return;
      } catch (batchErr) {
        console.warn(`[${callId}] Failed to defer to batch (falling back to on-demand):`, (batchErr as Error).message);
      }
    }

    // Skip AI for very short calls (< 15 seconds) — likely noise, voicemail, or misdials
    const tooShortForAI = callDurationSeconds < MIN_CALL_DURATION_FOR_AI_SEC;

    if (tooShortForAI) {
      console.log(`[${callId}] Step 4/6: Skipping AI analysis (call too short: ${callDurationSeconds}s). Saves ~$0.05.`);
    } else if (aiProvider.isAvailable && speakerLabeledText) {
      try {
        const transcriptCharCount = speakerLabeledText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name}). Transcript: ${transcriptCharCount} chars (~${estimatedTokens} tokens)`);

        if (estimatedTokens > 100000) {
          console.warn(`[${callId}] Very long transcript (${estimatedTokens} estimated tokens).`);
        }

        // Cost optimization: use Haiku for short routine calls (≤ 2min, no flags, no custom template)
        // Haiku is 3x cheaper for input, 3x cheaper for output — saves ~67% per call
        const isRoutineShort = callDurationSeconds <= HAIKU_SHORT_CALL_MAX_SEC && !promptTemplate && estimatedTokens < HAIKU_SHORT_CALL_MAX_TOKENS;
        let analysisProvider = aiProvider;
        if (isRoutineShort && !process.env.BEDROCK_MODEL?.includes("haiku")) {
          try {
            const { BedrockProvider } = await import("../services/bedrock");
            const haikuModel = "us.anthropic.claude-haiku-4-5-20251001";
            analysisProvider = BedrockProvider.createWithModel(haikuModel);
            // Rough rate differential: Sonnet $3/$15 per 1M vs Haiku $0.80/$4 per 1M.
            // Savings per call depend on in/out mix; ~70% is a typical ballpark
            // but left qualitative here rather than hard-coded.
            console.log(`[${callId}] Using Haiku for short routine call (${callDurationSeconds}s ≤ ${HAIKU_SHORT_CALL_MAX_SEC}s, ~${estimatedTokens} tokens)`);
          } catch (haikuErr) {
            console.warn(`[${callId}] Haiku provider creation failed, using default model:`, (haikuErr as Error).message);
          }
        }

        try {
          aiAnalysis = await analysisProvider.analyzeCallTranscript(speakerLabeledText, callId, callCategory, promptTemplate, language, callDurationSeconds, undefined, ragContext);
        } catch (firstErr) {
          // A12/F17: 1-retry budget on parse/schema failures. The first call may
          // have gotten a malformed response that a second try can recover.
          const firstMsg = (firstErr as Error).message || "";
          const isParseFailure = /JSON|parse|schema/i.test(firstMsg) && !/timeout|unavailable|ECONNREFUSED|ETIMEDOUT|throttl/i.test(firstMsg);
          if (isParseFailure) {
            console.warn(`[${callId}] AI parse failure on first attempt, retrying once:`, firstMsg);
            aiAnalysis = await analysisProvider.analyzeCallTranscript(speakerLabeledText, callId, callCategory, promptTemplate, language, callDurationSeconds, undefined, ragContext);
          } else {
            throw firstErr;
          }
        }
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        const errMsg = (aiError as Error).message || "";
        const isParseFailure =
          /JSON|parse|schema/i.test(errMsg) && !/timeout|unavailable|ECONNREFUSED|ETIMEDOUT|throttl/i.test(errMsg);
        if (isParseFailure) {
          console.error(`[${callId}] AI returned unparseable response after retry (continuing with defaults):`, errMsg);
          captureException(aiError as Error, { callId, errorType: "ai_parse_failure" });
        } else {
          console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, errMsg);
          captureException(aiError as Error, { callId, errorType: "ai_unavailable" });
        }
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, skipping AI analysis.`);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." });
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);

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
        console.log(`[${callId}] Agent "${aiAnalysis.detected_agent_name}" identified as Speaker ${agentSpeakerLabel}`);
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

    // Prompt injection: flag if injection was detected in transcript
    if (injectionDetected) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push("prompt_injection_detected");
      analysis.flags = existingFlags;
      console.warn(`[${callId}] Flagged: prompt injection detected in transcript`);
    }

    // Output anomaly: check if AI response shows signs of injection bypass
    if (aiAnalysis && analysis.summary) {
      const rawOutputText = `${analysis.summary || ""} ${(analysis.actionItems || []).join(" ")} ${(analysis.feedback?.strengths || []).join(" ")} ${(analysis.feedback?.suggestions || []).join(" ")}`;
      const outputCheck = detectOutputAnomaly(rawOutputText);
      if (outputCheck.anomaly) {
        const existingFlags = (analysis.flags as string[]) || [];
        existingFlags.push(`output_anomaly:${outputCheck.reason}`);
        analysis.flags = existingFlags;
        console.warn(`[${callId}] Flagged: output anomaly — ${outputCheck.reason}`);
      }
    }

    console.log(`[${callId}] Step 5/6: Data processing complete. Confidence: ${(confidenceScore * 100).toFixed(0)}%`);

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." });
    console.log(`[${callId}] Step 6/6: Saving analysis results...`);
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
          console.warn(`[${callId}] Embedding generation failed (non-blocking):`, err.message);
          captureException(err as Error, { callId, errorType: "embedding_generation" });
        });
      }
    }

    // Auto-assign to employee based on detected agent name (shared logic from utils.ts)
    let autoAssigned = false;
    if (aiAnalysis?.detected_agent_name) {
      const result = await autoAssignEmployee(callId, aiAnalysis.detected_agent_name, storage, `[${callId}] `);
      autoAssigned = result.assigned;
    }

    await storage.updateCall(callId, {
      status: "completed",
      duration: callDurationSeconds, // A23/F56 dedup
      ...(autoCategoryToApply ? { callCategory: autoCategoryToApply } : {}),
    });
    if (autoCategoryToApply) {
      console.log(`[${callId}] Auto-categorized as: ${autoCategoryToApply}`);
    }
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${autoAssigned ? " (auto-assigned)" : ""}`);

    // A23/F57: fetch completed call once and reuse across coaching and webhook blocks.
    const completedCall = await storage.getCall(callId);
    const performanceScoreNum = parseFloat(analysis.performanceScore || "0");

    // Auto-generate coaching alerts for low/high scores (non-blocking)
    try {
      const performanceScore = performanceScoreNum;
      const finalEmployeeId = completedCall?.employeeId;
      const callSummary = (analysis.summary as string) || "";
      // A12/F11/F21: pass the freshly-built analysis through so the
      // coaching service doesn't re-fetch it from storage.
      checkAndCreateCoachingAlert(callId, performanceScore, finalEmployeeId, callSummary, ragSources, {
        feedback: analysis.feedback,
        subScores: analysis.subScores,
        flags: analysis.flags,
      }).catch(err => {
        console.warn(`[${callId}] Coaching alert failed (non-blocking):`, (err as Error).message);
        captureException(err as Error, { callId, errorType: "coaching_alert" });
      });

      // Gamification: evaluate badges (non-blocking)
      if (finalEmployeeId) {
        const subScores = analysis.subScores as { compliance?: number; customerExperience?: number; communication?: number; resolution?: number } | undefined;
        evaluateBadges(callId, finalEmployeeId, performanceScore, subScores).catch(err => {
          console.warn(`[${callId}] Badge evaluation failed (non-blocking):`, (err as Error).message);
          captureException(err as Error, { callId, errorType: "badge_evaluation" });
        });
      }

      // Best practice auto-ingestion: send exceptional calls (≥9.0) to the KB
      if (performanceScore >= 9.0) {
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
            console.warn(`[${callId}] Best-practice ingestion failed (non-blocking):`, (err as Error).message);
            captureException(err as Error, { callId, errorType: "best_practice_ingest" });
          });
        }).catch((err) => {
          console.warn(`[${callId}] Best-practice ingest module import failed:`, (err as Error).message);
        });
      }
    } catch (alertErr) {
      console.warn(`[${callId}] Coaching alert check failed (non-blocking):`, (alertErr as Error).message);
      captureException(alertErr as Error, { callId, errorType: "coaching_alert_setup" });
    }

    // Trigger webhooks (non-blocking)
    try {
      const employeeId = completedCall?.employeeId;
      let employeeName: string | undefined;
      if (employeeId) {
        try {
          const emp = await storage.getEmployee(employeeId);
          employeeName = emp?.name;
        } catch (empErr) {
          console.warn(`[${callId}] Failed to look up employee name for webhook:`, (empErr as Error).message);
        }
      }

      // call.completed
      triggerWebhook("call.completed", {
        callId,
        score: performanceScoreNum,
        sentiment: sentiment.overallSentiment,
        duration: callDurationSeconds,
        employee: employeeName || undefined,
        fileName: originalName,
      }).catch(err => {
        console.warn(`[WEBHOOK] Delivery failed:`, (err as Error).message);
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
          console.warn(`[WEBHOOK] Delivery failed:`, (err as Error).message);
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
          console.warn(`[WEBHOOK] Delivery failed:`, (err as Error).message);
          captureException(err as Error, { callId, errorType: "webhook_delivery" });
        });
      }
    } catch (webhookErr) {
      console.warn(`[${callId}] Webhook trigger failed (non-blocking):`, (webhookErr as Error).message);
    }

    // Track usage/cost
    try {
      const audioDuration = callDurationSeconds || 0;
      const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
      const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
      const estimatedOutputTokens = 800;
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const bedrockCost = (aiAnalysis !== null)
        ? (estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) ?? 0)
        : 0;

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
            estimatedCost: Math.round(bedrockCost * 10000) / 10000,
          } : undefined,
        },
        totalEstimatedCost: Math.round((assemblyaiCost + bedrockCost) * 10000) / 10000,
      };
      await storage.createUsageRecord(usageRecord);
    } catch (usageErr) {
      console.warn(`[${callId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
    }

    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" });
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, (error as Error).message);
    captureException(error instanceof Error ? error : new Error(String(error)), { callId, step: "processAudioFile" });

    try {
      await storage.updateCall(callId, { status: "failed" });
    } catch (updateErr) {
      console.error(`[${callId}] Failed to update call status to failed:`, (updateErr as Error).message);
    }

    broadcastCallUpdate(callId, "failed", { label: "Processing failed" });

    // Trigger call.failed webhook (non-blocking)
    triggerWebhook("call.failed", {
      callId,
      error: (error as Error).message,
      fileName: originalName,
    }).catch(err => {
        console.warn(`[WEBHOOK] Delivery failed:`, (err as Error).message);
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
      console.log(`[${callId}] Embedding stored (${embedding.length}-dim)`);
    }
  }
}
