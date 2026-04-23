/**
 * Tests for the search-analytics rolling buffer + aggregation.
 * Pure data-shape tests; no network, no storage.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  recordSearch,
  getSearchAnalytics,
  _resetSearchAnalyticsForTests,
} from "../server/services/search-analytics.js";

describe("search-analytics ring buffer", () => {
  before(() => _resetSearchAnalyticsForTests());
  after(() => _resetSearchAnalyticsForTests());

  it("returns empty-shaped data on an untouched buffer", () => {
    _resetSearchAnalyticsForTests();
    const a = getSearchAnalytics();
    assert.equal(a.totalSearches, 0);
    assert.equal(a.uniqueUsers, 0);
    assert.equal(a.topQueries.length, 0);
    assert.equal(a.zeroResultQueries.length, 0);
    assert.equal(a.userActivity.length, 0);
  });

  it("clusters normalized variations of the same query", () => {
    _resetSearchAnalyticsForTests();
    recordSearch({ username: "m1", query: "billing dispute", mode: "keyword", resultCount: 3 });
    recordSearch({ username: "m2", query: "Billing Dispute?", mode: "keyword", resultCount: 3 });
    recordSearch({ username: "m1", query: "billing dispute!", mode: "semantic", resultCount: 4 });

    const a = getSearchAnalytics();
    assert.equal(a.totalSearches, 3);
    assert.equal(a.uniqueUsers, 2);
    assert.equal(a.topQueries.length, 1);
    const top = a.topQueries[0];
    assert.equal(top.frequency, 3);
    // users array contains both but order isn't guaranteed
    assert.deepEqual([...top.users].sort(), ["m1", "m2"]);
  });

  it("flags zero-result queries that appeared >=2 times", () => {
    _resetSearchAnalyticsForTests();
    // One-time zero-result query: doesn't count (likely a typo)
    recordSearch({ username: "m1", query: "xyz123", mode: "keyword", resultCount: 0 });
    // Two-time zero-result: real gap signal
    recordSearch({ username: "m1", query: "eligibility 2025", mode: "keyword", resultCount: 0 });
    recordSearch({ username: "m2", query: "eligibility 2025", mode: "keyword", resultCount: 0 });

    const a = getSearchAnalytics();
    assert.equal(a.zeroResultQueries.length, 1);
    assert.equal(a.zeroResultQueries[0].query.toLowerCase(), "eligibility 2025");
    assert.equal(a.zeroResultQueries[0].frequency, 2);
  });

  it("distinguishes keyword vs semantic in modeBreakdown", () => {
    _resetSearchAnalyticsForTests();
    recordSearch({ username: "m1", query: "a", mode: "keyword", resultCount: 1 });
    recordSearch({ username: "m2", query: "a", mode: "keyword", resultCount: 1 });
    recordSearch({ username: "m3", query: "b", mode: "semantic", resultCount: 2 });
    const a = getSearchAnalytics();
    assert.equal(a.modeBreakdown.keyword, 2);
    assert.equal(a.modeBreakdown.semantic, 1);
  });

  it("sorts userActivity descending by count", () => {
    _resetSearchAnalyticsForTests();
    recordSearch({ username: "m1", query: "x", mode: "keyword", resultCount: 1 });
    recordSearch({ username: "m2", query: "y", mode: "keyword", resultCount: 1 });
    recordSearch({ username: "m2", query: "z", mode: "keyword", resultCount: 1 });
    recordSearch({ username: "m2", query: "w", mode: "keyword", resultCount: 1 });
    const a = getSearchAnalytics();
    assert.equal(a.userActivity[0].username, "m2");
    assert.equal(a.userActivity[0].searchCount, 3);
  });

  it("respects the 1000-entry cap by evicting oldest", () => {
    _resetSearchAnalyticsForTests();
    for (let i = 0; i < 1005; i++) {
      recordSearch({
        username: `m${i}`,
        query: `q${i}`,
        mode: "keyword",
        resultCount: 1,
      });
    }
    const a = getSearchAnalytics();
    assert.equal(a.window.entries, 1000);
    assert.equal(a.totalSearches, 1000);
    // Oldest evicted — the first five users shouldn't appear
    const users = new Set(a.userActivity.map((u) => u.username));
    assert.equal(users.has("m0"), false);
    assert.equal(users.has("m1004"), true);
  });

  it("records the most-recent canonical wording on clusters", () => {
    _resetSearchAnalyticsForTests();
    // Explicit timestamps — two recordSearch calls in the same ms would
    // keep the first wording (ties don't update), so we force a gap.
    recordSearch({
      username: "m1",
      query: "Billing issue",
      mode: "keyword",
      resultCount: 3,
      timestamp: "2026-04-23T12:00:00.000Z",
    });
    recordSearch({
      username: "m2",
      query: "BILLING ISSUE?",
      mode: "keyword",
      resultCount: 3,
      timestamp: "2026-04-23T12:00:00.100Z",
    });
    const a = getSearchAnalytics();
    assert.equal(a.topQueries.length, 1);
    assert.equal(a.topQueries[0].query, "BILLING ISSUE?");
  });
});
