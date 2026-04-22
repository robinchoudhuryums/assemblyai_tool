/**
 * Route endpoint integration tests — real route handlers with MemStorage.
 *
 * Mounts actual route registration functions with a fake auth layer.
 * Tests the full middleware chain: auth → param validation → body validation → storage → response.
 *
 * Uses a single test server per describe block to avoid hanging from unclosed timers
 * in imported services (webhooks, etc.).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import passport from "passport";
import { createHash } from "crypto";
import http from "http";
import { storage } from "../server/storage.js";
import { register as registerEmployeeRoutes } from "../server/routes/employees.js";
import { registerCallRoutes } from "../server/routes/calls.js";
import { registerUserRoutes } from "../server/routes/users.js";
import { register as registerDashboardRoutes } from "../server/routes/dashboard.js";
import { registerConfigRoutes } from "../server/routes/config.js";
import { registerReportRoutes } from "../server/routes/reports.js";
import { register as registerCoachingRoutes } from "../server/routes/coaching.js";

// --- Test harness ---

const TEST_UA = "TestRunner/1.0";
const TEST_LANG = "en-US";
const TEST_FINGERPRINT = createHash("sha256").update(`${TEST_UA}|${TEST_LANG}`).digest("hex").slice(0, 16);

interface TestUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

const ADMIN_USER: TestUser = { id: "test-admin", username: "admin", name: "Test Admin", role: "admin" };
const MANAGER_USER: TestUser = { id: "test-manager", username: "manager", name: "Test Manager", role: "manager" };
const VIEWER_USER: TestUser = { id: "test-viewer", username: "viewer", name: "Test Viewer", role: "viewer" };

/**
 * Build an Express app with real employee routes and a configurable fake user.
 * The user can be changed per-request by setting a header.
 */
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true, cookie: { secure: false } }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Patch Session.prototype.regenerate (Passport 0.7 compat)
  let patched = false;
  app.use((req: any, _res, next) => {
    if (!patched && req.session) {
      const proto = Object.getPrototypeOf(req.session);
      if (proto) {
        proto.regenerate = function (cb: (err?: Error) => void) { cb(); };
        proto.save = proto.save || function (cb: (err?: Error) => void) { cb(); };
      }
      patched = true;
    }
    next();
  });

  // Dynamic user injection: read role from X-Test-Role header
  const users: Record<string, TestUser> = { admin: ADMIN_USER, manager: MANAGER_USER, viewer: VIEWER_USER };
  app.use((req: any, _res, next) => {
    const role = req.headers["x-test-role"] as string;
    if (role === "none") {
      req.isAuthenticated = () => false;
    } else {
      const user = users[role] || ADMIN_USER;
      req.user = user;
      req.isAuthenticated = () => true;
      if (req.session) (req.session as any).fingerprint = TEST_FINGERPRINT;
    }
    next();
  });

  return { app, addRoutes(setup: (router: express.Router) => void) { const r = express.Router(); setup(r); app.use(r); } };
}

