/**
 * Tests for the audio processing pipeline: processTranscriptData,
 * buildSpeakerLabeledTranscript, normalizeStringArray, and auto-assign logic.
 * Run with: npx tsx --test tests/pipeline.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AssemblyAIService, buildSpeakerLabeledTranscript } from "../server/services/assemblyai.js";
import type { AssemblyAIResponse } from "../server/services/assemblyai.js";
import type { CallAnalysis } from "../server/services/ai-provider.js";

const service = new AssemblyAIService({ apiKey: "test", baseUrl: "http://localhost" });

// ── processTranscriptData ─────────────────────────────────

describe("processTranscriptData", () => {
  const baseTranscript: AssemblyAIResponse = {
    id: "aai-123",
    status: "completed",
    text: "Hello, how can I help you today?",
    confidence: 0.95,
    words: [
      { text: "Hello,", start: 0, end: 500, confidence: 0.98, speaker: "A" },
      { text: "how", start: 510, end: 700, confidence: 0.97, speaker: "A" },
      { text: "can", start: 710, end: 900, confidence: 0.96, speaker: "A" },
      { text: "I", start: 910, end: 1000, confidence: 0.99, speaker: "A" },
      { text: "help", start: 1010, end: 1200, confidence: 0.97, speaker: "A" },
      { text: "you", start: 1210, end: 1400, confidence: 0.98, speaker: "A" },
      { text: "today?", start: 1410, end: 1800, confidence: 0.95, speaker: "A" },
    ],
    sentiment_analysis_results: [
      { text: "Hello, how can I help you today?", sentiment: "POSITIVE", confidence: 0.9, start: 0, end: 1800 },
    ],
  };

  const baseAI: CallAnalysis = {
    summary: "Agent greeted caller",
    topics: ["greeting", "customer_service"],
    sentiment: "positive",
    sentiment_score: 0.85,
    performance_score: 8.0,
    sub_scores: { compliance: 8, customer_experience: 9, communication: 8, resolution: 7 },
    action_items: ["Follow up in 2 days"],
    feedback: { strengths: ["Great empathy"], suggestions: ["Shorter hold time"] },
    call_party_type: "customer",
    flags: [],
    detected_agent_name: "Sarah",
  };

  it("builds transcript, sentiment, and analysis from full AI response", () => {
    const { transcript, sentiment, analysis } = service.processTranscriptData(baseTranscript, baseAI, "call-1");

    assert.equal(transcript.callId, "call-1");
    assert.equal(transcript.text, "Hello, how can I help you today?");
    assert.equal(transcript.confidence, "0.95");

    assert.equal(sentiment.overallSentiment, "positive");
    assert.equal(sentiment.overallScore, "0.85");

    assert.equal(analysis.performanceScore, "8");
    assert.deepEqual(analysis.topics, ["greeting", "customer_service"]);
    assert.equal(analysis.summary, "Agent greeted caller");
    assert.deepEqual(analysis.actionItems, ["Follow up in 2 days"]);
  });

  it("falls back to AssemblyAI sentiment when no AI analysis", () => {
    const { sentiment } = service.processTranscriptData(baseTranscript, null, "call-2");
    // With 1 positive sentiment result out of 1, should be positive
    assert.equal(sentiment.overallSentiment, "positive");
  });

  it("defaults to neutral sentiment when no AI and no sentiment results", () => {
    const noSentiment: AssemblyAIResponse = {
      ...baseTranscript,
      sentiment_analysis_results: undefined,
    };
    const { sentiment } = service.processTranscriptData(noSentiment, null, "call-3");
    assert.equal(sentiment.overallSentiment, "neutral");
  });

  it("adds low_score flag when performance <= 2.0", () => {
    const lowScoreAI: CallAnalysis = {
      ...baseAI,
      performance_score: 1.5,
      flags: [],
    };
    const { analysis } = service.processTranscriptData(baseTranscript, lowScoreAI, "call-4");
    assert.ok(analysis.flags?.includes("low_score"), "Should have low_score flag");
  });

  it("adds exceptional_call flag when performance >= 9.0", () => {
    const highScoreAI: CallAnalysis = {
      ...baseAI,
      performance_score: 9.5,
      flags: [],
    };
    const { analysis } = service.processTranscriptData(baseTranscript, highScoreAI, "call-5");
    assert.ok(analysis.flags?.includes("exceptional_call"), "Should have exceptional_call flag");
  });

  it("calculates talk time ratio from speaker labels", () => {
    // A4: talkTimeRatio is null until an agent speaker label is supplied. Pass "A" since
    // baseTranscript's words are all speaker A.
    const { analysis } = service.processTranscriptData(baseTranscript, baseAI, "call-6", "A");
    const ratio = parseFloat(analysis.talkTimeRatio!);
    assert.ok(ratio > 0.9, `Expected high ratio for all-A speakers, got ${ratio}`);
  });

  it("handles mixed speakers for talk time ratio", () => {
    const mixedWords: AssemblyAIResponse = {
      ...baseTranscript,
      words: [
        { text: "Hello", start: 0, end: 500, confidence: 0.98, speaker: "A" },
        { text: "Hi", start: 600, end: 1000, confidence: 0.97, speaker: "B" },
      ],
    };
    // A4: explicit agent speaker label required.
    const { analysis } = service.processTranscriptData(mixedWords, baseAI, "call-7", "A");
    const ratio = parseFloat(analysis.talkTimeRatio!);
    assert.ok(ratio > 0 && ratio < 1, `Expected ratio between 0 and 1, got ${ratio}`);
  });

  it("normalizes AI objects in topic arrays to strings", () => {
    const objectTopics: CallAnalysis = {
      ...baseAI,
      topics: [{ text: "billing" }, "returns", { name: "shipping" }] as unknown as string[],
    };
    const { analysis } = service.processTranscriptData(baseTranscript, objectTopics, "call-8");
    assert.deepEqual(analysis.topics, ["billing", "returns", "shipping"]);
  });

  it("normalizes AI objects in action_items to strings", () => {
    const objectActions: CallAnalysis = {
      ...baseAI,
      action_items: [{ task: "Call back tomorrow" }, "Send invoice"] as unknown as string[],
    };
    const { analysis } = service.processTranscriptData(baseTranscript, objectActions, "call-9");
    assert.deepEqual(analysis.actionItems, ["Call back tomorrow", "Send invoice"]);
  });

  it("Audio-F1: writes 0 + ai_unavailable:no_analysis flag when AI returns null (no fabricated 5.0)", () => {
    const { analysis } = service.processTranscriptData(baseTranscript, null, "call-10");
    // Was previously 5.0 — that fallback masked AI failures and poisoned
    // dashboards / coaching with fabricated mid-range scores. Now the
    // pipeline sets 0 + the ai_unavailable flag so downstream readers
    // can detect skipped-AI calls and skip side-effects.
    assert.equal(analysis.performanceScore, "0");
    const flags = (analysis.flags as string[]) || [];
    assert.ok(
      flags.includes("ai_unavailable:no_analysis"),
      `expected ai_unavailable:no_analysis flag, got ${JSON.stringify(flags)}`,
    );
  });

  it("uses first 500 chars of transcript as summary when AI is null", () => {
    const { analysis } = service.processTranscriptData(baseTranscript, null, "call-11");
    assert.equal(analysis.summary, "Hello, how can I help you today?");
  });
});

// ── buildSpeakerLabeledTranscript ─────────────────────────

describe("buildSpeakerLabeledTranscript", () => {
  it("groups consecutive words by same speaker", () => {
    const words = [
      { text: "Hello", start: 0, end: 500, confidence: 0.9, speaker: "A" },
      { text: "there", start: 510, end: 800, confidence: 0.9, speaker: "A" },
      { text: "Hi", start: 1000, end: 1300, confidence: 0.9, speaker: "B" },
      { text: "thanks", start: 1310, end: 1600, confidence: 0.9, speaker: "B" },
    ];

    const result = buildSpeakerLabeledTranscript(words);
    assert.ok(result.includes("Speaker A: Hello there"));
    assert.ok(result.includes("Speaker B: Hi thanks"));
  });

  it("handles speaker changes correctly", () => {
    const words = [
      { text: "One", start: 0, end: 200, confidence: 0.9, speaker: "A" },
      { text: "Two", start: 300, end: 500, confidence: 0.9, speaker: "B" },
      { text: "Three", start: 600, end: 800, confidence: 0.9, speaker: "A" },
    ];

    const result = buildSpeakerLabeledTranscript(words);
    const lines = result.split("\n").filter(l => l.trim());
    assert.equal(lines.length, 3);
  });

  it("returns empty string for empty words array", () => {
    assert.equal(buildSpeakerLabeledTranscript([]), "");
  });

  it("handles missing speaker labels", () => {
    const words = [
      { text: "Hello", start: 0, end: 500, confidence: 0.9 },
      { text: "world", start: 510, end: 800, confidence: 0.9 },
    ];

    const result = buildSpeakerLabeledTranscript(words);
    assert.ok(result.includes("Hello world"));
  });
});
