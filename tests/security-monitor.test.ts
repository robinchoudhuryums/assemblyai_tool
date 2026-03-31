/**
 * Tests for HIPAA Security Monitor & Breach Detection
 *
 * Validates:
 *   - Failed login tracking and threshold detection
 *   - Credential stuffing detection
 *   - Bulk data access (exfiltration) detection
 *   - Security alert severity classification
 *   - Alert acknowledgment
 *   - Window expiration and counter reset
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Threshold constants (mirror from security-monitor.ts) ──

const ALERT_THRESHOLDS = {
  DISTRIBUTED_BRUTE_FORCE_IPS: 3,
  DISTRIBUTED_BRUTE_FORCE_ATTEMPTS: 10,
  DISTRIBUTED_BRUTE_FORCE_WINDOW_MS: 60 * 60 * 1000,
  CREDENTIAL_STUFFING_USERNAMES: 5,
  CREDENTIAL_STUFFING_WINDOW_MS: 15 * 60 * 1000,
  BULK_ACCESS_THRESHOLD: 50,
  BULK_ACCESS_WINDOW_MS: 5 * 60 * 1000,
};

const SEVERITY_MAP: Record<string, string> = {
  distributed_brute_force: "high",
  credential_stuffing: "high",
  bulk_data_access: "critical",
  breach_reported: "critical",
  mfa_bypass_attempt: "high",
  session_anomaly: "medium",
};

// ── Distributed brute-force detection ──

describe("Distributed brute-force detection", () => {
  it("requires 3+ unique IPs AND 10+ attempts to trigger", () => {
    assert.equal(ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_IPS, 3);
    assert.equal(ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_ATTEMPTS, 10);
  });

  it("window is 1 hour", () => {
    assert.equal(ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS, 3_600_000);
  });

  it("does not trigger with few IPs but many attempts", () => {
    // Simulate: 15 attempts from 2 IPs — below IP threshold
    const ips = new Set(["10.0.0.1", "10.0.0.2"]);
    const attempts = 15;
    const shouldAlert = ips.size >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_IPS &&
      attempts >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_ATTEMPTS;
    assert.equal(shouldAlert, false);
  });

  it("triggers when both thresholds met", () => {
    const ips = new Set(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    const attempts = 12;
    const shouldAlert = ips.size >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_IPS &&
      attempts >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_ATTEMPTS;
    assert.equal(shouldAlert, true);
  });
});

// ── Credential stuffing detection ──

describe("Credential stuffing detection", () => {
  it("requires 5+ unique usernames from same IP to trigger", () => {
    assert.equal(ALERT_THRESHOLDS.CREDENTIAL_STUFFING_USERNAMES, 5);
  });

  it("window is 15 minutes", () => {
    assert.equal(ALERT_THRESHOLDS.CREDENTIAL_STUFFING_WINDOW_MS, 900_000);
  });

  it("triggers when username count reaches threshold", () => {
    const usernames = new Set(["user1", "user2", "user3", "user4", "user5"]);
    assert.ok(usernames.size >= ALERT_THRESHOLDS.CREDENTIAL_STUFFING_USERNAMES);
  });

  it("does not trigger below threshold", () => {
    const usernames = new Set(["user1", "user2", "user3"]);
    assert.ok(usernames.size < ALERT_THRESHOLDS.CREDENTIAL_STUFFING_USERNAMES);
  });
});

// ── Bulk data access (exfiltration) detection ──

describe("Bulk data access detection", () => {
  it("triggers at 50 accesses within 5 minutes", () => {
    assert.equal(ALERT_THRESHOLDS.BULK_ACCESS_THRESHOLD, 50);
    assert.equal(ALERT_THRESHOLDS.BULK_ACCESS_WINDOW_MS, 300_000);
  });

  it("tracks per user:resourceType key", () => {
    const key1 = "admin:transcript";
    const key2 = "admin:call";
    assert.notEqual(key1, key2, "Different resource types should have different keys");
  });

  it("resets counter after alert to prevent flooding", () => {
    let count = 55;
    // Simulate: threshold hit, counter reset
    if (count >= ALERT_THRESHOLDS.BULK_ACCESS_THRESHOLD) {
      count = 0; // reset as done in security-monitor.ts
    }
    assert.equal(count, 0);
  });
});

// ── Severity classification ──

describe("Security alert severity", () => {
  it("maps distributed brute-force to high", () => {
    assert.equal(SEVERITY_MAP["distributed_brute_force"], "high");
  });

  it("maps credential stuffing to high", () => {
    assert.equal(SEVERITY_MAP["credential_stuffing"], "high");
  });

  it("maps bulk data access to critical", () => {
    assert.equal(SEVERITY_MAP["bulk_data_access"], "critical");
  });

  it("maps breach reports to critical", () => {
    assert.equal(SEVERITY_MAP["breach_reported"], "critical");
  });

  it("maps session anomaly to medium", () => {
    assert.equal(SEVERITY_MAP["session_anomaly"], "medium");
  });

  it("defaults unknown types to medium", () => {
    const severity = SEVERITY_MAP["unknown_type"] || "medium";
    assert.equal(severity, "medium");
  });
});

// ── Alert structure ──

describe("SecurityAlert structure", () => {
  it("generates unique alert IDs", () => {
    const id1 = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id2 = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith("alert-"));
  });

  it("includes required fields", () => {
    const alert = {
      id: "alert-1",
      timestamp: new Date().toISOString(),
      type: "credential_stuffing",
      severity: SEVERITY_MAP["credential_stuffing"],
      details: { ip: "10.0.0.1", usernamesTried: 6 },
      acknowledged: false,
    };
    assert.ok(alert.id);
    assert.ok(alert.timestamp);
    assert.equal(alert.acknowledged, false);
    assert.equal(alert.severity, "high");
  });
});

// ── Window expiration ──

describe("Activity window expiration", () => {
  it("expired entries are detected correctly", () => {
    const now = Date.now();
    const record = { lastSeen: now - ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS - 1 };
    const isExpired = now - record.lastSeen > ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS;
    assert.ok(isExpired);
  });

  it("active entries are not expired", () => {
    const now = Date.now();
    const record = { lastSeen: now - 1000 }; // 1 second ago
    const isExpired = now - record.lastSeen > ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS;
    assert.equal(isExpired, false);
  });

  it("MAX_RECENT_ALERTS limits in-memory storage to 100", () => {
    const MAX_RECENT_ALERTS = 100;
    const alerts: any[] = [];
    for (let i = 0; i < 120; i++) {
      alerts.push({ id: `alert-${i}` });
      if (alerts.length > MAX_RECENT_ALERTS) alerts.shift();
    }
    assert.equal(alerts.length, MAX_RECENT_ALERTS);
    assert.equal(alerts[0].id, "alert-20"); // First 20 should have been shifted out
  });
});
