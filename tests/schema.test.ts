/**
 * Tests for Zod schema validation — ensures data integrity at system boundaries.
 * Run with: npx tsx --test tests/schema.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insertCallAnalysisSchema,
  insertCoachingSessionSchema,
  insertAccessRequestSchema,
  insertUserSchema,
  insertEmployeeSchema,
} from "../shared/schema.js";

describe("insertCallAnalysisSchema", () => {
  it("accepts valid complete analysis", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-123",
      performanceScore: "7.5",
      summary: "Good call",
      topics: ["billing", "shipping"],
      actionItems: ["Follow up"],
      feedback: { strengths: ["Empathy"], suggestions: ["Faster"] },
      flags: ["exceptional_call"],
      subScores: { compliance: 8, customerExperience: 7, communication: 9, resolution: 7 },
      detectedAgentName: "Sarah",
      confidenceScore: "0.85",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts minimal analysis (only callId required)", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "call-456",
    });
    assert.ok(result.success);
  });

  it("rejects missing callId", () => {
    const result = insertCallAnalysisSchema.safeParse({
      performanceScore: "5.0",
    });
    assert.ok(!result.success);
  });

  it("validates sub-score ranges", () => {
    const valid = insertCallAnalysisSchema.safeParse({
      callId: "call-789",
      subScores: { compliance: 10, customerExperience: 0, communication: 5.5, resolution: 10 },
    });
    assert.ok(valid.success);

    const invalid = insertCallAnalysisSchema.safeParse({
      callId: "call-789",
      subScores: { compliance: 11 }, // > 10
    });
    assert.ok(!invalid.success);

    const invalidNeg = insertCallAnalysisSchema.safeParse({
      callId: "call-789",
      subScores: { compliance: -1 }, // < 0
    });
    assert.ok(!invalidNeg.success);
  });

  it("allows undefined for all optional fields on old data", () => {
    const result = insertCallAnalysisSchema.safeParse({
      callId: "old-call",
      performanceScore: "6.0",
      summary: "An older call",
      // No subScores, no confidenceScore, no detectedAgentName
    });
    assert.ok(result.success);
    assert.equal(result.data.subScores, undefined);
    assert.equal(result.data.confidenceScore, undefined);
    assert.equal(result.data.detectedAgentName, undefined);
  });
});

describe("insertCoachingSessionSchema", () => {
  it("accepts valid coaching session", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Improve greeting compliance",
      category: "compliance",
      notes: "Review HIPAA greeting requirements",
      actionPlan: [
        { task: "Listen to 3 example calls", completed: false },
        { task: "Practice with team lead", completed: false },
      ],
      dueDate: "2026-04-01",
    });
    assert.ok(result.success);
  });

  it("defaults status to pending", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "General coaching",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "pending");
  });

  it("defaults category to general", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "General coaching",
    });
    assert.ok(result.success);
    assert.equal(result.data.category, "general");
  });

  it("validates status enum", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
      status: "invalid_status",
    });
    assert.ok(!result.success);
  });

  it("accepts optional effectivenessRating helpful/neutral/not_helpful", () => {
    for (const rating of ["helpful", "neutral", "not_helpful"] as const) {
      const result = insertCoachingSessionSchema.safeParse({
        employeeId: "emp-1",
        assignedBy: "mgr-1",
        title: "Rated session",
        effectivenessRating: rating,
      });
      assert.ok(result.success, `${rating} should be accepted`);
    }
  });

  it("rejects unknown effectivenessRating values", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
      effectivenessRating: "very_helpful",
    });
    assert.ok(!result.success);
  });

  it("accepts effectivenessNote up to 1000 chars", () => {
    const ok = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
      effectivenessNote: "a".repeat(1000),
    });
    assert.ok(ok.success);

    const tooLong = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
      effectivenessNote: "a".repeat(1001),
    });
    assert.ok(!tooLong.success);
  });

  it("accepts session without effectiveness fields (backward-compatible)", () => {
    const result = insertCoachingSessionSchema.safeParse({
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Pre-Tier-2 session",
    });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.effectivenessRating, undefined);
      assert.equal(result.data.effectivenessNote, undefined);
    }
  });
});

describe("insertAccessRequestSchema", () => {
  it("accepts valid request", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "John Doe",
      email: "john@example.com",
      reason: "Need access to review calls",
      requestedRole: "viewer",
    });
    assert.ok(result.success);
  });

  it("rejects invalid email", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "John",
      email: "not-an-email",
    });
    assert.ok(!result.success);
  });

  it("rejects empty name", () => {
    const result = insertAccessRequestSchema.safeParse({
      name: "",
      email: "john@example.com",
    });
    assert.ok(!result.success);
  });
});

describe("insertUserSchema", () => {
  it("accepts valid user", () => {
    const result = insertUserSchema.safeParse({
      username: "admin",
      passwordHash: "hashed_password_here",
      name: "Admin User",
      role: "admin",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("defaults role to viewer", () => {
    const result = insertUserSchema.safeParse({
      username: "viewer1",
      passwordHash: "hashed_password_here",
      name: "View Only",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
    assert.equal(result.data.role, "viewer");
  });
});

describe("insertEmployeeSchema", () => {
  it("accepts valid employee", () => {
    const result = insertEmployeeSchema.safeParse({
      name: "Jane Smith",
      email: "jane@company.com",
      role: "Senior Agent",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts employee without status (optional field)", () => {
    const result = insertEmployeeSchema.safeParse({
      name: "New Employee",
      email: "new@company.com",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
    // status is optional — may be undefined when not provided
  });

  it("accepts explicit status value", () => {
    const result = insertEmployeeSchema.safeParse({
      name: "Inactive Employee",
      email: "inactive@company.com",
      status: "Inactive",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "Inactive");
  });
});
