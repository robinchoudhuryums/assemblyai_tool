/**
 * Extended schema validation tests — covers tightened Zod schemas, edge cases,
 * and AI data normalization behavior.
 * Run with: npx tsx --test tests/validation.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insertCallAnalysisSchema,
  insertAccessRequestSchema,
  analysisEditSchema,
  insertCallSchema,
  insertTranscriptSchema,
  insertSentimentAnalysisSchema,
  usageRecordSchema,
  webhookConfigSchema,
} from "../shared/schema.js";

describe("lemurResponse validation", () => {
  it("accepts null lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-1",
      lemurResponse: null,
    });
    assert.ok(result.success);
  });

  it("accepts string lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-2",
      lemurResponse: "raw text response from LeMUR",
    });
    assert.ok(result.success);
  });

  it("accepts structured lemurResponse object", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-3",
      lemurResponse: {
        response: "AI summary of the call",
        request_id: "req-123",
        model: "default",
        usage: { input_tokens: 500, output_tokens: 200 },
      },
    });
    assert.ok(result.success);
  });

  it("accepts lemurResponse with extra fields (passthrough)", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-4",
      lemurResponse: {
        response: "summary",
        custom_field: "value",
      },
    });
    assert.ok(result.success);
  });

  it("accepts undefined lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-5",
    });
    assert.ok(result.success);
    assert.equal(result.data.lemurResponse, undefined);
  });

  it("rejects number lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-6",
      lemurResponse: 42,
    });
    assert.ok(!result.success);
  });

  it("rejects boolean lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-7",
      lemurResponse: true,
    });
    assert.ok(!result.success);
  });

  it("rejects array lemurResponse", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-8",
      lemurResponse: ["a", "b"],
    });
    assert.ok(!result.success);
  });
});

describe("confidenceFactors validation", () => {
  it("accepts full confidenceFactors", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-1",
      confidenceFactors: {
        transcriptConfidence: 0.95,
        wordCount: 200,
        callDurationSeconds: 180,
        transcriptLength: 3000,
        aiAnalysisCompleted: true,
        overallScore: 0.97,
        agentSpeakerLabel: "A",
        utteranceMetrics: {
          interruptionCount: 2,
          avgResponseLatencyMs: 450,
          monologueSegments: 3,
          questionCount: 5,
        },
      },
    });
    assert.ok(result.success);
  });

  it("accepts confidenceFactors without optional utteranceMetrics", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-2",
      confidenceFactors: {
        transcriptConfidence: 0.9,
        wordCount: 100,
      },
    });
    assert.ok(result.success);
  });

  it("accepts confidenceFactors with agentSpeakerLabel", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-3",
      confidenceFactors: {
        agentSpeakerLabel: "B",
      },
    });
    assert.ok(result.success);
  });
});

describe("AI data arrays (aiStringOrObject)", () => {
  it("accepts string arrays for keywords", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-1",
      keywords: ["billing", "shipping", "returns"],
    });
    assert.ok(result.success);
  });

  it("accepts object arrays for keywords (AI quirk)", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-2",
      keywords: [{ text: "billing" }, { name: "shipping" }],
    });
    assert.ok(result.success);
  });

  it("accepts mixed string/object arrays", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-3",
      topics: ["billing", { category: "support" }, "returns"],
    });
    assert.ok(result.success);
  });

  it("rejects number elements in keywords", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-4",
      keywords: [42, "billing"],
    });
    assert.ok(!result.success);
  });

  it("rejects nested arrays in topics", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-5",
      topics: [["nested"]],
    });
    assert.ok(!result.success);
  });
});

describe("analysisEditSchema feedback arrays", () => {
  it("accepts string arrays in feedback strengths", () => {
    const result = analysisEditSchema.safeParse({
      updates: {
        feedback: {
          strengths: ["Good empathy", "Clear communication"],
        },
      },
      reason: "Updating feedback",
    });
    assert.ok(result.success);
  });

  it("accepts object arrays in feedback (AI quirk)", () => {
    const result = analysisEditSchema.safeParse({
      updates: {
        feedback: {
          strengths: [{ text: "Empathy" }],
          suggestions: [{ text: "Be faster" }],
        },
      },
      reason: "Updating feedback",
    });
    assert.ok(result.success);
  });

  it("rejects empty updates", () => {
    const result = analysisEditSchema.safeParse({
      updates: {},
      reason: "No changes",
    });
    assert.ok(!result.success);
  });

  it("rejects missing reason", () => {
    const result = analysisEditSchema.safeParse({
      updates: { summary: "Updated summary" },
    });
    assert.ok(!result.success);
  });

  it("validates performance score range (0-10)", () => {
    const valid = analysisEditSchema.safeParse({
      updates: { performanceScore: "7.5" },
      reason: "Score adjustment",
    });
    assert.ok(valid.success);

    const tooHigh = analysisEditSchema.safeParse({
      updates: { performanceScore: "11" },
      reason: "Invalid score",
    });
    assert.ok(!tooHigh.success);

    const tooLow = analysisEditSchema.safeParse({
      updates: { performanceScore: "-1" },
      reason: "Invalid score",
    });
    assert.ok(!tooLow.success);
  });
});

describe("insertCallSchema contentHash", () => {
  it("accepts call with contentHash", () => {
    const result = insertCallSchema.safeParse({
      fileName: "call.mp3",
      status: "pending",
      contentHash: "a".repeat(64),
    });
    assert.ok(result.success);
  });

  it("accepts call without contentHash", () => {
    const result = insertCallSchema.safeParse({
      fileName: "call.mp3",
    });
    assert.ok(result.success);
  });
});

describe("insertAccessRequestSchema email validation", () => {
  it("accepts valid email", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
    });
    assert.ok(result.success);
  });

  it("rejects plaintext (not an email)", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "not-an-email",
    });
    assert.ok(!result.success);
  });

  it("rejects email without domain", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "user@",
    });
    assert.ok(!result.success);
  });

  it("rejects email without local part", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "@example.com",
    });
    assert.ok(!result.success);
  });

  it("only allows viewer or manager roles", () => {
    const viewer = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "t@e.com",
      requestedRole: "viewer",
    });
    assert.ok(viewer.success);

    const manager = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "t@e.com",
      requestedRole: "manager",
    });
    assert.ok(manager.success);

    const admin = insertAccessRequestSchema.safeParse({
      name: "Test",
      email: "t@e.com",
      requestedRole: "admin",
    });
    assert.ok(!admin.success, "admin role should be rejected for access requests");
  });
});

describe("usageRecordSchema", () => {
  it("accepts valid usage record", () => {
    const result = usageRecordSchema.safeParse({
      id: "usage-1",
      callId: "call-1",
      type: "call",
      timestamp: "2026-03-19T00:00:00.000Z",
      user: "admin",
      services: {
        assemblyai: { durationSeconds: 120, estimatedCost: 0.0057 },
        bedrock: {
          model: "us.anthropic.claude-sonnet-4-6",
          estimatedInputTokens: 1000,
          estimatedOutputTokens: 500,
          estimatedCost: 0.0105,
        },
      },
      totalEstimatedCost: 0.0162,
    });
    assert.ok(result.success);
  });

  it("validates type enum (call or ab-test)", () => {
    const invalid = usageRecordSchema.safeParse({
      id: "u-1",
      callId: "c-1",
      type: "invalid",
      timestamp: "2026-03-19T00:00:00.000Z",
      user: "admin",
      services: {},
      totalEstimatedCost: 0,
    });
    assert.ok(!invalid.success);
  });
});

describe("sub-scores completeness", () => {
  it("accepts all four sub-scores", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-1",
      subScores: {
        compliance: 8,
        customerExperience: 7,
        communication: 9,
        resolution: 6,
      },
    });
    assert.ok(result.success);
  });

  it("accepts partial sub-scores (all optional)", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-2",
      subScores: { compliance: 8 },
    });
    assert.ok(result.success);
  });

  it("accepts empty sub-scores object", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-3",
      subScores: {},
    });
    assert.ok(result.success);
  });

  it("validates each sub-score range (0-10)", () => {
    const tooHigh = insertCallAnalysisSchema.safeParse({
      callId: "call-4",
      subScores: { compliance: 11 },
    });
    assert.ok(!tooHigh.success);

    const tooLow = insertCallAnalysisSchema.safeParse({
      callId: "call-5",
      subScores: { customerExperience: -1 },
    });
    assert.ok(!tooLow.success);
  });

  it("accepts decimal sub-scores", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-6",
      subScores: { compliance: 7.5, communication: 8.3 },
    });
    assert.ok(result.success);
  });
});
