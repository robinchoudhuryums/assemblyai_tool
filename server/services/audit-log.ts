/**
 * HIPAA PHI Access Audit Logger
 *
 * Logs access to Protected Health Information (PHI) — call recordings,
 * transcripts, analysis data — for compliance and incident response.
 *
 * Dual-write strategy:
 * 1. Always writes to stdout (captured by pm2/CloudWatch/log aggregators)
 * 2. If PostgreSQL is available, also writes to the audit_log table for
 *    durable, queryable 6-year retention (HIPAA requirement)
 */
import { getPool } from "../db/pool";

export interface AuditEntry {
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

export function logPhiAccess(entry: AuditEntry): void {
  const line = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Always write to stdout (primary log sink)
  console.log(`${AUDIT_PREFIX} ${JSON.stringify(line)}`);

  // Dual-write to PostgreSQL if available (fire-and-forget, non-blocking)
  const pool = getPool();
  if (pool) {
    pool.query(
      `INSERT INTO audit_log (timestamp, event, user_id, username, role, resource_type, resource_id, ip, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [line.timestamp, line.event, line.userId, line.username, line.role,
       line.resourceType, line.resourceId, line.ip, line.userAgent, line.detail],
    ).catch((err) => {
      // Never let audit log writes break the application
      console.error("[HIPAA_AUDIT] Failed to write to database:", err.message);
    });
  }
}

/**
 * Helper to extract audit-relevant fields from an Express request.
 */
export function auditContext(req: any): Pick<AuditEntry, "userId" | "username" | "role" | "ip" | "userAgent"> {
  const user = req.user as { id?: string; username?: string; role?: string } | undefined;
  return {
    userId: user?.id,
    username: user?.username,
    role: user?.role,
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
}
