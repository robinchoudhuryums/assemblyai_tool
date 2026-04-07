/**
 * RAG Knowledge Base Client
 *
 * Integrates with the ums-knowledge-reference service to retrieve relevant
 * company documentation (SOPs, compliance guides, product catalogs, scripts)
 * for grounding AI call analysis in actual company standards.
 *
 * Env vars:
 *   RAG_SERVICE_URL      — Base URL of the knowledge reference API
 *   RAG_ENABLED          — "true" to enable (default: disabled)
 *   RAG_API_KEY          — API key for service-to-service auth (X-API-Key header)
 *   RAG_CACHE_TTL_MIN    — Cache TTL in minutes (default: 30)
 *   RAG_CACHE_SIZE       — Max cache entries (default: 50)
 *
 * Graceful fallback: if the RAG service is unavailable, analysis proceeds
 * without additional context (current behavior).
 */

import { withSpan } from "./trace-span";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
const RAG_API_KEY = process.env.RAG_API_KEY || "";
const RAG_TIMEOUT_MS = 8_000;

// A6/F10: In production, reject plaintext http:// RAG URLs. The API key is sent
// in the X-API-Key header on every request — over http:// it would leak in
// transit. Boot-fail in prod; warn in dev so localhost workflows still work.
if (RAG_SERVICE_URL && RAG_SERVICE_URL.startsWith("http://")) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `RAG_SERVICE_URL must use https:// in production (got: ${RAG_SERVICE_URL}). ` +
      `Plaintext http would leak the RAG_API_KEY in transit.`
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[RAG] RAG_SERVICE_URL is plaintext http:// — only allowed outside production (${RAG_SERVICE_URL})`);
  }
}

// --- LFU (Least Frequently Used) Cache with metrics ---

const RAG_CACHE_TTL_MS = (parseInt(process.env.RAG_CACHE_TTL_MIN || "30", 10) || 30) * 60 * 1000;
const RAG_CACHE_MAX = parseInt(process.env.RAG_CACHE_SIZE || "50", 10) || 50;

interface CacheEntry {
  result: { context: string; sources: RagSource[] };
  expiresAt: number;
  hits: number;
  lastAccessAt: number;
}

const ragCache = new Map<string, CacheEntry>();
const cacheMetrics = { hits: 0, misses: 0 };

function getCachedRagContext(cacheKey: string): { context: string; sources: RagSource[] } | undefined {
  const entry = ragCache.get(cacheKey);
  if (!entry) { cacheMetrics.misses++; return undefined; }
  if (Date.now() > entry.expiresAt) { ragCache.delete(cacheKey); cacheMetrics.misses++; return undefined; }
  entry.hits++;
  entry.lastAccessAt = Date.now();
  cacheMetrics.hits++;
  return entry.result;
}

function setCachedRagContext(cacheKey: string, result: { context: string; sources: RagSource[] }): void {
  if (ragCache.size >= RAG_CACHE_MAX) {
    // Evict least-frequently-used entry
    let leastKey: string | null = null;
    let leastHits = Infinity;
    for (const [key, entry] of ragCache) {
      if (entry.hits < leastHits) { leastHits = entry.hits; leastKey = key; }
    }
    if (leastKey) ragCache.delete(leastKey);
  }
  ragCache.set(cacheKey, { result, expiresAt: Date.now() + RAG_CACHE_TTL_MS, hits: 1, lastAccessAt: Date.now() });
}

/** Cache metrics for admin monitoring (GET /api/admin/rag-cache-metrics) */
export function getRagCacheMetrics() {
  const total = cacheMetrics.hits + cacheMetrics.misses;
  return {
    hits: cacheMetrics.hits,
    misses: cacheMetrics.misses,
    hitRate: total > 0 ? `${(cacheMetrics.hits / total * 100).toFixed(1)}%` : "0%",
    entries: ragCache.size,
    maxEntries: RAG_CACHE_MAX,
    ttlMinutes: RAG_CACHE_TTL_MS / 60000,
  };
}

