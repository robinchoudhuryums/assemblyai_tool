/**
 * Pure scoring helpers for the RAG-integration eval harness. Kept
 * separate from the runner so they can be unit-tested without
 * touching AWS / RAG.
 *
 * `keywordCoverage` matches ums-knowledge-reference's ragMetrics.ts
 * behavior: case-insensitive whole-word-ish match, normalized
 * whitespace. Returns the fraction of expected keywords found.
 */

export interface CoverageResult {
  retrievedText: string;
  expectedKeywords: string[];
  matched: string[];
  missing: string[];
  coverage: number; // 0 to 1
}

/**
 * Compute the fraction of expected keywords present in the retrieved
 * text. Normalizes both sides (lowercase, collapse whitespace) so
 * "High Confidence" matches "high confidence".
 *
 * Multi-word keywords ("prior authorization") are matched as substrings
 * after normalization, which is forgiving of word-boundary punctuation.
 */
export function keywordCoverage(
  retrievedText: string,
  expectedKeywords: string[],
): CoverageResult {
  const haystack = retrievedText.toLowerCase().replace(/\s+/g, " ").trim();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const k of expectedKeywords) {
    const needle = k.toLowerCase().replace(/\s+/g, " ").trim();
    if (!needle) continue;
    if (haystack.includes(needle)) {
      matched.push(k);
    } else {
      missing.push(k);
    }
  }
  const coverage =
    expectedKeywords.length === 0 ? 1 : matched.length / expectedKeywords.length;
  return { retrievedText, expectedKeywords, matched, missing, coverage };
}

/**
 * Aggregate the coverage across many pairs. Returns the mean, plus
 * count of pairs that fully passed (coverage === 1).
 */
export function aggregateCoverage(results: CoverageResult[]): {
  mean: number;
  fullyCovered: number;
  total: number;
} {
  if (results.length === 0) return { mean: 0, fullyCovered: 0, total: 0 };
  const sum = results.reduce((s, r) => s + r.coverage, 0);
  const fully = results.filter((r) => r.coverage === 1).length;
  return { mean: sum / results.length, fullyCovered: fully, total: results.length };
}

/**
 * Escape XML special chars for JUnit output.
 */
export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}
