/**
 * RAG Knowledge Base Client
 *
 * Integrates with the ums-knowledge-reference service to retrieve relevant
 * company documentation (SOPs, compliance guides, product catalogs, scripts)
 * for grounding AI call analysis in actual company standards.
 *
 * Env vars:
 *   RAG_SERVICE_URL  — Base URL of the knowledge reference API
 *   RAG_ENABLED      — "true" to enable (default: disabled)
 *   RAG_API_KEY      — API key for service-to-service auth (X-API-Key header)
 *
 * Graceful fallback: if the RAG service is unavailable, analysis proceeds
 * without additional context (current behavior).
 */

import { withSpan } from "./trace-span";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
const RAG_API_KEY = process.env.RAG_API_KEY || "";
const RAG_TIMEOUT_MS = 8_000; // 8 second timeout — don't block the pipeline

// --- Category-based RAG cache ---
// Calls with the same category often need the same company policies/procedures.
// Cache RAG results by category for 10 minutes to avoid redundant API calls.
// This can save 80%+ of RAG queries in high-volume processing.
const RAG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RAG_CACHE_MAX = 20; // Max cached categories
const ragCache = new Map<string, { result: { context: string; sources: RagSource[] }; expiresAt: number }>();

function getCachedRagContext(cacheKey: string): { context: string; sources: RagSource[] } | undefined {
  const entry = ragCache.get(cacheKey);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    ragCache.delete(cacheKey);
    return undefined;
  }
  return entry.result;
}

function setCachedRagContext(cacheKey: string, result: { context: string; sources: RagSource[] }): void {
  // LRU eviction
  if (ragCache.size >= RAG_CACHE_MAX) {
    const oldest = ragCache.keys().next().value;
    if (oldest) ragCache.delete(oldest);
  }
  ragCache.set(cacheKey, { result, expiresAt: Date.now() + RAG_CACHE_TTL_MS });
}

export function isRagEnabled(): boolean {
  return process.env.RAG_ENABLED === "true" && !!RAG_SERVICE_URL && !!RAG_API_KEY;
}

interface RagSource {
  documentId: string;
  documentName: string;
  chunkId: string;
  text: string;
  pageNumber?: number;
  sectionHeader?: string;
  score: number;
}

interface RagResponse {
  answer: string;
  sources: RagSource[];
  confidence: "high" | "partial" | "low";
  traceId?: string;
}

/**
 * Query the knowledge base for context relevant to a call transcript.
 *
 * Builds a focused query from the transcript summary/category rather than
 * sending the full transcript (which could be huge and contain PHI).
 *
 * @param question - A focused query (e.g., call category + key topics)
 * @param collectionIds - Optional collection IDs to restrict search scope
 * @returns RAG context string for prompt injection, or undefined on failure
 */
export async function fetchRagContext(
  question: string,
  collectionIds?: string[],
  cacheKey?: string,
): Promise<{ context: string; sources: RagSource[] } | undefined> {
  if (!isRagEnabled()) return undefined;

  // Check cache first (category-based queries return similar results)
  if (cacheKey) {
    const cached = getCachedRagContext(cacheKey);
    if (cached) {
      console.log(`[RAG] Cache hit for "${cacheKey}"`);
      return cached;
    }
  }

  return withSpan("rag.fetchContext", { questionChars: question.length, serviceUrl: RAG_SERVICE_URL || "", cacheKey: cacheKey || "none" }, async (span) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${RAG_SERVICE_URL}/api/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": RAG_API_KEY,
      },
      body: JSON.stringify({
        question,
        collectionIds: collectionIds?.length ? collectionIds : undefined,
        topK: 6,
        responseStyle: "concise",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[RAG] Knowledge base returned ${response.status}: ${response.statusText}`);
      return undefined;
    }

    const data: RagResponse = await response.json();

    if (!data.answer || data.confidence === "low") {
      // Knowledge base didn't have useful context — skip injection
      return undefined;
    }

    // Build context block for prompt injection
    const sourceRefs = data.sources
      .slice(0, 4) // Limit to top 4 sources to keep prompt reasonable
      .map((s, i) => `[Ref ${i + 1}: ${s.documentName}${s.pageNumber ? ` p.${s.pageNumber}` : ""}] ${s.text.slice(0, 500)}`)
      .join("\n\n");

    const context = `${data.answer}\n\nRelevant source excerpts:\n${sourceRefs}`;

    span.setAttribute("sourceCount", data.sources.length);
    span.setAttribute("confidence", data.confidence);
    const result = { context, sources: data.sources.slice(0, 4) };
    if (cacheKey) setCachedRagContext(cacheKey, result);
    return result;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[RAG] Knowledge base request timed out");
    } else {
      console.warn("[RAG] Knowledge base request failed:", (err as Error).message);
    }
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
  }); // end withSpan
}

/**
 * Category-specific query templates.
 * These produce much higher quality RAG retrieval than raw transcript text
 * because they use domain-specific terminology the knowledge base was built for.
 */
const CATEGORY_QUERIES: Record<string, string> = {
  inbound: "What are the required procedures, greeting scripts, verification steps, and compliance requirements for handling inbound customer calls at a medical supply company? Include HIPAA verification requirements and required disclosures.",
  outbound: "What are the required procedures, disclosure requirements, and compliance guidelines for outbound calls to patients and customers at a medical supply company? Include consent verification and callback protocols.",
  internal: "What are the guidelines for internal calls between departments at a medical supply company? Include information handoff procedures, escalation protocols, and documentation requirements.",
  vendor: "What are the procedures and compliance requirements for calls with vendors, insurance companies, and medical facilities? Include verification procedures and authorization protocols.",
};

const DEFAULT_QUERY = "What are the general call quality evaluation procedures, required phrases, compliance requirements, and HIPAA guidelines for customer service calls at a medical supply company?";

/**
 * Build a focused RAG query from call metadata.
 *
 * Uses category-specific templates for high retrieval quality.
 * Returns both the query and a cache key — calls with the same category
 * can reuse cached RAG context (policies don't change between calls).
 */
export function buildRagQuery(
  callCategory?: string,
  topics?: string[],
  _summary?: string,
): { query: string; cacheKey: string } {
  // Category-specific template (best retrieval quality)
  const baseQuery = (callCategory && CATEGORY_QUERIES[callCategory]) || DEFAULT_QUERY;

  // Append topics if available (adds specificity without raw transcript text)
  let query = baseQuery;
  if (topics?.length) {
    query += ` Topics discussed: ${topics.slice(0, 5).join(", ")}.`;
  }

  // Cache key: category (or "general") — topics are too variable to cache on
  const cacheKey = `rag:${callCategory || "general"}`;

  return { query, cacheKey };
}
