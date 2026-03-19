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
} from "../server/routes/utils.js";

describe("estimateBedrockCost", () => {
  it("calculates cost for Sonnet 4.6", () => {
    // 1000 input tokens * $0.003/1K + 500 output tokens * $0.015/1K
    const cost = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", 1000, 500);
    assert.equal(cost, 0.003 + 0.0075);
  });

  it("calculates cost for Haiku 4.5", () => {
    const cost = estimateBedrockCost("us.anthropic.claude-haiku-4-5-20251001", 1000, 500);
    assert.equal(cost, 0.001 + 0.0025);
  });

  it("calculates cost for Claude 3 Haiku (cheapest)", () => {
    const cost = estimateBedrockCost("anthropic.claude-3-haiku-20240307", 1000, 500);
    assert.equal(cost, 0.00025 + 0.000625);
  });

  it("uses Sonnet default pricing for unknown models", () => {
    const cost = estimateBedrockCost("unknown-model", 1000, 500);
    assert.equal(cost, 0.003 + 0.0075);
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
    // 60 seconds * $0.0000472/sec
    const cost = estimateAssemblyAICost(60, true);
    assert.equal(Math.round(cost * 10000000) / 10000000, 0.002832);
  });

  it("calculates cost without sentiment", () => {
    const cost = estimateAssemblyAICost(60, false);
    assert.equal(Math.round(cost * 10000000) / 10000000, 0.002502);
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
