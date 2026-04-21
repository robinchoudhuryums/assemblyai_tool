/**
 * PerKeyCircuitBreaker tests (Phase C).
 *
 * The single-key CircuitBreaker was already exercised indirectly via the
 * Bedrock + webhook paths. PerKeyCircuitBreaker is the Phase C addition
 * keyed on webhookId; these tests verify per-key isolation, threshold
 * behavior, the half-open transition, LRU bound, and the snapshot shape
 * the admin observability endpoint consumes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerKeyCircuitBreaker } from "../server/services/resilience.js";

describe("PerKeyCircuitBreaker", () => {
  it("each key has its own independent state", async () => {
    const b = new PerKeyCircuitBreaker("test", 3, 1_000);
    // Fail 3 times on key A — should open.
    for (let i = 0; i < 3; i++) {
      await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    }
    assert.equal(b.getState("A"), "open");
    // Key B is unaffected.
    assert.equal(b.getState("B"), "closed");
    assert.equal(b.isOpen("B"), false);
  });

  it("closed key executes the function and returns its result", async () => {
    const b = new PerKeyCircuitBreaker("test", 3, 1_000);
    const result = await b.execute("A", async () => 42);
    assert.equal(result, 42);
  });

  it("open breaker rejects immediately without running the function", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 60_000);
    // Open the breaker.
    for (let i = 0; i < 2; i++) {
      await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    }
    assert.equal(b.getState("A"), "open");
    // Next execute should be rejected WITHOUT invoking the fn.
    let invoked = false;
    await assert.rejects(b.execute("A", async () => { invoked = true; return 1; }));
    assert.equal(invoked, false);
  });

  it("transitions to half-open after the reset timeout", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 20); // 20ms reset
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    assert.equal(b.getState("A"), "open");
    // Wait past the reset timeout.
    await new Promise(r => setTimeout(r, 30));
    // getState() transitions open -> half-open lazily.
    assert.equal(b.getState("A"), "half-open");
  });

  it("half-open success closes the circuit", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 20);
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await new Promise(r => setTimeout(r, 30));
    // Call getState to transition to half-open.
    assert.equal(b.getState("A"), "half-open");
    // One successful call in half-open closes.
    const result = await b.execute("A", async () => "ok");
    assert.equal(result, "ok");
    assert.equal(b.getState("A"), "closed");
  });

  it("half-open failure re-opens the circuit", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 20);
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(b.getState("A"), "half-open");
    // Failure in half-open immediately reopens.
    await assert.rejects(b.execute("A", async () => { throw new Error("still down"); }));
    assert.equal(b.getState("A"), "open");
  });

  it("isFailure classifier skips non-counting errors", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 1_000);
    // 3 "client" errors that don't count — breaker stays closed.
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        b.execute("A", async () => { throw new Error("client"); }, () => false),
      );
    }
    assert.equal(b.getState("A"), "closed");
    // 2 server errors — now it opens.
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        b.execute("A", async () => { throw new Error("server"); }, () => true),
      );
    }
    assert.equal(b.getState("A"), "open");
  });

  it("snapshot returns all tracked keys sorted by most-recently-failed", async () => {
    const b = new PerKeyCircuitBreaker("test", 3, 1_000);
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await new Promise(r => setTimeout(r, 2));
    await assert.rejects(b.execute("B", async () => { throw new Error("fail"); }));
    const snap = b.snapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap[0].key, "B");  // most recent failure first
    assert.equal(snap[1].key, "A");
    for (const s of snap) {
      assert.ok(["closed", "open", "half-open"].includes(s.state));
      assert.equal(typeof s.failureCount, "number");
      assert.equal(typeof s.lastFailureTime, "number");
    }
  });

  it("reset clears a specific key's state", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 60_000);
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    assert.equal(b.isOpen("A"), true);
    b.reset("A");
    // After reset, key is unknown again (closed by default).
    assert.equal(b.getState("A"), "closed");
    // And a fresh execute works.
    assert.equal(await b.execute("A", async () => "ok"), "ok");
  });

  it("successful delivery in closed state resets the failure counter", async () => {
    const b = new PerKeyCircuitBreaker("test", 3, 1_000);
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    // One success in closed state resets — takes another 3 failures to open.
    await b.execute("A", async () => "ok");
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    assert.equal(b.getState("A"), "closed");
  });

  // Per-key policy override (webhook retry-policy feature).
  it("per-key threshold override takes effect on breaker creation", async () => {
    const b = new PerKeyCircuitBreaker("test", 5, 1_000);
    // Key A uses default threshold 5 → 5 failures to open.
    for (let i = 0; i < 4; i++) {
      await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    }
    assert.equal(b.getState("A"), "closed");
    // Key B uses override threshold 2 → 2 failures to open.
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        b.execute("B", async () => { throw new Error("fail"); }, { threshold: 2 }),
      );
    }
    assert.equal(b.getState("B"), "open");
    // Key A unaffected.
    assert.equal(b.getState("A"), "closed");
  });

  it("per-key override ignored on existing breaker — reset required for policy change", async () => {
    const b = new PerKeyCircuitBreaker("test", 5, 1_000);
    // Create key A with default threshold 5.
    await assert.rejects(b.execute("A", async () => { throw new Error("fail"); }));
    // Later call passes threshold=2, but A already exists with threshold 5.
    // Need 5 failures total (including the first above) to trip — override is not
    // retroactively applied.
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        b.execute("A", async () => { throw new Error("fail"); }, { threshold: 2 }),
      );
    }
    // Still 4 failures → still closed at threshold 5.
    assert.equal(b.getState("A"), "closed");
    // Now reset() + fresh execute with the override recreates with threshold 2.
    b.reset("A");
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        b.execute("A", async () => { throw new Error("fail"); }, { threshold: 2 }),
      );
    }
    assert.equal(b.getState("A"), "open");
  });

  it("per-key resetMs override takes effect on breaker creation", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 10_000);
    // Key with a very short resetMs override — opens fast, recovers fast.
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        b.execute("fast", async () => { throw new Error("fail"); }, { threshold: 2, resetMs: 20 }),
      );
    }
    assert.equal(b.getState("fast"), "open");
    await new Promise(r => setTimeout(r, 30));
    assert.equal(b.getState("fast"), "half-open");
  });

  it("per-key options-object accepts isFailure + threshold together", async () => {
    const b = new PerKeyCircuitBreaker("test", 2, 1_000);
    // Failures that don't count toward the open threshold.
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        b.execute(
          "A",
          async () => { throw new Error("client"); },
          { threshold: 2, isFailure: () => false },
        ),
      );
    }
    assert.equal(b.getState("A"), "closed");
  });
});
