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
export function shouldUseBatchMode(perUploadOverride?: string): boolean {
  if (perUploadOverride === "immediate") return false;
  if (perUploadOverride === "batch") return bedrockBatchService.isAvailable;
  if (!bedrockBatchService.isAvailable) return false;

  const scheduleStart = process.env.BATCH_SCHEDULE_START;
  const scheduleEnd = process.env.BATCH_SCHEDULE_END;

  if (scheduleStart && scheduleEnd) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = scheduleStart.split(":").map(Number);
    const [endH, endM] = scheduleEnd.split(":").map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    if (startMinutes <= endMinutes) {
      // Same-day window (e.g., 09:00–17:00): active between start and end
      if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
    } else {
      // Overnight window (e.g., 22:00–06:00): active from start to midnight, and midnight to end
      // Inactive only between endMinutes and startMinutes
      if (currentMinutes >= endMinutes && currentMinutes < startMinutes) return false;
    }
  }

  return true;
}

/** Process audio file with AssemblyAI and archive to cloud storage */
export async function processAudioFile(
  callId: string,
  filePath: string,
  audioBuffer: Buffer,
  originalName: string,
  mimeType: string,
  callCategory?: string,
  uploadedBy?: string,
  processingMode?: string,
  language?: string,
) {
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
        audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      }
    } else {
      console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
      audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    }
    console.log(`[${callId}] Step 1/7: Audio URL ready.`);

    // Step 1b: Archive audio to cloud storage (skip if already archived by job queue)
    const existingAudio = await storage.getAudioFiles(callId);
    if (existingAudio.length === 0) {
      console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
      try {
        await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
        console.log(`[${callId}] Step 1b/7: Audio archived.`);
      } catch (archiveError) {
        console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, archiveError);
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
        analysis.confidenceScore = "0.300";
        analysis.confidenceFactors = {
          transcriptConfidence: transcriptResponse.confidence || 0,
          wordCount: transcriptResponse.words?.length || 0,
          callDurationSeconds: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
          transcriptLength: (transcriptResponse.text || "").length,
          aiAnalysisCompleted: false,
          overallScore: 0.3,
        };
        const existingFlags = (analysis.flags as string[]) || [];
        existingFlags.push("awaiting_batch_analysis");
        analysis.flags = existingFlags;
        await storage.createCallAnalysis(analysis);

        await storage.updateCall(callId, {
          status: "awaiting_analysis",
          duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
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
    const tooShortForAI = callDurationSeconds < 15;

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
        const isRoutineShort = callDurationSeconds <= 120 && !promptTemplate && estimatedTokens < 3000;
        let analysisProvider = aiProvider;
        if (isRoutineShort && !process.env.BEDROCK_MODEL?.includes("haiku")) {
          try {
            const { BedrockProvider } = await import("../services/bedrock");
            const haikuModel = "us.anthropic.claude-haiku-4-5-20251001";
            analysisProvider = BedrockProvider.createWithModel(haikuModel);
            console.log(`[${callId}] Using Haiku for short routine call (${callDurationSeconds}s ≤ 120s, ~${estimatedTokens} tokens) — 67% cost savings`);
          } catch (haikuErr) {
            console.warn(`[${callId}] Haiku provider creation failed, using default model:`, (haikuErr as Error).message);
          }
        }

        aiAnalysis = await analysisProvider.analyzeCallTranscript(speakerLabeledText, callId, callCategory, promptTemplate, language, callDurationSeconds, undefined, ragContext);
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        const errMsg = (aiError as Error).message || "";
        const isParseFailure = errMsg.includes("malformed JSON") || errMsg.includes("did not contain valid JSON") || errMsg.includes("failed schema validation");
        if (isParseFailure) {
          console.error(`[${callId}] AI returned unparseable response (continuing with defaults):`, errMsg);
          captureException(aiError as Error, { callId, errorType: "ai_parse_failure" });
        } else {
          console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, errMsg);
          captureException(aiError as Error, { callId, errorType: "ai_unavailable" });
        }
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." });
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);

    // Compute confidence score (shared formula from utils.ts)
    const { score: confidenceScore, factors: confidenceFactors } = computeConfidenceScore(
      {
        transcriptConfidence: transcriptResponse.confidence || 0,
        wordCount: transcriptResponse.words?.length || 0,
        callDurationSeconds,
        hasAiAnalysis: aiAnalysis !== null,
      },
      (transcriptResponse.text || "").length,
    );

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

      // Named speaker identification (#6): determine which speaker (A/B) is the agent
      if (transcriptResponse.words && transcriptResponse.words.length > 0) {
        const detectedName = aiAnalysis.detected_agent_name.toLowerCase();
        // Look for the agent's name in the first 50 words to identify their speaker label
        const earlyWords = transcriptResponse.words.slice(0, 50);
        for (let i = 0; i < earlyWords.length; i++) {
          const w = earlyWords[i];
          if (w.text.toLowerCase().includes(detectedName) ||
              (i > 0 && `${earlyWords[i - 1].text} ${w.text}`.toLowerCase().includes(detectedName))) {
            const agentSpeaker = w.speaker || "?";
            console.log(`[${callId}] Agent "${aiAnalysis.detected_agent_name}" identified as Speaker ${agentSpeaker}`);
            // Store agent speaker label in analysis for downstream use
            if (!analysis.confidenceFactors) analysis.confidenceFactors = {};
            (analysis.confidenceFactors as Record<string, unknown>).agentSpeakerLabel = agentSpeaker;
            break;
          }
        }
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

    // Auto-categorize if no category was provided at upload and AI returned one
    if (!callCategory && aiAnalysis?.call_category) {
      const validCategories = ["inbound", "outbound", "internal", "vendor"] as const;
      type ValidCategory = typeof validCategories[number];
      if (validCategories.includes(aiAnalysis.call_category as ValidCategory)) {
        try {
          await storage.updateCall(callId, { callCategory: aiAnalysis.call_category as ValidCategory });
          console.log(`[${callId}] Auto-categorized as: ${aiAnalysis.call_category}`);
        } catch (catErr) {
          console.warn(`[${callId}] Failed to auto-categorize (non-blocking):`, (catErr as Error).message);
        }
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
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${autoAssigned ? " (auto-assigned)" : ""}`);

    // Auto-generate coaching alerts for low/high scores (non-blocking)
    try {
      const performanceScore = parseFloat(analysis.performanceScore || "0");
      const completedCall = await storage.getCall(callId);
      const finalEmployeeId = completedCall?.employeeId;
      const callSummary = (analysis.summary as string) || "";
      checkAndCreateCoachingAlert(callId, performanceScore, finalEmployeeId, callSummary, ragSources).catch(err => {
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
          }).catch(() => {}); // fire-and-forget
        }).catch(() => {});
      }
    } catch (alertErr) {
      console.warn(`[${callId}] Coaching alert check failed (non-blocking):`, (alertErr as Error).message);
      captureException(alertErr as Error, { callId, errorType: "coaching_alert_setup" });
    }

    // Trigger webhooks (non-blocking)
    try {
      const performanceScoreNum = parseFloat(analysis.performanceScore || "0");
      const finalCallForWebhook = await storage.getCall(callId);
      const employeeId = finalCallForWebhook?.employeeId;
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
      const bedrockCost = (aiAnalysis !== null) ? estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) : 0;

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
