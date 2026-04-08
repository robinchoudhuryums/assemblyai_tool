/**
 * Pure helpers for transcript-viewer search highlighting.
 *
 * Extracted from transcript-viewer.tsx so the multi-hit active-occurrence
 * logic can be exercised in unit tests without standing up the full React
 * component (audio element, hooks, etc.).
 */

export interface TranscriptSegmentLike {
  text: string;
}

export interface SearchMatch {
  segmentIndex: number;
  charIndex: number;
}

/**
 * Walk all transcript segments, returning every occurrence of `query`
 * (case-insensitive) as a {segmentIndex, charIndex} tuple.
 */
export function computeSearchMatches(
  segments: TranscriptSegmentLike[],
  query: string,
): SearchMatch[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const matches: SearchMatch[] = [];
  segments.forEach((seg, segIdx) => {
    const text = seg.text.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(trimmed, pos)) !== -1) {
      matches.push({ segmentIndex: segIdx, charIndex: pos });
      pos += 1; // overlap-safe step
    }
  });
  return matches;
}

/**
 * Map a part-start char position back to its global match index.
 *
 * Used by the highlightKeywords renderer in transcript-viewer.tsx after it
 * String.split()s a segment by the combined topic+search regex. For each
 * resulting "search match" part, we know its starting char index within the
 * segment (running cumulative length of preceding parts) and we look it up
 * in the precomputed `searchMatches` array to discover the global index, so
 * we can decide whether *this* particular occurrence is the active one
 * (`searchMatchIdx`).
 */
export function findGlobalMatchIndex(
  searchMatches: SearchMatch[],
  segmentIndex: number,
  charIndex: number,
): number {
  return searchMatches.findIndex(
    (m) => m.segmentIndex === segmentIndex && m.charIndex === charIndex,
  );
}
