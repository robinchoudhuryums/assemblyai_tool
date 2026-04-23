/**
 * CA-side RAG-integration evaluation harness. Ported from
 * ums-knowledge-reference/backend/src/scripts/evalRag.ts and adapted
 * to CA's surface: instead of querying RAG's internal vector store, we
 * call RAG through the same service-to-service client the pipeline
 * uses (services/rag-client.ts). That way the eval measures the EXACT
 * integration CA cares about — "when my pipeline asks RAG a question,
 * does it come back with useful context?"
 *
 * Usage:
 *   npm run eval:rag
 *
 * Prerequisites:
 *   RAG_ENABLED=true
 *   RAG_SERVICE_URL=<reachable RAG URL>
 *   RAG_API_KEY=<shared service key; ≥32 chars>
 *
 * Env thresholds:
 *   RAG_EVAL_COVERAGE_THRESHOLD  Minimum mean keyword coverage (0-1, default 0.5). Exit 1 if below.
 *   RAG_EVAL_OUTPUT_DIR          Where to write junit.xml + results.json (default ./eval-output)
 *
 * Not part of `npm test` because it needs a live RAG instance. Intended
 * for a nightly CI workflow or ops-triggered staging run.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadGoldStandard, type GoldPair } from "../evalData/loader";
import { keywordCoverage, aggregateCoverage, escapeXml, type CoverageResult } from "../evalData/scoring";
import { fetchRagContext, isRagEnabled } from "../services/rag-client";
import { logger } from "../services/logger";

interface RunResult extends CoverageResult {
  question: string;
  category: string;
  snippetCount: number;
  confidence?: string;
  latencyMs: number;
  error?: string;
}

async function evaluatePair(pair: GoldPair): Promise<RunResult> {
  const start = Date.now();
  try {
    // fetchRagContext is the production pipeline's entry point into RAG.
    // Returns `{ context, sources[], confidence }` when RAG is enabled
    // and available; undefined when disabled. Concatenate the context
    // string with each source's text and do keyword matching against
    // the joined corpus — that's what the downstream Bedrock prompt
    // actually sees.
    const ctx = await fetchRagContext(pair.question);
    const retrievedText = [
      ctx?.context ?? "",
      ...(ctx?.sources ?? []).map((s) => `${s.documentName} ${s.text}`),
    ].join(" ");
    const cov = keywordCoverage(retrievedText, pair.expectedKeywords);
    return {
      ...cov,
      question: pair.question,
      category: pair.category,
      snippetCount: ctx?.sources?.length ?? 0,
      confidence: ctx?.confidence,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("rag-integration-eval: pair failed", {
      question: pair.question,
      error: msg,
    });
    return {
      retrievedText: "",
      expectedKeywords: pair.expectedKeywords,
      matched: [],
      missing: pair.expectedKeywords,
      coverage: 0,
      question: pair.question,
      category: pair.category,
      snippetCount: 0,
      latencyMs: Date.now() - start,
      error: msg,
    };
  }
}

function buildJunitXml(results: RunResult[], threshold: number): string {
  const failures = results.filter((r) => r.error || r.coverage < threshold).length;
  const testcases = results
    .map((r) => {
      const name = escapeXml(r.question.slice(0, 100));
      const className = escapeXml(r.category);
      if (r.error) {
        return `    <testcase name="${name}" classname="${className}"><failure message="eval error">${escapeXml(r.error)}</failure></testcase>`;
      }
      if (r.coverage < threshold) {
        return `    <testcase name="${name}" classname="${className}"><failure message="coverage below threshold">coverage=${r.coverage.toFixed(2)} &lt; ${threshold}; missing: ${escapeXml(r.missing.join(", "))}</failure></testcase>`;
      }
      return `    <testcase name="${name}" classname="${className}" />`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="ca-rag-integration" tests="${results.length}" failures="${failures}">
${testcases}
  </testsuite>
</testsuites>
`;
}

async function main() {
  if (!isRagEnabled()) {
    console.error(
      "RAG is not enabled. Set RAG_ENABLED=true, RAG_SERVICE_URL=<url>, and RAG_API_KEY=<≥32-char secret> before running this harness.",
    );
    process.exit(2);
  }

  const threshold = parseFloat(process.env.RAG_EVAL_COVERAGE_THRESHOLD || "0.5");
  const outputDir = process.env.RAG_EVAL_OUTPUT_DIR || "./eval-output";

  const dataset = loadGoldStandard();
  console.log(`\nCA RAG-integration evaluation — ${dataset.pairs.length} pairs (v${dataset.version})`);
  console.log(`Threshold: mean keyword coverage ≥ ${threshold}\n`);

  const results: RunResult[] = [];
  for (const pair of dataset.pairs) {
    const r = await evaluatePair(pair);
    results.push(r);
    const mark = r.error ? "ERR" : r.coverage >= threshold ? "OK " : "LOW";
    console.log(
      `  [${mark}] cov=${r.coverage.toFixed(2)} snippets=${r.snippetCount} (${r.latencyMs}ms)  ${r.question.slice(0, 70)}`,
    );
  }

  const agg = aggregateCoverage(results);

  console.log(`\n  Aggregate coverage: ${(agg.mean * 100).toFixed(1)}%`);
  console.log(`  Fully covered pairs: ${agg.fullyCovered} / ${agg.total}`);
  console.log(`  Threshold check: ${agg.mean >= threshold ? "PASS" : "FAIL"}\n`);

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "junit.xml"), buildJunitXml(results, threshold));
  writeFileSync(
    join(outputDir, "results.json"),
    JSON.stringify(
      {
        datasetVersion: dataset.version,
        meanCoverage: agg.mean,
        fullyCoveredCount: agg.fullyCovered,
        totalPairs: agg.total,
        threshold,
        results,
      },
      null,
      2,
    ),
  );

  if (agg.mean < threshold) {
    console.error(`\nFAIL: mean coverage ${(agg.mean * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log(`\nOK: wrote ${outputDir}/junit.xml + results.json`);
}

main().catch((err) => {
  console.error("RAG integration eval harness failed:", err);
  process.exit(2);
});
