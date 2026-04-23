/**
 * Loader + validator for CA's gold-standard RAG-integration eval dataset.
 * Ported from ums-knowledge-reference/backend/src/evalData/loader.ts and
 * retargeted at CA's analyst-question domain (no HCPCS codes; just
 * question, category, expected keywords).
 *
 * Throws on malformed entries so a bad commit fails the harness fast
 * rather than silently producing zero-recall results.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GoldPair {
  question: string;
  category: string;
  expectedKeywords: string[];
}

export interface GoldStandard {
  version: string;
  description: string;
  lastUpdated: string;
  pairs: GoldPair[];
}

const DATA_PATH = join(__dirname, "goldStandardRagIntegration.json");

/**
 * Load + validate the dataset. Throws on missing fields, bad shape, or
 * fewer than 10 pairs (sanity floor for a meaningful eval run).
 */
export function loadGoldStandard(): GoldStandard {
  const raw = readFileSync(DATA_PATH, "utf8");
  const parsed = JSON.parse(raw) as GoldStandard;

  if (!parsed.version || !parsed.pairs || !Array.isArray(parsed.pairs)) {
    throw new Error("Gold-standard dataset: missing required fields (version, pairs[])");
  }
  if (parsed.pairs.length < 10) {
    throw new Error(`Gold-standard dataset: needs ≥10 pairs, found ${parsed.pairs.length}`);
  }

  for (let i = 0; i < parsed.pairs.length; i++) {
    const p = parsed.pairs[i];
    if (!p.question || typeof p.question !== "string") {
      throw new Error(`Gold-standard pair[${i}]: missing question`);
    }
    if (!p.category || typeof p.category !== "string") {
      throw new Error(`Gold-standard pair[${i}]: missing category`);
    }
    if (!Array.isArray(p.expectedKeywords) || p.expectedKeywords.length === 0) {
      throw new Error(`Gold-standard pair[${i}]: expectedKeywords must be a non-empty array`);
    }
  }

  return parsed;
}
