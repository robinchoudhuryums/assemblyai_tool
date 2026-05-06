import { test, expect } from "@playwright/test";

test.describe("API Health", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toMatch(/ok|degraded/);
    expect(body.timestamp).toBeTruthy();
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.memory).toBeDefined();
    expect(body.memory.rss_mb).toBeGreaterThan(0);
  });

  test("unauthenticated API calls return 401", async ({ request }) => {
    const response = await request.get("/api/calls");
    expect(response.status()).toBe(401);
  });

  // Login rate-limit assertion was removed: the e2e dev server bypasses
  // the limiter when E2E_MOCKS=true (server/index.ts:410-413) so 27 specs
  // logging in from one CI runner IP don't trip the 5/15min cap. The
  // limiter logic itself is covered at the unit level by
  // tests/auth.test.ts:32-72 (recordFailedAttempt + isLockedOut).
});
