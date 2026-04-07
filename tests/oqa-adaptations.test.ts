/**
 * Tests for patterns adapted from Observatory QA into Call Analyzer:
 * - Structured error handling (AppError + asyncHandler)
 * - Durable job queue
 * - Enhanced MFA (backup codes, trusted devices, WebAuthn)
 * - RAG hybrid search (semantic + BM25)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Structured error handling", () => {
  it("AppError has statusCode, code, and message", async () => {
    const { AppError } = await import("../server/middleware/error-handler.js");
    const err = new AppError(404, "NOT_FOUND", "Item not found");
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, "NOT_FOUND");
    assert.equal(err.message, "Item not found");
    assert.ok(err instanceof Error);
  });

  it("AppError supports optional detail", async () => {
    const { AppError } = await import("../server/middleware/error-handler.js");
    const err = new AppError(400, "VALIDATION_ERROR", "Bad input", "Field 'name' is required");
    assert.equal(err.detail, "Field 'name' is required");
  });

  it("ERROR_CODES contains expected keys", async () => {
    const { ERROR_CODES } = await import("../server/middleware/error-handler.js");
    assert.ok(ERROR_CODES.NOT_FOUND);
    assert.ok(ERROR_CODES.UNAUTHORIZED);
    assert.ok(ERROR_CODES.INTERNAL_ERROR);
    assert.ok(ERROR_CODES.AI_UNAVAILABLE);
  });
});

// Durable job queue tests removed (A40): services/durable-queue.ts was
// dead code — the production queue is JobQueue in services/job-queue.ts
// backed by PostgreSQL. Those tests are covered in tests/job-queue.test.ts.

// Enhanced MFA module (server/services/mfa-enhanced.ts) was removed as dead code (A3).
// Backup codes / trusted devices / WebAuthn were never wired into any route.

describe("RAG hybrid search", () => {
  it("bm25Score returns higher score for matching terms", async () => {
    const { bm25Score } = await import("../server/services/rag-hybrid.js");
    const corpus = ["billing policy for insurance claims", "scheduling appointments guide", "emergency procedures"];
    const matchScore = bm25Score("billing insurance", "billing policy for insurance claims", corpus);
    const noMatchScore = bm25Score("billing insurance", "emergency procedures", corpus);
    assert.ok(matchScore > noMatchScore, `Match (${matchScore}) should score higher than no-match (${noMatchScore})`);
  });

  it("bm25Score returns 0 for empty query", async () => {
    const { bm25Score } = await import("../server/services/rag-hybrid.js");
    assert.equal(bm25Score("", "some document text", ["some document text"]), 0);
  });

  it("hybridRank combines semantic and BM25 scores", async () => {
    const { hybridRank } = await import("../server/services/rag-hybrid.js");
    const chunks = [
      { id: "c1", text: "billing policy for insurance claims", semanticScore: 0.9 },
      { id: "c2", text: "scheduling appointments guide", semanticScore: 0.3 },
      { id: "c3", text: "insurance billing procedures and claims", semanticScore: 0.7 },
    ];
    const allTexts = chunks.map((c) => c.text);

    const results = hybridRank("billing insurance claims", chunks, allTexts);
    assert.ok(results.length > 0);
    // First result should have highest combined score
    assert.ok(results[0].combinedScore >= results[results.length - 1].combinedScore);
    // Each result should have both score components
    for (const r of results) {
      assert.ok(r.semanticScore >= 0);
      assert.ok(r.bm25Score >= 0);
      assert.ok(r.combinedScore >= 0);
    }
  });

  it("hybridRank respects topK limit", async () => {
    const { hybridRank } = await import("../server/services/rag-hybrid.js");
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      text: `document ${i} about billing`,
      semanticScore: Math.random(),
    }));
    const results = hybridRank("billing", chunks, chunks.map((c) => c.text), { topK: 3 });
    assert.ok(results.length <= 3);
  });

  it("hybridRank filters below minScore", async () => {
    const { hybridRank } = await import("../server/services/rag-hybrid.js");
    const chunks = [
      { id: "c1", text: "completely unrelated text about weather", semanticScore: 0.01 },
    ];
    // With only 1 chunk, normalization makes its score 1.0. Use a very high threshold.
    const results = hybridRank("billing claims", chunks, [chunks[0].text], { minScore: 1.5 });
    assert.equal(results.length, 0, "Results above threshold should be filtered");
  });
});
