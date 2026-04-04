/**
 * Best Practice Auto-Ingestion
 *
 * When a call scores exceptionally high (≥9.0), the transcript is automatically
 * sent to the Knowledge Base as a "best practice" reference document. This means
 * future RAG context retrieval includes real examples of excellent call handling.
 *
 * Flow:
 * 1. Pipeline detects exceptional score (≥9.0) and "exceptional_call" flag
 * 2. This service formats the transcript as a reference document
 * 3. The document is uploaded to the KB via the /api/documents endpoint
 * 4. Future RAG queries for the same call category retrieve the example
 *
 * Env vars:
 *   BEST_PRACTICE_INGEST_ENABLED — "true" to enable (default: disabled)
 *   RAG_SERVICE_URL, RAG_API_KEY — reuses the RAG connection settings
 *
 * Non-blocking: ingestion failure never affects the call pipeline.
 */

import { isRagEnabled } from "./rag-client";
import { logger } from "./logger";

const INGEST_TIMEOUT_MS = 15_000; // 15 seconds

export function isBestPracticeIngestEnabled(): boolean {
  return process.env.BEST_PRACTICE_INGEST_ENABLED === "true" && isRagEnabled();
}

/**
 * Submit an exceptional call transcript to the Knowledge Base as a best practice document.
 * Non-blocking — errors are logged but never thrown.
 */
export async function ingestBestPractice(params: {
  callId: string;
  callCategory?: string;
  score: number;
  agentName?: string;
  summary: string;
  transcript: string;
  strengths: string[];
}): Promise<void> {
  if (!isBestPracticeIngestEnabled()) return;

  const { callId, callCategory, score, agentName, summary, transcript, strengths } = params;

  // Format as a reference document
  const title = `Best Practice: ${callCategory || "General"} Call — Score ${score.toFixed(1)}/10${agentName ? ` (${agentName})` : ""}`;

  const content = [
    `# ${title}`,
    "",
    `**Call ID**: ${callId}`,
    `**Category**: ${callCategory || "general"}`,
    `**Score**: ${score.toFixed(1)}/10`,
    `**Date**: ${new Date().toISOString().split("T")[0]}`,
    agentName ? `**Agent**: ${agentName}` : "",
    "",
    "## Summary",
    summary,
    "",
    "## Key Strengths",
    ...strengths.map(s => `- ${s}`),
    "",
    "## Transcript",
    "The following is an example of excellent call handling that scored above 9.0:",
    "",
    transcript.slice(0, 5000), // Limit to 5000 chars to stay within KB upload limits
  ].filter(Boolean).join("\n");

  const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
  const RAG_API_KEY = process.env.RAG_API_KEY || "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);

  try {
    // Upload as a text document to the KB's document ingestion endpoint
    const formData = new Blob([content], { type: "text/plain" });
    const body = new FormData();
    body.append("file", formData, `best-practice-${callId}.txt`);
    body.append("collectionId", "best-practices"); // Dedicated collection for exemplary calls

    const response = await fetch(`${RAG_SERVICE_URL}/api/documents/upload`, {
      method: "POST",
      headers: { "X-API-Key": RAG_API_KEY },
      body,
      signal: controller.signal,
    });

    if (response.ok) {
      logger.info("Best practice ingested to KB", { callId, score, category: callCategory });
    } else {
      logger.warn("Best practice ingestion failed", { callId, status: response.status });
    }
  } catch (err) {
    logger.warn("Best practice ingestion error (non-blocking)", {
      callId, error: (err as Error).message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
