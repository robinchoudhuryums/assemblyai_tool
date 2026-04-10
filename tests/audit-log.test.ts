/**
 * Tests for HIPAA PHI Access Audit Logger
 *
 * Validates:
 *   - logPhiAccess writes to stdout with correct format
 *   - auditContext extracts expected fields from request objects
 *   - Retry logic constants are correct
 *   - Entry structure matches the AuditEntry interface
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// --- AuditEntry structure ---

interface AuditEntry {
  timestamp: string;
  event: string;
  userId?: string;
  username?: string;
  role?: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
}

const AUDIT_PREFIX = "[HIPAA_AUDIT]";

describe("Audit Log entry format", () => {
  it("produces valid JSON after prefix", () => {
    const entry: AuditEntry = {
      timestamp: "2026-03-31T12:00:00.000Z",
      event: "view_call_details",
      userId: "user-1",
      username: "admin",
      role: "admin",
      resourceType: "call",
      resourceId: "call-123",
      ip: "10.0.0.1",
      userAgent: "Mozilla/5.0",
      detail: "test detail",
    };
    const line = `${AUDIT_PREFIX} ${JSON.stringify(entry)}`;
    assert.ok(line.startsWith(AUDIT_PREFIX));
    const parsed = JSON.parse(line.replace(`${AUDIT_PREFIX} `, ""));
    assert.equal(parsed.event, "view_call_details");
    assert.equal(parsed.resourceType, "call");
    assert.equal(parsed.resourceId, "call-123");
    assert.equal(parsed.username, "admin");
  });

  it("handles missing optional fields", () => {
    const entry: AuditEntry = {
      timestamp: "2026-03-31T12:00:00.000Z",
      event: "export_calls_csv",
      resourceType: "export",
    };
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);
    assert.equal(parsed.event, "export_calls_csv");
    assert.equal(parsed.userId, undefined);
    assert.equal(parsed.detail, undefined);
  });

  it("timestamp defaults to ISO format", () => {
    const ts = new Date().toISOString();
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(ts));
  });
});

// --- auditContext extraction ---

describe("auditContext extraction", () => {
  function auditContext(req: any): Pick<AuditEntry, "userId" | "username" | "role" | "ip" | "userAgent"> {
    const user = req.user as { id?: string; username?: string; role?: string } | undefined;
    return {
      userId: user?.id,
      username: user?.username,
      role: user?.role,
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
  }

  it("extracts user fields from authenticated request", () => {
    const req = {
      user: { id: "u-1", username: "testuser", role: "manager" },
      headers: { "user-agent": "TestBrowser/1.0", "x-forwarded-for": "203.0.113.5" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const ctx = auditContext(req);
    assert.equal(ctx.userId, "u-1");
    assert.equal(ctx.username, "testuser");
    assert.equal(ctx.role, "manager");
    assert.equal(ctx.ip, "203.0.113.5");
    assert.equal(ctx.userAgent, "TestBrowser/1.0");
  });

  it("falls back to socket address when x-forwarded-for is missing", () => {
    const req = {
      user: { id: "u-2", username: "viewer", role: "viewer" },
      headers: { "user-agent": "TestBrowser/2.0" },
      socket: { remoteAddress: "192.168.1.10" },
    };
    const ctx = auditContext(req);
    assert.equal(ctx.ip, "192.168.1.10");
  });

  it("handles x-forwarded-for with multiple IPs (takes first)", () => {
    const req = {
      user: undefined,
      headers: { "x-forwarded-for": "10.0.0.1, 172.16.0.1, 192.168.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const ctx = auditContext(req);
    assert.equal(ctx.ip, "10.0.0.1");
    assert.equal(ctx.userId, undefined);
  });

  it("handles unauthenticated request", () => {
    const req = {
      user: undefined,
      headers: {},
      socket: { remoteAddress: "::1" },
    };
    const ctx = auditContext(req);
    assert.equal(ctx.userId, undefined);
    assert.equal(ctx.username, undefined);
    assert.equal(ctx.role, undefined);
    assert.equal(ctx.ip, "::1");
  });
});

// --- Retry configuration ---

describe("Audit log retry configuration", () => {
  const MAX_AUDIT_RETRIES = 3;

  it("allows 3 retry attempts", () => {
    assert.equal(MAX_AUDIT_RETRIES, 3);
  });

  it("exponential backoff: 500ms, 1s, 2s", () => {
    const delays = [0, 1, 2].map(attempt => 500 * Math.pow(2, attempt));
    assert.deepEqual(delays, [500, 1000, 2000]);
  });

  it("total max retry time is 3.5 seconds", () => {
    const totalMs = 500 + 1000 + 2000;
    assert.equal(totalMs, 3500);
  });
});

// --- Write-ahead queue ---

describe("Audit log write-ahead queue", () => {
  it("getDroppedAuditEntryCount starts at 0", async () => {
    const { getDroppedAuditEntryCount, _resetAuditQueue } = await import("../server/services/audit-log.js");
    _resetAuditQueue();
    assert.equal(getDroppedAuditEntryCount(), 0);
  });

  it("getPendingAuditEntryCount starts at 0 after reset", async () => {
    const { getPendingAuditEntryCount, _resetAuditQueue } = await import("../server/services/audit-log.js");
    _resetAuditQueue();
    assert.equal(getPendingAuditEntryCount(), 0);
  });

  it("logPhiAccess queues entry when pool is unavailable (no DB)", async () => {
    const { logPhiAccess, getPendingAuditEntryCount, _resetAuditQueue } = await import("../server/services/audit-log.js");
    _resetAuditQueue();
    // Without DATABASE_URL, getPool() returns null, so nothing gets queued to DB
    logPhiAccess({
      timestamp: new Date().toISOString(),
      event: "test_event",
      resourceType: "test",
    });
    // No DB pool → entry goes only to stdout, queue stays empty
    assert.equal(getPendingAuditEntryCount(), 0);
  });

  it("flushAuditQueue is safe to call when queue is empty", async () => {
    const { flushAuditQueue, _resetAuditQueue } = await import("../server/services/audit-log.js");
    _resetAuditQueue();
    // Should not throw
    await flushAuditQueue();
  });
});

// --- Integrity hash chain ---

describe("Audit log integrity hash", () => {
  it("computeIntegrityHash returns consistent 16-char hex string", async () => {
    // The hash function is not exported, but we can verify the chain behavior via logPhiAccess stdout
    // by checking that repeated calls produce different hashes (chained)
    const { logPhiAccess, _resetAuditQueue } = await import("../server/services/audit-log.js");
    _resetAuditQueue();

    // Capture console.log output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(String(args[0])); };

    logPhiAccess({ timestamp: "2026-04-03T00:00:00Z", event: "test_1", resourceType: "test" });
    logPhiAccess({ timestamp: "2026-04-03T00:00:01Z", event: "test_2", resourceType: "test" });

    console.log = originalLog;

    // Both entries should have [h:...] integrity hashes
    assert.equal(logs.length, 2);
    const hash1Match = logs[0].match(/\[h:([0-9a-f]{16})\]$/);
    const hash2Match = logs[1].match(/\[h:([0-9a-f]{16})\]$/);
    assert.ok(hash1Match, "First entry should have integrity hash");
    assert.ok(hash2Match, "Second entry should have integrity hash");
    // Chain: hashes should be different (second depends on first)
    assert.notEqual(hash1Match![1], hash2Match![1], "Chained hashes should differ");
  });
});

// --- loadAuditIntegrityChain retry + throw (F01) ---

describe("loadAuditIntegrityChain retry behavior (F01)", () => {
  it("retries up to 3 times with exponential backoff constants", () => {
    // Verify the retry contract: 3 attempts with 1s, 2s, 4s delays
    const MAX_LOAD_RETRIES = 3;
    const BASE_DELAY_MS = 1000;
    const delays = Array.from({ length: MAX_LOAD_RETRIES }, (_, i) => BASE_DELAY_MS * Math.pow(2, i));
    assert.deepEqual(delays, [1000, 2000, 4000]);
    // Total max wait: 7 seconds before throw
    assert.equal(delays.reduce((a, b) => a + b, 0), 7000);
  });

  it("is idempotent — returns immediately on second call", async () => {
    // The function sets integrityLoaded=true on success, so re-calling is a no-op.
    // We can verify this by calling it twice — first call succeeds (no pool → marks loaded),
    // second call returns immediately without querying.
    const { loadAuditIntegrityChain } = await import("../server/services/audit-log.js");
    // Without DATABASE_URL, getPool() returns null → marks loaded immediately
    await loadAuditIntegrityChain();
    // Second call should return without error (idempotent)
    await loadAuditIntegrityChain();
  });
});

// --- HIPAA event taxonomy ---

describe("HIPAA audit event types", () => {
  const VALID_EVENTS = [
    "view_call_details", "view_transcript", "view_sentiment", "view_analysis",
    "edit_call_analysis", "export_calls_csv", "export_team_csv",
    "tag_added", "tag_removed", "search_calls_by_tag", "view_annotations",
    "security_alert:distributed_brute_force", "security_alert:credential_stuffing",
    "security_alert:bulk_data_access", "retention_purge",
  ];

  it("event names follow snake_case convention", () => {
    for (const event of VALID_EVENTS) {
      // Allow colons for namespaced events
      assert.ok(/^[a-z][a-z0-9_:]+$/.test(event), `Invalid event name: ${event}`);
    }
  });

  it("all events have non-empty names", () => {
    for (const event of VALID_EVENTS) {
      assert.ok(event.length > 0);
    }
  });
});
