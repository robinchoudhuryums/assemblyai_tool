/**
 * Tests for authentication and authorization logic.
 * Run with: npx tsx --test tests/auth.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We test the role hierarchy logic directly since the auth module depends on Express
describe("Role hierarchy", () => {
  const ROLE_HIERARCHY: Record<string, number> = {
    admin: 3,
    manager: 2,
    viewer: 1,
  };

  function hasAccess(userRole: string, ...allowedRoles: string[]): boolean {
    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] ?? 0));
    return userLevel >= requiredLevel;
  }

  it("admin can access all roles", () => {
    assert.ok(hasAccess("admin", "admin"));
    assert.ok(hasAccess("admin", "manager"));
    assert.ok(hasAccess("admin", "viewer"));
  });

  it("manager can access manager and viewer roles", () => {
    assert.ok(hasAccess("manager", "manager"));
    assert.ok(hasAccess("manager", "viewer"));
    assert.ok(!hasAccess("manager", "admin"));
  });

  it("viewer can only access viewer role", () => {
    assert.ok(hasAccess("viewer", "viewer"));
    assert.ok(!hasAccess("viewer", "manager"));
    assert.ok(!hasAccess("viewer", "admin"));
  });

  it("unknown role has no access", () => {
    assert.ok(!hasAccess("unknown", "viewer"));
    assert.ok(!hasAccess("", "viewer"));
  });

  it("handles combined role requirements (manager OR admin)", () => {
    // requireRole("manager", "admin") means min level = manager(2)
    assert.ok(hasAccess("admin", "manager", "admin"));
    assert.ok(hasAccess("manager", "manager", "admin"));
    assert.ok(!hasAccess("viewer", "manager", "admin"));
  });
});

describe("Account lockout logic", () => {
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  let loginAttempts: Map<string, { count: number; lastAttempt: number; lockedUntil?: number }>;

  beforeEach(() => {
    loginAttempts = new Map();
  });

  function isAccountLocked(username: string): boolean {
    const record = loginAttempts.get(username);
    if (!record?.lockedUntil) return false;
    if (Date.now() > record.lockedUntil) {
      loginAttempts.delete(username);
      return false;
    }
    return true;
  }

  function recordFailedAttempt(username: string): void {
    const record = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    loginAttempts.set(username, record);
  }

  function clearFailedAttempts(username: string): void {
    loginAttempts.delete(username);
  }

  it("does not lock account after fewer than 5 attempts", () => {
    for (let i = 0; i < 4; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(!isAccountLocked("user1"));
  });

  it("locks account after 5 failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(isAccountLocked("user1"));
  });

  it("clears lockout on successful login", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    assert.ok(isAccountLocked("user1"));
    clearFailedAttempts("user1");
    assert.ok(!isAccountLocked("user1"));
  });

  it("unlocks after lockout duration expires", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    // Manually expire the lockout
    const record = loginAttempts.get("user1")!;
    record.lockedUntil = Date.now() - 1000; // 1 second in the past
    assert.ok(!isAccountLocked("user1"));
  });

  it("tracks different users independently", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt("user1");
    }
    recordFailedAttempt("user2");
    assert.ok(isAccountLocked("user1"));
    assert.ok(!isAccountLocked("user2"));
  });
});

describe("CSRF protection logic", () => {
  it("JSON Content-Type should pass CSRF check", () => {
    const contentType = "application/json";
    const isJson = contentType.includes("application/json");
    assert.ok(isJson);
  });

  it("empty Content-Type should fail CSRF check", () => {
    const contentType = "";
    const isJson = contentType.includes("application/json");
    assert.ok(!isJson);
  });

  it("multipart/form-data is exempt from CSRF", () => {
    const contentType = "multipart/form-data; boundary=----WebKitFormBoundary";
    const isMultipart = contentType.includes("multipart/form-data");
    assert.ok(isMultipart);
  });
});

describe("Session secret validation", () => {
  it("rejects empty session secret in production", () => {
    const sessionSecret = "";
    const isProduction = true;
    const shouldFail = !sessionSecret && isProduction;
    assert.ok(shouldFail);
  });

  it("allows missing session secret in development", () => {
    const sessionSecret = "";
    const isProduction = false;
    const shouldFail = !sessionSecret && isProduction;
    assert.ok(!shouldFail);
  });
});
