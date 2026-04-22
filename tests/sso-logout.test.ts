/**
 * Tests for POST /api/auth/sso-logout — the service-to-service logout
 * endpoint the RAG tool hits to complete single sign-out.
 *
 * Parallels tests/sso-verify.test.ts.
 *
 * Coverage:
 *   - 503 when SSO_SHARED_SECRET unset or <32 chars
 *   - 401 on missing / length-mismatched / wrong secret
 *   - 200 + revoked:false when secret valid but no session exists
 *   - 200 + revoked:true when secret valid + session exists, and
 *     session.destroy() is actually called
 */
import { describe, it, after } from "node:test";
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

function buildTestApp(opts: {
  authenticated: boolean;
  sessionDestroy?: (cb: (err?: Error) => void) => void;
  logout?: (cb: (err?: Error) => void) => void;
}) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (opts.authenticated) {
      req.user = TEST_USER;
      req.isAuthenticated = () => true;
      req.session = {
        destroy:
          opts.sessionDestroy ??
          ((cb: (err?: Error) => void) => cb()),
      };
      req.logout =
        opts.logout ?? ((cb: (err?: Error) => void) => cb());
    } else {
      req.isAuthenticated = () => false;
      req.session = { destroy: (cb: (err?: Error) => void) => cb() };
      req.logout = (cb: (err?: Error) => void) => cb();
    }
    next();
  });
  const router = Router();
  registerAuthRoutes(router);
  app.use(router);
  return app;
}

async function post(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method: "POST",
    headers,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe("POST /api/auth/sso-logout", () => {
  const originalSecret = process.env.SSO_SHARED_SECRET;
  after(() => {
    if (originalSecret === undefined) delete process.env.SSO_SHARED_SECRET;
    else process.env.SSO_SHARED_SECRET = originalSecret;
  });

  it("returns 503 when SSO_SHARED_SECRET is unset", async () => {
    delete process.env.SSO_SHARED_SECRET;
    const server = buildTestApp({ authenticated: true }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "anything",
      });
      assert.equal(r.status, 503);
    } finally {
      server.close();
    }
  });

  it("returns 401 when X-Service-Secret is missing", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const server = buildTestApp({ authenticated: true }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout");
      assert.equal(r.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 401 on wrong-length secret (pre-timingSafeEqual guard)", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const server = buildTestApp({ authenticated: true }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "a".repeat(31),
      });
      assert.equal(r.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 401 on equal-length but wrong secret", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const server = buildTestApp({ authenticated: true }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "b".repeat(32),
      });
      assert.equal(r.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 200 + revoked:false when secret valid but no session exists", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const server = buildTestApp({ authenticated: false }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "a".repeat(32),
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.revoked, false);
    } finally {
      server.close();
    }
  });

  it("returns 200 + revoked:true AND calls logout + session.destroy when session exists", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    let logoutCalled = false;
    let destroyCalled = false;
    const server = buildTestApp({
      authenticated: true,
      logout: (cb) => {
        logoutCalled = true;
        cb();
      },
      sessionDestroy: (cb) => {
        destroyCalled = true;
        cb();
      },
    }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "a".repeat(32),
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.revoked, true);
      assert.equal(logoutCalled, true);
      assert.equal(destroyCalled, true);
    } finally {
      server.close();
    }
  });

  it("returns 500 when session.destroy errors", async () => {
    process.env.SSO_SHARED_SECRET = "a".repeat(32);
    const server = buildTestApp({
      authenticated: true,
      sessionDestroy: (cb) => cb(new Error("DB down")),
    }).listen(0);
    try {
      const r = await post(server, "/api/auth/sso-logout", {
        "x-service-secret": "a".repeat(32),
      });
      assert.equal(r.status, 500);
    } finally {
      server.close();
    }
  });
});
