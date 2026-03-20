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
