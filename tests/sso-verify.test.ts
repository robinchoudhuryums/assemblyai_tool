/**
 * Tests for GET /api/auth/sso-verify — the service-to-service SSO
 * introspection endpoint the RAG tool (ums-knowledge-reference) uses
 * to resolve a shared session cookie into a user record.
 *
 * Coverage:
 *   - 503 when SSO_SHARED_SECRET is unset or < 32 chars
 *   - 401 on missing / wrong / length-mismatched service secret
 *   - 401 on valid secret but unauthenticated request
 *   - 200 on valid secret + authenticated session with correct shape
 *   - NO fingerprint check (RAG backend UA legitimately differs from user browser)
 */
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import express, { Router } from "express";
import http from "http";
import { registerAuthRoutes } from "../server/routes/auth.js";

interface TestUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

const TEST_USER: TestUser = {
  id: "user-uuid-abc",
  username: "alice@example.com",
  name: "Alice Admin",
  role: "admin",
};

/**
 * Minimal Express app that registers auth routes and injects a fake
 * authenticated user per-request via the X-Test-Auth header.
 */
function buildTestApp(opts: { authenticated: boolean }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (opts.authenticated) {
      req.user = TEST_USER;
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  });
  const router = Router();
  registerAuthRoutes(router);
  app.use(router);
  return app;
}

async function fetchJson(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe("GET /api/auth/sso-verify", () => {
  const originalSecret = process.env.SSO_SHARED_SECRET;
  after(() => {
    if (originalSecret === undefined) delete process.env.SSO_SHARED_SECRET;
    else process.env.SSO_SHARED_SECRET = originalSecret;
  });

  it("returns 503 when SSO_SHARED_SECRET is unset", async () => {
    delete process.env.SSO_SHARED_SECRET;
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "anything",
      });
      assert.equal(r.status, 503);
      assert.match(String(r.body.message), /not configured/i);
    } finally {
      server.close();
    }
  });

  it("returns 503 when SSO_SHARED_SECRET is too short (<32 chars)", async () => {
    process.env.SSO_SHARED_SECRET = "short";
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "short",
      });
      assert.equal(r.status, 503);
    } finally {
      server.close();
    }
  });

  it("returns 401 when X-Service-Secret header is missing", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify");
      assert.equal(r.status, 401);
      assert.match(String(r.body.message), /service credential/i);
    } finally {
      server.close();
    }
  });

  it("returns 401 when X-Service-Secret has wrong length (short-circuit guard)", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "a".repeat(31),
      });
      assert.equal(r.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 401 when X-Service-Secret is wrong (timing-safe path)", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "b".repeat(32),
      });
      assert.equal(r.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 401 when secret is valid but request has no session", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: false });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "a".repeat(32),
      });
      assert.equal(r.status, 401);
      assert.match(String(r.body.message), /not authenticated/i);
    } finally {
      server.close();
    }
  });

  it("returns 200 with user shape + mfaVerified when secret valid + session exists", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "a".repeat(32),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.user, {
        id: TEST_USER.id,
        username: TEST_USER.username,
        name: TEST_USER.name,
        role: TEST_USER.role,
      });
      assert.equal(r.body.mfaVerified, true);
      assert.equal(r.body.source, "callanalyzer");
    } finally {
      server.close();
    }
  });

  it("does NOT enforce fingerprint — arbitrary UA is accepted", async () => {
    // Service-to-service callers (RAG backend) have a different UA than the
    // user's browser that established the session. The endpoint must accept
    // whatever UA the caller sends without destroying the session.
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const app = buildTestApp({ authenticated: true });
    const server = app.listen(0);
    try {
      const r = await fetchJson(server, "/api/auth/sso-verify", {
        "x-service-secret": "a".repeat(32),
        "user-agent": "RAG-Backend/1.0 (node-fetch)",
        "accept-language": "en-US",
      });
      assert.equal(r.status, 200);
    } finally {
      server.close();
    }
  });
});
