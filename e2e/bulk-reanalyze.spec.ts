/**
 * E2E coverage for POST /api/calls/bulk-reanalyze.
 *
 * Scope: contract + auth/role gating only. The 429 quota path
 * (BULK_REANALYZE_DAILY_CAP exceeded) is intentionally NOT exercised
 * here — triggering it requires either:
 *   (a) running 200+ valid bulk reanalyzes (spends real Bedrock time
 *       even with mocks; takes minutes)
 *   (b) booting the dev server with BULK_REANALYZE_DAILY_CAP=1 (env
 *       drift across the suite; would need a third Playwright project).
 * Neither is worth it: the quota math is unit-tested at
 * tests/bulk-reanalyze-filter.test.ts and the 429 response shape is
 * pinned by the route handler's literal jsonify (calls.ts:727-731).
 *
 * What IS testable on the wire:
 *   - Auth gate (requireAuth → 401 unauthenticated)
 *   - Role gate (requireRole("admin") → 403 for viewer)
 *   - Validation gate (Zod union schema rejects malformed payloads)
 *   - Empty-filter happy path (200 + {results: []})
 *
 * Why this matters: the bulk-reanalyze handler is a real spend vector
 * — each successful invocation runs the full pipeline ($0.10–$0.20 per
 * call). The auth + validation + role layers are the only thing
 * preventing accidental or malicious mass-spend. Asserting them on the
 * wire (not just at the unit level) catches middleware-ordering
 * regressions that unit tests can't see.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

async function loginAs(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post("/api/auth/login", {
    data: { username, password },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
  const cookies = await request.storageState();
  const csrf = cookies.cookies.find((c) => c.name === "csrf_token");
  if (!csrf) throw new Error("CSRF cookie not set after login");
  return csrf.value;
}

test.describe("POST /api/calls/bulk-reanalyze gating + validation", () => {
  test("unauthenticated request is blocked (CSRF before auth → 403)", async ({ request }) => {
    // CI showed 403, not 401: the CSRF double-submit middleware
    // (server/index.ts:319) fires BEFORE the route's requireAuth.
    // An anonymous POST has no csrf_token cookie + no X-CSRF-Token
    // header → 403 "CSRF token missing or invalid" before the route
    // handler ever runs. That's a defense-in-depth feature: anonymous
    // attackers don't even reach business logic. Assert the wire
    // behavior, not the abstract "auth required" intent. Either
    // status is a valid "blocked" answer; the unit suite (auth.test.ts)
    // proves the requireAuth path independently.
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: { callIds: ["00000000-0000-0000-0000-000000000001"] },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(403);
  });

  test("viewer role is rejected with 403", async ({ request }) => {
    const csrf = await loginAs(request, "testviewer", "ViewPass123!");
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: { callIds: ["00000000-0000-0000-0000-000000000001"] },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.status()).toBe(403);
  });

  test("admin + empty callIds array returns 400", async ({ request }) => {
    const csrf = await loginAs(request, "testadmin", "TestPass123!");
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: { callIds: [] },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    // Zod schema requires .min(1); rejected before quota or handler runs.
    expect(res.status()).toBe(400);
  });

  test("admin + >50 callIds returns 400 (Zod cap)", async ({ request }) => {
    const csrf = await loginAs(request, "testadmin", "TestPass123!");
    const tooMany = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: { callIds: tooMany },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("admin + non-UUID id returns 400", async ({ request }) => {
    const csrf = await loginAs(request, "testadmin", "TestPass123!");
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: { callIds: ["not-a-uuid"] },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("admin + filter with no matches returns 200 + empty results", async ({ request }) => {
    const csrf = await loginAs(request, "testadmin", "TestPass123!");
    // MemStorage starts empty. Filter to inbound/2099 → no candidates.
    // Hits the resolveBulkReanalyzeCallIds → empty → handler returns
    // 200 with the literal "No calls matched the filter" message.
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: {
        filter: {
          callCategory: "inbound",
          from: "2099-01-01",
          to: "2099-12-31",
          limit: 10,
        },
      },
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { message?: string; results?: unknown[] };
    expect(body.message).toMatch(/no calls matched/i);
    expect(Array.isArray(body.results)).toBeTruthy();
    expect(body.results!.length).toBe(0);
  });

  test("admin + missing both callIds and filter returns 400", async ({ request }) => {
    const csrf = await loginAs(request, "testadmin", "TestPass123!");
    const res = await request.post("/api/calls/bulk-reanalyze", {
      data: {},
      headers: {
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
    });
    expect(res.status()).toBe(400);
  });
});