// --- Types ---

export function isRagEnabled(): boolean {
  if (process.env.RAG_ENABLED !== "true") return false;
  if (!RAG_SERVICE_URL || !RAG_API_KEY) return false;
  // In production, refuse to enable against a plaintext http:// URL.
  if (process.env.NODE_ENV === "production" && RAG_SERVICE_URL.startsWith("http://")) return false;
  return true;
}

export interface RagSource {
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

// --- Fetch ---

export async function fetchRagContext(
  question: string,
  collectionIds?: string[],
  cacheKey?: string,
): Promise<{ context: string; sources: RagSource[]; confidence: "high" | "partial" } | undefined> {
  if (!isRagEnabled()) return undefined;

  // A11/F11: wrap cache hits in their own span so traces show RAG cache
  // activity (latency-near-zero, hit=true) instead of disappearing entirely.
  if (cacheKey) {
    const cached = getCachedRagContext(cacheKey);
    if (cached) {
      return withSpan("rag.fetchContext", { questionChars: question.length, cacheKey, cacheHit: true }, async (span) => {
        span.setAttribute("cacheHit", true);
        span.setAttribute("sourceCount", cached.sources.length);
        return cached as { context: string; sources: RagSource[]; confidence: "high" | "partial" };
      });
    }
  }

  return withSpan("rag.fetchContext", { questionChars: question.length, cacheKey: cacheKey || "none", cacheHit: false }, async (span) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${RAG_SERVICE_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": RAG_API_KEY },
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

    if (!data.answer || data.confidence === "low") return undefined;

    // Confidence-aware source filtering: high = 4 sources, partial = 2
    const sourceLimit = data.confidence === "high" ? 4 : 2;
    const topSources = data.sources.slice(0, sourceLimit);

    const sourceRefs = topSources
      .map((s, i) => `[Ref ${i + 1}: ${s.documentName}${s.pageNumber ? ` p.${s.pageNumber}` : ""}] ${s.text.slice(0, 500)}`)
      .join("\n\n");

    // Add confidence note for partial matches so the AI knows to supplement with general knowledge
    const confidenceNote = data.confidence === "partial"
      ? "\n(Note: Partial knowledge base match — supplement with general industry best practices where gaps exist.)"
      : "";

    const context = `${data.answer}${confidenceNote}\n\nRelevant source excerpts:\n${sourceRefs}`;

    span.setAttribute("sourceCount", topSources.length);
    span.setAttribute("confidence", data.confidence);
    const result = { context, sources: topSources, confidence: data.confidence as "high" | "partial" };
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

// --- Query Templates ---

const CATEGORY_QUERIES: Record<string, string> = {
  inbound: "What are the required procedures, greeting scripts, verification steps, and compliance requirements for handling inbound customer calls at a medical supply company? Include HIPAA verification requirements and required disclosures.",
  outbound: "What are the required procedures, disclosure requirements, and compliance guidelines for outbound calls to patients and customers at a medical supply company? Include consent verification and callback protocols.",
  internal: "What are the guidelines for internal calls between departments at a medical supply company? Include information handoff procedures, escalation protocols, and documentation requirements.",
  vendor: "What are the procedures and compliance requirements for calls with vendors, insurance companies, and medical facilities? Include verification procedures and authorization protocols.",
};

const DEFAULT_QUERY = "What are the general call quality evaluation procedures, required phrases, compliance requirements, and HIPAA guidelines for customer service calls at a medical supply company?";

export function buildRagQuery(
  callCategory?: string,
  topics?: string[],
  _summary?: string,
): { query: string; cacheKey: string } {
  const baseQuery = (callCategory && CATEGORY_QUERIES[callCategory]) || DEFAULT_QUERY;
  let query = baseQuery;
  if (topics?.length) {
    query += ` Topics discussed: ${topics.slice(0, 5).join(", ")}.`;
  }
  const cacheKey = `rag:${callCategory || "general"}`;
  return { query, cacheKey };
}
