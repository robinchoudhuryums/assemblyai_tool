/**
 * PostgreSQL-backed storage implementation.
 *
 * Stores all metadata in RDS PostgreSQL. Audio files remain in S3.
 * Implements the same IStorage interface as MemStorage and CloudStorage.
 */
import type pg from "pg";
import { randomUUID } from "crypto";
import type {
  User, InsertUser, DbUser, Employee, InsertEmployee,
  Call, InsertCall, Transcript, InsertTranscript,
  SentimentAnalysis, InsertSentimentAnalysis,
  CallAnalysis, InsertCallAnalysis,
  CallWithDetails, DashboardMetrics, SentimentDistribution,
  AccessRequest, InsertAccessRequest,
  PromptTemplate, InsertPromptTemplate,
  CoachingSession, InsertCoachingSession,
  PerformerSummary, ABTest, InsertABTest, UsageRecord,
  Badge, InsertBadge, LeaderboardRow,
} from "@shared/schema";
import type { IStorage, ObjectStorageClient } from "./storage";
import { safeFloat } from "./routes/utils";
import { logPhiAccess } from "./services/audit-log";

/**
 * Maps a database row (snake_case) to the application model (camelCase).
 * Each entity has its own mapper to keep types correct.
 */
function mapEmployee(row: any): Employee {
  return {
    id: row.id, name: row.name, role: row.role, email: row.email,
    initials: row.initials, status: row.status, subTeam: row.sub_team,
    pseudonym: row.pseudonym, extension: row.extension,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapCall(row: any): Call {
  return {
    id: row.id, employeeId: row.employee_id, fileName: row.file_name,
    filePath: row.file_path, status: row.status, duration: row.duration,
    assemblyAiId: row.assembly_ai_id, callCategory: row.call_category,
    contentHash: row.content_hash,
    externalId: row.external_id ?? undefined,
    uploadedAt: row.uploaded_at?.toISOString?.() ?? row.uploaded_at,
  };
}

function mapTranscript(row: any): Transcript {
  return {
    id: row.id, callId: row.call_id, text: row.text,
    confidence: row.confidence, words: row.words,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapSentiment(row: any): SentimentAnalysis {
  return {
    id: row.id, callId: row.call_id,
    overallSentiment: row.overall_sentiment, overallScore: row.overall_score,
    segments: row.segments,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapAnalysis(row: any): CallAnalysis {
  return {
    id: row.id, callId: row.call_id,
    performanceScore: row.performance_score, talkTimeRatio: row.talk_time_ratio,
    responseTime: row.response_time, keywords: row.keywords, topics: row.topics,
    summary: row.summary, actionItems: row.action_items, feedback: row.feedback,
    lemurResponse: row.lemur_response, callPartyType: row.call_party_type,
    flags: row.flags, manualEdits: row.manual_edits,
    confidenceScore: row.confidence_score, confidenceFactors: row.confidence_factors,
    subScores: row.sub_scores, detectedAgentName: row.detected_agent_name,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapAccessRequest(row: any): AccessRequest {
  return {
    id: row.id, name: row.name, email: row.email, reason: row.reason,
    requestedRole: row.requested_role, status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at?.toISOString?.() ?? row.reviewed_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapPromptTemplate(row: any): PromptTemplate {
  return {
    id: row.id, callCategory: row.call_category, name: row.name,
    evaluationCriteria: row.evaluation_criteria,
    requiredPhrases: row.required_phrases, scoringWeights: row.scoring_weights,
    additionalInstructions: row.additional_instructions,
    isActive: row.is_active,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapCoachingSession(row: any): CoachingSession {
  return {
    id: row.id, employeeId: row.employee_id, callId: row.call_id,
    assignedBy: row.assigned_by, category: row.category, title: row.title,
    notes: row.notes, actionPlan: row.action_plan, status: row.status,
    dueDate: row.due_date?.toISOString?.() ?? row.due_date,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
  };
}

function mapABTest(row: any): ABTest {
  return {
    id: row.id, fileName: row.file_name, callCategory: row.call_category,
    baselineModel: row.baseline_model, testModel: row.test_model,
    status: row.status, transcriptText: row.transcript_text,
    baselineAnalysis: row.baseline_analysis, testAnalysis: row.test_analysis,
    baselineLatencyMs: row.baseline_latency_ms, testLatencyMs: row.test_latency_ms,
    notes: row.notes, createdBy: row.created_by,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapUsageRecord(row: any): UsageRecord {
  return {
    id: row.id, callId: row.call_id, type: row.type,
    timestamp: row.timestamp?.toISOString?.() ?? row.timestamp,
    // F18: query aliases the reserved-word column "user" → user_name
    user: row.user_name,
    services: row.services,
    totalEstimatedCost: parseFloat(row.total_estimated_cost),
  };
}

/**
 * Shared row → CallWithDetails mapper used by getCallsWithDetails,
 * getCallsPaginated, and searchCalls. The row must include the e_*, t_*,
 * s_*, a_* aliased columns produced by those queries.
 */
function mapCallWithDetailsRow(row: any): CallWithDetails {
  const call = mapCall(row);
  const employee = row.e_id ? {
    id: row.e_id, name: row.e_name, role: row.e_role, email: row.e_email,
    initials: row.e_initials, status: row.e_status, subTeam: row.e_sub_team,
    createdAt: row.e_created_at?.toISOString?.() ?? row.e_created_at,
  } : undefined;
  const transcript = row.t_id ? {
    id: row.t_id, callId: call.id, text: row.t_text, confidence: row.t_confidence,
    words: row.t_words, createdAt: row.t_created_at?.toISOString?.() ?? row.t_created_at,
  } : undefined;
  const sentiment = row.s_id ? {
    id: row.s_id, callId: call.id, overallSentiment: row.overall_sentiment,
    overallScore: row.overall_score, segments: row.s_segments,
    createdAt: row.s_created_at?.toISOString?.() ?? row.s_created_at,
  } : undefined;
  const analysis = row.a_id ? {
    id: row.a_id, callId: call.id,
    performanceScore: row.performance_score, talkTimeRatio: row.talk_time_ratio,
    responseTime: row.response_time, keywords: row.keywords,
    topics: Array.isArray(row.topics) ? row.topics : [],
    summary: typeof row.summary === "string" ? row.summary : "",
    actionItems: Array.isArray(row.action_items) ? row.action_items : [],
    feedback: (row.feedback && typeof row.feedback === "object" && !Array.isArray(row.feedback))
      ? row.feedback : { strengths: [], suggestions: [] },
    lemurResponse: row.lemur_response, callPartyType: row.call_party_type,
    flags: Array.isArray(row.flags) ? row.flags : [],
    manualEdits: row.manual_edits,
    confidenceScore: row.confidence_score, confidenceFactors: row.confidence_factors,
    subScores: row.sub_scores, detectedAgentName: row.detected_agent_name,
    createdAt: row.a_created_at?.toISOString?.() ?? row.a_created_at,
  } : undefined;
  return { ...call, employee, transcript, sentiment, analysis } as CallWithDetails;
}

/**
 * Declarative column map for updateCallAnalysis (A5/F07). Each entry maps an
 * UpdateCallAnalysisInput key to its DB column and an optional value coercer
 * (defaults to identity for scalars; jsonb columns need JSON.stringify).
 */
const UPDATE_ANALYSIS_COLUMNS = {
  embedding:        { column: "embedding",         coerce: (v: unknown) => JSON.stringify(v) },
  manualEdits:      { column: "manual_edits",      coerce: (v: unknown) => JSON.stringify(v) },
  performanceScore: { column: "performance_score", coerce: (v: unknown) => v },
  summary:          { column: "summary",           coerce: (v: unknown) => v },
} as const;

export type UpdateCallAnalysisInput = Partial<{
  embedding: number[];
  manualEdits: unknown;
  performanceScore: string | number;
  summary: string;
}>;

function mapDbUser(row: any): DbUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    displayName: row.display_name,
    active: row.active,
    mfaSecret: row.mfa_secret ?? null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

export class PostgresStorage implements IStorage {
  constructor(
    private db: pg.Pool,
    private audioClient?: ObjectStorageClient,
  ) {}

  // ── Users (legacy env-var based — kept for IStorage interface) ──
  async getUser(_id: string): Promise<User | undefined> { return undefined; }
  async getUserByUsername(_username: string): Promise<User | undefined> { return undefined; }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }

  // ── DB Users (PostgreSQL-backed user management) ──────────
  async getDbUser(id: string): Promise<DbUser | undefined> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? mapDbUser(rows[0]) : undefined;
  }

  async getDbUserByUsername(username: string): Promise<DbUser | undefined> {
    const { rows } = await this.db.query("SELECT * FROM users WHERE username = $1", [username]);
    return rows[0] ? mapDbUser(rows[0]) : undefined;
  }

  async getAllDbUsers(): Promise<DbUser[]> {
    const { rows } = await this.db.query("SELECT * FROM users ORDER BY created_at DESC");
    return rows.map(mapDbUser);
  }

  async createDbUser(user: { username: string; passwordHash: string; role: string; displayName: string }): Promise<DbUser> {
    const { rows } = await this.db.query(
      `INSERT INTO users (username, password_hash, role, display_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user.username, user.passwordHash, user.role, user.displayName],
    );
    return mapDbUser(rows[0]);
  }

  async updateDbUser(id: string, updates: { role?: string; displayName?: string; active?: boolean }): Promise<DbUser | undefined> {
    const current = await this.getDbUser(id);
    if (!current) return undefined;
    const role = updates.role ?? current.role;
    const displayName = updates.displayName ?? current.displayName;
    const active = updates.active ?? current.active;
    const { rows } = await this.db.query(
      `UPDATE users SET role = $2, display_name = $3, active = $4, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, role, displayName, active],
    );
    return rows[0] ? mapDbUser(rows[0]) : undefined;
  }

  async getDbUserPasswordHistory(id: string): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT password_history FROM users WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return [];
    const history = rows[0].password_history;
    return Array.isArray(history) ? history : [];
  }

  async updateDbUserPassword(id: string, passwordHash: string, oldPasswordHash?: string): Promise<boolean> {
    if (oldPasswordHash) {
      // Use a transaction so the history read + write is atomic — prevents a
      // concurrent password change from clobbering the history array.
      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT password_history FROM users WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const history = Array.isArray(rows[0]?.password_history) ? rows[0].password_history : [];
        const newHistory = [oldPasswordHash, ...history].slice(0, 5);
        await client.query(
          `UPDATE users SET password_history = $2, password_hash = $3, updated_at = NOW() WHERE id = $1`,
          [id, JSON.stringify(newHistory), passwordHash],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else {
      await this.db.query(
        `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
        [id, passwordHash],
      );
    }
    return true;
  }

  // ── Employees ─────────────────────────────────────────────
  async getEmployee(id: string): Promise<Employee | undefined> {
    const { rows } = await this.db.query("SELECT * FROM employees WHERE id = $1", [id]);
    return rows[0] ? mapEmployee(rows[0]) : undefined;
  }

  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    const { rows } = await this.db.query("SELECT * FROM employees WHERE email = $1", [email]);
    return rows[0] ? mapEmployee(rows[0]) : undefined;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO employees (id, name, role, email, initials, status, sub_team, pseudonym, extension)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, employee.name, employee.role, employee.email, employee.initials, employee.status ?? "Active", employee.subTeam, employee.pseudonym, employee.extension],
    );
    return mapEmployee(rows[0]);
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const current = await this.getEmployee(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE employees SET name=$2, role=$3, email=$4, initials=$5, status=$6, sub_team=$7, pseudonym=$8, extension=$9
       WHERE id=$1 RETURNING *`,
      [id, merged.name, merged.role, merged.email, merged.initials, merged.status, merged.subTeam, merged.pseudonym, merged.extension],
    );
    return rows[0] ? mapEmployee(rows[0]) : undefined;
  }

  async getAllEmployees(): Promise<Employee[]> {
    const { rows } = await this.db.query("SELECT * FROM employees ORDER BY name");
    return rows.map(mapEmployee);
  }
  async getEmployeesPaginated(options: { limit: number; offset: number; status?: "Active" | "Inactive" }): Promise<{ employees: Employee[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.status) {
      params.push(options.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const totalResult = await this.db.query(`SELECT COUNT(*)::int AS c FROM employees ${whereSql}`, params);
    params.push(options.limit);
    params.push(options.offset);
    const { rows } = await this.db.query(
      `SELECT * FROM employees ${whereSql} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { employees: rows.map(mapEmployee), total: totalResult.rows[0].c };
  }

  /**
   * Find employee by name (case-insensitive). Tries exact match first,
   * then falls back to first-name match. Returns undefined if ambiguous or not found.
   */
  async findEmployeeByName(name: string): Promise<Employee | undefined> {
    const normalized = name.toLowerCase().trim();
    // Exact match
    const { rows: exact } = await this.db.query(
      "SELECT * FROM employees WHERE lower(name) = $1 LIMIT 1",
      [normalized],
    );
    if (exact.length > 0) return mapEmployee(exact[0]);

    // First-name match (only if unambiguous)
    const { rows: firstNameRows } = await this.db.query(
      "SELECT * FROM employees WHERE split_part(lower(name), ' ', 1) = $1",
      [normalized],
    );
    if (firstNameRows.length === 1) return mapEmployee(firstNameRows[0]);
    return undefined;
  }

  // ── Calls ─────────────────────────────────────────────────
  async getCall(id: string): Promise<Call | undefined> {
    const { rows } = await this.db.query("SELECT * FROM calls WHERE id = $1", [id]);
    return rows[0] ? mapCall(rows[0]) : undefined;
  }

  async createCall(call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO calls (id, employee_id, file_name, file_path, status, duration, assembly_ai_id, call_category, content_hash, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, call.employeeId, call.fileName, call.filePath, call.status ?? "pending", call.duration, call.assemblyAiId, call.callCategory, call.contentHash, (call as any).externalId ?? null],
    );
    return mapCall(rows[0]);
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    // F14: guard against silent employee_id clobber. Callers that need to
    // change the assignee must use atomicAssignEmployee or setCallEmployee.
    if (Object.prototype.hasOwnProperty.call(updates, "employeeId")) {
      throw new Error(
        "updateCall: employeeId cannot be modified via updateCall — use atomicAssignEmployee or setCallEmployee",
      );
    }
    // Dynamic SET clause: only update keys explicitly provided. Includes
    // content_hash (F01) which was missing from the legacy whitelist.
    const COLUMN_MAP: Record<string, string> = {
      fileName: "file_name",
      filePath: "file_path",
      status: "status",
      duration: "duration",
      assemblyAiId: "assembly_ai_id",
      callCategory: "call_category",
      contentHash: "content_hash",
      uploadedAt: "uploaded_at",
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, column] of Object.entries(COLUMN_MAP)) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        fields.push(`${column} = $${++idx}`);
        values.push((updates as Record<string, unknown>)[key]);
      }
    }
    if (fields.length === 0) return this.getCall(id);
    const { rows } = await this.db.query(
      `UPDATE calls SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return rows[0] ? mapCall(rows[0]) : undefined;
  }

  async setCallEmployee(callId: string, employeeId: string | null): Promise<Call | undefined> {
    const { rows } = await this.db.query(
      `UPDATE calls SET employee_id = $2 WHERE id = $1 RETURNING *`,
      [callId, employeeId],
    );
    return rows[0] ? mapCall(rows[0]) : undefined;
  }

  async atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean> {
    // Atomic conditional update — only assigns if employee_id IS NULL
    const { rowCount } = await this.db.query(
      `UPDATE calls SET employee_id = $2 WHERE id = $1 AND employee_id IS NULL`,
      [callId, employeeId],
    );
    return (rowCount ?? 0) > 0;
  }

  async deleteCall(id: string): Promise<void> {
    // Cascading deletes handle transcripts, sentiments, analyses
    await this.db.query("DELETE FROM calls WHERE id = $1", [id]);
    // Also delete audio from S3
    if (this.audioClient) {
      try { await this.audioClient.deleteByPrefix(`audio/${id}/`); } catch { /* non-blocking */ }
    }
  }

  async getAllCalls(): Promise<Call[]> {
    const { rows } = await this.db.query("SELECT * FROM calls ORDER BY uploaded_at DESC");
    return rows.map(mapCall);
  }
  async getCallsByStatus(status: string): Promise<Call[]> {
    // A7/F14: indexed via idx_calls_status (see schema.sql)
    const { rows } = await this.db.query(
      "SELECT * FROM calls WHERE status = $1 ORDER BY uploaded_at DESC",
      [status],
    );
    return rows.map(mapCall);
  }
  async getCallsSince(since: Date): Promise<Call[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM calls WHERE uploaded_at >= $1 ORDER BY uploaded_at DESC",
      [since],
    );
    return rows.map(mapCall);
  }
  async findCallByContentHash(contentHash: string): Promise<Call | undefined> {
    const { rows } = await this.db.query(
      "SELECT * FROM calls WHERE content_hash = $1 LIMIT 1",
      [contentHash],
    );
    return rows.length > 0 ? mapCall(rows[0]) : undefined;
  }
  async findCallByExternalId(externalId: string): Promise<Call | undefined> {
    const { rows } = await this.db.query(
      "SELECT * FROM calls WHERE external_id = $1 LIMIT 1",
      [externalId],
    );
    return rows.length > 0 ? mapCall(rows[0]) : undefined;
  }

  // ── A4/F03/F13/F15: hot-path helpers ──────────────────────
  async countCompletedCallsByEmployee(employeeId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS c FROM calls WHERE employee_id = $1 AND status = 'completed'`,
      [employeeId],
    );
    return rows[0]?.c ?? 0;
  }

  async getRecentCallsForBadgeEval(employeeId: string, limit: number): Promise<CallWithDetails[]> {
    const cappedLimit = Math.max(1, Math.min(limit, 200));
    // Joins only the analysis (not transcript/sentiment) — badge evaluation
    // needs sub_scores + performance_score, nothing more.
    const { rows } = await this.db.query(
      `SELECT c.*,
        a.id AS a_id, a.performance_score, a.talk_time_ratio, a.response_time,
        a.keywords, a.topics, a.summary, a.action_items, a.feedback,
        a.lemur_response, a.call_party_type, a.flags, a.manual_edits,
        a.confidence_score, a.confidence_factors, a.sub_scores, a.detected_agent_name, a.created_at AS a_created_at
       FROM calls c
       LEFT JOIN call_analyses a ON a.call_id = c.id
       WHERE c.employee_id = $1 AND c.status = 'completed'
       ORDER BY c.uploaded_at DESC
       LIMIT $2`,
      [employeeId, cappedLimit],
    );
    return rows.map(mapCallWithDetailsRow);
  }

  async getLeaderboardData(options: { since?: Date }): Promise<LeaderboardRow[]> {
    // One row per employee with totals + a JSON array of recent scores.
    // The recent_scores subquery returns up to 50 most recent scores per
    // employee — used downstream by the streak calculator. The since filter
    // is applied uniformly to both aggregates and the recent-scores window.
    const params: unknown[] = [];
    let sinceClause = "";
    if (options.since) {
      params.push(options.since);
      sinceClause = `AND c.uploaded_at >= $${params.length}`;
    }
    const { rows } = await this.db.query(
      `WITH ranked AS (
         SELECT c.employee_id,
                CAST(a.performance_score AS NUMERIC) AS score,
                c.uploaded_at,
                ROW_NUMBER() OVER (PARTITION BY c.employee_id ORDER BY c.uploaded_at DESC) AS rn
         FROM calls c
         JOIN call_analyses a ON a.call_id = c.id
         WHERE c.status = 'completed'
           AND c.employee_id IS NOT NULL
           AND a.performance_score IS NOT NULL
           AND a.performance_score <> ''
           ${sinceClause}
       )
       SELECT
         e.id AS employee_id,
         e.name AS employee_name,
         e.sub_team,
         COUNT(r.score)::int AS total_calls,
         COALESCE(SUM(r.score), 0)::float AS score_sum,
         COUNT(r.score)::int AS score_count,
         COALESCE(
           (SELECT json_agg(score ORDER BY rn ASC)
            FROM ranked r2
            WHERE r2.employee_id = e.id AND r2.rn <= 50),
           '[]'::json
         ) AS recent_scores
       FROM employees e
       LEFT JOIN ranked r ON r.employee_id = e.id
       GROUP BY e.id, e.name, e.sub_team
       HAVING COUNT(r.score) > 0
       ORDER BY score_sum DESC NULLS LAST`,
      params,
    );
    return rows.map((row: any) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      subTeam: row.sub_team ?? undefined,
      totalCalls: row.total_calls,
      scoreSum: parseFloat(row.score_sum) || 0,
      scoreCount: row.score_count,
      recentScores: Array.isArray(row.recent_scores)
        ? row.recent_scores.map((s: unknown) => parseFloat(String(s))).filter(Number.isFinite)
        : [],
    }));
  }

  async getCallsSinceWithDetails(since: Date, employeeId?: string): Promise<CallWithDetails[]> {
    const params: unknown[] = [since];
    let extra = "";
    if (employeeId) {
      params.push(employeeId);
      extra = ` AND c.employee_id = $2`;
    }
    const { rows } = await this.db.query(
      `SELECT c.*,
        e.id AS e_id, e.name AS e_name, e.role AS e_role, e.email AS e_email,
        e.initials AS e_initials, e.status AS e_status, e.sub_team AS e_sub_team, e.created_at AS e_created_at,
        t.id AS t_id, t.text AS t_text, t.confidence AS t_confidence, t.words AS t_words, t.created_at AS t_created_at,
        s.id AS s_id, s.overall_sentiment, s.overall_score, s.segments AS s_segments, s.created_at AS s_created_at,
        a.id AS a_id, a.performance_score, a.talk_time_ratio, a.response_time,
        a.keywords, a.topics, a.summary, a.action_items, a.feedback,
        a.lemur_response, a.call_party_type, a.flags, a.manual_edits,
        a.confidence_score, a.confidence_factors, a.sub_scores, a.detected_agent_name, a.created_at AS a_created_at
       FROM calls c
       LEFT JOIN employees e ON c.employee_id = e.id
       LEFT JOIN transcripts t ON t.call_id = c.id
       LEFT JOIN sentiment_analyses s ON s.call_id = c.id
       LEFT JOIN call_analyses a ON a.call_id = c.id
       WHERE c.uploaded_at >= $1${extra}
       ORDER BY c.uploaded_at DESC`,
      params,
    );
    return rows.map(mapCallWithDetailsRow);
  }

  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {},
  ): Promise<CallWithDetails[]> {
    let query = `
      SELECT c.*,
        e.id AS e_id, e.name AS e_name, e.role AS e_role, e.email AS e_email,
        e.initials AS e_initials, e.status AS e_status, e.sub_team AS e_sub_team, e.created_at AS e_created_at,
        t.id AS t_id, t.text AS t_text, t.confidence AS t_confidence, t.words AS t_words, t.created_at AS t_created_at,
        s.id AS s_id, s.overall_sentiment, s.overall_score, s.segments AS s_segments, s.created_at AS s_created_at,
        a.id AS a_id, a.performance_score, a.talk_time_ratio, a.response_time,
        a.keywords, a.topics, a.summary, a.action_items, a.feedback,
        a.lemur_response, a.call_party_type, a.flags, a.manual_edits,
        a.confidence_score, a.confidence_factors, a.sub_scores, a.detected_agent_name, a.created_at AS a_created_at
      FROM calls c
      LEFT JOIN employees e ON c.employee_id = e.id
      LEFT JOIN transcripts t ON t.call_id = c.id
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (filters.status) {
      query += ` AND c.status = $${idx++}`;
      params.push(filters.status);
    }
    if (filters.sentiment) {
      query += ` AND s.overall_sentiment = $${idx++}`;
      params.push(filters.sentiment);
    }
    if (filters.employee) {
      query += ` AND c.employee_id = $${idx++}`;
      params.push(filters.employee);
    }

    query += " ORDER BY c.uploaded_at DESC";

    const { rows } = await this.db.query(query, params);
    return rows.map(mapCallWithDetailsRow);
  }

  async getCallsPaginated(options: {
    filters?: { status?: string; sentiment?: string; employee?: string };
    cursor?: string;
    limit?: number;
  }): Promise<{ calls: CallWithDetails[]; nextCursor: string | null; total: number }> {
    const filters = options.filters || {};
    const limit = Math.max(1, Math.min(options.limit || 25, 200));

    // Build WHERE clause for both count and data queries
    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    let idx = 1;
    if (filters.status) {
      whereClause += ` AND c.status = $${idx++}`;
      params.push(filters.status);
    }
    if (filters.sentiment) {
      whereClause += ` AND s.overall_sentiment = $${idx++}`;
      params.push(filters.sentiment);
    }
    if (filters.employee) {
      whereClause += ` AND c.employee_id = $${idx++}`;
      params.push(filters.employee);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as cnt FROM calls c
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      ${whereClause}
    `;
    const { rows: countRows } = await this.db.query(countQuery, params);
    const total = parseInt(countRows[0]?.cnt || "0", 10);

    // Apply cursor (with format validation to prevent malformed queries)
    const dataParams = [...params];
    let cursorClause = "";
    if (options.cursor) {
      const sepIdx = options.cursor.indexOf("|");
      if (sepIdx > 0 && sepIdx < options.cursor.length - 1) {
        const cursorDate = options.cursor.substring(0, sepIdx);
        const cursorId = options.cursor.substring(sepIdx + 1);
        // Validate cursor date is ISO-like and cursorId is non-empty
        if (/^\d{4}-\d{2}-\d{2}/.test(cursorDate) && cursorId.length > 0 && cursorId.length <= 36) {
          cursorClause = ` AND (c.uploaded_at < $${idx} OR (c.uploaded_at = $${idx} AND c.id < $${idx + 1}))`;
          idx += 2;
          dataParams.push(cursorDate, cursorId);
        }
      }
      // If cursor is malformed, silently ignore it (returns first page)
    }

    const dataQuery = `
      SELECT c.*,
        e.id AS e_id, e.name AS e_name, e.role AS e_role, e.email AS e_email,
        e.initials AS e_initials, e.status AS e_status, e.sub_team AS e_sub_team, e.created_at AS e_created_at,
        t.id AS t_id, t.text AS t_text, t.confidence AS t_confidence, t.words AS t_words, t.created_at AS t_created_at,
        s.id AS s_id, s.overall_sentiment, s.overall_score, s.segments AS s_segments, s.created_at AS s_created_at,
        a.id AS a_id, a.performance_score, a.talk_time_ratio, a.response_time,
        a.keywords, a.topics, a.summary, a.action_items, a.feedback,
        a.lemur_response, a.call_party_type, a.flags, a.manual_edits,
        a.confidence_score, a.confidence_factors, a.sub_scores, a.detected_agent_name, a.created_at AS a_created_at
      FROM calls c
      LEFT JOIN employees e ON c.employee_id = e.id
      LEFT JOIN transcripts t ON t.call_id = c.id
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      ${whereClause}${cursorClause}
      ORDER BY c.uploaded_at DESC, c.id DESC
      LIMIT $${idx}
    `;
    dataParams.push(limit + 1); // Fetch one extra to check hasMore

    const { rows } = await this.db.query(dataQuery, dataParams);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const calls = pageRows.map(mapCallWithDetailsRow);

    const lastCall = calls[calls.length - 1];
    const nextCursor = hasMore && lastCall?.uploadedAt
      ? `${lastCall.uploadedAt}|${lastCall.id}`
      : null;

    return { calls, nextCursor, total };
  }

  // ── Transcripts ───────────────────────────────────────────
  async getTranscript(callId: string): Promise<Transcript | undefined> {
    const { rows } = await this.db.query("SELECT * FROM transcripts WHERE call_id = $1", [callId]);
    return rows[0] ? mapTranscript(rows[0]) : undefined;
  }

  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO transcripts (id, call_id, text, confidence, words)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, transcript.callId, transcript.text, transcript.confidence, JSON.stringify(transcript.words ?? null)],
    );
    return mapTranscript(rows[0]);
  }

  // ── Sentiment ─────────────────────────────────────────────
  async getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined> {
    const { rows } = await this.db.query("SELECT * FROM sentiment_analyses WHERE call_id = $1", [callId]);
    return rows[0] ? mapSentiment(rows[0]) : undefined;
  }

  async createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO sentiment_analyses (id, call_id, overall_sentiment, overall_score, segments)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, sentiment.callId, sentiment.overallSentiment, sentiment.overallScore, JSON.stringify(sentiment.segments ?? null)],
    );
    return mapSentiment(rows[0]);
  }

  // ── Call Analysis ─────────────────────────────────────────
  async getCallAnalysis(callId: string): Promise<CallAnalysis | undefined> {
    const { rows } = await this.db.query("SELECT * FROM call_analyses WHERE call_id = $1", [callId]);
    return rows[0] ? mapAnalysis(rows[0]) : undefined;
  }

  async getCallAnalysesBulk(callIds: string[]): Promise<Map<string, CallAnalysis>> {
    const result = new Map<string, CallAnalysis>();
    if (callIds.length === 0) return result;
    // Batch into chunks of 500 to avoid overly large IN clauses
    const CHUNK_SIZE = 500;
    for (let i = 0; i < callIds.length; i += CHUNK_SIZE) {
      const chunk = callIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(",");
      const { rows } = await this.db.query(
        `SELECT * FROM call_analyses WHERE call_id IN (${placeholders})`,
        chunk
      );
      for (const row of rows) {
        const analysis = mapAnalysis(row);
        result.set(analysis.callId, analysis);
      }
    }
    return result;
  }

  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO call_analyses (id, call_id, performance_score, talk_time_ratio, response_time,
       keywords, topics, summary, action_items, feedback, lemur_response, call_party_type,
       flags, manual_edits, confidence_score, confidence_factors, sub_scores, detected_agent_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [id, analysis.callId, analysis.performanceScore, analysis.talkTimeRatio, analysis.responseTime,
       JSON.stringify(analysis.keywords ?? null), JSON.stringify(analysis.topics ?? null),
       analysis.summary, JSON.stringify(analysis.actionItems ?? null),
       JSON.stringify(analysis.feedback ?? null), JSON.stringify(analysis.lemurResponse ?? null),
       analysis.callPartyType, JSON.stringify(analysis.flags ?? null),
       JSON.stringify(analysis.manualEdits ?? null), analysis.confidenceScore,
       JSON.stringify(analysis.confidenceFactors ?? null), JSON.stringify(analysis.subScores ?? null),
       analysis.detectedAgentName],
    );
    return mapAnalysis(rows[0]);
  }

  async updateCallAnalysis(callId: string, updates: UpdateCallAnalysisInput): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 0;
    for (const key of Object.keys(updates)) {
      const def = (UPDATE_ANALYSIS_COLUMNS as Record<string, { column: string; coerce: (v: unknown) => unknown }>)[key];
      if (!def) {
        throw new Error(`updateCallAnalysis: unknown field "${key}"`);
      }
      const value = (updates as Record<string, unknown>)[key];
      if (value === undefined) continue;
      fields.push(`${def.column} = $${++idx}`);
      values.push(def.coerce(value));
    }
    if (fields.length === 0) return;
    values.push(callId);
    await this.db.query(
      `UPDATE call_analyses SET ${fields.join(", ")} WHERE call_id = $${idx + 1}`,
      values,
    );
  }

  // ── Audio (delegated to S3 client) ────────────────────────
  async uploadAudio(callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.audioClient) throw new Error("No audio storage configured");
    await this.audioClient.uploadFile(`audio/${callId}/${fileName}`, buffer, contentType);
  }

  async getAudioFiles(callId: string): Promise<string[]> {
    if (!this.audioClient) return [];
    return this.audioClient.listObjects(`audio/${callId}/`);
  }

  async downloadAudio(objectName: string): Promise<Buffer | undefined> {
    if (!this.audioClient) return undefined;
    return this.audioClient.downloadFile(objectName);
  }

  async getAudioPresignedUrl(objectName: string): Promise<string | undefined> {
    if (!this.audioClient) return undefined;
    return this.audioClient.getPresignedUrl?.(objectName, 3600);
  }

  // ── Dashboard Metrics ─────────────────────────────────────
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const { rows } = await this.db.query(`
      SELECT
        (SELECT COUNT(*) FROM calls)::int AS total_calls,
        (SELECT COALESCE(AVG(CAST(overall_score AS NUMERIC)) * 10, 0) FROM sentiment_analyses) AS avg_sentiment,
        (SELECT COALESCE(AVG(CAST(performance_score AS NUMERIC)), 0) FROM call_analyses) AS avg_performance
    `);
    const r = rows[0];
    return {
      totalCalls: r.total_calls,
      avgSentiment: Math.round(parseFloat(r.avg_sentiment) * 100) / 100,
      avgPerformanceScore: Math.round(parseFloat(r.avg_performance) * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(): Promise<SentimentDistribution> {
    const { rows } = await this.db.query(`
      SELECT overall_sentiment, COUNT(*)::int AS count
      FROM sentiment_analyses
      WHERE overall_sentiment IS NOT NULL
      GROUP BY overall_sentiment
    `);
    const dist: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const row of rows) {
      const key = row.overall_sentiment as keyof SentimentDistribution;
      if (key in dist) dist[key] = row.count;
    }
    return dist;
  }

  async getTopPerformers(limit = 3): Promise<PerformerSummary[]> {
    const { rows } = await this.db.query(`
      SELECT e.id, e.name, e.role,
        COUNT(c.id)::int AS total_calls,
        ROUND(AVG(CAST(a.performance_score AS NUMERIC)), 2) AS avg_score
      FROM employees e
      JOIN calls c ON c.employee_id = e.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      GROUP BY e.id, e.name, e.role
      HAVING COUNT(c.id) > 0
      ORDER BY avg_score DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    return rows.map((r) => ({
      id: r.id, name: r.name, role: r.role,
      avgPerformanceScore: r.avg_score ? parseFloat(r.avg_score) : null,
      totalCalls: r.total_calls,
    }));
  }

  // ── Search ────────────────────────────────────────────────
  async searchCalls(query: string, limit = 50): Promise<CallWithDetails[]> {
    // Single query: join transcript search with full call details (no N+1)
    const { rows } = await this.db.query(`
      SELECT c.*,
        e.id AS e_id, e.name AS e_name, e.role AS e_role, e.email AS e_email,
        e.initials AS e_initials, e.status AS e_status, e.sub_team AS e_sub_team, e.created_at AS e_created_at,
        t.id AS t_id, t.text AS t_text, t.confidence AS t_confidence, t.words AS t_words, t.created_at AS t_created_at,
        s.id AS s_id, s.overall_sentiment, s.overall_score, s.segments AS s_segments, s.created_at AS s_created_at,
        a.id AS a_id, a.performance_score, a.talk_time_ratio, a.response_time,
        a.keywords, a.topics, a.summary, a.action_items, a.feedback,
        a.lemur_response, a.call_party_type, a.flags, a.manual_edits,
        a.confidence_score, a.confidence_factors, a.sub_scores, a.detected_agent_name, a.created_at AS a_created_at
      FROM calls c
      JOIN transcripts t ON t.call_id = c.id
      LEFT JOIN employees e ON c.employee_id = e.id
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      WHERE to_tsvector('english', coalesce(t.text, '')) @@ plainto_tsquery('english', $1)
         OR t.text ILIKE $2
      ORDER BY ts_rank(to_tsvector('english', coalesce(t.text, '')), plainto_tsquery('english', $1)) DESC,
               c.uploaded_at DESC
      LIMIT $3
    `, [query, `%${query}%`, limit]);

    if (rows.length === 0) return [];
    return rows.map(mapCallWithDetailsRow);
  }

  // ── Access Requests ───────────────────────────────────────
  async createAccessRequest(request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO access_requests (id, name, email, reason, requested_role)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, request.name, request.email, request.reason, request.requestedRole ?? "viewer"],
    );
    return mapAccessRequest(rows[0]);
  }

  async getAllAccessRequests(): Promise<AccessRequest[]> {
    const { rows } = await this.db.query("SELECT * FROM access_requests ORDER BY created_at DESC");
    return rows.map(mapAccessRequest);
  }

  async getAccessRequest(id: string): Promise<AccessRequest | undefined> {
    const { rows } = await this.db.query("SELECT * FROM access_requests WHERE id = $1", [id]);
    return rows[0] ? mapAccessRequest(rows[0]) : undefined;
  }

  async updateAccessRequest(id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const current = await this.getAccessRequest(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE access_requests SET status=$2, reviewed_by=$3, reviewed_at=$4 WHERE id=$1 RETURNING *`,
      [id, merged.status, merged.reviewedBy, merged.reviewedAt ?? (updates.status ? new Date().toISOString() : null)],
    );
    return rows[0] ? mapAccessRequest(rows[0]) : undefined;
  }

  // ── Prompt Templates ──────────────────────────────────────
  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    const { rows } = await this.db.query("SELECT * FROM prompt_templates WHERE id = $1", [id]);
    return rows[0] ? mapPromptTemplate(rows[0]) : undefined;
  }

  async getPromptTemplateByCategory(callCategory: string): Promise<PromptTemplate | undefined> {
    const { rows } = await this.db.query(
      "SELECT * FROM prompt_templates WHERE call_category = $1 AND is_active = TRUE LIMIT 1",
      [callCategory],
    );
    return rows[0] ? mapPromptTemplate(rows[0]) : undefined;
  }

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    const { rows } = await this.db.query("SELECT * FROM prompt_templates ORDER BY name");
    return rows.map(mapPromptTemplate);
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO prompt_templates (id, call_category, name, evaluation_criteria,
       required_phrases, scoring_weights, additional_instructions, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, template.callCategory, template.name, template.evaluationCriteria,
       JSON.stringify(template.requiredPhrases ?? null), JSON.stringify(template.scoringWeights ?? null),
       template.additionalInstructions, template.isActive ?? true],
    );
    return mapPromptTemplate(rows[0]);
  }

  async updatePromptTemplate(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const current = await this.getPromptTemplate(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE prompt_templates SET call_category=$2, name=$3, evaluation_criteria=$4,
       required_phrases=$5, scoring_weights=$6, additional_instructions=$7,
       is_active=$8, updated_at=NOW(), updated_by=$9 WHERE id=$1 RETURNING *`,
      [id, merged.callCategory, merged.name, merged.evaluationCriteria,
       JSON.stringify(merged.requiredPhrases ?? null), JSON.stringify(merged.scoringWeights ?? null),
       merged.additionalInstructions, merged.isActive, merged.updatedBy],
    );
    return rows[0] ? mapPromptTemplate(rows[0]) : undefined;
  }

  async deletePromptTemplate(id: string): Promise<void> {
    await this.db.query("DELETE FROM prompt_templates WHERE id = $1", [id]);
  }

  // ── Coaching Sessions ─────────────────────────────────────
  async createCoachingSession(session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO coaching_sessions (id, employee_id, call_id, assigned_by, category, title, notes, action_plan, status, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, session.employeeId, session.callId, session.assignedBy, session.category ?? "general",
       session.title, session.notes, JSON.stringify(session.actionPlan ?? null),
       session.status ?? "pending", session.dueDate],
    );
    return mapCoachingSession(rows[0]);
  }

  async getCoachingSession(id: string): Promise<CoachingSession | undefined> {
    const { rows } = await this.db.query("SELECT * FROM coaching_sessions WHERE id = $1", [id]);
    return rows[0] ? mapCoachingSession(rows[0]) : undefined;
  }

  async getAllCoachingSessions(): Promise<CoachingSession[]> {
    const { rows } = await this.db.query("SELECT * FROM coaching_sessions ORDER BY created_at DESC");
    return rows.map(mapCoachingSession);
  }

  async getCoachingSessionsByEmployee(employeeId: string): Promise<CoachingSession[]> {
    const { rows } = await this.db.query(
      "SELECT * FROM coaching_sessions WHERE employee_id = $1 ORDER BY created_at DESC",
      [employeeId],
    );
    return rows.map(mapCoachingSession);
  }

  async updateCoachingSession(id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const current = await this.getCoachingSession(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const completedAt = merged.status === "completed" && !current.completedAt ? new Date().toISOString() : merged.completedAt;
    const { rows } = await this.db.query(
      `UPDATE coaching_sessions SET employee_id=$2, call_id=$3, assigned_by=$4, category=$5,
       title=$6, notes=$7, action_plan=$8, status=$9, due_date=$10, completed_at=$11
       WHERE id=$1 RETURNING *`,
      [id, merged.employeeId, merged.callId, merged.assignedBy, merged.category,
       merged.title, merged.notes, JSON.stringify(merged.actionPlan ?? null),
       merged.status, merged.dueDate, completedAt],
    );
    return rows[0] ? mapCoachingSession(rows[0]) : undefined;
  }

  // ── A/B Tests ─────────────────────────────────────────────
  async createABTest(test: InsertABTest): Promise<ABTest> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO ab_tests (id, file_name, call_category, baseline_model, test_model, status,
       transcript_text, baseline_analysis, test_analysis, baseline_latency_ms, test_latency_ms, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, test.fileName, test.callCategory, test.baselineModel, test.testModel,
       test.status ?? "processing", test.transcriptText,
       JSON.stringify(test.baselineAnalysis ?? null), JSON.stringify(test.testAnalysis ?? null),
       test.baselineLatencyMs, test.testLatencyMs, test.notes, test.createdBy],
    );
    return mapABTest(rows[0]);
  }

  async getABTest(id: string): Promise<ABTest | undefined> {
    const { rows } = await this.db.query("SELECT * FROM ab_tests WHERE id = $1", [id]);
    return rows[0] ? mapABTest(rows[0]) : undefined;
  }

  async getAllABTests(): Promise<ABTest[]> {
    const { rows } = await this.db.query("SELECT * FROM ab_tests ORDER BY created_at DESC");
    return rows.map(mapABTest);
  }

  async updateABTest(id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
    const current = await this.getABTest(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE ab_tests SET status=$2, transcript_text=$3, baseline_analysis=$4, test_analysis=$5,
       baseline_latency_ms=$6, test_latency_ms=$7, notes=$8 WHERE id=$1 RETURNING *`,
      [id, merged.status, merged.transcriptText,
       JSON.stringify(merged.baselineAnalysis ?? null), JSON.stringify(merged.testAnalysis ?? null),
       merged.baselineLatencyMs, merged.testLatencyMs, merged.notes],
    );
    return rows[0] ? mapABTest(rows[0]) : undefined;
  }

  async deleteABTest(id: string): Promise<void> {
    await this.db.query("DELETE FROM ab_tests WHERE id = $1", [id]);
  }

  // ── Usage Records ─────────────────────────────────────────
  async createUsageRecord(record: UsageRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_records (id, call_id, type, timestamp, "user", services, total_estimated_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.callId, record.type, record.timestamp,
       record.user, JSON.stringify(record.services), record.totalEstimatedCost],
    );
  }

  async getAllUsageRecords(): Promise<UsageRecord[]> {
    // F18: explicit alias for the reserved-word column "user" → user_name
    const { rows } = await this.db.query(
      `SELECT id, call_id, type, timestamp, "user" AS user_name, services, total_estimated_cost
       FROM usage_records ORDER BY timestamp DESC`,
    );
    return rows.map(mapUsageRecord);
  }

  // ── Data Retention ────────────────────────────────────────
  async purgeExpiredCalls(retentionDays: number): Promise<number> {
    // F05/F06: compute a single cutoff timestamp at the top so SELECT and
    // DELETE see the same boundary (eliminates race where calls expire
    // mid-purge and S3 cleanup misses them).
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Stage 1: regular retention purge (uploaded_at < cutoff)
    const { rows } = await this.db.query(
      "SELECT id FROM calls WHERE uploaded_at < $1",
      [cutoff],
    );
    let purged = 0;
    if (rows.length > 0) {
      const callIds = rows.map((r: any) => r.id);

      // Delete audio + batch-inference artifacts from S3 first (HIPAA)
      if (this.audioClient) {
        await Promise.allSettled(
          callIds.flatMap((id: string) => [
            this.audioClient!.deleteByPrefix(`audio/${id}/`).catch((err) =>
              console.error(`[RETENTION] Failed to delete S3 audio for call ${id}:`, err.message),
            ),
            this.audioClient!.deleteObject(`batch-inference/pending/${id}.json`).catch(() => {}),
          ]),
        );
      }

      // HIPAA audit through the audit-log service (chained HMAC + DB persist)
      logPhiAccess({
        timestamp: new Date().toISOString(),
        event: "retention_purge",
        resourceType: "call",
        resourceId: callIds.join(","),
        detail: `${callIds.length} calls purged by retention policy (cutoff=${cutoff.toISOString()})`,
      });

      // Delete by ID array — same set we just cleaned up in S3
      const { rowCount } = await this.db.query(
        "DELETE FROM calls WHERE id = ANY($1::uuid[])",
        [callIds],
      );
      purged = rowCount ?? 0;
    }

    // Stage 2: shorter retention for failed calls (split out for clarity)
    await this.purgeFailedCalls();

    return purged;
  }

  /** Cleanup of failed calls older than 7 days. Split from main retention path. */
  private async purgeFailedCalls(): Promise<void> {
    const failedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const { rows: failedRows } = await this.db.query(
        "SELECT id FROM calls WHERE status = 'failed' AND uploaded_at < $1",
        [failedCutoff],
      );
      if (failedRows.length === 0) return;
      const failedIds = failedRows.map((r: any) => r.id);
      if (this.audioClient) {
        await Promise.allSettled(
          failedIds.map((id: string) =>
            this.audioClient!.deleteByPrefix(`audio/${id}/`).catch(() => {}),
          ),
        );
      }
      await this.db.query("DELETE FROM calls WHERE id = ANY($1::uuid[])", [failedIds]);
      console.log(`[RETENTION] Purged ${failedIds.length} failed call(s) older than 7 days.`);
    } catch (err) {
      console.warn("[RETENTION] Failed call cleanup error:", (err as Error).message);
    }
  }

  // --- Gamification ---
  // F15: ON CONFLICT only fires for milestone badge types — those are the
  // only ones with a UNIQUE (employee_id, badge_type) constraint. For all
  // other badge types (score/streak/sub-score/improvement), the conflict
  // path is unreachable and indicates a logic bug; throw loudly instead of
  // silently swallowing the row count == 0 case.
  private static readonly MILESTONE_BADGE_TYPES = new Set([
    "first_call", "calls_25", "calls_50", "calls_100",
  ]);

  async createBadge(badge: InsertBadge): Promise<Badge> {
    const id = randomUUID();
    const isMilestone = PostgresStorage.MILESTONE_BADGE_TYPES.has(badge.badgeType);
    const { rows } = await this.db.query(
      `INSERT INTO badges (id, employee_id, badge_type, call_id, earned_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ${isMilestone ? "ON CONFLICT DO NOTHING" : ""}
       RETURNING *`,
      [id, badge.employeeId, badge.badgeType, badge.callId || null, badge.earnedAt, JSON.stringify(badge.metadata || {})]
    );
    if (rows.length === 0) {
      if (!isMilestone) {
        throw new Error(
          `createBadge: INSERT returned no rows for non-milestone badge "${badge.badgeType}" — should be unreachable`,
        );
      }
      // Milestone duplicate path: return the existing row
      const existing = await this.db.query(
        `SELECT * FROM badges WHERE employee_id = $1 AND badge_type = $2 LIMIT 1`,
        [badge.employeeId, badge.badgeType]
      );
      if (existing.rows.length > 0) return this.mapBadge(existing.rows[0]);
      throw new Error(
        `createBadge: milestone "${badge.badgeType}" conflict with no existing row for employee ${badge.employeeId}`,
      );
    }
    return this.mapBadge(rows[0]);
  }

  async getBadgesByEmployee(employeeId: string): Promise<Badge[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM badges WHERE employee_id = $1 ORDER BY earned_at DESC`,
      [employeeId]
    );
    return rows.map((r: any) => this.mapBadge(r));
  }

  async hasBadge(employeeId: string, badgeType: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM badges WHERE employee_id = $1 AND badge_type = $2 LIMIT 1`,
      [employeeId, badgeType]
    );
    return rows.length > 0;
  }

  async getAllBadges(): Promise<Badge[]> {
    const { rows } = await this.db.query(`SELECT * FROM badges ORDER BY earned_at DESC`);
    return rows.map((r: any) => this.mapBadge(r));
  }

  private mapBadge(row: any): Badge {
    return {
      id: row.id,
      employeeId: row.employee_id,
      badgeType: row.badge_type,
      callId: row.call_id,
      earnedAt: row.earned_at?.toISOString?.() ?? row.earned_at,
      metadata: row.metadata,
    };
  }

  getObjectStorageClient(): ObjectStorageClient | undefined {
    return this.audioClient;
  }
}
