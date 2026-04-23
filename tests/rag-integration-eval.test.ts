/**
 * Unit tests for the pure scoring helpers + dataset loader used by
 * the CA RAG-integration eval harness. Does NOT call RAG / AWS —
 * covers only the data-shape and math pieces so the harness itself
 * can fail-fast on regressions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  keywordCoverage,
  aggregateCoverage,
  escapeXml,
} from "../server/evalData/scoring.js";
import { loadGoldStandard } from "../server/evalData/loader.js";

describe("keywordCoverage", () => {
  it("returns 1.0 when every keyword is present", () => {
    const r = keywordCoverage(
      "The CPAP return policy allows 30 days from delivery.",
      ["CPAP", "return", "days"],
    );
    assert.equal(r.coverage, 1);
    assert.deepEqual(r.missing, []);
  });

  it("returns 0.0 when no keyword is present", () => {
    const r = keywordCoverage("This text has nothing relevant.", ["wheelchair", "oxygen"]);
    assert.equal(r.coverage, 0);
    assert.deepEqual(r.matched, []);
  });

  it("is case-insensitive", () => {
    const r = keywordCoverage("HIPAA COMPLIANCE IS REQUIRED.", ["hipaa", "compliance"]);
    assert.equal(r.coverage, 1);
  });

  it("collapses whitespace in both the haystack and needle", () => {
    const r = keywordCoverage(
      "prior\n\nauthorization   process",
      ["prior authorization", "process"],
    );
    assert.equal(r.coverage, 1);
  });

  it("returns the partial fraction when some match and some don't", () => {
    const r = keywordCoverage(
      "CPAP mask replacement every 90 days",
      ["CPAP", "mask", "warranty"], // warranty missing
    );
    assert.equal(r.matched.length, 2);
    assert.equal(r.missing.length, 1);
    assert.ok(Math.abs(r.coverage - 2 / 3) < 1e-9);
  });

  it("treats empty expectedKeywords as fully covered (edge)", () => {
    const r = keywordCoverage("anything", []);
    assert.equal(r.coverage, 1);
  });
});

describe("aggregateCoverage", () => {
  it("averages coverage across pairs and counts fully-covered", () => {
    const agg = aggregateCoverage([
      { retrievedText: "", expectedKeywords: [], matched: [], missing: [], coverage: 1 },
      { retrievedText: "", expectedKeywords: [], matched: [], missing: [], coverage: 0.5 },
      { retrievedText: "", expectedKeywords: [], matched: [], missing: [], coverage: 0 },
    ]);
    assert.equal(agg.total, 3);
    assert.equal(agg.fullyCovered, 1);
    assert.ok(Math.abs(agg.mean - 0.5) < 1e-9);
  });

  it("handles an empty result list without NaN", () => {
    const agg = aggregateCoverage([]);
    assert.equal(agg.mean, 0);
    assert.equal(agg.fullyCovered, 0);
    assert.equal(agg.total, 0);
  });
});

describe("escapeXml", () => {
  it("escapes the five predefined XML entities", () => {
    assert.equal(escapeXml("<a href=\"x\">O'Reilly & Sons</a>"),
      "&lt;a href=&quot;x&quot;&gt;O&apos;Reilly &amp; Sons&lt;/a&gt;");
  });
});

describe("loadGoldStandard", () => {
  it("loads the shipped dataset without throwing", () => {
    const gs = loadGoldStandard();
    assert.ok(gs.pairs.length >= 10, `Expected ≥10 pairs, got ${gs.pairs.length}`);
    assert.ok(gs.version);
    for (const p of gs.pairs) {
      assert.ok(p.question.length > 0);
      assert.ok(p.category.length > 0);
      assert.ok(Array.isArray(p.expectedKeywords) && p.expectedKeywords.length > 0);
    }
  });
});
