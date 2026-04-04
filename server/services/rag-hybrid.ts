/**
 * RAG Hybrid Search — semantic + BM25 keyword boosting.
 *
 * Adapted from Observatory QA's full RAG pipeline.
 * Combines vector similarity search (from existing rag-client.ts) with
 * BM25 keyword scoring for better retrieval relevance.
 *
 * Why hybrid? Pure vector search misses exact keyword matches (e.g., policy
 * numbers, product codes). Pure BM25 misses semantic similarity. Combining
 * both with configurable weights produces the best retrieval for call analysis
 * grounding (SOPs, scripts, compliance docs).
 *
 * Scoring formula: combined = (semanticWeight * vectorScore) + (bm25Weight * bm25Score)
 * Default weights: semantic 0.7, bm25 0.3
 */

export interface SearchResult {
  chunkId: string;
  text: string;
  documentName?: string;
  semanticScore: number;
  bm25Score: number;
  combinedScore: number;
}

export interface HybridSearchOptions {
  /** Weight for semantic (vector) search score (0-1, default 0.7) */
  semanticWeight?: number;
  /** Weight for BM25 keyword search score (0-1, default 0.3) */
  bm25Weight?: number;
  /** Maximum results to return (default 5) */
  topK?: number;
  /** Minimum combined score threshold (default 0.1) */
  minScore?: number;
}

// ==================== BM25 SCORING ====================

/**
 * Tokenize text into normalized terms for BM25 scoring.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Compute BM25 score for a query against a document.
 *
 * BM25 parameters:
 * - k1 = 1.2 (term frequency saturation)
 * - b = 0.75 (document length normalization)
 *
 * Returns a normalized 0-1 score.
 */
export function bm25Score(
  query: string,
  document: string,
  corpus: string[],
): number {
  const k1 = 1.2;
  const b = 0.75;

  const queryTerms = tokenize(query);
  const docTerms = tokenize(document);
  if (queryTerms.length === 0 || docTerms.length === 0) return 0;

  // Document frequency (how many corpus docs contain each term)
  const N = corpus.length;
  const avgDl = corpus.reduce((sum, doc) => sum + tokenize(doc).length, 0) / Math.max(N, 1);
  const dl = docTerms.length;

  // Term frequency in this document
  const tf = new Map<string, number>();
  for (const term of docTerms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  // Document frequency for each query term
  const df = new Map<string, number>();
  for (const qTerm of queryTerms) {
    let count = 0;
    for (const doc of corpus) {
      if (tokenize(doc).includes(qTerm)) count++;
    }
    df.set(qTerm, count);
  }

  let score = 0;
  for (const qTerm of queryTerms) {
    const termFreq = tf.get(qTerm) || 0;
    if (termFreq === 0) continue;

    const docFreq = df.get(qTerm) || 0;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (dl / avgDl)));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * Normalize scores to 0-1 range within a result set.
 */
function normalizeScores(scores: number[]): number[] {
  const max = Math.max(...scores, 0.001);
  return scores.map((s) => s / max);
}

/**
 * Perform hybrid search combining semantic and BM25 scores.
 *
 * @param query - The search query text
 * @param chunks - Array of {id, text, documentName, semanticScore} from vector search
 * @param allTexts - Full corpus of chunk texts (for BM25 IDF computation)
 * @param options - Weight and threshold configuration
 */
export function hybridRank(
  query: string,
  chunks: Array<{ id: string; text: string; documentName?: string; semanticScore: number }>,
  allTexts: string[],
  options?: HybridSearchOptions,
): SearchResult[] {
  const semanticWeight = options?.semanticWeight ?? 0.7;
  const bm25Weight = options?.bm25Weight ?? 0.3;
  const topK = options?.topK ?? 5;
  const minScore = options?.minScore ?? 0.1;

  if (chunks.length === 0) return [];

  // Compute BM25 scores
  const rawBm25 = chunks.map((c) => bm25Score(query, c.text, allTexts));
  const normalizedBm25 = normalizeScores(rawBm25);

  // Normalize semantic scores
  const rawSemantic = chunks.map((c) => c.semanticScore);
  const normalizedSemantic = normalizeScores(rawSemantic);

  // Combine scores
  const results: SearchResult[] = chunks.map((c, i) => ({
    chunkId: c.id,
    text: c.text,
    documentName: c.documentName,
    semanticScore: normalizedSemantic[i],
    bm25Score: normalizedBm25[i],
    combinedScore:
      Math.round(
        (semanticWeight * normalizedSemantic[i] + bm25Weight * normalizedBm25[i]) * 1000,
      ) / 1000,
  }));

  return results
    .filter((r) => r.combinedScore >= minScore)
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);
}
