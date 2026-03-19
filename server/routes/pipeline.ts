import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { assemblyAIService, buildSpeakerLabeledTranscript, computeUtteranceMetrics } from "../services/assemblyai";
import { aiProvider } from "../services/ai-factory";
import { calibrateScore, calibrateSubScores, getCalibrationConfig } from "../services/scoring-calibration";
import { buildAnalysisPrompt } from "../services/ai-provider";
import { broadcastCallUpdate } from "../services/websocket";
import { bedrockBatchService, type PendingBatchItem } from "../services/bedrock-batch";
import { type UsageRecord } from "@shared/schema";
import { randomUUID } from "crypto";
import { cleanupFile, estimateBedrockCost, estimateAssemblyAICost, TaskQueue } from "./utils";
import { checkAndCreateCoachingAlert } from "../services/coaching-alerts";
import { triggerWebhook } from "../services/webhooks";

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
      if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
    } else {
      if (currentMinutes < startMinutes && currentMinutes >= endMinutes) return false;
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
      nameWords.add("UMS");
      if (nameWords.size > 0) {
        wordBoost = Array.from(nameWords).slice(0, 100);
      }
    } catch (boostErr) {
      console.warn(`[${callId}] Failed to build word boost list (non-blocking):`, (boostErr as Error).message);
    }

    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl, wordBoost, language);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." });
    console.log(`[${callId}] Step 3/7: Polling for transcript results...`);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Compute call duration from word-level data
    const callDurationSeconds = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);

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

    // Batch mode: defer AI analysis for 50% cost savings
    if (shouldUseBatchMode(processingMode) && aiProvider.isAvailable && speakerLabeledText) {
      const prompt = buildAnalysisPrompt(speakerLabeledText, callCategory, promptTemplate, language);
      const pendingItem: PendingBatchItem = {
        callId,
        prompt,
        callCategory,
        uploadedBy,
        timestamp: new Date().toISOString(),
      };

      try {
        const s3Client = (storage as any).audioClient || (storage as any).client;
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

    if (aiProvider.isAvailable && speakerLabeledText) {
      try {
        const transcriptCharCount = speakerLabeledText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name}). Transcript: ${transcriptCharCount} chars (~${estimatedTokens} tokens)`);

        if (estimatedTokens > 100000) {
          console.warn(`[${callId}] Very long transcript (${estimatedTokens} estimated tokens).`);
        }

        aiAnalysis = await aiProvider.analyzeCallTranscript(speakerLabeledText, callId, callCategory, promptTemplate, language, callDurationSeconds);
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, (aiError as Error).message);
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." });
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);

    // Compute confidence score
    const transcriptConfidence = transcriptResponse.confidence || 0;
    const wordCount = transcriptResponse.words?.length || 0;
    const callDuration = callDurationSeconds;
    const hasAiAnalysis = aiAnalysis !== null;

    const wordConfidence = Math.min(wordCount / 50, 1);
    const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
    const aiConfidence = hasAiAnalysis ? 1 : 0.3;

    const confidenceScore = (
      transcriptConfidence * 0.4 +
      wordConfidence * 0.2 +
      durationConfidence * 0.15 +
      aiConfidence * 0.25
    );

    const transcriptCharCount = (transcriptResponse.text || "").length;
    const confidenceFactors = {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: transcriptCharCount,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(confidenceScore * 100) / 100,
    };

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

    // Auto-categorize if no category was provided at upload and AI returned one
    if (!callCategory && aiAnalysis?.call_category) {
      const validCategories = ["inbound", "outbound", "internal", "vendor"];
      if (validCategories.includes(aiAnalysis.call_category)) {
        try {
          await storage.updateCall(callId, { callCategory: aiAnalysis.call_category });
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

    console.log(`[${callId}] Step 5/6: Data processing complete. Confidence: ${(confidenceScore * 100).toFixed(0)}%`);

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." });
    console.log(`[${callId}] Step 6/6: Saving analysis results...`);
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    // Auto-assign to employee based on detected agent name
    const currentCall = await storage.getCall(callId);
    let autoAssigned = false;
    if (!currentCall?.employeeId && aiAnalysis?.detected_agent_name) {
      const detectedName = aiAnalysis.detected_agent_name.trim();
      const matchedEmployee = await storage.findEmployeeByName(detectedName);

      if (matchedEmployee) {
        await storage.updateCall(callId, { employeeId: matchedEmployee.id });
        autoAssigned = true;
        console.log(`[${callId}] Auto-assigned to employee: ${matchedEmployee.name} (${matchedEmployee.id})`);
      } else {
        console.log(`[${callId}] Detected agent name "${detectedName}" but no matching employee found.`);
      }
    }

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${autoAssigned ? " (auto-assigned)" : ""}`);

    // Auto-generate coaching alerts for low/high scores (non-blocking)
    try {
      const performanceScore = parseFloat(analysis.performanceScore || "0");
      const finalCall = autoAssigned ? await storage.getCall(callId) : currentCall;
      const finalEmployeeId = finalCall?.employeeId;
      const callSummary = (analysis.summary as string) || "";
      checkAndCreateCoachingAlert(callId, performanceScore, finalEmployeeId, callSummary).catch(err => {
        console.warn(`[${callId}] Coaching alert failed (non-blocking):`, (err as Error).message);
      });
    } catch (alertErr) {
      console.warn(`[${callId}] Coaching alert check failed (non-blocking):`, (alertErr as Error).message);
    }

    // Trigger webhooks (non-blocking)
    try {
      const performanceScoreNum = parseFloat(analysis.performanceScore || "0");
      const finalCallForWebhook = autoAssigned ? await storage.getCall(callId) : currentCall;
      const employeeId = finalCallForWebhook?.employeeId;
      let employeeName: string | undefined;
      if (employeeId) {
        try {
          const emp = await storage.getEmployee(employeeId);
          employeeName = emp?.name;
        } catch {}
      }

      // call.completed
      triggerWebhook("call.completed", {
        callId,
        score: performanceScoreNum,
        sentiment: sentiment.overallSentiment,
        duration: callDuration,
        employee: employeeName || undefined,
        fileName: originalName,
      }).catch(() => {});

      // score.low (score <= 4)
      if (performanceScoreNum > 0 && performanceScoreNum <= 4) {
        triggerWebhook("score.low", {
          callId,
          score: performanceScoreNum,
          employee: employeeName || undefined,
          fileName: originalName,
        }).catch(() => {});
      }

      // score.exceptional (score >= 9)
      if (performanceScoreNum >= 9) {
        triggerWebhook("score.exceptional", {
          callId,
          score: performanceScoreNum,
          employee: employeeName || undefined,
          fileName: originalName,
        }).catch(() => {});
      }
    } catch (webhookErr) {
      console.warn(`[${callId}] Webhook trigger failed (non-blocking):`, (webhookErr as Error).message);
    }

    // Track usage/cost
    try {
      const audioDuration = callDuration || 0;
      const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
      const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
      const estimatedOutputTokens = 800;
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const bedrockCost = hasAiAnalysis ? estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) : 0;

      const usageRecord: UsageRecord = {
        id: randomUUID(),
        callId,
        type: "call",
        timestamp: new Date().toISOString(),
        user: uploadedBy || "unknown",
        services: {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
          bedrock: hasAiAnalysis ? {
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

    await cleanupFile(filePath);
    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" });
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, (error as Error).message);
    await storage.updateCall(callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" });

    // Trigger call.failed webhook (non-blocking)
    triggerWebhook("call.failed", {
      callId,
      error: (error as Error).message,
      fileName: originalName,
    }).catch(() => {});

    await cleanupFile(filePath);
  }
}
