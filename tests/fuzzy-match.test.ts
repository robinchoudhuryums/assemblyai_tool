/**
 * Fuzzy-match helper tests (Phase E).
 *
 * Powers the "Did you mean?" candidate suggestions on the admin unlinked-
 * users flow. Covers normalization rules (email-domain strip, separators
 * to spaces, case-insensitive) and the similarity-score bounds the UI
 * consumes (threshold > 0.5 to appear as a suggestion).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  levenshtein,
  normalizeForFuzzy,
  fuzzySimilarity,
} from "../server/routes/utils.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(levenshtein("alice", "alice"), 0);
  });

  it("returns length for empty vs non-empty", () => {
    assert.equal(levenshtein("", "alice"), 5);
    assert.equal(levenshtein("bob", ""), 3);
  });

  it("counts a single substitution as distance 1", () => {
    assert.equal(levenshtein("alice", "alicf"), 1);
  });

  it("counts a single insertion as distance 1", () => {
    assert.equal(levenshtein("alice", "alices"), 1);
  });

  it("counts a single deletion as distance 1", () => {
    assert.equal(levenshtein("alice", "alic"), 1);
  });

  it("handles multi-character differences", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
  });
});

describe("normalizeForFuzzy", () => {
  it("lowercases", () => {
    assert.equal(normalizeForFuzzy("Alice Smith"), "alice smith");
  });

  it("drops email domain", () => {
    assert.equal(normalizeForFuzzy("alice.smith@x.com"), "alice smith");
  });

  it("replaces separators with space", () => {
    assert.equal(normalizeForFuzzy("alice.smith"), "alice smith");
    assert.equal(normalizeForFuzzy("alice_smith"), "alice smith");
    assert.equal(normalizeForFuzzy("alice-smith"), "alice smith");
    assert.equal(normalizeForFuzzy("alice+smith"), "alice smith");
  });

  it("strips punctuation", () => {
    assert.equal(normalizeForFuzzy("O'Brien, John!"), "obrien john");
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeForFuzzy("alice   smith"), "alice smith");
  });

  it("returns empty for whitespace-only input", () => {
    assert.equal(normalizeForFuzzy("   "), "");
  });
});

describe("fuzzySimilarity", () => {
  it("returns 1 for identical normalized forms", () => {
    assert.equal(fuzzySimilarity("alice.smith@x.com", "Alice Smith"), 1);
    assert.equal(fuzzySimilarity("Alice Smith", "alice smith"), 1);
  });

  it("returns 0 when either side is empty after normalization", () => {
    assert.equal(fuzzySimilarity("", "Alice"), 0);
    assert.equal(fuzzySimilarity("!!!", "Alice"), 0);
  });

  it("returns high similarity for minor typos (>0.5)", () => {
    // "alice smith" vs "alice smth" — 1 deletion, len 11 → 1 - 1/11 ≈ 0.91
    const sim = fuzzySimilarity("alice smith", "alice smth");
    assert.ok(sim > 0.8, `expected >0.8, got ${sim}`);
  });

  it("returns low similarity for unrelated names (<0.5)", () => {
    const sim = fuzzySimilarity("alice", "bob");
    assert.ok(sim < 0.5, `expected <0.5, got ${sim}`);
  });

  it("cross-field match: email vs name (>0.5)", () => {
    // "alice.smith@x.com" normalizes to "alice smith" — should match "Alice Smith".
    const sim = fuzzySimilarity("alice.smith@x.com", "Alice Smith");
    assert.ok(sim > 0.5, `expected >0.5, got ${sim}`);
  });

  it("short-prefix match: bob j vs bob jones (>0.5)", () => {
    const sim = fuzzySimilarity("bob j", "Bob Jones");
    // "bob j" (5) vs "bob jones" (9) — 4 insertions, max 9 → 1 - 4/9 ≈ 0.56
    assert.ok(sim > 0.5, `expected >0.5, got ${sim}`);
  });

  it("ignores case", () => {
    assert.equal(
      fuzzySimilarity("ALICE SMITH", "alice smith"),
      fuzzySimilarity("alice smith", "alice smith"),
    );
  });
});
