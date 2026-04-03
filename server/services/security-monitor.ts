/**
 * HIPAA Security Monitor & Breach Detection
 *
 * Detects suspicious activity patterns, manages breach notifications,
 * and provides incident response logging. Required by HIPAA Security Rule
 * (§164.308(a)(6) — Security Incident Procedures).
 */
import { logPhiAccess } from "./audit-log";
import { getPool } from "../db/pool";

// --- Suspicious Activity Detection ---

interface ActivityRecord {
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Tracks unique actors: IPs when tracking by username, usernames when tracking by IP */
  actors: Set<string>;
}

// Track failed logins by username (for distributed brute-force detection)
const failedLoginsByUser = new Map<string, ActivityRecord>();
// Track failed logins by IP (for credential stuffing detection)
const failedLoginsByIP = new Map<string, ActivityRecord>();
// Track unusual access patterns (e.g., bulk data access)
const bulkAccessByUser = new Map<string, ActivityRecord>();

// Cap all tracking Maps to prevent unbounded memory growth under distributed attacks.
// When at capacity, evict the oldest entry (by insertion order) before adding new ones.
const MAX_TRACKING_ENTRIES = 10_000;

function evictOldestIfFull(map: Map<string, ActivityRecord>): void {
  if (map.size >= MAX_TRACKING_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

const ALERT_THRESHOLDS = {
  // Multiple IPs trying same username = potential targeted attack
  DISTRIBUTED_BRUTE_FORCE_IPS: 3,
  DISTRIBUTED_BRUTE_FORCE_ATTEMPTS: 10,
  DISTRIBUTED_BRUTE_FORCE_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  // Single IP hitting many usernames = credential stuffing
  CREDENTIAL_STUFFING_USERNAMES: 5,
  CREDENTIAL_STUFFING_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  // Bulk data access (many records in short time) = potential exfiltration
  BULK_ACCESS_THRESHOLD: 50, // 50 records in window
  BULK_ACCESS_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
};

// Cleanup old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failedLoginsByUser) {
    if (now - record.lastSeen > ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS) {
      failedLoginsByUser.delete(key);
    }
  }
  for (const [key, record] of failedLoginsByIP) {
    if (now - record.lastSeen > ALERT_THRESHOLDS.CREDENTIAL_STUFFING_WINDOW_MS) {
      failedLoginsByIP.delete(key);
    }
  }
  for (const [key, record] of bulkAccessByUser) {
    if (now - record.lastSeen > ALERT_THRESHOLDS.BULK_ACCESS_WINDOW_MS) {
      bulkAccessByUser.delete(key);
    }
  }
}, 30 * 60 * 1000);

/**
 * Record a failed login and check for suspicious patterns.
 */
export function recordFailedLogin(username: string, ip: string): void {
  const now = Date.now();

  // Track by username (distributed brute-force detection)
  if (!failedLoginsByUser.has(username)) evictOldestIfFull(failedLoginsByUser);
  const userRecord = failedLoginsByUser.get(username) || { count: 0, firstSeen: now, lastSeen: now, actors: new Set() };
  if (now - userRecord.firstSeen > ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_WINDOW_MS) {
    userRecord.count = 0;
    userRecord.firstSeen = now;
    userRecord.actors.clear();
  }
  userRecord.count++;
  userRecord.lastSeen = now;
  userRecord.actors.add(ip);
  failedLoginsByUser.set(username, userRecord);

  // Check: distributed brute-force (many IPs targeting one user)
  if (
    userRecord.actors.size >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_IPS &&
    userRecord.count >= ALERT_THRESHOLDS.DISTRIBUTED_BRUTE_FORCE_ATTEMPTS
  ) {
    raiseSecurityAlert("distributed_brute_force", {
      username,
      attemptCount: userRecord.count,
      uniqueIPs: userRecord.actors.size,
      window: "1 hour",
    });
  }

  // Track by IP (credential stuffing detection)
  if (!failedLoginsByIP.has(ip)) evictOldestIfFull(failedLoginsByIP);
  const ipRecord = failedLoginsByIP.get(ip) || { count: 0, firstSeen: now, lastSeen: now, actors: new Set() };
  if (now - ipRecord.firstSeen > ALERT_THRESHOLDS.CREDENTIAL_STUFFING_WINDOW_MS) {
    ipRecord.count = 0;
    ipRecord.firstSeen = now;
    ipRecord.actors.clear();
  }
  ipRecord.count++;
  ipRecord.lastSeen = now;
  ipRecord.actors.add(username);
  failedLoginsByIP.set(ip, ipRecord);

  // Check: credential stuffing (one IP trying many usernames)
  if (ipRecord.actors.size >= ALERT_THRESHOLDS.CREDENTIAL_STUFFING_USERNAMES) {
    raiseSecurityAlert("credential_stuffing", {
      ip,
      usernamesTried: ipRecord.actors.size,
      totalAttempts: ipRecord.count,
      window: "15 minutes",
    });
  }
}

