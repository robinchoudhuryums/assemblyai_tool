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

  const router = express.Router();
  registerEmployeeRoutes(router);
  app.use(router);

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

describe("Employee endpoints (real routes)", () => {
  const app = buildTestApp();
  const server = http.createServer(app);
  let baseUrl: string;

  // Start server once for all tests in this block
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

  after((_, done) => {
    server.close(done);
  });
});
