/**
 * Tests for route utility functions: cost estimation, clamping, date parsing, safe parsing.
 * Run with: npx tsx --test tests/utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateBedrockCost,
  estimateAssemblyAICost,
  estimateEmbeddingCost,
  clampInt,
  parseDate,
  safeFloat,
  safeJsonParse,
  TaskQueue,
  computeConfidenceScore,
  autoAssignEmployee,
  escapeCsvValue,
  filterCallsByDateRange,
  countFrequency,
  validateParams,
  calculateSentimentBreakdown,
  calculateAvgScore,
} from "../server/routes/utils.js";

describe("estimateBedrockCost", () => {
  it("calculates cost for Sonnet 4.6", () => {
    // 1000 input tokens * $0.003/1K + 500 output tokens * $0.015/1K
    const cost = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", 1000, 500);
    assert.equal(cost, 0.003 + 0.0075);
  });

  it("calculates cost for Haiku 4.5", () => {
    // Titan V2 rate updated A27: $0.0008 in / $0.004 out per 1K
    const cost = estimateBedrockCost("us.anthropic.claude-haiku-4-5-20251001", 1000, 500);
    assert.equal(cost, 0.0008 + 0.002);
  });

  it("calculates cost for Claude 3 Haiku (cheapest)", () => {
    const cost = estimateBedrockCost("anthropic.claude-3-haiku-20240307", 1000, 500);
    assert.equal(cost, 0.00025 + 0.000625);
  });

  it("returns null for unknown models (A27/F60)", () => {
    const cost = estimateBedrockCost("unknown-model", 1000, 500);
    assert.equal(cost, null);
  });

  it("returns 0 for zero tokens", () => {
    const cost = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", 0, 0);
    assert.equal(cost, 0);
  });

  it("scales linearly with token count", () => {
    const cost1k = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", 1000, 0);
    const cost2k = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", 2000, 0);
    assert.equal(cost2k, cost1k * 2);
  });
});

describe("estimateAssemblyAICost", () => {
  it("calculates cost with sentiment enabled", () => {
    // Rate updated A27: $0.17/hr = 0.17/3600 per sec
    const cost = estimateAssemblyAICost(60, true);
    assert.ok(Math.abs(cost - (60 * 0.17 / 3600)) < 1e-9);
  });

  it("calculates cost without sentiment", () => {
    const cost = estimateAssemblyAICost(60, false);
    assert.ok(Math.abs(cost - (60 * 0.15 / 3600)) < 1e-9);
  });

  it("defaults to sentiment enabled", () => {
    const cost = estimateAssemblyAICost(60);
    assert.equal(cost, estimateAssemblyAICost(60, true));
  });

  it("returns 0 for zero duration", () => {
    assert.equal(estimateAssemblyAICost(0), 0);
  });
});

describe("estimateEmbeddingCost", () => {
  it("estimates cost based on text length", () => {
    // 4000 chars → ~1000 tokens → 1K * $0.00002 = $0.00002
    const cost = estimateEmbeddingCost(4000);
    assert.equal(cost, 0.00002);
  });

  it("returns 0 for empty text", () => {
    assert.equal(estimateEmbeddingCost(0), 0);
  });
});

describe("clampInt", () => {
  it("returns default for undefined", () => {
    assert.equal(clampInt(undefined, 10, 1, 100), 10);
  });

  it("returns default for NaN", () => {
    assert.equal(clampInt("abc", 10, 1, 100), 10);
  });

  it("clamps to minimum", () => {
    assert.equal(clampInt("0", 10, 1, 100), 1);
  });

  it("clamps to maximum", () => {
    assert.equal(clampInt("200", 10, 1, 100), 100);
  });

  it("returns parsed value within range", () => {
    assert.equal(clampInt("50", 10, 1, 100), 50);
  });
});

describe("parseDate", () => {
  it("returns undefined for undefined input", () => {
    assert.equal(parseDate(undefined), undefined);
  });

  it("returns undefined for invalid date", () => {
    assert.equal(parseDate("not-a-date"), undefined);
  });

  it("parses valid ISO date", () => {
    const d = parseDate("2026-03-19T00:00:00.000Z");
    assert.ok(d instanceof Date);
    assert.equal(d.getFullYear(), 2026);
  });

  it("parses date-only string", () => {
    const d = parseDate("2026-03-19");
    assert.ok(d instanceof Date);
  });
});

describe("safeFloat", () => {
  it("parses valid float", () => {
    assert.equal(safeFloat("7.5"), 7.5);
  });

  it("returns fallback for null", () => {
    assert.equal(safeFloat(null), 0);
  });

  it("returns fallback for undefined", () => {
    assert.equal(safeFloat(undefined), 0);
  });

  it("returns fallback for NaN string", () => {
    assert.equal(safeFloat("abc"), 0);
  });

  it("uses custom fallback", () => {
    assert.equal(safeFloat("abc", 5), 5);
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON string", () => {
    assert.deepEqual(safeJsonParse('{"a":1}', {}), { a: 1 });
  });

  it("returns fallback for invalid JSON", () => {
    assert.deepEqual(safeJsonParse("{broken", {}), {});
  });

  it("returns non-string value as-is", () => {
    assert.deepEqual(safeJsonParse({ a: 1 }, {}), { a: 1 });
  });

  it("returns fallback for null non-string", () => {
    assert.deepEqual(safeJsonParse(null, { default: true }), { default: true });
  });
});

describe("TaskQueue", () => {
  it("limits concurrency", async () => {
    const queue = new TaskQueue(2);
    let maxConcurrent = 0;
    let current = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      queue.add(async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 50));
        current--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    assert.deepEqual(results, [0, 1, 2, 3, 4]);
    assert.ok(maxConcurrent <= 2, `Max concurrent ${maxConcurrent} exceeded limit of 2`);
  });

  it("returns results in order", async () => {
    const queue = new TaskQueue(3);
    const results = await Promise.all([
      queue.add(async () => "a"),
      queue.add(async () => "b"),
      queue.add(async () => "c"),
    ]);
    assert.deepEqual(results, ["a", "b", "c"]);
  });

  it("propagates errors", async () => {
    const queue = new TaskQueue(1);
    await assert.rejects(
      queue.add(async () => { throw new Error("task failed"); }),
      /task failed/
    );
  });
});

describe("computeConfidenceScore (shared utility)", () => {
  it("returns score and factors object", () => {
    const result = computeConfidenceScore(
      { transcriptConfidence: 0.95, wordCount: 200, callDurationSeconds: 180, hasAiAnalysis: true },
    );
    assert.equal(typeof result.score, "number");
    assert.ok(result.score > 0.9);
    assert.equal(result.factors.transcriptConfidence, 0.95);
    assert.equal(result.factors.wordCount, 200);
    assert.equal(result.factors.callDurationSeconds, 180);
    assert.equal(result.factors.aiAnalysisCompleted, true);
  });

  it("factors.overallScore matches score rounded to 2 decimal places", () => {
    const result = computeConfidenceScore(
      { transcriptConfidence: 0.8, wordCount: 30, callDurationSeconds: 20, hasAiAnalysis: false },
    );
    assert.equal(result.factors.overallScore, Math.round(result.score * 100) / 100);
  });
});

describe("autoAssignEmployee (shared utility)", () => {
  it("assigns when employee found and not already assigned", async () => {
    const mockStorage = {
      findEmployeeByName: async (name: string) => ({ id: "emp-1", name }),
      atomicAssignEmployee: async () => true,
    };
    const result = await autoAssignEmployee("call-1", "Sarah", mockStorage);
    assert.equal(result.assigned, true);
    assert.equal(result.employeeName, "Sarah");
  });

  it("returns false when employee not found", async () => {
    const mockStorage = {
      findEmployeeByName: async () => undefined,
      atomicAssignEmployee: async () => true,
    };
    const result = await autoAssignEmployee("call-1", "Unknown", mockStorage);
    assert.equal(result.assigned, false);
    assert.equal(result.employeeName, undefined);
  });

  it("returns false when call already assigned", async () => {
    const mockStorage = {
      findEmployeeByName: async (name: string) => ({ id: "emp-1", name }),
      atomicAssignEmployee: async () => false, // Already assigned
    };
    const result = await autoAssignEmployee("call-1", "Sarah", mockStorage);
    assert.equal(result.assigned, false);
  });

  it("trims whitespace from agent name", async () => {
    let searchedName = "";
    const mockStorage = {
      findEmployeeByName: async (name: string) => { searchedName = name; return { id: "emp-1", name }; },
      atomicAssignEmployee: async () => true,
    };
    await autoAssignEmployee("call-1", "  Sarah  ", mockStorage);
    assert.equal(searchedName, "Sarah");
  });
});

// ── Shared Route Helpers ──

describe("escapeCsvValue", () => {
  it("returns plain values unchanged", () => {
    assert.equal(escapeCsvValue("hello"), "hello");
    assert.equal(escapeCsvValue(42), "42");
  });

  it("wraps values with commas in quotes", () => {
    assert.equal(escapeCsvValue("hello, world"), '"hello, world"');
  });

  it("escapes double quotes", () => {
    assert.equal(escapeCsvValue('say "hi"'), '"say ""hi"""');
  });

  it("prefixes formula-triggering characters", () => {
    assert.equal(escapeCsvValue("=SUM(A1)"), "'=SUM(A1)");
    assert.equal(escapeCsvValue("+cmd"), "'+cmd");
    assert.equal(escapeCsvValue("-exec"), "'-exec");
    assert.equal(escapeCsvValue("@import"), "'@import");
  });

  it("handles null/undefined", () => {
    assert.equal(escapeCsvValue(null), "");
    assert.equal(escapeCsvValue(undefined), "");
  });
});

describe("filterCallsByDateRange", () => {
  const calls = [
    { id: "1", uploadedAt: "2026-01-15T10:00:00Z" },
    { id: "2", uploadedAt: "2026-02-15T10:00:00Z" },
    { id: "3", uploadedAt: "2026-03-15T10:00:00Z" },
  ];

  it("returns all calls when no date range", () => {
    assert.equal(filterCallsByDateRange(calls).length, 3);
  });

  it("filters by from date", () => {
    const result = filterCallsByDateRange(calls, "2026-02-01");
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "2");
  });

  it("filters by to date (inclusive end-of-day)", () => {
    const result = filterCallsByDateRange(calls, undefined, "2026-02-15");
    assert.equal(result.length, 2);
    assert.equal(result[1].id, "2");
  });

  it("filters by both from and to", () => {
    const result = filterCallsByDateRange(calls, "2026-02-01", "2026-02-28");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "2");
  });

  it("ignores invalid date strings", () => {
    const result = filterCallsByDateRange(calls, "not-a-date", "also-bad");
    assert.equal(result.length, 3);
  });
});

describe("countFrequency", () => {
  it("counts and sorts by frequency", () => {
    const result = countFrequency(["a", "b", "a", "c", "a", "b"]);
    assert.equal(result[0].text, "a");
    assert.equal(result[0].count, 3);
    assert.equal(result[1].text, "b");
    assert.equal(result[1].count, 2);
  });

  it("normalizes to lowercase and trims", () => {
    const result = countFrequency(["Hello", "  hello  ", "HELLO"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 3);
  });

  it("respects limit parameter", () => {
    const items = Array.from({ length: 20 }, (_, i) => `item${i}`);
    assert.equal(countFrequency(items, 5).length, 5);
  });

  it("skips empty strings", () => {
    const result = countFrequency(["a", "", "  ", "a"]);
    assert.equal(result.length, 1);
  });
});

describe("calculateSentimentBreakdown", () => {
  it("counts sentiment categories", () => {
    const calls = [
      { sentiment: { overallSentiment: "positive" } },
      { sentiment: { overallSentiment: "positive" } },
      { sentiment: { overallSentiment: "negative" } },
      { sentiment: { overallSentiment: "neutral" } },
      { sentiment: null },
    ];
    const result = calculateSentimentBreakdown(calls);
    assert.equal(result.positive, 2);
    assert.equal(result.negative, 1);
    assert.equal(result.neutral, 1);
  });
});

describe("calculateAvgScore", () => {
  it("calculates average with default precision", () => {
    assert.equal(calculateAvgScore([8, 6, 7]), 7);
  });

  it("returns null for empty array", () => {
    assert.equal(calculateAvgScore([]), null);
  });

  it("filters out zero and non-finite values", () => {
    assert.equal(calculateAvgScore([0, 8, 0, 6, NaN]), 7);
  });

  it("respects decimal places", () => {
    assert.equal(calculateAvgScore([7, 8, 9], 1), 8);
    assert.equal(calculateAvgScore([7.33, 8.67], 2), 8);
  });
});

// --- validateParams middleware ---

describe("validateParams middleware", () => {
  function runMiddleware(specs: Record<string, "uuid" | "safeId" | "safeName">, params: Record<string, string>): { status?: number; body?: any; nextCalled: boolean } {
    const mw = validateParams(specs);
    let result: { status?: number; body?: any; nextCalled: boolean } = { nextCalled: false };
    const req = { params } as any;
    const res = {
      status(code: number) { result.status = code; return this; },
      json(body: any) { result.body = body; },
    } as any;
    const next = () => { result.nextCalled = true; };
    mw(req, res, next);
    return result;
  }

  it("accepts valid UUID", () => {
    const r = runMiddleware({ id: "uuid" }, { id: "550e8400-e29b-41d4-a716-446655440000" });
    assert.ok(r.nextCalled);
    assert.equal(r.status, undefined);
  });

  it("rejects invalid UUID", () => {
    const r = runMiddleware({ id: "uuid" }, { id: "not-a-uuid" });
    assert.ok(!r.nextCalled);
    assert.equal(r.status, 400);
  });

  it("rejects UUID with SQL injection", () => {
    const r = runMiddleware({ id: "uuid" }, { id: "'; DROP TABLE calls;--" });
    assert.ok(!r.nextCalled);
    assert.equal(r.status, 400);
  });

  it("accepts valid safeId", () => {
    const r = runMiddleware({ id: "safeId" }, { id: "incident-2026-001" });
    assert.ok(r.nextCalled);
  });

  it("rejects safeId with special chars", () => {
    const r = runMiddleware({ id: "safeId" }, { id: "id; rm -rf /" });
    assert.ok(!r.nextCalled);
    assert.equal(r.status, 400);
  });

  it("accepts valid safeName", () => {
    const r = runMiddleware({ teamName: "safeName" }, { teamName: "Sales Team (East)" });
    assert.ok(r.nextCalled);
  });

  it("rejects safeName with control chars", () => {
    const r = runMiddleware({ teamName: "safeName" }, { teamName: "team\x00name" });
    assert.ok(!r.nextCalled);
    assert.equal(r.status, 400);
  });

  it("skips missing optional params", () => {
    const r = runMiddleware({ id: "uuid", tagId: "uuid" }, { id: "550e8400-e29b-41d4-a716-446655440000" });
    assert.ok(r.nextCalled); // tagId not in params, should pass
  });

  it("validates multiple params at once", () => {
    const r = runMiddleware(
      { id: "uuid", tagId: "uuid" },
      { id: "550e8400-e29b-41d4-a716-446655440000", tagId: "bad!" }
    );
    assert.ok(!r.nextCalled);
    assert.equal(r.status, 400);
  });
});