/**
 * Record a data access event and check for bulk access (exfiltration detection).
 */
export function recordDataAccess(username: string, resourceType: string): void {
  const now = Date.now();
  const key = `${username}:${resourceType}`;
  if (!bulkAccessByUser.has(key)) evictOldestIfFull(bulkAccessByUser);
  const record = bulkAccessByUser.get(key) || { count: 0, firstSeen: now, lastSeen: now, actors: new Set() };

  if (now - record.firstSeen > ALERT_THRESHOLDS.BULK_ACCESS_WINDOW_MS) {
    record.count = 0;
    record.firstSeen = now;
  }
  record.count++;
  record.lastSeen = now;
  bulkAccessByUser.set(key, record);

  if (record.count >= ALERT_THRESHOLDS.BULK_ACCESS_THRESHOLD) {
    raiseSecurityAlert("bulk_data_access", {
      username,
      resourceType,
      accessCount: record.count,
      window: "5 minutes",
    });
    // Reset to avoid alert flooding
    record.count = 0;
    record.firstSeen = now;
  }
}

// --- Security Alerts ---

export interface SecurityAlert {
  id: string;
  timestamp: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, unknown>;
  acknowledged: boolean;
}

const SEVERITY_MAP: Record<string, SecurityAlert["severity"]> = {
  distributed_brute_force: "high",
  credential_stuffing: "high",
  bulk_data_access: "critical",
  breach_reported: "critical",
  mfa_bypass_attempt: "high",
  session_anomaly: "medium",
};

// In-memory alert log (also persisted to audit_log)
const recentAlerts: SecurityAlert[] = [];
const MAX_RECENT_ALERTS = 100;

function raiseSecurityAlert(type: string, details: Record<string, unknown>): void {
  const alert: SecurityAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    severity: SEVERITY_MAP[type] || "medium",
    details,
    acknowledged: false,
  };

  recentAlerts.push(alert);
  if (recentAlerts.length > MAX_RECENT_ALERTS) recentAlerts.shift();

  // Log to HIPAA audit trail
  console.error(`[SECURITY] ALERT [${alert.severity.toUpperCase()}] ${type}: ${JSON.stringify(details)}`);
  logPhiAccess({
    timestamp: alert.timestamp,
    event: `security_alert:${type}`,
    resourceType: "security",
    detail: JSON.stringify({ severity: alert.severity, ...details }),
  });
}

export function getRecentAlerts(): SecurityAlert[] {
  return [...recentAlerts].reverse();
}

export function acknowledgeAlert(alertId: string, username: string): boolean {
  const alert = recentAlerts.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.acknowledged = true;
  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "security_alert_acknowledged",
    username,
    resourceType: "security",
    resourceId: alertId,
    detail: `Alert ${alert.type} acknowledged`,
  });
  return true;
}

// --- Breach Notification Framework (HIPAA §164.408) ---

export interface BreachReport {
  id: string;
  reportedAt: string;
  reportedBy: string;
  description: string;
  affectedIndividuals: number;
  dataTypes: string[];
  discoveryDate: string;
  containmentActions: string;
  notificationStatus: "pending" | "notified" | "resolved";
  timeline: Array<{ timestamp: string; action: string; actor: string }>;
}

// In-memory store (also persisted to DB if available)
const breachReports: BreachReport[] = [];