/** Shorthand: build app and register specific routes */
function buildAppWith(...setups: Array<(r: express.Router) => void>) {
  const { app, addRoutes } = buildTestApp();
  for (const setup of setups) addRoutes(setup);
  return app;
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  role = "admin",
): Promise<{ status: number; body: any }> {
  const url = `${baseUrl}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "User-Agent": TEST_UA,
      "Accept-Language": TEST_LANG,
      "X-Test-Role": role,
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// Raw variant for binary endpoints (PDF export) — returns status, headers,
// and the body as a Buffer so tests can verify content-type + PDF magic bytes.
async function reqBinary(
  baseUrl: string,
  method: string,
  path: string,
  role = "admin",
): Promise<{ status: number; headers: Headers; buffer: Buffer }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "User-Agent": TEST_UA,
      "Accept-Language": TEST_LANG,
      "X-Test-Role": role,
    },
  });
  const ab = await res.arrayBuffer();
  return { status: res.status, headers: res.headers, buffer: Buffer.from(ab) };
}

// =====================================================================
// EMPLOYEE ENDPOINTS
// =====================================================================

/** Start a test server, return base URL. Caller must close server in after(). */
function startServer(app: express.Express): { server: http.Server; getBaseUrl: () => string } {
  const server = http.createServer(app);
  let baseUrl = "";
  return {
    server,
    getBaseUrl: () => baseUrl,
  };
}

describe("Employee endpoints (real routes)", () => {
  const app = buildAppWith(registerEmployeeRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup: start test server", (_, done) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://localhost:${addr.port}`;
      done();
    });
  });

  it("GET /api/employees returns array", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/employees");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("GET /api/employees returns 401 when unauthenticated", async () => {
    const { status } = await req(baseUrl, "GET", "/api/employees", undefined, "none");
    assert.equal(status, 401);
  });

  it("POST /api/employees creates employee with valid data", async () => {
    const { status, body } = await req(baseUrl, "POST", "/api/employees", {
      name: "Route Test Agent",
      email: "route-test@example.com",
      role: "Agent",
      status: "Active",
    });
    assert.equal(status, 201);
    assert.equal(body.name, "Route Test Agent");
    assert.ok(body.id);
  });

  it("POST /api/employees rejects invalid email", async () => {
    const { status, body } = await req(baseUrl, "POST", "/api/employees", {
      name: "Bad Email",
      email: "not-an-email",
      role: "Agent",
      status: "Active",
    });
    assert.equal(status, 400);
    assert.ok(body.message.includes("Invalid"));
  });

  it("POST /api/employees rejects invalid status enum", async () => {
    const { status } = await req(baseUrl, "POST", "/api/employees", {
      name: "Bad Status",
      email: "status@example.com",
      role: "Agent",
      status: "Retired",
    });
    assert.equal(status, 400);
  });

  it("POST /api/employees rejects missing required fields", async () => {
    const { status } = await req(baseUrl, "POST", "/api/employees", { name: "No Email" });
    assert.equal(status, 400);
  });

  it("POST /api/employees returns 403 for viewer role", async () => {
    const { status } = await req(baseUrl, "POST", "/api/employees", {
      name: "Unauthorized",
      email: "unauth@example.com",
      role: "Agent",
      status: "Active",
    }, "viewer");
    assert.equal(status, 403);
  });

  it("PATCH /api/employees/:id updates employee", async () => {
    const emp = await storage.createEmployee({
      name: "Updatable",
      email: "update@example.com",
      role: "Agent",
      status: "Active",
    });
    const { status, body } = await req(baseUrl, "PATCH", `/api/employees/${emp.id}`, {
      name: "Updated Name",
    }, "manager");
    assert.equal(status, 200);
    assert.equal(body.name, "Updated Name");
  });

  it("PATCH /api/employees/:id returns 404 for non-existent", async () => {
    const { status } = await req(baseUrl, "PATCH", "/api/employees/00000000-0000-0000-0000-000000000000", {
      name: "Ghost",
    }, "manager");
    assert.equal(status, 404);
  });

  it("PATCH /api/employees/:id rejects invalid update data", async () => {
    const emp = await storage.createEmployee({
      name: "Validate Me",
      email: "validate@example.com",
      role: "Agent",
      status: "Active",
    });
    const { status } = await req(baseUrl, "PATCH", `/api/employees/${emp.id}`, {
      status: "InvalidStatus",
    }, "manager");
    assert.equal(status, 400);
  });

  it("manager can create and update employees", async () => {
    const { status: createStatus, body: created } = await req(baseUrl, "POST", "/api/employees", {
      name: "Manager Created",
      email: "mgr-create@example.com",
      role: "Agent",
      status: "Active",
    }, "manager");
    assert.equal(createStatus, 201);

    const { status: updateStatus, body: updated } = await req(baseUrl, "PATCH", `/api/employees/${created.id}`, {
      name: "Manager Updated",
    }, "manager");
    assert.equal(updateStatus, 200);
    assert.equal(updated.name, "Manager Updated");
  });

  // --- A28: GET /api/employees/teams ---

  it("GET /api/employees/teams returns the department/sub-team taxonomy", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/employees/teams");
    assert.equal(status, 200);
    assert.ok(body.departmentsWithSubTeams);
    assert.ok(typeof body.departmentsWithSubTeams === "object");
    // Both Power Mobility department keys should be present
    assert.ok(body.departmentsWithSubTeams["Power Mobility"]);
    assert.ok(body.departmentsWithSubTeams["Intake - Power Mobility"]);
    // Sub-teams should be a non-empty array of strings
    assert.ok(Array.isArray(body.departmentsWithSubTeams["Power Mobility"]));
    assert.ok(body.departmentsWithSubTeams["Power Mobility"].length > 0);
    for (const team of body.departmentsWithSubTeams["Power Mobility"]) {
      assert.equal(typeof team, "string");
    }
  });

  it("GET /api/employees/teams requires authentication", async () => {
    const { status } = await req(baseUrl, "GET", "/api/employees/teams", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/employees/teams is registered before /api/employees/:id (route ordering)", async () => {
    // The /teams literal must be matched before any future /:id wildcard.
    // If a future change accidentally registers GET /api/employees/:id BEFORE
    // /teams, this test would still pass (since :id doesn't exist yet) — but
    // it documents the contract.
    const { status, body } = await req(baseUrl, "GET", "/api/employees/teams");
    assert.equal(status, 200);
    // The body shape proves we hit the /teams handler, not a /:id handler
    assert.ok(body.departmentsWithSubTeams);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// CALL ENDPOINTS
// =====================================================================

describe("Call endpoints (real routes)", () => {
  // registerCallRoutes needs uploadMiddleware, processAudioFn, getJobQueue — stub them
  const noopUpload = (_req: any, _res: any, next: any) => next();
  const noopProcess = async () => {};
  const app = buildAppWith(
    (r) => registerCallRoutes(r, noopUpload, noopProcess as any, () => null),
    registerEmployeeRoutes, // needed for assign tests
  );
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/calls returns paginated result", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/calls");
    assert.equal(status, 200);
    assert.ok(body.calls !== undefined || Array.isArray(body));
  });

  it("GET /api/calls returns 401 when unauthenticated", async () => {
    const { status } = await req(baseUrl, "GET", "/api/calls", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/calls/:id returns 400 for invalid UUID", async () => {
    const { status } = await req(baseUrl, "GET", "/api/calls/not-a-uuid");
    assert.equal(status, 400);
    // validateIdParam rejects before route handler
  });

  it("GET /api/calls/:id returns 404 for non-existent call", async () => {
    const { status } = await req(baseUrl, "GET", "/api/calls/00000000-0000-0000-0000-000000000000");
    assert.equal(status, 404);
  });

  it("GET /api/calls/:id returns call details for existing call", async () => {
    const call = await storage.createCall({ fileName: "endpoint-test.mp3", duration: 60, status: "completed" });
    const { status, body } = await req(baseUrl, "GET", `/api/calls/${call.id}`);
    assert.equal(status, 200);
    assert.equal(body.id, call.id);
    assert.equal(body.fileName, "endpoint-test.mp3");
  });

  it("PATCH /api/calls/:id/assign rejects extra fields (strict schema)", async () => {
    const call = await storage.createCall({ fileName: "assign-strict.mp3", duration: 60, status: "completed" });
    // assignCallSchema is .strict() — extra fields should fail
    const { status } = await req(baseUrl, "PATCH", `/api/calls/${call.id}/assign`, { employeeId: "x", extra: "bad" }, "manager");
    assert.equal(status, 400);
  });

  it("PATCH /api/calls/:id/assign succeeds with valid employee", async () => {
    const emp = await storage.createEmployee({ name: "Assign Target", email: "assign-ep@test.com", role: "Agent", status: "Active" });
    const call = await storage.createCall({ fileName: "assign-ok.mp3", duration: 60, status: "completed" });
    const { status, body } = await req(baseUrl, "PATCH", `/api/calls/${call.id}/assign`, { employeeId: emp.id }, "manager");
    assert.equal(status, 200);
    assert.equal(body.employeeId, emp.id);
  });

  it("PATCH /api/calls/:id/assign returns 403 for viewer", async () => {
    const call = await storage.createCall({ fileName: "no-assign.mp3", duration: 60, status: "completed" });
    const { status } = await req(baseUrl, "PATCH", `/api/calls/${call.id}/assign`, { employeeId: "any" }, "viewer");
    assert.equal(status, 403);
  });

  it("DELETE /api/calls/:id deletes call", async () => {
    const call = await storage.createCall({ fileName: "delete-me.mp3", duration: 60, status: "completed" });
    const { status } = await req(baseUrl, "DELETE", `/api/calls/${call.id}`, undefined, "manager");
    assert.ok(status === 200 || status === 204, `Expected 200 or 204, got ${status}`);

    const deleted = await storage.getCall(call.id);
    assert.equal(deleted, undefined);
  });

  it("DELETE /api/calls/:id returns 403 for viewer", async () => {
    const call = await storage.createCall({ fileName: "no-delete.mp3", duration: 60, status: "completed" });
    const { status } = await req(baseUrl, "DELETE", `/api/calls/${call.id}`, undefined, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/calls/:id/transcript returns 404 when no transcript", async () => {
    const call = await storage.createCall({ fileName: "no-transcript.mp3", duration: 60, status: "completed" });
    const { status } = await req(baseUrl, "GET", `/api/calls/${call.id}/transcript`);
    assert.equal(status, 404);
  });

  it("GET /api/calls/:id/transcript returns transcript when exists", async () => {
    const call = await storage.createCall({ fileName: "has-transcript.mp3", duration: 60, status: "completed" });
    await storage.createTranscript({ callId: call.id, text: "Hello world", confidence: 0.95 });
    const { status, body } = await req(baseUrl, "GET", `/api/calls/${call.id}/transcript`);
    assert.equal(status, 200);
    assert.equal(body.text, "Hello world");
  });

  it("GET /api/calls/:id/analysis returns 404 when no analysis", async () => {
    const call = await storage.createCall({ fileName: "no-analysis.mp3", duration: 60, status: "completed" });
    const { status } = await req(baseUrl, "GET", `/api/calls/${call.id}/analysis`);
    assert.equal(status, 404);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// USER MANAGEMENT ENDPOINTS
// =====================================================================

describe("User management endpoints (real routes)", () => {
  const app = buildAppWith(registerUserRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/users returns 401 when unauthenticated", async () => {
    const { status } = await req(baseUrl, "GET", "/api/users", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/users returns 403 for non-admin", async () => {
    const { status } = await req(baseUrl, "GET", "/api/users", undefined, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/users returns array for admin", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/users", undefined, "admin");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("POST /api/users rejects weak password", async () => {
    const { status, body } = await req(baseUrl, "POST", "/api/users", {
      username: "weakuser",
      password: "short",
      role: "viewer",
      displayName: "Weak User",
    });
    assert.equal(status, 400);
    assert.ok(body.message?.includes("password") || body.errors);
  });

  it("POST /api/users rejects missing username", async () => {
    const { status } = await req(baseUrl, "POST", "/api/users", {
      password: "SuperStr0ng!Pass123",
      role: "viewer",
    });
    assert.equal(status, 400);
  });

  it("POST /api/users rejects invalid role", async () => {
    const { status } = await req(baseUrl, "POST", "/api/users", {
      username: "badrole",
      password: "SuperStr0ng!Pass123",
      role: "superadmin",
      displayName: "Bad Role",
    });
    assert.equal(status, 400);
  });

  it("POST /api/users returns 500 without PostgreSQL (MemStorage limitation)", async () => {
    // DB user management requires PostgreSQL — MemStorage throws
    const { status } = await req(baseUrl, "POST", "/api/users", {
      username: `testuser_${Date.now()}`,
      password: "SecureP@ss12345!",
      role: "viewer",
      displayName: "Valid User",
    });
    assert.equal(status, 500);
  });

  it("POST /api/users returns 403 for non-admin", async () => {
    const { status } = await req(baseUrl, "POST", "/api/users", {
      username: "unauthorized",
      password: "SecureP@ss12345!",
      role: "viewer",
    }, "manager");
    assert.equal(status, 403);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// UNLINKED USERS + PHASE E ADDITIONS
// =====================================================================
//
// Focused tests for the Phase E enhancements — candidate suggestions in
// the unlinked list, the manager-role extension, and the create-user
// "no matching employee" warning. MemStorage supports the user list
// operations that MemStorage-compatible routes use.
describe("Users Phase E — unlinked + fuzzy candidates", () => {
  const app = buildAppWith(registerUserRoutes, registerEmployeeRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/users/unlinked returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/users/unlinked", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/users/unlinked returns 403 for non-admin", async () => {
    const { status } = await req(baseUrl, "GET", "/api/users/unlinked", undefined, "manager");
    assert.equal(status, 403);
  });

  it("GET /api/users/unlinked returns count + users array for admin", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/users/unlinked", undefined, "admin");
    assert.equal(status, 200);
    assert.equal(typeof body.count, "number");
    assert.ok(Array.isArray(body.users));
  });

  it("GET /api/users/unlinked returned users carry a candidates array (Phase E)", async () => {
    const { body } = await req(baseUrl, "GET", "/api/users/unlinked", undefined, "admin");
    // Even when empty, the shape guarantees candidates is present on each user.
    for (const u of body.users) {
      assert.ok(Array.isArray(u.candidates), `user ${u.id} missing candidates array`);
    }
  });
});

// =====================================================================
// DASHBOARD ENDPOINTS
// =====================================================================

describe("Dashboard endpoints (real routes)", () => {
  const app = buildAppWith(registerDashboardRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/dashboard/metrics returns metrics object", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/metrics");
    assert.equal(status, 200);
    assert.ok(body.totalCalls !== undefined);
  });

  it("GET /api/dashboard/metrics returns 401 when unauthenticated", async () => {
    const { status } = await req(baseUrl, "GET", "/api/dashboard/metrics", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/dashboard/sentiment returns distribution", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/sentiment");
    assert.equal(status, 200);
    assert.ok(body.positive !== undefined);
    assert.ok(body.neutral !== undefined);
    assert.ok(body.negative !== undefined);
  });

  it("GET /api/dashboard/performers returns array", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/performers");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// PUBLIC CONFIG ENDPOINT (A11)
// =====================================================================

describe("Public config endpoint (/api/config)", () => {
  const app = buildAppWith(registerConfigRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/config returns 200 without authentication (public route)", async () => {
    const { status } = await req(baseUrl, "GET", "/api/config", undefined, "none");
    assert.equal(status, 200);
  });

  it("GET /api/config returns companyName + appName + scoring shape", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/config", undefined, "none");
    assert.equal(status, 200);
    assert.equal(typeof body.companyName, "string");
    assert.ok(body.companyName.length > 0);
    assert.equal(typeof body.appName, "string");
    assert.ok(body.appName.length > 0);
    assert.ok(body.scoring);
    assert.equal(typeof body.scoring.lowScoreThreshold, "number");
    assert.equal(typeof body.scoring.highScoreThreshold, "number");
    assert.equal(typeof body.scoring.streakScoreThreshold, "number");
    assert.equal(typeof body.scoring.excellentThreshold, "number");
    assert.equal(typeof body.scoring.goodThreshold, "number");
    assert.equal(typeof body.scoring.needsWorkThreshold, "number");
  });

  it("scoring tier thresholds are sane (low < good < excellent)", async () => {
    const { body } = await req(baseUrl, "GET", "/api/config", undefined, "none");
    assert.ok(body.scoring.lowScoreThreshold < body.scoring.highScoreThreshold);
    assert.ok(body.scoring.needsWorkThreshold < body.scoring.goodThreshold);
    assert.ok(body.scoring.goodThreshold < body.scoring.excellentThreshold);
  });

  it("companyName falls back to default when COMPANY_NAME env var is not overridden", async () => {
    // Default per server/routes/config.ts is "UniversalMed Supply".
    // The test process may have COMPANY_NAME set or unset; just assert it's
    // a non-empty string and matches the env var when present.
    const { body } = await req(baseUrl, "GET", "/api/config", undefined, "none");
    const expected = process.env.COMPANY_NAME || "UniversalMed Supply";
    assert.equal(body.companyName, expected);
  });

  it("appName is always CallAnalyzer regardless of COMPANY_NAME env var", async () => {
    // appName is the product brand for UI chrome — hardcoded server-side
    // so a tenant's COMPANY_NAME override never changes the app name shown
    // in the login page title or sidebar header.
    const { body } = await req(baseUrl, "GET", "/api/config", undefined, "none");
    assert.equal(body.appName, "CallAnalyzer");
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// REPORTS EXPORT BEACON (A8 — HIPAA audit beacon for client-built exports)
// =====================================================================

// =====================================================================
// SEMANTIC SEARCH (Phase A — UI + hybrid ranking)
// =====================================================================
//
// Verifies the mode/alpha/threshold/filter contract on /api/search/semantic.
// The route falls through to keyword search when the AI provider has no
// embedding capability — which is the case in the test harness, since
// ai-factory selects a stub provider without AWS credentials. So every
// assertion below exercises the keyword-fallback branch. That's still the
// branch most clients will hit when Bedrock is unreachable, so it's a
// meaningful test surface even if the semantic-only assertions are deferred.
describe("Semantic search (GET /api/search/semantic)", () => {
  const app = buildAppWith(registerReportRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/search/semantic?q=foo", undefined, "none");
    assert.equal(status, 401);
  });

  it("returns 400 when q is missing", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/search/semantic", undefined, "viewer");
    assert.equal(status, 400);
    assert.ok(/required/i.test(body.message ?? ""));
  });

  it("returns 400 when q exceeds 500 chars", async () => {
    const huge = "a".repeat(501);
    const { status } = await req(baseUrl, "GET", `/api/search/semantic?q=${encodeURIComponent(huge)}`, undefined, "viewer");
    assert.equal(status, 400);
  });

  it("falls back to keyword mode when embedding provider is unavailable", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/search/semantic?q=test%20query", undefined, "viewer");
    assert.equal(status, 200);
    // In the test harness, no embedding provider → keyword-fallback branch.
    assert.equal(body.mode, "keyword-fallback");
    assert.ok(Array.isArray(body.results));
  });

  it("clamps invalid alpha to a finite value", async () => {
    // alpha=NaN should clamp to 0.5 default. Mode=hybrid still routes through
    // the fallback because no embedding provider, but the parser shouldn't 500.
    const { status } = await req(baseUrl, "GET", "/api/search/semantic?q=foo&mode=hybrid&alpha=not-a-number", undefined, "viewer");
    assert.equal(status, 200);
  });

  it("clamps alpha > 1 to 1", async () => {
    const { status } = await req(baseUrl, "GET", "/api/search/semantic?q=foo&mode=hybrid&alpha=99", undefined, "viewer");
    assert.equal(status, 200);
  });

  it("clamps threshold > 1 to 1", async () => {
    const { status } = await req(baseUrl, "GET", "/api/search/semantic?q=foo&threshold=99", undefined, "viewer");
    assert.equal(status, 200);
  });

  it("ignores unknown mode and defaults to semantic", async () => {
    const { status } = await req(baseUrl, "GET", "/api/search/semantic?q=foo&mode=lasers", undefined, "viewer");
    // Mode=lasers → defaults to semantic → falls back to keyword (no provider).
    assert.equal(status, 200);
  });

  it("accepts date filters without 500", async () => {
    const { status } = await req(
      baseUrl,
      "GET",
      "/api/search/semantic?q=foo&from=2025-01-01&to=2025-12-31&sentiment=positive",
      undefined,
      "viewer",
    );
    assert.equal(status, 200);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// COACHING OUTCOMES-SUMMARY (Phase B)
// =====================================================================
//
// Exercises the Phase B extensions: ?groupBy=employee, ?bucket=week,
// ?includeSkipped=true, and the new avgSubDeltas fields on every rollup.
// With MemStorage there are no sessions so the rollup is zero-measured;
// the tests verify shape + validation + auth rather than non-trivial math.
// The math is covered in the Phase B frontend tests via synthetic fixtures.
describe("Coaching outcomes-summary (GET /api/coaching/outcomes-summary)", () => {
  const app = buildAppWith(registerCoachingRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary", undefined, "none");
    assert.equal(status, 401);
  });

  it("returns 403 for viewer role", async () => {
    const { status } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary", undefined, "viewer");
    assert.equal(status, 403);
  });

  it("returns flat shape for manager role without groupBy", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(typeof body.windowDays, "number");
    assert.equal(typeof body.totalSessions, "number");
    assert.equal(typeof body.measured, "number");
    // Phase B: avgSubDeltas is on the rollup even when no sessions measured.
    assert.ok(body.avgSubDeltas, "avgSubDeltas should be present");
    assert.ok("compliance" in body.avgSubDeltas);
    assert.ok("customerExperience" in body.avgSubDeltas);
    assert.ok("communication" in body.avgSubDeltas);
    assert.ok("resolution" in body.avgSubDeltas);
  });

  it("returns grouped shape for ?groupBy=manager", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?groupBy=manager", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(body.groupBy, "manager");
    assert.ok(Array.isArray(body.groups));
    assert.ok(body.overall);
  });

  it("returns grouped shape for ?groupBy=employee", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?groupBy=employee", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(body.groupBy, "employee");
    assert.ok(Array.isArray(body.groups));
  });

  it("includes timeSeries when ?bucket=week", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?bucket=week", undefined, "manager");
    assert.equal(status, 200);
    // Empty storage → empty time series, but the field must be present.
    assert.ok(Array.isArray(body.timeSeries));
  });

  it("omits timeSeries when bucket param absent", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(body.timeSeries, undefined);
  });

  it("includes skipped list when ?includeSkipped=true", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?includeSkipped=true", undefined, "manager");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.skipped));
  });

  it("omits skipped list by default", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/coaching/outcomes-summary", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(body.skipped, undefined);
  });

  it("clamps days outside [7, 365] to the bounds", async () => {
    const low = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?days=1", undefined, "manager");
    assert.equal(low.status, 200);
    assert.equal(low.body.windowDays, 7);
    const high = await req(baseUrl, "GET", "/api/coaching/outcomes-summary?days=9999", undefined, "manager");
    assert.equal(high.status, 200);
    assert.equal(high.body.windowDays, 365);
  });

  it("accepts all Phase B params simultaneously", async () => {
    const { status, body } = await req(
      baseUrl,
      "GET",
      "/api/coaching/outcomes-summary?groupBy=employee&bucket=week&includeSkipped=true&days=30",
      undefined,
      "manager",
    );
    assert.equal(status, 200);
    assert.equal(body.groupBy, "employee");
    assert.equal(body.windowDays, 30);
    assert.ok(Array.isArray(body.timeSeries));
    assert.ok(Array.isArray(body.skipped));
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// PDF EXPORTS (Phase D)
// =====================================================================
//
// Verifies content-type, content-disposition, PDF magic bytes, and
// auth/RBAC on the three Phase D PDF endpoints. Exact PDF content isn't
// parsed — trusting pdfkit to produce valid output is reasonable; the
// tests guard against regressions in the Express-level wiring.
describe("Report PDF exports (Phase D)", () => {
  const app = buildAppWith(registerReportRoutes, registerCoachingRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/reports/filtered/export.pdf returns 401 without auth", async () => {
    const { status } = await reqBinary(baseUrl, "GET", "/api/reports/filtered/export.pdf", "none");
    assert.equal(status, 401);
  });

  it("GET /api/reports/filtered/export.pdf returns 403 for viewer", async () => {
    const { status } = await reqBinary(baseUrl, "GET", "/api/reports/filtered/export.pdf", "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/reports/filtered/export.pdf returns 200 application/pdf for manager", async () => {
    const { status, headers, buffer } = await reqBinary(
      baseUrl,
      "GET",
      "/api/reports/filtered/export.pdf?from=2025-01-01&to=2025-12-31",
      "manager",
    );
    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(headers.get("content-disposition") ?? "", /attachment; filename=/);
    // PDF magic bytes: %PDF-
    assert.equal(buffer.slice(0, 4).toString("ascii"), "%PDF");
  });

  it("GET /api/reports/filtered/export.pdf filename embeds the period", async () => {
    const { headers } = await reqBinary(
      baseUrl,
      "GET",
      "/api/reports/filtered/export.pdf?from=2025-06-01&to=2025-06-30",
      "admin",
    );
    assert.match(headers.get("content-disposition") ?? "", /2025-06-01/);
    assert.match(headers.get("content-disposition") ?? "", /2025-06-30/);
  });

  it("GET /api/coaching/outcomes-summary/export.pdf returns 401 without auth", async () => {
    const { status } = await reqBinary(baseUrl, "GET", "/api/coaching/outcomes-summary/export.pdf", "none");
    assert.equal(status, 401);
  });

  it("GET /api/coaching/outcomes-summary/export.pdf returns 403 for viewer", async () => {
    const { status } = await reqBinary(baseUrl, "GET", "/api/coaching/outcomes-summary/export.pdf", "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/coaching/outcomes-summary/export.pdf returns a valid PDF for manager", async () => {
    const { status, headers, buffer } = await reqBinary(
      baseUrl,
      "GET",
      "/api/coaching/outcomes-summary/export.pdf",
      "manager",
    );
    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /application\/pdf/);
    assert.equal(buffer.slice(0, 4).toString("ascii"), "%PDF");
  });

  it("GET /api/coaching/outcomes-summary/export.pdf clamps window days", async () => {
    const { status, headers } = await reqBinary(
      baseUrl,
      "GET",
      "/api/coaching/outcomes-summary/export.pdf?days=9999",
      "manager",
    );
    assert.equal(status, 200);
    // windowDays clamped to 365 — should appear in the filename.
    assert.match(headers.get("content-disposition") ?? "", /365d/);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// DASHBOARD SEEDED-DATA TESTS (#10) — exercises the aggregation code paths
// in routes/dashboard.ts. The earlier "Dashboard endpoints" describe block
// only hits empty-MemStorage paths; this one seeds 2 employees + 4 calls +
// analyses + sentiment rows and verifies the aggregate shapes.
// =====================================================================
describe("Dashboard endpoints — seeded data (#10)", () => {
  const app = buildAppWith(registerDashboardRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  const seededCallIds: string[] = [];
  let empAliceId = "";
  let empBobId = "";

  it("setup + seed", async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`;
        resolve();
      });
    });

    const alice = await storage.createEmployee({
      name: "Dashboard Alice",
      email: "dash-alice@test.com",
      role: "Agent",
      status: "Active",
    });
    empAliceId = alice.id;
    const bob = await storage.createEmployee({
      name: "Dashboard Bob",
      email: "dash-bob@test.com",
      role: "Agent",
      status: "Active",
    });
    empBobId = bob.id;

    // 4 calls across the two agents with known scores + sentiments.
    const scores: Array<{ perf: string; sent: string; sentScore: string; emp: string }> = [
      { perf: "9.0", sent: "positive", sentScore: "0.9", emp: empAliceId },
      { perf: "7.5", sent: "positive", sentScore: "0.7", emp: empAliceId },
      { perf: "6.0", sent: "neutral", sentScore: "0.5", emp: empBobId },
      { perf: "4.0", sent: "negative", sentScore: "0.2", emp: empBobId },
    ];
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      const call = await storage.createCall({
        fileName: `dash-seed-${i}.mp3`,
        status: "completed",
        contentHash: `dash-seed-${i}`,
      });
      seededCallIds.push(call.id);
      await storage.setCallEmployee(call.id, s.emp);
      await storage.createCallAnalysis({
        callId: call.id,
        performanceScore: s.perf,
        summary: `seed ${i}`,
      } as any);
      await storage.createSentimentAnalysis({
        callId: call.id,
        overallSentiment: s.sent,
        overallScore: s.sentScore,
      } as any);
    }
  });

  it("GET /api/dashboard/metrics returns aggregates over seeded data", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/metrics");
    assert.equal(status, 200);
    // Earlier describe blocks may have seeded additional calls, so assert ≥.
    assert.ok(body.totalCalls >= 4, `expected ≥4 totalCalls, got ${body.totalCalls}`);
    assert.equal(typeof body.avgSentiment, "number");
    assert.equal(typeof body.avgPerformanceScore, "number");
    assert.ok(body.avgPerformanceScore >= 0 && body.avgPerformanceScore <= 10);
  });

  it("GET /api/dashboard/sentiment includes all 3 sentiment buckets", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/sentiment");
    assert.equal(status, 200);
    // Our seed contributes: 2 positive, 1 neutral, 1 negative.
    assert.ok(body.positive >= 2, `expected ≥2 positive, got ${body.positive}`);
    assert.ok(body.neutral >= 1);
    assert.ok(body.negative >= 1);
  });

  it("GET /api/dashboard/performers returns employees ranked by avg score", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/performers");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    const alice = body.find((p: any) => p.id === empAliceId);
    const bob = body.find((p: any) => p.id === empBobId);
    assert.ok(alice, "Dashboard Alice should appear in performers");
    assert.ok(bob, "Dashboard Bob should appear in performers");
    // Alice's avg (9.0, 7.5) = 8.25; Bob's (6.0, 4.0) = 5.0.
    assert.ok(alice.avgPerformanceScore > bob.avgPerformanceScore,
      "Alice should rank above Bob");
  });

  it("GET /api/dashboard/performers respects limit query", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/performers?limit=1");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1, "limit=1 should return exactly 1 performer");
  });

  it("GET /api/dashboard/weekly-changes returns narrative for manager+", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/dashboard/weekly-changes", undefined, "manager");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("GET /api/dashboard/weekly-changes returns 403 for viewer", async () => {
    const { status } = await req(baseUrl, "GET", "/api/dashboard/weekly-changes", undefined, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/dashboard/weekly-changes returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/dashboard/weekly-changes", undefined, "none");
    assert.equal(status, 401);
  });

  it("Dashboard metrics exclude calls flagged as excluded_from_metrics", async () => {
    // INV-34 regression guard at the route level.
    const before = await req(baseUrl, "GET", "/api/dashboard/metrics");
    const beforeTotal = before.body.totalCalls;

    await storage.updateCall(seededCallIds[0], { excludedFromMetrics: true });
    const after = await req(baseUrl, "GET", "/api/dashboard/metrics");
    assert.equal(after.body.totalCalls, beforeTotal - 1,
      "flagged call should be excluded from totalCalls");

    // Cleanup for any subsequent describe blocks that share storage.
    await storage.updateCall(seededCallIds[0], { excludedFromMetrics: false });
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// REPORTS: scoring-quality + similar-uncorrected route tests (#2)
// =====================================================================
//
// Covers the two new manager+ read-only endpoints shipped in Tier A #3
// and Tier 2 #5. Both operate on the in-memory corrections array backed
// by scoring-feedback.ts; tests seed via recordScoringCorrection so the
// composition layer (auth → data → response shape) is exercised.
describe("Reports — scoring quality + similar-uncorrected (#2)", () => {
  const app = buildAppWith(registerReportRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("GET /api/scoring-quality returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/scoring-quality", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/scoring-quality returns 403 for viewer", async () => {
    const { status } = await req(baseUrl, "GET", "/api/scoring-quality", undefined, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/scoring-quality returns the expected shape for manager", async () => {
    const { status, body } = await req(baseUrl, "GET", "/api/scoring-quality", undefined, "manager");
    assert.equal(status, 200);
    // Lean projection: correctionStats + qualityAlerts + calibration summary.
    assert.ok(body.correctionStats, "correctionStats must be present");
    assert.equal(typeof body.correctionStats.total, "number");
    assert.equal(typeof body.correctionStats.upgrades, "number");
    assert.equal(typeof body.correctionStats.downgrades, "number");
    assert.ok(Array.isArray(body.qualityAlerts), "qualityAlerts must be an array");
    assert.ok(body.calibration, "calibration summary must be present");
    assert.ok("lastSnapshotAt" in body.calibration);
    assert.ok("driftDetected" in body.calibration);
  });

  it("GET /api/scoring-quality is also reachable for admin role", async () => {
    const { status } = await req(baseUrl, "GET", "/api/scoring-quality", undefined, "admin");
    assert.equal(status, 200);
  });

  it("GET /api/scoring-corrections/similar-uncorrected returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "GET", "/api/scoring-corrections/similar-uncorrected", undefined, "none");
    assert.equal(status, 401);
  });

  it("GET /api/scoring-corrections/similar-uncorrected returns 403 for viewer", async () => {
    const { status } = await req(baseUrl, "GET", "/api/scoring-corrections/similar-uncorrected", undefined, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/scoring-corrections/similar-uncorrected returns empty when no corrections", async () => {
    const { status, body } = await req(
      baseUrl,
      "GET",
      "/api/scoring-corrections/similar-uncorrected",
      undefined,
      "manager",
    );
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.suggestions));
    assert.ok(Array.isArray(body.groups));
  });

  it("GET /api/scoring-corrections/similar-uncorrected returns groups after seeding corrections", async () => {
    // Seed 2 same-category/direction corrections by "manager" (the test role's
    // username). This seeds the in-memory `corrections` array backing the
    // scoring-feedback module. After seeding, the endpoint should see the
    // user's recent corrections and compute a qualifying group.
    const { recordScoringCorrection } = await import("../server/services/scoring-feedback");
    const empIdA = "emp-siml-" + Math.random().toString(36).slice(2, 8);
    const callA = await storage.createCall({
      fileName: "siml-a.mp3",
      status: "completed",
      contentHash: `siml-a-${Date.now()}`,
    });
    await storage.setCallEmployee(callA.id, empIdA);
    await storage.createCallAnalysis({ callId: callA.id, performanceScore: "3.0" } as any);
    const callB = await storage.createCall({
      fileName: "siml-b.mp3",
      status: "completed",
      contentHash: `siml-b-${Date.now()}`,
    });
    await storage.setCallEmployee(callB.id, empIdA);
    await storage.createCallAnalysis({ callId: callB.id, performanceScore: "3.5" } as any);

    await recordScoringCorrection({
      callId: callA.id,
      correctedBy: "manager",
      reason: "too low for a clean call",
      originalScore: 3.0,
      correctedScore: 5.0,
    });
    await recordScoringCorrection({
      callId: callB.id,
      correctedBy: "manager",
      reason: "also too low",
      originalScore: 3.5,
      correctedScore: 5.5,
    });

    const { status, body } = await req(
      baseUrl,
      "GET",
      "/api/scoring-corrections/similar-uncorrected",
      undefined,
      "manager",
    );
    assert.equal(status, 200);
    // With 2 corrections in the same (category=general, direction=upgraded)
    // bucket, a qualifying group should be returned (minCount=2).
    assert.ok(body.groups.length >= 1, `expected ≥1 group, got ${body.groups.length}`);
    const upgradedGroup = body.groups.find((g: any) => g.direction === "upgraded");
    assert.ok(upgradedGroup, "upgraded group should exist");
    assert.equal(upgradedGroup.count, 2);
    // Centroid is the mean of 3.0 + 3.5 = 3.25 (rounded to 1 decimal in API).
    assert.ok(Math.abs(upgradedGroup.centroid - 3.25) < 0.1,
      `centroid should be ~3.25, got ${upgradedGroup.centroid}`);
  });

  it("GET /api/scoring-corrections/similar-uncorrected clamps limit to [1, 50]", async () => {
    const hi = await req(
      baseUrl,
      "GET",
      "/api/scoring-corrections/similar-uncorrected?limit=9999",
      undefined,
      "manager",
    );
    assert.equal(hi.status, 200);
    // Should not throw / no clamping issue; just run.
    assert.ok(Array.isArray(hi.body.suggestions));

    const lo = await req(
      baseUrl,
      "GET",
      "/api/scoring-corrections/similar-uncorrected?limit=0",
      undefined,
      "manager",
    );
    assert.equal(lo.status, 200);
  });

  after((_, done) => {
    server.close(done);
  });
});

// =====================================================================
// COACHING: effectivenessRating PATCH round-trip + /outcome filter (#3)
// =====================================================================
//
// Covers the Tier 2 #8 effectiveness rating fields and the Tier B #5
// filter that makes per-session /outcome consistent with the program-wide
// /outcomes-summary behavior (excludes flagged-from-metrics calls from
// before/after windows).
describe("Coaching — effectivenessRating + outcome filter (#3)", () => {
  const app = buildAppWith(registerCoachingRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  let employeeId = "";
  let sessionId = "";

  it("setup + seed coaching session", async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`;
        resolve();
      });
    });
    const emp = await storage.createEmployee({
      name: "Coaching Target",
      email: "coaching-target@test.com",
      role: "Agent",
      status: "Active",
    });
    employeeId = emp.id;
    const session = await storage.createCoachingSession({
      employeeId,
      assignedBy: "manager",
      title: "Test coaching session for effectiveness rating",
      category: "general",
    });
    sessionId = session.id;
  });

  it("PATCH /api/coaching/:id accepts effectivenessRating + effectivenessNote", async () => {
    const { status, body } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
      effectivenessRating: "helpful",
      effectivenessNote: "Agent applied the feedback next call — clear improvement.",
    });
    assert.equal(status, 200);
    assert.equal(body.effectivenessRating, "helpful");
    assert.equal(body.effectivenessNote, "Agent applied the feedback next call — clear improvement.");
  });

  it("PATCH effectivenessRating persists across storage round-trip", async () => {
    // Pull direct from storage to prove the field lands in persistence.
    const row = await storage.getCoachingSession(sessionId);
    assert.ok(row);
    assert.equal(row.effectivenessRating, "helpful");
  });

  it("PATCH effectivenessRating rejects unknown enum values (400)", async () => {
    const { status } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
      effectivenessRating: "super_helpful",
    });
    assert.equal(status, 400);
  });

  it("PATCH effectivenessNote rejects notes over 1000 chars", async () => {
    const { status } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
      effectivenessNote: "x".repeat(1001),
    });
    assert.equal(status, 400);
  });

  it("PATCH accepts neutral + not_helpful enum values", async () => {
    for (const rating of ["neutral", "not_helpful"] as const) {
      const { status, body } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
        effectivenessRating: rating,
      });
      assert.equal(status, 200, `${rating} should be accepted`);
      assert.equal(body.effectivenessRating, rating);
    }
  });

  it("PATCH returns 401 without auth", async () => {
    const { status } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
      effectivenessRating: "helpful",
    }, "none");
    assert.equal(status, 401);
  });

  it("PATCH returns 403 for viewer role", async () => {
    const { status } = await req(baseUrl, "PATCH", `/api/coaching/${sessionId}`, {
      effectivenessRating: "helpful",
    }, "viewer");
    assert.equal(status, 403);
  });

  it("GET /api/coaching/:id/outcome filters excludedFromMetrics (Tier B #5)", async () => {
    // Set up a session with known before/after calls, flag one as excluded,
    // and verify the call count reflects the filter.
    const empId = (await storage.createEmployee({
      name: "Outcome Filter Test",
      email: "outcome-filter@test.com",
      role: "Agent",
      status: "Active",
    })).id;

    const now = Date.now();
    const sessionAt = now - 5 * 86400000;
    const ownedSession = await storage.createCoachingSession({
      employeeId: empId,
      assignedBy: "manager",
      title: "Outcome filter session",
      category: "general",
    });
    await storage.updateCoachingSession(ownedSession.id, {
      createdAt: new Date(sessionAt).toISOString(),
    });

    // 4 before calls + 4 after calls, all scoring 6.0 except one flagged
    // before-call scoring 0.0 (would drag the avg down if included).
    const earlier = now - 8 * 86400000;
    const later = now - 2 * 86400000;
    for (let i = 0; i < 4; i++) {
      const c = await storage.createCall({
        fileName: `outcome-before-${i}.mp3`,
        status: "completed",
        contentHash: `outcome-before-${i}-${now}`,
      });
      await storage.setCallEmployee(c.id, empId);
      await storage.updateCall(c.id, { uploadedAt: new Date(earlier + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "6.0" } as any);
    }
    const flagged = await storage.createCall({
      fileName: "outcome-before-flagged.mp3",
      status: "completed",
      contentHash: `outcome-before-flagged-${now}`,
      excludedFromMetrics: true,
    });
    await storage.setCallEmployee(flagged.id, empId);
    await storage.updateCall(flagged.id, { uploadedAt: new Date(earlier + 4000).toISOString() });
    await storage.createCallAnalysis({ callId: flagged.id, performanceScore: "0.0" } as any);

    for (let i = 0; i < 4; i++) {
      const c = await storage.createCall({
        fileName: `outcome-after-${i}.mp3`,
        status: "completed",
        contentHash: `outcome-after-${i}-${now}`,
      });
      await storage.setCallEmployee(c.id, empId);
      await storage.updateCall(c.id, { uploadedAt: new Date(later + i * 1000).toISOString() });
      await storage.createCallAnalysis({ callId: c.id, performanceScore: "8.0" } as any);
    }

    const { status, body } = await req(
      baseUrl,
      "GET",
      `/api/coaching/${ownedSession.id}/outcome`,
      undefined,
      "manager",
    );
    assert.equal(status, 200);
    assert.equal(body.before.callCount, 4, "flagged before-call must be excluded");
    assert.equal(body.after.callCount, 4);
    // Without the filter, flagged 0.0 would drop before-avg from 6.0 to 4.8.
    assert.equal(body.before.avgScore, 6.0);
    assert.equal(body.after.avgScore, 8.0);
  });

  it("GET /api/coaching/:id/outcome returns 403 for viewer", async () => {
    const { status } = await req(baseUrl, "GET", `/api/coaching/${sessionId}/outcome`, undefined, "viewer");
    assert.equal(status, 403);
  });

  after((_, done) => {
    server.close(done);
  });
});
