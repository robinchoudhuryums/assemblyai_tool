/**
 * Tests for AI provider utilities: parseJsonResponse, buildAnalysisPrompt, smartTruncate
 * Run with: npx tsx --test tests/ai-provider.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonResponse, buildAnalysisPrompt } from "../server/services/ai-provider.js";

describe("parseJsonResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      summary: "Test summary",
      topics: ["billing"],
      sentiment: "positive",
      sentiment_score: 0.8,
      performance_score: 7.5,
      sub_scores: { compliance: 8, customer_experience: 7, communication: 8, resolution: 7 },
      action_items: ["Follow up"],
      feedback: { strengths: ["Good empathy"], suggestions: ["Be faster"] },
      call_party_type: "customer",
      flags: [],
      detected_agent_name: "Sarah",
    });

    const result = parseJsonResponse(raw, "test-1");
    assert.equal(result.summary, "Test summary");
    assert.equal(result.performance_score, 7.5);
    assert.equal(result.detected_agent_name, "Sarah");
    assert.deepEqual(result.topics, ["billing"]);
  });

  it("extracts JSON from markdown code fences", () => {
    const raw = '```json\n{"summary":"fenced","topics":[],"sentiment":"neutral","sentiment_score":0.5,"performance_score":5.0,"sub_scores":{"compliance":5,"customer_experience":5,"communication":5,"resolution":5},"action_items":[],"feedback":{"strengths":[],"suggestions":[]},"call_party_type":"customer","flags":[],"detected_agent_name":null}\n```';

    const result = parseJsonResponse(raw, "test-2");
    assert.equal(result.summary, "fenced");
  });

  it("throws on non-JSON response", () => {
    assert.throws(() => {
      parseJsonResponse("This is not JSON at all", "test-3");
    }, /did not contain valid JSON/);
  });

  it("throws on malformed JSON", () => {
    assert.throws(() => {
      parseJsonResponse("{broken: json,}", "test-4");
    }, /malformed JSON/);
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes transcript text", () => {
    const prompt = buildAnalysisPrompt("Hello this is a test call", undefined);
    assert.ok(prompt.includes("Hello this is a test call"));
  });

  it("includes category context for inbound calls", () => {
    const prompt = buildAnalysisPrompt("test", "inbound");
    assert.ok(prompt.includes("INBOUND call"));
  });

  it("includes category context for internal calls", () => {
    const prompt = buildAnalysisPrompt("test", "internal");
    assert.ok(prompt.includes("INTERNAL call"));
    assert.ok(prompt.includes("collaboration"));
  });

  it("includes custom evaluation criteria from template", () => {
    const prompt = buildAnalysisPrompt("test", undefined, {
      evaluationCriteria: "Check for HIPAA compliance and proper greeting",
    });
    assert.ok(prompt.includes("HIPAA compliance and proper greeting"));
  });

  it("includes scoring weights from template", () => {
    const prompt = buildAnalysisPrompt("test", undefined, {
      scoringWeights: { compliance: 40, customerExperience: 20, communication: 20, resolution: 20 },
    });
    assert.ok(prompt.includes("Compliance (40%)"));
  });

  it("includes required phrases from template", () => {
    const prompt = buildAnalysisPrompt("test", undefined, {
      requiredPhrases: [
        { phrase: "How can I help you?", label: "greeting", severity: "required" },
        { phrase: "Is there anything else?", label: "closing", severity: "recommended" },
      ],
    });
    assert.ok(prompt.includes("REQUIRED PHRASES"));
    assert.ok(prompt.includes("How can I help you?"));
    assert.ok(prompt.includes("RECOMMENDED PHRASES"));
    assert.ok(prompt.includes("Is there anything else?"));
  });

  it("truncates very long transcripts", () => {
    const longText = "x".repeat(100000);
    const prompt = buildAnalysisPrompt(longText);
    // Should be shorter than the raw text due to truncation
    assert.ok(prompt.length < longText.length + 5000);
    assert.ok(prompt.includes("characters omitted"));
  });

  it("does not truncate normal-length transcripts", () => {
    const normalText = "This is a normal length transcript.".repeat(100);
    const prompt = buildAnalysisPrompt(normalText);
    assert.ok(!prompt.includes("characters omitted"));
    assert.ok(prompt.includes(normalText));
  });

  it("requests JSON output format", () => {
    const prompt = buildAnalysisPrompt("test");
    assert.ok(prompt.includes("ONLY valid JSON"));
    assert.ok(prompt.includes("performance_score"));
    assert.ok(prompt.includes("sub_scores"));
    assert.ok(prompt.includes("detected_agent_name"));
  });
});
