/**
 * Agent decline alert scheduler (Tier 2 #6).
 *
 * Tests the observable return shape of runDeclineCheck() against the
 * production `storage` singleton (which is MemStorage when neither
 * DATABASE_URL nor S3 is configured, i.e. the test environment).
 *
 * Webhook delivery is fire-and-forget from the scheduler's perspective —
 * runDeclineCheck returns { checked, alerted, employeeIds } which we assert
 * against. An actual webhook call would attempt to reach a real URL and
 * fail silently because no webhook configs exist in MemStorage.
 *
 * Dedup state is module-level in-memory; each test seeds a fresh employee
 * with a unique name so the scheduler's dedup set doesn't conflict across
 * tests in the same process.
 *
 * Run with: npx tsx --test tests/agent-decline-alert.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage.js";
import { runDeclineCheck, isAgentDeclineCheckEnabled } from "../server/services/agent-decline-alert.js";
import type { Employee } from "@shared/schema";

// Unique employee name per test so the scheduler's in-memory dedup set
// never observes the "same" employee across test cases. Counter is
// process-global; each test picks up the next value.
let uniqueCounter = 0;
function uniqueName(base: string): string {
  uniqueCounter++;
  return `${base}-${uniqueCounter}`;
}

// Clean up before each test: delete all employees + calls from the shared
// storage singleton so leftover state from previous tests doesn't bleed in.
beforeEach(async () => {
  const employees = await storage.getAllEmployees();
  for (const e of employees) {
    // MemStorage has no deleteEmployee on IStorage; set status=Inactive
    // instead so they're skipped by runDeclineCheck. Good enough for test
    // isolation since we're only looking at who triggers an alert.
    await storage.updateEmployee(e.id, { status: "Inactive" });
  }
});

interface SeedParams {
  name?: string;
  status?: string;
  currentScore: number;
  priorScore: number;
}

/**
 * Seed an active employee with 4 completed calls in the current 14-day
 * window (mid = 7 days ago) and 4 in the prior window (mid = 21 days ago).
 * Each window gets one extra call above MIN_CALLS (3) for safety margin.
 */
async function seedEmployeeWithScores(params: SeedParams): Promise<Employee> {
  const name = params.name ?? uniqueName("Agent");
  const emp = await storage.createEmployee({
    name,
    email: `${name.replace(/\s+/g, "-").toLowerCase()}@test.com`,
    status: params.status ?? "Active",
  });

  const now = Date.now();
  const currentMid = now - 7 * 86_400_000;
  const priorMid = now - 21 * 86_400_000;

  for (let i = 0; i < 4; i++) {
    const c = await storage.createCall({
      fileName: `${emp.id}-cur-${i}.mp3`,
      status: "completed",
      contentHash: `${emp.id}-cur-${i}`,
    });
    await storage.setCallEmployee(c.id, emp.id);
    await storage.updateCall(c.id, {
      uploadedAt: new Date(currentMid + i * 1000).toISOString(),
    });
    await storage.createCallAnalysis({
      callId: c.id,
      performanceScore: params.currentScore.toFixed(1),
    } as any);
  }
  for (let i = 0; i < 4; i++) {
    const c = await storage.createCall({
      fileName: `${emp.id}-pr-${i}.mp3`,
      status: "completed",
      contentHash: `${emp.id}-pr-${i}`,
    });
    await storage.setCallEmployee(c.id, emp.id);
    await storage.updateCall(c.id, {
      uploadedAt: new Date(priorMid + i * 1000).toISOString(),
    });
    await storage.createCallAnalysis({
      callId: c.id,
      performanceScore: params.priorScore.toFixed(1),
    } as any);
  }
  return emp;
}

describe("runDeclineCheck — basic alerting", () => {
  it("flags employees whose current-window avg dropped by >= threshold (default 1.0)", async () => {
    const emp = await seedEmployeeWithScores({
      name: uniqueName("Declining"),
      currentScore: 5.5,
      priorScore: 7.5, // delta -2.0, well past threshold
    });
    const result = await runDeclineCheck();
    assert.ok(result.employeeIds.includes(emp.id));
    assert.ok(result.alerted >= 1);
  });

  it("does NOT flag stable employees", async () => {
    const emp = await seedEmployeeWithScores({
      name: uniqueName("Stable"),
      currentScore: 7.5,
      priorScore: 7.3, // delta -0.2, below threshold
    });
    const result = await runDeclineCheck();
    assert.ok(!result.employeeIds.includes(emp.id));
  });

  it("does NOT flag improving employees (positive delta)", async () => {
    const emp = await seedEmployeeWithScores({
      name: uniqueName("Improving"),
      currentScore: 8.5,
      priorScore: 6.0,
    });
    const result = await runDeclineCheck();
    assert.ok(!result.employeeIds.includes(emp.id));
  });
});

