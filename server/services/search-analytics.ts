/**
 * Search analytics — in-memory rolling log of manager-facing search
 * activity, plus aggregation into a FAQ-style dashboard.
 *
 * Inspired by ums-knowledge-reference's faqAnalytics.ts (which clusters
 * KB questions from its query log). CA doesn't have an equivalent
 * "asked a question" surface — the closest analog is manager searches
 * via /api/search and /api/search/semantic. Clustering repeated
 * searches surfaces what managers keep looking for, which is a signal
 * for dashboard gaps, missing saved filters, or training opportunities.
 *
 * Design intentionally stays lightweight:
 *   - Rolling in-memory buffer, last N entries (default 1000).
 *   - No persistence — the signal is "what's been asked recently", not
 *     a historical audit. Restarts clear the buffer; we catch up within
 *     ~one business day of usage.
 *   - Aggregation computed on the fly from the buffer; cheap for N=1000.
 *
 * A future upgrade path is to back this with a `search_logs` table if
 * operators want historical patterns — the API shape this module
 * exposes is stable across that migration.
 */

import { logger } from "./logger";

type SearchMode = "keyword" | "semantic";

export interface SearchLogEntry {
  timestamp: string; // ISO
  username: string;
  query: string;
  mode: SearchMode;
  /** Number of results returned — 0 = gap signal. */
  resultCount: number;
}

export interface SearchClusterItem {
  /** Representative wording (most recent). */
  query: string;
  /** Total occurrences over the aggregation window. */
  frequency: number;
  /** Distinct users who issued this query. */
  users: string[];
  /** Most recent timestamp seen. */
  lastSeen: string;
  /** Average result count across occurrences; 0 is a gap. */
  avgResultCount: number;
}

export interface SearchAnalytics {
  window: { entries: number; capacity: number };
  totalSearches: number;
  uniqueUsers: number;
  modeBreakdown: { keyword: number; semantic: number };
  /** Most-repeated queries; top 20. */
  topQueries: SearchClusterItem[];
  /** Queries that returned zero results ≥2 times — concrete gaps. */
  zeroResultQueries: SearchClusterItem[];
  /** Per-user activity; sorted by volume descending. */
  userActivity: Array<{ username: string; searchCount: number }>;
}

const MAX_ENTRIES = 1000;
const ring: SearchLogEntry[] = [];

/**
 * Record a single search. Called from the /api/search and
 * /api/search/semantic middleware layer. Fire-and-forget; any error
 * is caught inside so logging failures can't surface as 500s.
 */
export function recordSearch(entry: Omit<SearchLogEntry, "timestamp"> & { timestamp?: string }): void {
  try {
    const full: SearchLogEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      username: entry.username,
      query: entry.query,
      mode: entry.mode,
      resultCount: entry.resultCount,
    };
    ring.push(full);
    if (ring.length > MAX_ENTRIES) ring.shift();
  } catch (err) {
    // Swallow — search UX must not break because logging failed.
    logger.warn("search-analytics: recordSearch threw", {
      error: (err as Error).message,
    });
  }
}

/**
 * Normalize a query for clustering — lowercase, strip punctuation,
 * collapse whitespace. Matches RAG's faqAnalytics normalization rule
 * so the two systems' cluster signals are directly comparable.
 */
function normalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/[?!.,;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Aggregate the current ring into a FAQ-style dashboard.
 */
export function getSearchAnalytics(): SearchAnalytics {
  if (ring.length === 0) {
    return {
      window: { entries: 0, capacity: MAX_ENTRIES },
      totalSearches: 0,
      uniqueUsers: 0,
      modeBreakdown: { keyword: 0, semantic: 0 },
      topQueries: [],
      zeroResultQueries: [],
      userActivity: [],
    };
  }

  const modeBreakdown = { keyword: 0, semantic: 0 };
  const userCount = new Map<string, number>();

  // key = normalized query
  const clusters = new Map<
    string,
    { original: string; count: number; users: Set<string>; lastSeen: string; resultSum: number }
  >();

  for (const e of ring) {
    modeBreakdown[e.mode]++;
    userCount.set(e.username, (userCount.get(e.username) ?? 0) + 1);

    const key = normalize(e.query);
    if (!key) continue; // skip empty / punctuation-only
    const existing = clusters.get(key);
    if (existing) {
      existing.count++;
      existing.users.add(e.username);
      existing.resultSum += e.resultCount;
      // Keep the most-recent wording as the canonical query text.
      if (e.timestamp > existing.lastSeen) {
        existing.lastSeen = e.timestamp;
        existing.original = e.query;
      }
    } else {
      clusters.set(key, {
        original: e.query,
        count: 1,
        users: new Set([e.username]),
        lastSeen: e.timestamp,
        resultSum: e.resultCount,
      });
    }
  }

  const allClusters = [...clusters.values()].map<SearchClusterItem>((c) => ({
    query: c.original,
    frequency: c.count,
    users: [...c.users],
    lastSeen: c.lastSeen,
    avgResultCount: c.count === 0 ? 0 : Math.round((c.resultSum / c.count) * 10) / 10,
  }));

  const topQueries = [...allClusters]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 20);

  // Zero-result is a gap signal. Require ≥2 occurrences so a single
  // typo doesn't float to the top — the pattern we care about is
  // "multiple managers hitting the same missing data".
  const zeroResultQueries = allClusters
    .filter((c) => c.avgResultCount === 0 && c.frequency >= 2)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 20);

  const userActivity = [...userCount.entries()]
    .map(([username, searchCount]) => ({ username, searchCount }))
    .sort((a, b) => b.searchCount - a.searchCount);

  return {
    window: { entries: ring.length, capacity: MAX_ENTRIES },
    totalSearches: ring.length,
    uniqueUsers: userCount.size,
    modeBreakdown,
    topQueries,
    zeroResultQueries,
    userActivity,
  };
}

/** Test seam — clear the ring buffer. */
export function _resetSearchAnalyticsForTests(): void {
  ring.length = 0;
}
