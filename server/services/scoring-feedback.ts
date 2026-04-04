/**
 * Scoring Feedback Loop
 *
 * When managers override AI scores (edit analysis), this captures the correction
 * as a structured "lesson" that improves future RAG-grounded analysis.
 *
 * Corrections are stored locally and can be pushed to the Knowledge Base as
 * reference documents. The RAG client retrieves them alongside company policies
 * so the AI learns from past mistakes.
 *
 * Flow:
 * 1. Manager edits a call's performance_score or sub_scores with a reason
 * 2. This module captures the correction context (what AI scored, what human corrected)
 * 3. Corrections are stored in S3 under `corrections/` prefix (or in-memory)
 * 4. fetchRagContext() includes recent corrections in prompts via the KB
 * 5. Over time, the AI's scoring aligns with human judgment
 */

import { storage } from "../storage";
import { fetchRagContext, isRagEnabled, type RagSource } from "./rag-client";
import { logger } from "./logger";

export interface ScoringCorrection {
  id: string;
  callId: string;
  callCategory?: string;
  correctedBy: string;
  correctedAt: string;
  reason: string;
  /** What the AI originally scored */
  originalScore: number;
  /** What the manager corrected it to */
  correctedScore: number;
  /** Direction of correction */
  direction: "upgraded" | "downgraded";
  /** Sub-scores that were changed */
  subScoreChanges?: Record<string, { original: number; corrected: number }>;
  /** Call summary for context */
  callSummary?: string;
  /** Topics from the call */
  topics?: string[];
}

// In-memory corrections store (persisted to S3 when available)
const corrections: ScoringCorrection[] = [];
const MAX_CORRECTIONS = 200; // Keep last 200 corrections in memory

/**
 * Record a scoring correction when a manager edits a call's analysis.
 * Called from the PATCH /api/calls/:id/analysis route.
 */
export async function recordScoringCorrection(params: {
  callId: string;
  correctedBy: string;
  reason: string;
  originalScore: number;
  correctedScore: number;
  subScoreChanges?: Record<string, { original: number; corrected: number }>;
}): Promise<void> {
  const { callId, correctedBy, reason, originalScore, correctedScore, subScoreChanges } = params;

  // Get call context for the correction
  let callCategory: string | undefined;
  let callSummary: string | undefined;
  let topics: string[] | undefined;
  try {
    const call = await storage.getCall(callId);
    callCategory = call?.callCategory || undefined;
    const analysis = await storage.getCallAnalysis(callId);
    callSummary = (analysis?.summary as string) || undefined;
    topics = Array.isArray(analysis?.topics) ? analysis.topics.map(t => typeof t === "string" ? t : String(t)) : undefined;
  } catch { /* non-critical */ }

  const correction: ScoringCorrection = {
    id: `corr-${Date.now()}`,
    callId,
    callCategory,
    correctedBy,
    correctedAt: new Date().toISOString(),
    reason,
    originalScore,
    correctedScore,
    direction: correctedScore > originalScore ? "upgraded" : "downgraded",
    subScoreChanges,
    callSummary,
    topics,
  };

  corrections.push(correction);
  if (corrections.length > MAX_CORRECTIONS) corrections.shift();

  logger.info("Scoring correction recorded", {
    callId,
    originalScore,
    correctedScore,
    direction: correction.direction,
    category: callCategory,
  });

  // Persist to S3 if available
  try {
    const s3Client = storage.getObjectStorageClient();
    if (s3Client) {
      await s3Client.uploadJson(`corrections/${correction.id}.json`, correction);
    }
  } catch {
    // Non-critical — correction is still in memory
  }
}

/**
 * Build a correction context string for injection into the RAG prompt.
 * Returns recent relevant corrections (by category) formatted as guidance.
 */
export function buildCorrectionContext(callCategory?: string): string | undefined {
  // Filter corrections relevant to this call category
  const relevant = corrections
    .filter(c => !callCategory || c.callCategory === callCategory)
    .slice(-10); // Last 10 relevant corrections

  if (relevant.length === 0) return undefined;

  const lines = relevant.map(c => {
    const dir = c.direction === "upgraded" ? "scored too low" : "scored too high";
    let line = `- Manager ${dir} a ${c.callCategory || "general"} call (${c.originalScore} → ${c.correctedScore}): "${c.reason}"`;
    if (c.subScoreChanges) {
      const changes = Object.entries(c.subScoreChanges)
        .map(([dim, { original, corrected }]) => `${dim}: ${original}→${corrected}`)
        .join(", ");
      line += ` [Sub-scores: ${changes}]`;
    }
    return line;
  });

  return `RECENT SCORING CORRECTIONS (learn from these manager overrides):\n${lines.join("\n")}`;
}

/**
 * Get correction statistics for admin dashboard.
 */
export function getCorrectionStats(): {
  total: number;
  upgrades: number;
  downgrades: number;
  avgDelta: number;
  byCategory: Record<string, number>;
} {
  const upgrades = corrections.filter(c => c.direction === "upgraded").length;
  const downgrades = corrections.filter(c => c.direction === "downgraded").length;
  const avgDelta = corrections.length > 0
    ? corrections.reduce((sum, c) => sum + Math.abs(c.correctedScore - c.originalScore), 0) / corrections.length
    : 0;

  const byCategory: Record<string, number> = {};
  for (const c of corrections) {
    const cat = c.callCategory || "unknown";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  return { total: corrections.length, upgrades, downgrades, avgDelta: Math.round(avgDelta * 10) / 10, byCategory };
}
