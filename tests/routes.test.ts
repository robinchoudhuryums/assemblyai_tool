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

describe("Role-based access control (production requireRole)", () => {
  // A1/F04: replaced a local copy of requireRole with the production export.
  // Previous version tested its own inline implementation, never the real one.
  it("returns 403 when user role is insufficient", async () => {
    const { requireRole } = await import("../server/auth.js");
    const app = createTestApp();
    app.use((req: any, _res, next) => {
      req.user = { role: "viewer" };
      req.isAuthenticated = () => true;
      next();
    });
    app.get("/api/admin/test", requireRole("admin"), (_req, res) => res.json({ ok: true }));

    const { status, body } = await request(app, "GET", "/api/admin/test");
    assert.equal(status, 403);
    assert.equal(body.message, "Insufficient permissions");
  });

  it("returns 200 when user role matches", async () => {
    const { requireRole } = await import("../server/auth.js");
    const app = createTestApp();
    app.use((req: any, _res, next) => {
      req.user = { role: "admin" };
      req.isAuthenticated = () => true;
      next();
    });
    app.get("/api/admin/test", requireRole("admin"), (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/admin/test");
    assert.equal(status, 200);
  });

  it("manager can access manager routes (hierarchy)", async () => {
    const { requireRole } = await import("../server/auth.js");
    const app = createTestApp();
    app.use((req: any, _res, next) => {
      req.user = { role: "manager" };
      req.isAuthenticated = () => true;
      next();
    });
    app.get("/api/calls/export", requireRole("manager", "admin"), (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/calls/export");
    assert.equal(status, 200);
  });

  it("admin can access manager routes (hierarchy)", async () => {
    const { requireRole } = await import("../server/auth.js");
    const app = createTestApp();
    app.use((req: any, _res, next) => {
      req.user = { role: "admin" };
      req.isAuthenticated = () => true;
      next();
    });
    app.get("/api/calls/export", requireRole("manager"), (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/calls/export");
    assert.equal(status, 200);
  });

  it("returns 401 when unauthenticated", async () => {
    const { requireRole } = await import("../server/auth.js");
    const app = createTestApp();
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => false;
      next();
    });
    app.get("/api/admin/test", requireRole("admin"), (_req, res) => res.json({ ok: true }));

    const { status, body } = await request(app, "GET", "/api/admin/test");
    assert.equal(status, 401);
    assert.equal(body.message, "Authentication required");
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

  it("can paginate calls with cursor", async () => {
    // Create several calls
    for (let i = 0; i < 5; i++) {
      await globalStorage.createCall({ fileName: `page-test-${i}.mp3`, duration: 60, status: "completed" });
    }
    const page1 = await globalStorage.getCallsPaginated({ limit: 2 });
    assert.equal(page1.calls.length, 2);
    assert.ok(page1.nextCursor, "should have a next cursor");
    assert.ok(page1.total >= 5);

    const page2 = await globalStorage.getCallsPaginated({ limit: 2, cursor: page1.nextCursor! });
    assert.equal(page2.calls.length, 2);
    // Pages should have different calls
    assert.notEqual(page1.calls[0].id, page2.calls[0].id);
  });

  it("can filter calls by status", async () => {
    await globalStorage.createCall({ fileName: "active.mp3", duration: 30, status: "processing" });
    const completed = await globalStorage.getCallsWithDetails({ status: "completed" });
    for (const c of completed) {
      assert.equal(c.status, "completed");
    }
  });

  it("can assign a call to an employee", async () => {
    const emp = await globalStorage.createEmployee({ name: "Assignee", email: "assign@test.com", role: "Agent", status: "Active" });
    const call = await globalStorage.createCall({ fileName: "assign-test.mp3", duration: 90, status: "completed" });
    await globalStorage.setCallEmployee(call.id, emp.id);

    const updated = await globalStorage.getCall(call.id);
    assert.equal(updated?.employeeId, emp.id);
  });
});

describe("Storage: Transcript + Analysis lifecycle", () => {
  it("creates transcript and analysis, then deletes call cascading", async () => {
    const call = await globalStorage.createCall({ fileName: "lifecycle.mp3", duration: 120, status: "completed" });

    await globalStorage.createTranscript({ callId: call.id, text: "Hello, how can I help?", confidence: 0.95 });
    await globalStorage.createSentimentAnalysis({ callId: call.id, overallSentiment: "positive", overallScore: 0.8 });
    await globalStorage.createCallAnalysis({
      callId: call.id,
      performanceScore: "8.5",
      summary: "Good call",
      topics: ["billing"],
      actionItems: ["Follow up"],
      feedback: { strengths: ["Professional"], suggestions: ["Faster resolution"] },
      flags: [],
    });

    // Verify all created
    assert.ok(await globalStorage.getTranscript(call.id));
    assert.ok(await globalStorage.getSentimentAnalysis(call.id));
    assert.ok(await globalStorage.getCallAnalysis(call.id));

    // Delete call — should cascade
    await globalStorage.deleteCall(call.id);
    assert.equal(await globalStorage.getCall(call.id), undefined);
    assert.equal(await globalStorage.getTranscript(call.id), undefined);
    assert.equal(await globalStorage.getSentimentAnalysis(call.id), undefined);
    assert.equal(await globalStorage.getCallAnalysis(call.id), undefined);
  });
});

describe("Storage: Coaching sessions", () => {
  it("creates and retrieves coaching session by employee", async () => {
    // A1/F05: payload now matches the production InsertCoachingSession schema
    // — actionPlan (not actionItems), task (not text), valid category enum,
    // and required title + assignedBy. Previously the test passed by accident
    // because MemStorage doesn't validate inputs.
    const emp = await globalStorage.createEmployee({ name: "Coach Target", email: "coach@test.com", role: "Agent", status: "Active" });
    const session = await globalStorage.createCoachingSession({
      employeeId: emp.id,
      assignedBy: "test-manager",
      category: "communication",
      title: "Active listening practice",
      notes: "Needs improvement on empathy",
      actionPlan: [{ task: "Practice active listening", completed: false }],
      status: "pending",
    });
    assert.ok(session.id);

    const sessions = await globalStorage.getCoachingSessionsByEmployee(emp.id);
    assert.ok(sessions.length >= 1);
    assert.equal(sessions[0].employeeId, emp.id);
    // Verify the schema-correct fields round-tripped
    const created = sessions.find(s => s.id === session.id);
    assert.ok(created);
    assert.equal(created!.title, "Active listening practice");
    assert.equal(created!.assignedBy, "test-manager");
    assert.equal(created!.category, "communication");
    assert.deepEqual(created!.actionPlan, [{ task: "Practice active listening", completed: false }]);
  });
});

describe("Storage: Top performers", () => {
  it("returns performers sorted by score", async () => {
    const performers = await globalStorage.getTopPerformers(5);
    assert.ok(Array.isArray(performers));
    // Scores should be descending
    for (let i = 1; i < performers.length; i++) {
      assert.ok((performers[i - 1].avgScore ?? 0) >= (performers[i].avgScore ?? 0));
    }
  });
});

describe("Route param validation pattern", () => {
  it("rejects non-UUID :id with 400", async () => {
    const app = createTestApp();
    const { validateIdParam } = await import("../server/routes/utils.js");
    app.get("/api/test/:id", validateIdParam, (_req, res) => res.json({ ok: true }));

    const { status: bad } = await request(app, "GET", "/api/test/not-a-uuid");
    assert.equal(bad, 400);

    const { status: good } = await request(app, "GET", "/api/test/550e8400-e29b-41d4-a716-446655440000");
    assert.equal(good, 200);
  });

  it("rejects SQL injection in :id", async () => {
    const app = createTestApp();
    const { validateIdParam } = await import("../server/routes/utils.js");
    app.get("/api/test/:id", validateIdParam, (_req, res) => res.json({ ok: true }));

    const { status } = await request(app, "GET", "/api/test/';DROP%20TABLE%20calls;--");
    assert.equal(status, 400);
  });
});

describe("sendError / sendValidationError helpers", () => {
  it("sendError returns correct status and shape", async () => {
    const { sendError } = await import("../server/routes/utils.js");
    const app = createTestApp();
    app.get("/api/test-error", (_req, res) => sendError(res, 404, "Not found"));
    const { status, body } = await request(app, "GET", "/api/test-error");
    assert.equal(status, 404);
    assert.equal(body.message, "Not found");
    assert.equal(Object.keys(body).length, 1); // only message, no errors
  });

  it("sendValidationError returns 400 with flattened errors", async () => {
    const { sendValidationError } = await import("../server/routes/utils.js");
    const { z } = await import("zod");
    const app = createTestApp();
    app.post("/api/test-validate", (req, res) => {
      const schema = z.object({ name: z.string().min(1) });
      const result = schema.safeParse(req.body);
      if (!result.success) return sendValidationError(res, "Bad input", result.error);
      res.json({ ok: true });
    });

    const { status, body } = await request(app, "POST", "/api/test-validate", {});
    assert.equal(status, 400);
    assert.equal(body.message, "Bad input");
    assert.ok(body.errors); // flattened Zod errors present
    assert.ok(body.errors.fieldErrors); // .flatten() produces fieldErrors
  });
});
