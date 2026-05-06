/**
 * E2E coverage for /api/search/semantic — the new hybrid + threshold
 * features added in the semantic-search cycle.
 *
 * Scope: API contract only. Existing `pipeline.spec.ts` covers the UI
 * mode-toggle aria-pressed + URL state-sync; what's NOT covered
 * anywhere is the wire-level shape of the JSON response — the `mode`,
 * `backend`, `alpha`, `threshold`, and `coverage` fields, parameter
 * clamping, and the empty-storage shape.
 *
 * MSW deterministic-embedding caveat:
 *   `server/test-mocks/handlers.ts` returns the same 256-dim vector
 *   for every Bedrock Titan embed call. That makes ranking semantics
 *   meaningless (every stored call would tie at cosine=1.0), so we
 *   intentionally don't seed any calls into MemStorage here. The
 *   meaningful assertions are about RESPONSE SHAPE + parameter
 *   handling, which work fine with an empty result set.
 *
 * Why no DATABASE_URL in the e2e dev server matters:
 *   The pgvector fast path (server/routes/reports.ts:266) requires a
 *   live PostgreSQL with pgvector enabled. The dev server uses
 *   MemStorage → pgvector unavailable → in-memory fallback. So
 *   `backend` should be "in-memory" (or "keyword-fallback" if the
 *   embedding call somehow fails, which it won't with MSW). This is
 *   the path tested here.
 *
 * Why API-only instead of also driving the search page UI:
 *   pipeline.spec.ts:64-90 already covers mode-toggle aria-pressed,
 *   URL-state sync, and alpha-slider visibility. The coverage gap is
 *   the wire response, which the UI consumes but doesn't itself
 *   shape.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

async function loginAsAdmin(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/auth/login", {
    data: { username: "testadmin", password: "TestPass123!" },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
}

test.describe("/api/search/semantic contract", () => {
  test.beforeEach(async ({ request }) => {
    await loginAsAdmin(request);
  });

  test("requires q query param (400 + message)", async ({ request }) => {
    const res = await request.get("/api/search/semantic");
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/required/i);
  });

  test("rejects oversized q (>500 chars) with 400", async ({ request }) => {
    const long = "a".repeat(501);
    const res = await request.get(`/api/search/semantic?q=${encodeURIComponent(long)}`);
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/too long/i);
  });

  test("default mode returns semantic shape + structurally-valid coverage", async ({ request }) => {
    const res = await request.get("/api/search/semantic?q=hello");
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as {
      mode: string;
      backend?: string;
      threshold?: number;
      results: unknown[];
      coverage?: { totalAccessible: number; withEmbeddings: number };
    };
    // Default mode is "semantic" when an embedding is available, or
    // "keyword-fallback" if Bedrock blew up. MSW returns a
    // deterministic vector so we expect "semantic".
    expect(body.mode).toBe("semantic");
    // No DATABASE_URL → in-memory fallback path.
    expect(body.backend).toBe("in-memory");
    // Default threshold is 0.25 per the route's parseFloat default.
    expect(body.threshold).toBe(0.25);
    expect(Array.isArray(body.results)).toBeTruthy();
    // Coverage shape must be present + structurally valid. We can NOT
    // assume an empty MemStorage: full-pipeline.spec.ts runs earlier
    // alphabetically and uploads test calls that persist in the same
    // dev-server process. Any prior spec that creates a call inflates
    // totalAccessible. Assert structural invariants instead:
    //   - both fields are numbers >= 0
    //   - withEmbeddings <= totalAccessible (you can't have more
    //     embedded calls than accessible calls)
    expect(body.coverage).toBeDefined();
    expect(typeof body.coverage!.totalAccessible).toBe("number");
    expect(typeof body.coverage!.withEmbeddings).toBe("number");
    expect(body.coverage!.totalAccessible).toBeGreaterThanOrEqual(0);
    expect(body.coverage!.withEmbeddings).toBeGreaterThanOrEqual(0);
    expect(body.coverage!.withEmbeddings).toBeLessThanOrEqual(body.coverage!.totalAccessible);
  });

  test("hybrid mode reflects alpha + adds it to the response shape", async ({ request }) => {
    const res = await request.get("/api/search/semantic?q=test&mode=hybrid&alpha=0.7");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { mode: string; alpha?: number; threshold?: number };
    expect(body.mode).toBe("hybrid");
    expect(body.alpha).toBe(0.7);
    // Threshold defaults to 0.25 even in hybrid mode.
    expect(body.threshold).toBe(0.25);
  });

  test("threshold parameter is reflected in the response", async ({ request }) => {
    const res = await request.get("/api/search/semantic?q=test&threshold=0.5");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { threshold?: number };
    expect(body.threshold).toBe(0.5);
  });

  test("threshold=0 disables pruning (response carries the explicit 0)", async ({ request }) => {
    // Documented escape hatch — API callers expecting unlimited top-N
    // must pass ?threshold=0 explicitly. Asserts the value round-trips
    // (server doesn't silently fall back to the default).
    const res = await request.get("/api/search/semantic?q=test&threshold=0");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { threshold?: number };
    expect(body.threshold).toBe(0);
  });

  test("alpha clamps to [0, 1] when out of range", async ({ request }) => {
    const tooHigh = await request.get("/api/search/semantic?q=test&mode=hybrid&alpha=2.5");
    expect(tooHigh.ok()).toBeTruthy();
    expect(((await tooHigh.json()) as { alpha?: number }).alpha).toBe(1);

    const tooLow = await request.get("/api/search/semantic?q=test&mode=hybrid&alpha=-1");
    expect(tooLow.ok()).toBeTruthy();
    expect(((await tooLow.json()) as { alpha?: number }).alpha).toBe(0);
  });

  test("threshold clamps to [0, 1] when out of range", async ({ request }) => {
    const res = await request.get("/api/search/semantic?q=test&threshold=2.5");
    expect(res.ok()).toBeTruthy();
    expect(((await res.json()) as { threshold?: number }).threshold).toBe(1);
  });

  test("unrecognized mode value clamps to semantic", async ({ request }) => {
    // Server's parsing: `mode === "hybrid" ? "hybrid" : "semantic"`.
    // So anything not literally "hybrid" defaults to semantic — no
    // 400, no error. Confirms safe-default behavior.
    const res = await request.get("/api/search/semantic?q=test&mode=bogus");
    expect(res.ok()).toBeTruthy();
    expect(((await res.json()) as { mode?: string }).mode).toBe("semantic");
  });
});

test.describe("/api/search/semantic auth gate", () => {
  // Separate describe block with NO login beforeEach so the request
  // context has no session cookie. Asserts the requireAuth middleware
  // is wired correctly on the route.
  test("unauthenticated request returns 401", async ({ request }) => {
    const res = await request.get("/api/search/semantic?q=hello");
    expect(res.status()).toBe(401);
  });
});