export async function createBreachReport(report: Omit<BreachReport, "id" | "reportedAt" | "notificationStatus" | "timeline">): Promise<BreachReport> {
  const breach: BreachReport = {
    ...report,
    id: `breach-${Date.now()}`,
    reportedAt: new Date().toISOString(),
    notificationStatus: "pending",
    timeline: [
      { timestamp: new Date().toISOString(), action: "Breach reported", actor: report.reportedBy },
    ],
  };

  breachReports.push(breach);

  // Persist to database
  const pool = getPool();
  if (pool) {
    await pool.query(
      `INSERT INTO breach_reports (id, reported_at, reported_by, description, affected_individuals, data_types, discovery_date, containment_actions, notification_status, timeline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [breach.id, breach.reportedAt, breach.reportedBy, breach.description, breach.affectedIndividuals,
       JSON.stringify(breach.dataTypes), breach.discoveryDate, breach.containmentActions,
       breach.notificationStatus, JSON.stringify(breach.timeline)]
    );
  }

  // Critical alert
  raiseSecurityAlert("breach_reported", {
    breachId: breach.id,
    reportedBy: breach.reportedBy,
    affectedIndividuals: breach.affectedIndividuals,
    dataTypes: breach.dataTypes,
  });

  // Log to HIPAA audit
  logPhiAccess({
    timestamp: breach.reportedAt,
    event: "breach_report_created",
    username: breach.reportedBy,
    resourceType: "breach",
    resourceId: breach.id,
    detail: `Breach affecting ${breach.affectedIndividuals} individuals reported`,
  });

  return breach;
}

export async function updateBreachStatus(
  breachId: string,
  status: BreachReport["notificationStatus"],
  action: string,
  actor: string
): Promise<BreachReport | null> {
  const breach = breachReports.find((b) => b.id === breachId);
  if (!breach) return null;

  breach.notificationStatus = status;
  breach.timeline.push({ timestamp: new Date().toISOString(), action, actor });

  const pool = getPool();
  if (pool) {
    await pool.query(
      "UPDATE breach_reports SET notification_status = $1, timeline = $2 WHERE id = $3",
      [status, JSON.stringify(breach.timeline), breachId]
    );
  }

  logPhiAccess({
    timestamp: new Date().toISOString(),
    event: "breach_status_updated",
    username: actor,
    resourceType: "breach",
    resourceId: breachId,
    detail: `Status changed to ${status}: ${action}`,
  });

  return breach;
}

export async function getAllBreachReports(): Promise<BreachReport[]> {
  const pool = getPool();
  if (pool) {
    const result = await pool.query("SELECT * FROM breach_reports ORDER BY reported_at DESC");
    return result.rows.map((r: any) => ({
      id: r.id,
      reportedAt: r.reported_at,
      reportedBy: r.reported_by,
      description: r.description,
      affectedIndividuals: r.affected_individuals,
      dataTypes: typeof r.data_types === "string" ? JSON.parse(r.data_types) : r.data_types,
      discoveryDate: r.discovery_date,
      containmentActions: r.containment_actions,
      notificationStatus: r.notification_status,
      timeline: typeof r.timeline === "string" ? JSON.parse(r.timeline) : r.timeline,
    }));
  }
  return [...breachReports].reverse();
}

/**
 * Get a summary of the current security posture for the admin dashboard.
 */
export function getSecuritySummary(): {
  totalAlerts: number;
  unacknowledgedAlerts: number;
  criticalAlerts: number;
  activeBreach: boolean;
  mfaEnforcementEnabled: boolean;
  recentAlertTypes: Record<string, number>;
} {
  const unacknowledged = recentAlerts.filter((a) => !a.acknowledged);
  const critical = unacknowledged.filter((a) => a.severity === "critical");
  const alertTypeCounts: Record<string, number> = {};
  for (const alert of recentAlerts.slice(-20)) {
    alertTypeCounts[alert.type] = (alertTypeCounts[alert.type] || 0) + 1;
  }

  return {
    totalAlerts: recentAlerts.length,
    unacknowledgedAlerts: unacknowledged.length,
    criticalAlerts: critical.length,
    activeBreach: breachReports.some((b) => b.notificationStatus !== "resolved"),
    mfaEnforcementEnabled: process.env.REQUIRE_MFA === "true",
    recentAlertTypes: alertTypeCounts,
  };
}
