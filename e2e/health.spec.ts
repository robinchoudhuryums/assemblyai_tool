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

  test("login rate limiting works", async ({ request }) => {
    // CI environments share a single TCP IP across the whole Playwright
    // run, and the login rate limiter (5 attempts / 15 min per IP) is
    // process-global. Running this test pollutes the limiter for every
    // subsequent spec that calls /api/auth/login, which makes them all
    // 429 + retry × 2 (CI retries setting) until the workflow times out.
    //
    // The lockout/limiter logic is unit-tested in
    // tests/auth.test.ts:32-72 (recordFailedAttempt + isLockedOut), so
    // we lose no coverage by skipping this end-to-end assertion in CI.
    // It still runs locally for hand-validation.
    test.skip(
      process.env.E2E_MOCKS === "true",
      "Skipped in CI to avoid polluting the shared 5/15min login limiter; " +
      "rate-limit logic is covered by tests/auth.test.ts at the unit level.",
    );

    // Make 6 rapid login attempts (limit is 5 per 15 min)
    for (let i = 0; i < 6; i++) {
      await request.post("/api/auth/login", {
        data: { username: "nonexistent", password: "bad" },
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await request.post("/api/auth/login", {
      data: { username: "nonexistent", password: "bad" },
      headers: { "Content-Type": "application/json" },
    });

    // Should be rate limited
    expect(response.status()).toBe(429);
  });
});
