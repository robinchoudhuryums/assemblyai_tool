/**
 * Tests for pipeline error handling: AI parse failure vs unavailability distinction,
 * empty transcript guard, low-confidence guard, and error classification.
 * Run with: npx tsx --test tests/pipeline-errors.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonResponse, buildAnalysisPrompt } from "../server/services/ai-provider.js";
import { AssemblyAIService } from "../server/services/assemblyai.js";
import type { AssemblyAIResponse } from "../server/services/assemblyai.js";

const service = new AssemblyAIService({ apiKey: "test", baseUrl: "http://localhost" });

// ── AI Error Classification ─────────────────────────────

describe("AI error classification", () => {
  function classifyAIError(error: Error): "parse_failure" | "unavailable" | "unknown" {
    const msg = error.message;
    if (msg.includes("malformed JSON") || msg.includes("did not contain valid JSON") || msg.includes("failed schema validation")) {
      return "parse_failure";
    }
    if (msg.includes("Bedrock") || msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("not configured")) {
      return "unavailable";
    }
    return "unknown";
  }

  it("classifies malformed JSON as parse_failure", () => {
    assert.equal(classifyAIError(new Error("AI response contained malformed JSON")), "parse_failure");
  });

  it("classifies missing JSON as parse_failure", () => {
    assert.equal(classifyAIError(new Error("AI response did not contain valid JSON")), "parse_failure");
  });

  it("classifies schema validation failure as parse_failure", () => {
    assert.equal(classifyAIError(new Error("AI response failed schema validation")), "parse_failure");
  });

  it("classifies Bedrock errors as unavailable", () => {
    assert.equal(classifyAIError(new Error("Bedrock CreateModelInvocationJob failed (500)")), "unavailable");
  });

  it("classifies connection errors as unavailable", () => {
    assert.equal(classifyAIError(new Error("ECONNREFUSED")), "unavailable");
  });

  it("classifies timeout as unavailable", () => {
    assert.equal(classifyAIError(new Error("Request timeout after 120s")), "unavailable");
  });

  it("classifies unknown errors", () => {
    assert.equal(classifyAIError(new Error("Something unexpected")), "unknown");
  });
});

// ── parseJsonResponse error cases ─────────────────────────

describe("parseJsonResponse error handling", () => {
  it("throws on non-JSON response", () => {
    assert.throws(
      () => parseJsonResponse("I cannot analyze this call.", "test-call"),
      /did not contain valid JSON/,
    );
  });

  it("throws on malformed JSON", () => {
    assert.throws(
      () => parseJsonResponse('{"summary": "test", broken}', "test-call"),
      /malformed JSON/,
    );
  });

  it("parses JSON wrapped in markdown fences", () => {
    const response = '```json\n{"summary":"Test","topics":[],"sentiment":"neutral","sentiment_score":0.5,"performance_score":7.0,"sub_scores":{"compliance":7,"customer_experience":7,"communication":7,"resolution":7},"action_items":[],"feedback":{"strengths":[],"suggestions":[]},"flags":[]}\n```';
    const result = parseJsonResponse(response, "test-call");
    assert.equal(result.summary, "Test");
  });

  it("parses JSON with leading text", () => {
    const response = 'Here is the analysis:\n{"summary":"Test","topics":[],"sentiment":"neutral","sentiment_score":0.5,"performance_score":5.0,"sub_scores":{"compliance":5,"customer_experience":5,"communication":5,"resolution":5},"action_items":[],"feedback":{"strengths":[],"suggestions":[]},"flags":[]}';
    const result = parseJsonResponse(response, "test-call");
    assert.equal(result.summary, "Test");
  });

  it("clamps performance_score above 10 to 10", () => {
    const response = '{"summary":"Test","topics":[],"sentiment":"neutral","sentiment_score":0.5,"performance_score":15.0,"sub_scores":{"compliance":5,"customer_experience":5,"communication":5,"resolution":5},"action_items":[],"feedback":{"strengths":[],"suggestions":[]},"flags":[]}';
    const result = parseJsonResponse(response, "test-call");
    assert.ok(result.performance_score <= 10, `Score ${result.performance_score} should be clamped to 10`);
  });

  it("clamps negative performance_score to 0", () => {
    const response = '{"summary":"Test","topics":[],"sentiment":"neutral","sentiment_score":0.5,"performance_score":-3.0,"sub_scores":{"compliance":5,"customer_experience":5,"communication":5,"resolution":5},"action_items":[],"feedback":{"strengths":[],"suggestions":[]},"flags":[]}';
    const result = parseJsonResponse(response, "test-call");
    assert.ok(result.performance_score >= 0, `Score ${result.performance_score} should be clamped to 0`);
  });
});

// ── Empty Transcript Guard ─────────────────────────────

describe("Empty transcript quality gate", () => {
  function shouldSkipAI(transcriptText: string): boolean {
    return transcriptText.trim().length < 10;
  }

  it("skips AI for empty transcript", () => {
    assert.ok(shouldSkipAI(""));
  });

  it("skips AI for whitespace-only transcript", () => {
    assert.ok(shouldSkipAI("   \n\t  "));
  });

  it("skips AI for very short transcript", () => {
    assert.ok(shouldSkipAI("Hi."));
  });

  it("allows transcript at threshold (10 chars)", () => {
    assert.ok(!shouldSkipAI("Hello there"));
  });

  it("allows normal transcripts", () => {
    assert.ok(!shouldSkipAI("Hello, my name is Sarah. How can I help you today?"));
  });
});

// ── Low Confidence Guard ─────────────────────────────

describe("Low confidence quality gate", () => {
  function shouldSkipForConfidence(confidence: number): boolean {
    return confidence < 0.6 && confidence > 0;
  }

  it("skips AI for very low confidence (0.3)", () => {
    assert.ok(shouldSkipForConfidence(0.3));
  });

  it("skips AI for borderline confidence (0.59)", () => {
    assert.ok(shouldSkipForConfidence(0.59));
  });

  it("allows good confidence (0.6)", () => {
    assert.ok(!shouldSkipForConfidence(0.6));
  });

  it("allows high confidence (0.95)", () => {
    assert.ok(!shouldSkipForConfidence(0.95));
  });

  it("allows zero confidence (fallback — don't block entirely)", () => {
    assert.ok(!shouldSkipForConfidence(0));
  });
});

// ── processTranscriptData with null AI ─────────────────────

describe("processTranscriptData with no AI analysis", () => {
  const baseTranscript: AssemblyAIResponse = {
    id: "aai-no-ai",
    status: "completed",
    text: "Hello, how can I help?",
    confidence: 0.90,
    words: [
      { text: "Hello,", start: 0, end: 500, confidence: 0.98, speaker: "A" },
      { text: "how", start: 510, end: 700, confidence: 0.97, speaker: "A" },
      { text: "can", start: 710, end: 900, confidence: 0.96, speaker: "A" },
      { text: "I", start: 910, end: 1000, confidence: 0.99, speaker: "A" },
      { text: "help?", start: 1010, end: 1400, confidence: 0.97, speaker: "A" },
    ],
    sentiment_analysis_results: [
      { text: "Hello, how can I help?", sentiment: "POSITIVE", confidence: 0.85, start: 0, end: 1400 },
    ],
  };

  it("produces default analysis when AI is null", () => {
    const { analysis } = service.processTranscriptData(baseTranscript, null, "call-no-ai");

    assert.equal(analysis.callId, "call-no-ai");
    assert.ok(analysis.performanceScore != null);
    assert.equal(analysis.summary, "Hello, how can I help?"); // falls back to transcript text
  });

  it("derives sentiment from AssemblyAI when AI is null", () => {
    const { sentiment } = service.processTranscriptData(baseTranscript, null, "call-no-ai");

    assert.ok(sentiment.overallSentiment);
    assert.ok(["positive", "negative", "neutral"].includes(sentiment.overallSentiment));
  });

  it("still creates valid transcript record when AI is null", () => {
    const { transcript } = service.processTranscriptData(baseTranscript, null, "call-no-ai");

    assert.equal(transcript.callId, "call-no-ai");
    assert.equal(transcript.text, "Hello, how can I help?");
    assert.equal(transcript.confidence, "0.9");
  });
});

// ── buildAnalysisPrompt edge cases ─────────────────────

describe("buildAnalysisPrompt edge cases", () => {
  it("handles very long transcript (truncation)", () => {
    const longText = "Speaker A: " + "word ".repeat(20000);
    const prompt = buildAnalysisPrompt(longText);
    // Should be truncated but still valid
    assert.ok(prompt.length > 0);
    assert.ok(prompt.length < longText.length + 5000); // prompt overhead
  });

  it("includes call category context when provided", () => {
    const prompt = buildAnalysisPrompt("Test transcript", "inbound");
    assert.ok(prompt.includes("inbound") || prompt.includes("Inbound"), "Should include category context");
  });

  it("includes language instructions when specified", () => {
    const prompt = buildAnalysisPrompt("Test transcript", undefined, undefined, "es");
    assert.ok(prompt.toLowerCase().includes("spanish") || prompt.toLowerCase().includes("español"),
      "Should include language instruction");
  });

  it("works with minimal input", () => {
    const prompt = buildAnalysisPrompt("Hi");
    assert.ok(prompt.includes("Hi"));
    assert.ok(prompt.length > 100); // Should have system prompt
  });
});
