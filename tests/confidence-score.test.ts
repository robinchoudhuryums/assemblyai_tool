/**
 * Tests for the confidence score calculation formula used in the audio processing pipeline.
 * Validates the weighted formula: transcript(0.4) + word(0.2) + duration(0.15) + AI(0.25)
 * Run with: npx tsx --test tests/confidence-score.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Replicate the confidence score formula from pipeline.ts (lines 330-345)
function computeConfidenceScore(params: {
  transcriptConfidence: number;
  wordCount: number;
  callDurationSeconds: number;
  hasAiAnalysis: boolean;
}): number {
  const { transcriptConfidence, wordCount, callDurationSeconds, hasAiAnalysis } = params;
  const wordConfidence = Math.min(wordCount / 50, 1);
  const durationConfidence = callDurationSeconds > 30 ? 1 : callDurationSeconds / 30;
  const aiConfidence = hasAiAnalysis ? 1 : 0.3;

  return (
    transcriptConfidence * 0.4 +
    wordConfidence * 0.2 +
    durationConfidence * 0.15 +
    aiConfidence * 0.25
  );
}

describe("confidence score formula", () => {
  it("returns maximum score (1.0) with perfect inputs", () => {
    const score = computeConfidenceScore({
      transcriptConfidence: 1.0,
      wordCount: 100,
      callDurationSeconds: 60,
      hasAiAnalysis: true,
    });
    assert.equal(score, 1.0);
  });

  it("returns correct score with no AI analysis (0.3 weight)", () => {
    const score = computeConfidenceScore({
      transcriptConfidence: 1.0,
      wordCount: 100,
      callDurationSeconds: 60,
      hasAiAnalysis: false,
    });
    // 1.0*0.4 + 1.0*0.2 + 1.0*0.15 + 0.3*0.25 = 0.4 + 0.2 + 0.15 + 0.075 = 0.825
    assert.equal(Math.round(score * 1000) / 1000, 0.825);
  });

  it("returns minimum meaningful score with zero inputs and no AI", () => {
    const score = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 0,
      callDurationSeconds: 0,
      hasAiAnalysis: false,
    });
    // 0*0.4 + 0*0.2 + 0*0.15 + 0.3*0.25 = 0.075
    assert.equal(Math.round(score * 1000) / 1000, 0.075);
  });

  it("word confidence caps at 1.0 for 50+ words", () => {
    const score50 = computeConfidenceScore({
      transcriptConfidence: 0.9,
      wordCount: 50,
      callDurationSeconds: 60,
      hasAiAnalysis: true,
    });
    const score200 = computeConfidenceScore({
      transcriptConfidence: 0.9,
      wordCount: 200,
      callDurationSeconds: 60,
      hasAiAnalysis: true,
    });
    assert.equal(score50, score200, "50 words and 200 words should give same word confidence");
  });

  it("word confidence scales linearly below 50 words", () => {
    const score25 = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 25,
      callDurationSeconds: 0,
      hasAiAnalysis: false,
    });
    const score50 = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 50,
      callDurationSeconds: 0,
      hasAiAnalysis: false,
    });
    // 25 words: wordConfidence = 0.5, contribution = 0.5*0.2 = 0.1
    // 50 words: wordConfidence = 1.0, contribution = 1.0*0.2 = 0.2
    // Both also get 0.075 from aiConfidence(0.3*0.25)
    assert.equal(Math.round(score25 * 1000) / 1000, 0.175);
    assert.equal(Math.round(score50 * 1000) / 1000, 0.275);
  });

  it("duration confidence caps at 1.0 for calls > 30 seconds", () => {
    const score30 = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 0,
      callDurationSeconds: 30,
      hasAiAnalysis: false,
    });
    const score120 = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 0,
      callDurationSeconds: 120,
      hasAiAnalysis: false,
    });
    assert.equal(score30, score120, "30s and 120s should give same duration confidence");
  });

  it("duration confidence scales linearly for short calls", () => {
    const score15 = computeConfidenceScore({
      transcriptConfidence: 0,
      wordCount: 0,
      callDurationSeconds: 15,
      hasAiAnalysis: false,
    });
    // 15/30 = 0.5, contribution = 0.5*0.15 = 0.075 + 0.075 (AI) = 0.15
    assert.equal(Math.round(score15 * 1000) / 1000, 0.15);
  });

  it("transcript confidence has the highest weight (0.4)", () => {
    // All else equal, changing transcript confidence has the biggest impact
    const base = computeConfidenceScore({
      transcriptConfidence: 0.5,
      wordCount: 25,
      callDurationSeconds: 15,
      hasAiAnalysis: true,
    });

    const withHighTranscript = computeConfidenceScore({
      transcriptConfidence: 1.0,
      wordCount: 25,
      callDurationSeconds: 15,
      hasAiAnalysis: true,
    });

    const delta = withHighTranscript - base;
    // 0.5 * 0.4 = 0.2 change
    assert.equal(Math.round(delta * 1000) / 1000, 0.2);
  });

  it("scores below 0.7 should trigger low_confidence flag", () => {
    // A realistic case: low transcript confidence, few words, short call, no AI
    const score = computeConfidenceScore({
      transcriptConfidence: 0.5,
      wordCount: 10,
      callDurationSeconds: 5,
      hasAiAnalysis: false,
    });
    // 0.5*0.4 + (10/50)*0.2 + (5/30)*0.15 + 0.3*0.25
    // = 0.2 + 0.04 + 0.025 + 0.075 = 0.34
    assert.ok(score < 0.7, `Score ${score} should be below 0.7 threshold`);
  });

  it("good production call exceeds 0.7 threshold", () => {
    // Typical good call: high confidence, 200 words, 3 min, AI complete
    const score = computeConfidenceScore({
      transcriptConfidence: 0.92,
      wordCount: 200,
      callDurationSeconds: 180,
      hasAiAnalysis: true,
    });
    // 0.92*0.4 + 1.0*0.2 + 1.0*0.15 + 1.0*0.25 = 0.368 + 0.2 + 0.15 + 0.25 = 0.968
    assert.ok(score > 0.7, `Score ${score} should exceed 0.7 threshold`);
  });
});
