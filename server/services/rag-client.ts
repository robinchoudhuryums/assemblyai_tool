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

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL?.replace(/\/$/, "");
const RAG_API_KEY = process.env.RAG_API_KEY || "";
const RAG_TIMEOUT_MS = 8_000; // 8 second timeout — don't block the pipeline

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
): Promise<{ context: string; sources: RagSource[] } | undefined> {
  if (!isRagEnabled()) return undefined;

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

    return { context, sources: data.sources.slice(0, 4) };
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
}

/**
 * Build a focused RAG query from call metadata.
 *
 * Instead of sending the full transcript (which may contain PHI and is too long),
 * we construct a targeted question about company procedures relevant to the call.
 */
export function buildRagQuery(
  callCategory?: string,
  topics?: string[],
  summary?: string,
): string {
  const parts: string[] = [];

  if (callCategory) {
    parts.push(`Call type: ${callCategory}.`);
  }

  if (topics?.length) {
    parts.push(`Topics discussed: ${topics.slice(0, 5).join(", ")}.`);
  }

  if (summary) {
    // Use first 300 chars of summary to keep query focused
    parts.push(`Summary: ${summary.slice(0, 300)}`);
  }

  if (parts.length === 0) {
    parts.push("General call quality evaluation procedures and compliance requirements.");
  }

  return `What are the relevant company policies, procedures, required phrases, and compliance requirements for this call? ${parts.join(" ")}`;
}