describe("runDeclineCheck — eligibility gates", () => {
  it("skips inactive employees entirely (not even counted in `checked`)", async () => {
    const emp = await seedEmployeeWithScores({
      name: uniqueName("Inactive"),
      status: "Inactive",
      currentScore: 3.0,
      priorScore: 8.0, // huge decline
    });
    const result = await runDeclineCheck();
    assert.ok(!result.employeeIds.includes(emp.id), "inactive employees should not alert");
  });

  it("skips employees with fewer than MIN_CALLS in either window", async () => {
    const empName = uniqueName("Sparse");
    const emp = await storage.createEmployee({
      name: empName,
      email: `${empName.toLowerCase()}@test.com`,
      status: "Active",
    });
    const now = Date.now();
    // Only 2 calls in the current window (MIN_CALLS = 3).
    for (let i = 0; i < 2; i++) {
      const c = await storage.createCall({
        fileName: `${emp.id}-cur-${i}.mp3`,
        status: "completed",
        contentHash: `${emp.id}-sparse-cur-${i}`,
      });
      await storage.setCallEmployee(c.id, emp.id);
      await storage.updateCall(c.id, { uploadedAt: new Date(now - 7 * 86_400_000 + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "3.0" } as any);
    }
    // 4 calls in the prior window.
    for (let i = 0; i < 4; i++) {
      const c = await storage.createCall({
        fileName: `${emp.id}-pr-${i}.mp3`,
        status: "completed",
        contentHash: `${emp.id}-sparse-pr-${i}`,
      });
      await storage.setCallEmployee(c.id, emp.id);
      await storage.updateCall(c.id, { uploadedAt: new Date(now - 21 * 86_400_000 + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "9.0" } as any);
    }
    const result = await runDeclineCheck();
    assert.ok(!result.employeeIds.includes(emp.id), "insufficient-data employees should not alert");
  });

  it("excluded-from-metrics calls are filtered before pulse computation", async () => {
    // A 0.0 excluded-from-metrics call mid-current-window should not pull
    // the average down. INV-34 regression guard at the scheduler layer.
    const empName = uniqueName("Filtered");
    const emp = await storage.createEmployee({
      name: empName,
      email: `${empName.toLowerCase()}@test.com`,
      status: "Active",
    });
    const now = Date.now();
    // 4 normal current calls at 7.5
    for (let i = 0; i < 4; i++) {
      const c = await storage.createCall({
        fileName: `${emp.id}-cur-${i}.mp3`,
        status: "completed",
        contentHash: `${emp.id}-fil-cur-${i}`,
      });
      await storage.setCallEmployee(c.id, emp.id);
      await storage.updateCall(c.id, { uploadedAt: new Date(now - 7 * 86_400_000 + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "7.5" } as any);
    }
    // 1 excluded current call at 0.0 — should NOT pull the average down.
    const flagged = await storage.createCall({
      fileName: `${emp.id}-cur-flag.mp3`,
      status: "completed",
      contentHash: `${emp.id}-fil-cur-flag`,
      excludedFromMetrics: true,
    });
    await storage.setCallEmployee(flagged.id, emp.id);
    await storage.updateCall(flagged.id, { uploadedAt: new Date(now - 7 * 86_400_000).toISOString() });
    await storage.createCallAnalysis({ callId: flagged.id, performanceScore: "0.0" } as any);
    // 4 prior calls at 7.7
    for (let i = 0; i < 4; i++) {
      const c = await storage.createCall({
        fileName: `${emp.id}-pr-${i}.mp3`,
        status: "completed",
        contentHash: `${emp.id}-fil-pr-${i}`,
      });
      await storage.setCallEmployee(c.id, emp.id);
      await storage.updateCall(c.id, { uploadedAt: new Date(now - 21 * 86_400_000 + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "7.7" } as any);
    }
    const result = await runDeclineCheck();
    // delta = 7.5 - 7.7 = -0.2, below threshold → NOT flagged.
    assert.ok(!result.employeeIds.includes(emp.id),
      "excluded 0.0 call must not drag current-window average below threshold");
  });
});

describe("runDeclineCheck — dedup across cycles", () => {
  it("does not re-flag the same declining employee in a back-to-back cycle", async () => {
    const emp = await seedEmployeeWithScores({
      name: uniqueName("Persistent"),
      currentScore: 5.0,
      priorScore: 7.5,
    });
    const first = await runDeclineCheck();
    assert.ok(first.employeeIds.includes(emp.id), "first cycle should flag");

    const second = await runDeclineCheck();
    assert.ok(!second.employeeIds.includes(emp.id),
      "second cycle with identical data should suppress re-alert via dedup");
  });
});

describe("isAgentDeclineCheckEnabled — env var gate", () => {
  it("returns false when AGENT_DECLINE_CHECK_ENABLED is unset", () => {
    const prior = process.env.AGENT_DECLINE_CHECK_ENABLED;
    delete process.env.AGENT_DECLINE_CHECK_ENABLED;
    try {
      assert.equal(isAgentDeclineCheckEnabled(), false);
    } finally {
      if (prior !== undefined) process.env.AGENT_DECLINE_CHECK_ENABLED = prior;
    }
  });

  it("returns true when explicitly set to 'true'", () => {
    const prior = process.env.AGENT_DECLINE_CHECK_ENABLED;
    process.env.AGENT_DECLINE_CHECK_ENABLED = "true";
    try {
      assert.equal(isAgentDeclineCheckEnabled(), true);
    } finally {
      if (prior === undefined) delete process.env.AGENT_DECLINE_CHECK_ENABLED;
      else process.env.AGENT_DECLINE_CHECK_ENABLED = prior;
    }
  });

  it("is case-sensitive — 'TRUE' does NOT enable the scheduler", () => {
    const prior = process.env.AGENT_DECLINE_CHECK_ENABLED;
    process.env.AGENT_DECLINE_CHECK_ENABLED = "TRUE";
    try {
      assert.equal(isAgentDeclineCheckEnabled(), false);
    } finally {
      if (prior === undefined) delete process.env.AGENT_DECLINE_CHECK_ENABLED;
      else process.env.AGENT_DECLINE_CHECK_ENABLED = prior;
    }
  });
});
