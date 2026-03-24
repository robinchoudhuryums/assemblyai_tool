/**
 * Tests for AssemblyAI utility functions: computeUtteranceMetrics and buildSpeakerLabeledTranscript.
 * Pure functions — no network, no mocks needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeUtteranceMetrics,
  buildSpeakerLabeledTranscript,
} from "../server/services/assemblyai.js";
import type { TranscriptWord } from "../server/services/assemblyai.js";

// Helper to build word arrays quickly
function word(text: string, start: number, end: number, speaker: string, confidence = 0.95): TranscriptWord {
  return { text, start, end, confidence, speaker };
}

describe("buildSpeakerLabeledTranscript", () => {
  it("returns empty string for empty array", () => {
    assert.equal(buildSpeakerLabeledTranscript([]), "");
  });

  it("returns empty string for null-ish input", () => {
    assert.equal(buildSpeakerLabeledTranscript(null as any), "");
  });

  it("formats single speaker", () => {
    const words = [
      word("Hello", 0, 500, "A"),
      word("world", 600, 1000, "A"),
    ];
    assert.equal(buildSpeakerLabeledTranscript(words), "Speaker A: Hello world");
  });

  it("formats speaker changes", () => {
    const words = [
      word("Hi", 0, 300, "A"),
      word("there", 400, 700, "A"),
      word("Hello", 1000, 1400, "B"),
      word("back", 1500, 1800, "B"),
    ];
    const result = buildSpeakerLabeledTranscript(words);
    assert.equal(result, "Speaker A: Hi there\nSpeaker B: Hello back");
  });

  it("handles multiple speaker switches", () => {
    const words = [
      word("One", 0, 200, "A"),
      word("Two", 500, 700, "B"),
      word("Three", 1000, 1200, "A"),
    ];
    const result = buildSpeakerLabeledTranscript(words);
    const lines = result.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "Speaker A: One");
    assert.equal(lines[1], "Speaker B: Two");
    assert.equal(lines[2], "Speaker A: Three");
  });

  it("handles missing speaker labels with '?'", () => {
    const words = [
      { text: "Hello", start: 0, end: 300, confidence: 0.9 },
      { text: "world", start: 400, end: 700, confidence: 0.9 },
    ] as TranscriptWord[];
    const result = buildSpeakerLabeledTranscript(words);
    assert.ok(result.includes("Speaker ?:"));
  });

  it("handles single word", () => {
    const words = [word("Hello", 0, 300, "A")];
    assert.equal(buildSpeakerLabeledTranscript(words), "Speaker A: Hello");
  });
});

describe("computeUtteranceMetrics", () => {
  it("returns zeros for empty array", () => {
    const m = computeUtteranceMetrics([]);
    assert.equal(m.interruptionCount, 0);
    assert.equal(m.avgResponseLatencyMs, 0);
    assert.equal(m.monologueSegments, 0);
    assert.equal(m.questionCount, 0);
    assert.equal(m.speakerATalkTimeMs, 0);
    assert.equal(m.speakerBTalkTimeMs, 0);
  });

  it("returns zeros for single word", () => {
    const m = computeUtteranceMetrics([word("Hi", 0, 300, "A")]);
    assert.equal(m.interruptionCount, 0);
    assert.equal(m.avgResponseLatencyMs, 0);
  });

  it("detects interruptions (gap < 200ms on speaker change)", () => {
    const words = [
      word("I", 0, 500, "A"),
      word("think", 600, 900, "A"),
      word("No", 950, 1200, "B"), // gap = 950 - 900 = 50ms < 200ms → interruption
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.interruptionCount, 1);
  });

  it("does not count normal turn-taking as interruption (gap >= 200ms)", () => {
    const words = [
      word("Hello", 0, 500, "A"),
      word("Hi", 800, 1100, "B"), // gap = 800 - 500 = 300ms >= 200ms → normal
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.interruptionCount, 0);
  });

  it("computes response latency from positive gaps", () => {
    const words = [
      word("Hello", 0, 500, "A"),
      word("Hi", 1000, 1300, "B"),    // gap = 500ms
      word("How", 2000, 2300, "A"),    // gap = 700ms
    ];
    const m = computeUtteranceMetrics(words);
    // Two speaker switches with gaps 500 and 700 → avg = 600
    assert.equal(m.avgResponseLatencyMs, 600);
  });

  it("detects monologue segments (> 60 seconds of one speaker)", () => {
    // Speaker A talks for 65 seconds, then B responds
    const words = [
      word("Start", 0, 1000, "A"),
      word("end", 64000, 65000, "A"), // segment A: 65000 - 0 = 65000ms > 60000ms → monologue
      word("OK", 66000, 66500, "B"),
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.monologueSegments, 1);
  });

  it("does not count short segments as monologues", () => {
    const words = [
      word("Hello", 0, 500, "A"),
      word("there", 600, 1000, "A"),
      word("Hi", 2000, 2500, "B"),
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.monologueSegments, 0);
  });

  it("counts questions (words ending with ?)", () => {
    const words = [
      word("How", 0, 200, "A"),
      word("are", 300, 500, "A"),
      word("you?", 600, 900, "A"),
      word("Fine", 1200, 1500, "B"),
      word("right?", 1600, 1900, "B"),
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.questionCount, 2);
  });

  it("computes speaker talk times", () => {
    const words = [
      word("Hello", 0, 500, "A"),        // A segment: 500ms
      word("there", 600, 1000, "A"),      // still A, segment continues
      word("Hi", 2000, 2500, "B"),        // B segment: 500ms
      word("back", 2600, 3000, "B"),      // still B
      word("OK", 4000, 4500, "A"),        // A new segment: 500ms
    ];
    const m = computeUtteranceMetrics(words);
    // A first segment: 1000 - 0 = 1000ms, A second segment: 4500 - 4000 = 500ms → total 1500ms
    assert.equal(m.speakerATalkTimeMs, 1500);
    // B segment: 3000 - 2000 = 1000ms
    assert.equal(m.speakerBTalkTimeMs, 1000);
  });

  it("counts overlap as interruption (negative gap)", () => {
    const words = [
      word("Wait", 0, 1000, "A"),
      word("No", 800, 1200, "B"), // starts before A ends: gap = 800 - 1000 = -200 < 200 → interruption
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.interruptionCount, 1);
  });

  it("handles all same speaker — no interruptions, no response latency", () => {
    const words = [
      word("I", 0, 200, "A"),
      word("am", 300, 500, "A"),
      word("talking", 600, 1000, "A"),
    ];
    const m = computeUtteranceMetrics(words);
    assert.equal(m.interruptionCount, 0);
    assert.equal(m.avgResponseLatencyMs, 0);
    assert.equal(m.speakerATalkTimeMs, 1000);
    assert.equal(m.speakerBTalkTimeMs, 0);
  });

  it("detects final segment as monologue", () => {
    // Last speaker talks for > 60s
    const words = [
      word("Hi", 0, 500, "A"),
      word("Hello", 1000, 1500, "B"),
      word("Long", 2000, 3000, "A"),
      word("talk", 62000, 63000, "A"), // A segment: 63000 - 2000 = 61000ms → monologue
    ];
    const m = computeUtteranceMetrics(words);
    assert.ok(m.monologueSegments >= 1);
  });
});
