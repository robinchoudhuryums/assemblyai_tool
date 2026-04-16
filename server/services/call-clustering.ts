/**
 * Call Clustering Service
 *
 * Groups calls by topic similarity using TF-IDF cosine similarity
 * on AI-extracted topics and keywords. No external embedding model needed.
 * Surfaces "trending issues" — topic clusters that are growing in frequency.
 */
import { storage } from "../storage";
import type { CallWithDetails } from "@shared/schema";
import { logger } from "./logger";

export interface TopicCluster {
  id: string;
  label: string;
  topics: string[];
  callCount: number;
  callIds: string[];
  avgScore: number | null;
  avgSentiment: { positive: number; neutral: number; negative: number };
  trend: "rising" | "stable" | "declining";
  recentCallIds: string[]; // last 7 days
}

interface TermFrequency {
  callId: string;
  terms: Map<string, number>;
  uploadedAt: string;
}

/**
 * Tokenize and normalize topics/keywords from a call analysis
 */
function extractTerms(call: CallWithDetails): string[] {
  const terms: string[] = [];

  // Extract topics
  if (call.analysis?.topics && Array.isArray(call.analysis.topics)) {
    for (const topic of call.analysis.topics) {
      const text = typeof topic === "string" ? topic
        : (topic && typeof topic === "object") ? (String((topic as Record<string, unknown>).text || (topic as Record<string, unknown>).name || "")) : "";
      if (text) {
        // Split multi-word topics into individual terms + keep full phrase
        const normalized = text.toLowerCase().trim();
        terms.push(normalized);
        const words = normalized.split(/\s+/).filter((w: string) => w.length >= 3);
        terms.push(...words);
      }
    }
  }

  // Extract keywords
  if (call.analysis?.keywords && Array.isArray(call.analysis.keywords)) {
    for (const kw of call.analysis.keywords) {
      const text = typeof kw === "string" ? kw : "";
      if (text.length >= 3) terms.push(text.toLowerCase().trim());
    }
  }

  // Extract summary terms (top nouns/phrases)
  if (call.analysis?.summary && typeof call.analysis.summary === "string") {
    const words = call.analysis.summary.toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
    terms.push(...words.slice(0, 10)); // limit to avoid noise
  }

  return terms;
}

const STOP_WORDS = new Set([
  "the", "and", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "doing", "will", "would", "could", "should", "shall",
  "this", "that", "these", "those", "with", "from", "into", "about",
  "then", "than", "they", "them", "their", "there", "here", "what",
  "when", "where", "which", "while", "also", "very", "just", "only",
  "call", "caller", "agent", "customer", "said", "called", "told",
]);

/**
 * Build TF-IDF vectors for a set of calls
 */
