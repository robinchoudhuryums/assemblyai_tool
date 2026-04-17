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

describe("Reports export beacon (POST /api/reports/export-beacon)", () => {
  const app = buildAppWith(registerReportRoutes);
  const server = http.createServer(app);
  let baseUrl: string;

  it("setup", (_, done) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}`;
      done();
    });
  });

  it("POST /api/reports/export-beacon returns 401 when unauthenticated", async () => {
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {
      format: "txt",
      reportType: "overall",
      from: "2025-01-01",
      to: "2025-12-31",
    }, "none");
    assert.equal(status, 401);
  });

  it("POST /api/reports/export-beacon returns 204 on a valid TXT beacon", async () => {
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {
      format: "txt",
      reportType: "overall",
      from: "2025-01-01",
      to: "2025-12-31",
      targetId: "overall",
    }, "viewer");
    assert.equal(status, 204);
  });

  it("POST /api/reports/export-beacon returns 204 on a CSV beacon", async () => {
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {
      format: "csv",
      reportType: "employee",
      from: "2025-06-01",
      to: "2025-06-30",
      targetId: "employee-uuid-here",
    }, "viewer");
    assert.equal(status, 204);
  });

  it("POST /api/reports/export-beacon accepts an empty body (best-effort beacon)", async () => {
    // The handler reads body fields with safe defaults — an empty body
    // should still produce a 204, not a validation error, because the
    // beacon is fire-and-forget and must not block the user-initiated download.
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {}, "viewer");
    assert.equal(status, 204);
  });

  it("POST /api/reports/export-beacon truncates oversized field values (no overflow)", async () => {
    const huge = "x".repeat(5000);
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {
      format: huge,
      reportType: huge,
      from: huge,
      to: huge,
      targetId: huge,
    }, "viewer");
    // The handler slices each field to a max length and still records the beacon.
    assert.equal(status, 204);
  });

  it("POST /api/reports/export-beacon ignores non-string field types", async () => {
    // Defensive: malformed beacon body shouldn't crash the handler.
    const { status } = await req(baseUrl, "POST", "/api/reports/export-beacon", {
      format: 42,
      reportType: { nested: "object" },
      from: ["array"],
      to: null,
      targetId: undefined,
    }, "viewer");
    assert.equal(status, 204);
  });

  after((_, done) => {
    server.close(done);
  });
});
