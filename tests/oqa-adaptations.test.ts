/**
 * Tests for patterns adapted from Observatory QA into Call Analyzer:
 * - Structured error handling (AppError + asyncHandler)
 * - Durable job queue
 * - Enhanced MFA (backup codes, trusted devices, WebAuthn)
 * - RAG hybrid search (semantic + BM25) — REMOVED in A8: rag-hybrid.ts was
 *   dead code (no production imports) and has been deleted.
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

// RAG hybrid search tests removed (A8): server/services/rag-hybrid.ts was
// dead code — no production file imported it. The file and these tests were
// deleted together. If hybrid retrieval is ever needed, reintroduce as a
// production-wired service first, then add tests.