function buildTfIdf(calls: CallWithDetails[]): TermFrequency[] {
  const docTerms: TermFrequency[] = [];
  const docFreq = new Map<string, number>(); // term → number of docs containing it

  // First pass: extract terms per call
  for (const call of calls) {
    const terms = extractTerms(call);
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    docTerms.push({ callId: call.id, terms: tf, uploadedAt: call.uploadedAt || "" });

    // Count document frequency
    for (const term of tf.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Second pass: apply IDF weighting
  const N = calls.length;
  for (const dt of docTerms) {
    for (const [term, count] of dt.terms) {
      const idf = Math.log(N / (docFreq.get(term) || 1));
      dt.terms.set(term, count * idf);
    }
  }

  return docTerms;
}

/**
 * Cosine similarity between two term vectors
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [term, valA] of a) {
    const valB = b.get(term) || 0;
    dot += valA * valB;
    magA += valA * valA;
  }
  for (const valB of b.values()) {
    magB += valB * valB;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag > 0 ? dot / mag : 0;
}

/**
 * Simple agglomerative clustering using cosine similarity
 */
function clusterCalls(
  docTerms: TermFrequency[],
  similarityThreshold = 0.15,
): Map<number, TermFrequency[]> {
  // Assign each doc to a cluster
  const assignments = new Array(docTerms.length).fill(-1);
  let nextCluster = 0;

  for (let i = 0; i < docTerms.length; i++) {
    if (assignments[i] !== -1) continue;
    assignments[i] = nextCluster;

    // Find all similar docs
    for (let j = i + 1; j < docTerms.length; j++) {
      if (assignments[j] !== -1) continue;
      const sim = cosineSimilarity(docTerms[i].terms, docTerms[j].terms);
      if (sim >= similarityThreshold) {
        assignments[j] = nextCluster;
      }
    }
    nextCluster++;
  }

  // Group by cluster
  const clusters = new Map<number, TermFrequency[]>();
  for (let i = 0; i < assignments.length; i++) {
    const cid = assignments[i];
    if (!clusters.has(cid)) clusters.set(cid, []);
    clusters.get(cid)!.push(docTerms[i]);
  }

  return clusters;
}

/**
 * Get top terms for a cluster (by aggregate TF-IDF score)
 */
function getClusterTopTerms(docs: TermFrequency[], limit = 5): string[] {
  const aggregate = new Map<string, number>();
  for (const doc of docs) {
    for (const [term, score] of doc.terms) {
      aggregate.set(term, (aggregate.get(term) || 0) + score);
    }
  }
  return Array.from(aggregate.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

/**
 * Determine trend by comparing recent vs older call counts
 */
function determineTrend(docs: { uploadedAt: string }[]): "rising" | "stable" | "declining" {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const fourteenDaysAgo = now - 14 * 86400000;

  const recent = docs.filter(d => new Date(d.uploadedAt).getTime() >= sevenDaysAgo).length;
  const older = docs.filter(d => {
    const t = new Date(d.uploadedAt).getTime();
    return t >= fourteenDaysAgo && t < sevenDaysAgo;
  }).length;

  if (recent > older * 1.3) return "rising";
  if (recent < older * 0.7) return "declining";
  return "stable";
}

/**
 * Cosine similarity between two embedding vectors
 */
function embeddingCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag > 0 ? dot / mag : 0;
}

/**
 * Cluster using Bedrock Titan embeddings (higher accuracy).
 * Threshold is higher than TF-IDF since embeddings capture semantic similarity.
 */
function clusterByEmbeddings(
  callsWithEmbeddings: { callId: string; embedding: number[]; uploadedAt: string }[],
  similarityThreshold = 0.6,
): Map<number, { callId: string; uploadedAt: string }[]> {
  const assignments = new Array(callsWithEmbeddings.length).fill(-1);
  let nextCluster = 0;

  for (let i = 0; i < callsWithEmbeddings.length; i++) {
    if (assignments[i] !== -1) continue;
    assignments[i] = nextCluster;

    for (let j = i + 1; j < callsWithEmbeddings.length; j++) {
      if (assignments[j] !== -1) continue;
      const sim = embeddingCosineSimilarity(
        callsWithEmbeddings[i].embedding,
        callsWithEmbeddings[j].embedding
      );
      if (sim >= similarityThreshold) {
        assignments[j] = nextCluster;
      }
    }
    nextCluster++;
  }

  const clusters = new Map<number, { callId: string; uploadedAt: string }[]>();
  for (let i = 0; i < assignments.length; i++) {
    const cid = assignments[i];
    if (!clusters.has(cid)) clusters.set(cid, []);
    clusters.get(cid)!.push({
      callId: callsWithEmbeddings[i].callId,
      uploadedAt: callsWithEmbeddings[i].uploadedAt,
    });
  }
  return clusters;
}

/**
 * Main clustering function — returns topic clusters for calls.
 * Uses Bedrock Titan embeddings when available (higher accuracy),
 * falls back to TF-IDF cosine similarity otherwise.
 */
export async function getCallClusters(options: {
  days?: number;
  employeeId?: string;
  minClusterSize?: number;
}): Promise<TopicCluster[]> {
  const days = options.days || 30;
  const minSize = options.minClusterSize || 2;

  const filters: { employee?: string } = {};
  if (options.employeeId) filters.employee = options.employeeId;

  const allCalls = await storage.getCallsWithDetails(filters);
  const cutoff = Date.now() - days * 86400000;
  const sevenDaysAgo = Date.now() - 7 * 86400000;

  const calls = allCalls.filter(c =>
    c.status === "completed" &&
    c.analysis &&
    new Date(c.uploadedAt || 0).getTime() >= cutoff
  );

  if (calls.length < 2) return [];

  // Cap input size to prevent O(n²) clustering from consuming too much CPU.
  // Use the most recent calls if over the limit.
  const MAX_CLUSTER_INPUT = 500;
  if (calls.length > MAX_CLUSTER_INPUT) {
    calls.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
    calls.length = MAX_CLUSTER_INPUT;
  }

  // Build call lookup for enrichment
  const callMap = new Map(calls.map(c => [c.id, c]));

  // Check how many calls have embeddings
  const callsWithEmbeddings = calls
    .filter(c => {
      const a = c.analysis as Record<string, unknown> | undefined;
      return a?.embedding && Array.isArray(a.embedding);
    })
    .map(c => ({
      callId: c.id,
      embedding: (c.analysis as Record<string, unknown>).embedding as number[],
      uploadedAt: c.uploadedAt || "",
    }));

  const embeddingCoverage = callsWithEmbeddings.length / calls.length;
  const useEmbeddings = embeddingCoverage >= 0.5; // Use embeddings if 50%+ coverage

  let clusters: Map<number, { callId: string; uploadedAt: string }[]>;
  let docTermsForLabels: TermFrequency[] | null = null;

  if (useEmbeddings) {
    logger.info("Using embedding-based clustering", { embeddingCount: callsWithEmbeddings.length, totalCalls: calls.length });
    clusters = clusterByEmbeddings(callsWithEmbeddings);
    // Still build TF-IDF for labels (but only for calls in clusters)
    docTermsForLabels = buildTfIdf(calls);
  } else {
    logger.info("Using TF-IDF clustering", { embeddingCount: callsWithEmbeddings.length, totalCalls: calls.length });
    const docTerms = buildTfIdf(calls);
    const tfIdfClusters = clusterCalls(docTerms);
    docTermsForLabels = docTerms;
    // Convert to same format
    clusters = new Map();
    for (const [cid, docs] of tfIdfClusters) {
      clusters.set(cid, docs.map(d => ({ callId: d.callId, uploadedAt: d.uploadedAt })));
    }
  }

  // Convert to TopicCluster format
  const results: TopicCluster[] = [];
  for (const [clusterId, docs] of clusters) {
    if (docs.length < minSize) continue;

    // Get TF-IDF terms for this cluster's calls (for labeling)
    const clusterCallIds = new Set(docs.map(d => d.callId));
    const clusterDocTerms = (docTermsForLabels || []).filter(dt => clusterCallIds.has(dt.callId));
    const topTerms = getClusterTopTerms(clusterDocTerms);
    const matchedCalls = docs.map(d => callMap.get(d.callId)).filter(Boolean) as CallWithDetails[];

    // Compute aggregates
    let totalScore = 0, scoredCount = 0;
    const sentiment = { positive: 0, neutral: 0, negative: 0 };

    for (const call of matchedCalls) {
      if (call.analysis?.performanceScore != null) {
        totalScore += Number(call.analysis.performanceScore);
        scoredCount++;
      }
      const sent = call.sentiment?.overallSentiment;
      if (sent === "positive") sentiment.positive++;
      else if (sent === "negative") sentiment.negative++;
      else sentiment.neutral++;
    }

    const recentCallIds = docs
      .filter(d => new Date(d.uploadedAt).getTime() >= sevenDaysAgo)
      .map(d => d.callId);

    results.push({
      id: `cluster-${clusterId}`,
      label: topTerms.slice(0, 3).join(", "),
      topics: topTerms,
      callCount: docs.length,
      callIds: docs.map(d => d.callId),
      avgScore: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 10) / 10 : null,
      avgSentiment: sentiment,
      trend: determineTrend(docs),
      recentCallIds,
    });
  }

  // Sort by call count descending
  results.sort((a, b) => b.callCount - a.callCount);

  return results;
}
