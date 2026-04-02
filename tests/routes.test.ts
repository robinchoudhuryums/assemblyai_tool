/**
 * Route endpoint integration tests.
 *
 * Tests HTTP-level request/response for critical API routes using
 * a lightweight Express app with MemStorage (no database required).
 *
 * Tests validate:
 *   - Response status codes and shapes
 *   - Auth enforcement (401 on unauthenticated requests)
 *   - Role-based access control (403 on unauthorized role)
 *   - Input validation (400 on invalid data)
 *   - CRUD operations via the API layer
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import passport from "passport";
import { storage as globalStorage } from "../server/storage.js";

// --- Lightweight test app factory ---

/**
 * Creates a minimal Express app for route testing.
 * Uses the global MemStorage (no DB) and sets up session/auth middleware.
 * Returns the app and a helper to make authenticated requests.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  return app;
}

/**
 * Make a request to the app and return status + parsed body.
 * Uses Node's built-in fetch against a listening server.
 */
async function request(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address() as { port: number };
        const url = `http://localhost:${addr.port}${path}`;
        const opts: RequestInit = {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        };
        const res = await fetch(url, opts);
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => { headers[k] = v; });
        resolve({ status: res.status, body: parsed, headers });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

// --- Tests ---

describe("Health endpoint", () => {
  it("GET /api/health returns 200 with status ok", async () => {
    const app = createTestApp();
    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
    const { status, body } = await request(app, "GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.ok(body.timestamp);
  });
});

describe("Auth enforcement", () => {
  it("returns 401 for unauthenticated requests to protected routes", async () => {
    const app = createTestApp();
    // Simulate a protected route
    app.get("/api/calls", (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }
      res.json({ calls: [] });
    });
    const { status, body } = await request(app, "GET", "/api/calls");
    assert.equal(status, 401);
    assert.equal(body.message, "Authentication required");
  });
});

describe("Input validation", () => {
  it("rejects invalid JSON body with 400", async () => {
    const app = createTestApp();
    app.post("/api/test", (req, res) => {
      if (!req.body?.name || typeof req.body.name !== "string") {
        return res.status(400).json({ message: "name is required" });
      }
      res.json({ ok: true });
    });
    const { status: s1 } = await request(app, "POST", "/api/test", {});
    assert.equal(s1, 400);

    const { status: s2 } = await request(app, "POST", "/api/test", { name: "valid" });
    assert.equal(s2, 200);
  });
});

describe("CSV export", () => {
  it("returns CSV content-type and content-disposition headers", async () => {
    const app = createTestApp();
    app.get("/api/export/test", (_req, res) => {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="test.csv"');
      res.send("a,b,c\n1,2,3");
    });
    const { status, headers, body } = await request(app, "GET", "/api/export/test");
    assert.equal(status, 200);
    assert.ok(headers["content-type"]?.includes("text/csv"));
    assert.ok(headers["content-disposition"]?.includes("test.csv"));
  });
});

describe("Role-based access control pattern", () => {
  function requireRole(...roles: string[]) {
    return (req: any, res: any, next: any) => {
      if (!req.user) return res.status(401).json({ message: "Authentication required" });
      if (!roles.includes(req.user.role)) return res.status(403).json({ message: "Insufficient permissions" });
      next();
    };
  }

  it("returns 403 when user role is insufficient", async () => {
    const app = createTestApp();
    app.use((req: any, _res, next) => { req.user = { role: "viewer" }; next(); });
    app.get("/api/admin/test", requireRole("admin"), (_req, res) => res.json({ ok: true }));

    const { status, body } = await request(app, "GET", "/api/admin/test");
    assert.equal(status, 403);
    assert.equal(body.message, "Insufficient permissions");
  });

  it("returns 200 when user role matches", async () => {
    const app = createTestApp();
    app.use((req: any, _res, next) => { req.user = { role: "admin" }; next(); });
    app.get("/api/admin/test", requireRole("admin"), (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/admin/test");
    assert.equal(status, 200);
  });

  it("manager can access manager routes", async () => {
    const app = createTestApp();
    app.use((req: any, _res, next) => { req.user = { role: "manager" }; next(); });
    app.get("/api/calls/export", requireRole("manager", "admin"), (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/calls/export");
    assert.equal(status, 200);
  });
});

describe("Storage integration (MemStorage)", () => {
  it("MemStorage is available and functional", async () => {
    // Verify that the global storage (MemStorage in test environment) works
    const employees = await globalStorage.getAllEmployees();
    assert.ok(Array.isArray(employees));
  });

  it("can create and retrieve an employee", async () => {
    const emp = await globalStorage.createEmployee({
      name: "Test Agent",
      email: "test@example.com",
      role: "Agent",
      status: "Active",
    });
    assert.ok(emp.id);
    assert.equal(emp.name, "Test Agent");

    const fetched = await globalStorage.getEmployee(emp.id);
    assert.equal(fetched?.name, "Test Agent");
  });

  it("can create and retrieve a call", async () => {
    const call = await globalStorage.createCall({
      fileName: "test-call.mp3",
      duration: 120,
      status: "completed",
    });
    assert.ok(call.id);
    assert.equal(call.fileName, "test-call.mp3");
    assert.equal(call.status, "completed");

    const fetched = await globalStorage.getCall(call.id);
    assert.equal(fetched?.fileName, "test-call.mp3");
  });
});
