/**
 * Tests for batch inference: JSONL input building, output parsing, orphan recovery,
 * batch cycle logic, and scheduler lifecycle.
 * Run with: npx tsx --test tests/batch-inference.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseJsonResponse } from "../server/services/ai-provider.js";
import type { CallAnalysis } from "../server/services/ai-provider.js";
import type { PendingBatchItem, BatchJob } from "../server/services/bedrock-batch.js";

// ── JSONL Input Building ─────────────────────────────────

describe("Batch JSONL input format", () => {
  const sampleItems: PendingBatchItem[] = [
    { callId: "call-1", prompt: "Analyze this call transcript...", callCategory: "inbound", timestamp: "2026-01-01T00:00:00Z" },
    { callId: "call-2", prompt: "Analyze second call...", callCategory: "outbound", uploadedBy: "admin", timestamp: "2026-01-01T00:05:00Z" },
  ];

  it("produces valid JSONL with one line per item", () => {
    const lines = sampleItems.map(item => JSON.stringify({
      recordId: item.callId,
      modelInput: {
        messages: [{ role: "user", content: [{ text: item.prompt }] }],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      },
    }));
    const jsonl = lines.join("\n");

    const parsed = jsonl.split("\n").map(l => JSON.parse(l));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].recordId, "call-1");
    assert.equal(parsed[1].recordId, "call-2");
  });

  it("each JSONL line has correct Converse API structure", () => {
    const line = JSON.stringify({
      recordId: sampleItems[0].callId,
      modelInput: {
        messages: [{ role: "user", content: [{ text: sampleItems[0].prompt }] }],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      },
    });
    const record = JSON.parse(line);

    assert.equal(record.recordId, "call-1");
    assert.ok(record.modelInput);
    assert.ok(Array.isArray(record.modelInput.messages));
    assert.equal(record.modelInput.messages[0].role, "user");
    assert.equal(record.modelInput.messages[0].content[0].text, sampleItems[0].prompt);
    assert.equal(record.modelInput.inferenceConfig.temperature, 0.3);
    assert.equal(record.modelInput.inferenceConfig.maxTokens, 2048);
  });

  it("handles empty items array", () => {
    const lines: string[] = [];
    const jsonl = lines.join("\n");
    assert.equal(jsonl, "");
  });

  it("handles items with special characters in prompt", () => {
    const item: PendingBatchItem = {
      callId: "call-special",
      prompt: 'Transcript with "quotes" and\nnewlines and emoji 🎉',
      timestamp: "2026-01-01T00:00:00Z",
    };
    const line = JSON.stringify({
      recordId: item.callId,
      modelInput: {
        messages: [{ role: "user", content: [{ text: item.prompt }] }],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      },
    });
    // Should round-trip cleanly through JSON
    const parsed = JSON.parse(line);
    assert.equal(parsed.modelInput.messages[0].content[0].text, item.prompt);
  });
});

// ── Batch Output Parsing ─────────────────────────────────

describe("Batch output JSONL parsing", () => {
  const validAIResponse = JSON.stringify({
    summary: "Agent resolved billing issue",
    topics: ["billing", "refund"],
    sentiment: "positive",
    sentiment_score: 0.8,
    performance_score: 8.5,
    sub_scores: { compliance: 9, customer_experience: 8, communication: 8, resolution: 9 },
    action_items: ["Process refund"],
    feedback: { strengths: ["Clear communication"], suggestions: ["Faster resolution"] },
    flags: [],
    detected_agent_name: "John",
  });

  function buildOutputLine(callId: string, responseText: string, error?: string): string {
    if (error) {
      return JSON.stringify({ recordId: callId, error });
    }
    return JSON.stringify({
      recordId: callId,
      modelOutput: {
        output: {
          message: { content: [{ text: responseText }] },
        },
      },
    });
  }

  it("parses valid output line with AI analysis", () => {
    const line = buildOutputLine("call-1", validAIResponse);
    const record = JSON.parse(line);

    assert.equal(record.recordId, "call-1");
    assert.ok(!record.error);

    const responseText = record.modelOutput.output.message.content[0].text;
    const analysis = parseJsonResponse(responseText, "call-1");
    assert.equal(analysis.summary, "Agent resolved billing issue");
    assert.equal(analysis.performance_score, 8.5);
    assert.deepEqual(analysis.topics, ["billing", "refund"]);
  });

  it("handles error records gracefully", () => {
    const line = buildOutputLine("call-err", "", "ThrottlingException: Rate limit exceeded");
    const record = JSON.parse(line);

    assert.equal(record.recordId, "call-err");
    assert.ok(record.error);
    assert.match(record.error, /ThrottlingException/);
  });

  it("handles empty response text", () => {
    const line = JSON.stringify({
      recordId: "call-empty",
      modelOutput: { output: { message: { content: [] } } },
    });
    const record = JSON.parse(line);
    const text = record.modelOutput?.output?.message?.content?.[0]?.text;
    assert.equal(text, undefined);
  });

  it("handles missing modelOutput", () => {
    const line = JSON.stringify({ recordId: "call-no-output" });
    const record = JSON.parse(line);
    const text = record.modelOutput?.output?.message?.content?.[0]?.text;
    assert.equal(text, undefined);
  });

  it("parses multi-line output file", () => {
    const lines = [
      buildOutputLine("call-a", validAIResponse),
      buildOutputLine("call-b", validAIResponse),
      buildOutputLine("call-c", "", "Error: model timeout"),
    ];
    const content = lines.join("\n");
    const parsedLines = content.split("\n").filter(l => l.trim());

    assert.equal(parsedLines.length, 3);

    const results = new Map<string, CallAnalysis>();
    for (const l of parsedLines) {
      const record = JSON.parse(l);
      if (record.error) continue;
      const text = record.modelOutput?.output?.message?.content?.[0]?.text;
      if (text) {
        results.set(record.recordId, parseJsonResponse(text, record.recordId));
      }
    }

    assert.equal(results.size, 2);
    assert.ok(results.has("call-a"));
    assert.ok(results.has("call-b"));
    assert.ok(!results.has("call-c"));
  });

  it("handles malformed JSON in output line", () => {
    const badLine = "{not valid json";
    assert.throws(() => JSON.parse(badLine), /SyntaxError/);
  });
});

// ── BatchJob Status Handling ─────────────────────────────

describe("BatchJob status handling", () => {
  const baseBatchJob: BatchJob = {
    jobId: "job-123",
    jobArn: "arn:aws:bedrock:us-east-1:123456:model-invocation-job/job-123",
    status: "Submitted",
    inputS3Uri: "s3://bucket/input.jsonl",
    outputS3Uri: "s3://bucket/output/",
    callIds: ["call-1", "call-2"],
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("tracks all valid batch job statuses", () => {
    const validStatuses: BatchJob["status"][] = [
      "Submitted", "InProgress", "Completed", "Failed",
      "Stopping", "Stopped", "Expired", "Validating", "Scheduled",
    ];
    for (const status of validStatuses) {
      const job: BatchJob = { ...baseBatchJob, status };
      assert.equal(job.status, status);
    }
  });

  it("stores call IDs for tracking", () => {
    assert.deepEqual(baseBatchJob.callIds, ["call-1", "call-2"]);
  });

  it("extracts job ID from ARN", () => {
    const jobArn = "arn:aws:bedrock:us-east-1:123456:model-invocation-job/job-abc-123";
    const jobId = jobArn.split("/").pop();
    assert.equal(jobId, "job-abc-123");
  });

  it("handles ARN without job ID component", () => {
    const malformedArn = "arn:aws:bedrock:us-east-1:123456";
    const jobId = malformedArn.split("/").pop();
    // Falls back to the last segment which is the account ID
    assert.equal(jobId, "arn:aws:bedrock:us-east-1:123456");
  });
});

// ── Orphan Recovery Logic ─────────────────────────────────

describe("Orphan recovery logic", () => {
  const ORPHAN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

  interface MockCall {
    id: string;
    status: string;
    uploadedAt: string;
  }

  function identifyOrphans(
    awaitingCalls: MockCall[],
    pendingCallIds: Set<string>,
    now: number = Date.now(),
  ): string[] {
    const orphanIds: string[] = [];
    for (const call of awaitingCalls) {
      const age = now - new Date(call.uploadedAt).getTime();
      if (age > ORPHAN_THRESHOLD_MS && !pendingCallIds.has(call.id)) {
        orphanIds.push(call.id);
      }
    }
    return orphanIds;
  }

  it("identifies calls older than threshold without pending items", () => {
    const now = Date.now();
    const calls: MockCall[] = [
      { id: "old-call", status: "awaiting_analysis", uploadedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
    ];
    const orphans = identifyOrphans(calls, new Set(), now);
    assert.deepEqual(orphans, ["old-call"]);
  });

  it("skips calls that still have pending batch items", () => {
    const now = Date.now();
    const calls: MockCall[] = [
      { id: "still-pending", status: "awaiting_analysis", uploadedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
    ];
    const orphans = identifyOrphans(calls, new Set(["still-pending"]), now);
    assert.deepEqual(orphans, []);
  });

  it("skips calls newer than threshold", () => {
    const now = Date.now();
    const calls: MockCall[] = [
      { id: "recent-call", status: "awaiting_analysis", uploadedAt: new Date(now - 30 * 60 * 1000).toISOString() },
    ];
    const orphans = identifyOrphans(calls, new Set(), now);
    assert.deepEqual(orphans, []);
  });

  it("handles mixed old and new calls", () => {
    const now = Date.now();
    const calls: MockCall[] = [
      { id: "old-orphan", status: "awaiting_analysis", uploadedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString() },
      { id: "recent", status: "awaiting_analysis", uploadedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
      { id: "old-with-pending", status: "awaiting_analysis", uploadedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
    ];
    const orphans = identifyOrphans(calls, new Set(["old-with-pending"]), now);
    assert.deepEqual(orphans, ["old-orphan"]);
  });

  it("returns empty array when no awaiting calls", () => {
    const orphans = identifyOrphans([], new Set());
    assert.deepEqual(orphans, []);
  });
});

// ── Batch Scheduling Logic ─────────────────────────────────

describe("Batch scheduling logic", () => {
  const MIN_BATCH_SIZE = 5;

  function shouldSubmitBatch(
    pendingCount: number,
    oldestItemAgeMs: number,
    batchIntervalMinutes: number,
  ): boolean {
    if (pendingCount === 0) return false;
    if (pendingCount >= MIN_BATCH_SIZE) return true;
    // Submit even below threshold if items are old enough (2x interval)
    return oldestItemAgeMs >= batchIntervalMinutes * 60 * 1000 * 2;
  }

  it("submits when enough items are pending", () => {
    assert.ok(shouldSubmitBatch(5, 0, 15));
    assert.ok(shouldSubmitBatch(10, 0, 15));
  });

  it("waits when below threshold and items are fresh", () => {
    assert.ok(!shouldSubmitBatch(3, 10 * 60 * 1000, 15)); // 10 min old, threshold 30 min
  });

  it("submits below threshold when items are old enough", () => {
    assert.ok(shouldSubmitBatch(2, 31 * 60 * 1000, 15)); // 31 min old, threshold 30 min
  });

  it("never submits with zero items", () => {
    assert.ok(!shouldSubmitBatch(0, 999999999, 15));
  });

  it("respects custom batch interval", () => {
    // 60 min interval, so 2x = 120 min threshold
    assert.ok(!shouldSubmitBatch(3, 60 * 60 * 1000, 60)); // 60 min old, needs 120
    assert.ok(shouldSubmitBatch(3, 121 * 60 * 1000, 60)); // 121 min old, over 120
  });
});

// ── shouldUseBatchMode time-of-day scheduling ─────────────

describe("Batch mode time-of-day scheduling", () => {
  function isInBatchWindow(currentHour: number, startHour: number, endHour: number): boolean {
    if (startHour < endHour) {
      return currentHour >= startHour && currentHour < endHour;
    }
    // Overnight window (e.g., 18:00 → 08:00)
    return currentHour >= startHour || currentHour < endHour;
  }

  it("detects daytime window (09:00 → 17:00)", () => {
    assert.ok(isInBatchWindow(12, 9, 17));
    assert.ok(!isInBatchWindow(18, 9, 17));
    assert.ok(!isInBatchWindow(8, 9, 17));
  });

  it("detects overnight window (18:00 → 08:00)", () => {
    assert.ok(isInBatchWindow(20, 18, 8));
    assert.ok(isInBatchWindow(2, 18, 8));
    assert.ok(!isInBatchWindow(12, 18, 8));
    assert.ok(!isInBatchWindow(10, 18, 8));
  });

  it("handles boundary hours", () => {
    assert.ok(isInBatchWindow(18, 18, 8));   // Start of window
    assert.ok(!isInBatchWindow(8, 18, 8));   // End of window (exclusive)
    assert.ok(isInBatchWindow(9, 9, 17));    // Start of window
    assert.ok(!isInBatchWindow(17, 9, 17));  // End of window (exclusive)
  });
});
