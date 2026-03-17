/**
 * PostgreSQL-backed storage implementation.
 *
 * Stores all metadata in RDS PostgreSQL. Audio files remain in S3.
 * Implements the same IStorage interface as MemStorage and CloudStorage.
 */
import type pg from "pg";
import { randomUUID } from "crypto";
import type {
  User, InsertUser, Employee, InsertEmployee,
  Call, InsertCall, Transcript, InsertTranscript,
  SentimentAnalysis, InsertSentimentAnalysis,
  CallAnalysis, InsertCallAnalysis,
  CallWithDetails, DashboardMetrics, SentimentDistribution,
  AccessRequest, InsertAccessRequest,
  PromptTemplate, InsertPromptTemplate,
  CoachingSession, InsertCoachingSession,
  PerformerSummary, ABTest, InsertABTest, UsageRecord,
} from "@shared/schema";
import type { IStorage, ObjectStorageClient } from "./storage";

/** Safe parseFloat that returns fallback on NaN. */
function safeFloat(value: string | undefined | null, fallback = 0): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Maps a database row (snake_case) to the application model (camelCase).
 * Each entity has its own mapper to keep types correct.
 */
function mapEmployee(row: any): Employee {
  return {
    id: row.id, name: row.name, role: row.role, email: row.email,
    initials: row.initials, status: row.status, subTeam: row.sub_team,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function mapCall(row: any): Call {
  return {
    id: row.id, employeeId: row.employee_id, fileName: row.file_name,
    filePath: row.file_path, status: row.status, duration: row.duration,
    assemblyAiId: row.assembly_ai_id, callCategory: row.call_category,
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
    user: row.user, services: row.services,
    totalEstimatedCost: parseFloat(row.total_estimated_cost),
  };
}

export class PostgresStorage implements IStorage {
  constructor(
    private db: pg.Pool,
    private audioClient?: ObjectStorageClient,
  ) {}

  // ── Users (env-var based, not in DB) ──────────────────────
  async getUser(_id: string): Promise<User | undefined> { return undefined; }
  async getUserByUsername(_username: string): Promise<User | undefined> { return undefined; }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
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
      `INSERT INTO employees (id, name, role, email, initials, status, sub_team)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, employee.name, employee.role, employee.email, employee.initials, employee.status ?? "Active", employee.subTeam],
    );
    return mapEmployee(rows[0]);
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const current = await this.getEmployee(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE employees SET name=$2, role=$3, email=$4, initials=$5, status=$6, sub_team=$7
       WHERE id=$1 RETURNING *`,
      [id, merged.name, merged.role, merged.email, merged.initials, merged.status, merged.subTeam],
    );
    return rows[0] ? mapEmployee(rows[0]) : undefined;
  }

  async getAllEmployees(): Promise<Employee[]> {
    const { rows } = await this.db.query("SELECT * FROM employees ORDER BY name");
    return rows.map(mapEmployee);
  }

  // ── Calls ─────────────────────────────────────────────────
  async getCall(id: string): Promise<Call | undefined> {
    const { rows } = await this.db.query("SELECT * FROM calls WHERE id = $1", [id]);
    return rows[0] ? mapCall(rows[0]) : undefined;
  }

  async createCall(call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const { rows } = await this.db.query(
      `INSERT INTO calls (id, employee_id, file_name, file_path, status, duration, assembly_ai_id, call_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, call.employeeId, call.fileName, call.filePath, call.status ?? "pending", call.duration, call.assemblyAiId, call.callCategory],
    );
    return mapCall(rows[0]);
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const current = await this.getCall(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const { rows } = await this.db.query(
      `UPDATE calls SET employee_id=$2, file_name=$3, file_path=$4, status=$5,
       duration=$6, assembly_ai_id=$7, call_category=$8, uploaded_at=$9
       WHERE id=$1 RETURNING *`,
      [id, merged.employeeId, merged.fileName, merged.filePath, merged.status,
       merged.duration, merged.assemblyAiId, merged.callCategory, merged.uploadedAt],
    );
    return rows[0] ? mapCall(rows[0]) : undefined;
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
    return rows.map((row) => {
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
    });
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
    // Use ILIKE for simple text search; could upgrade to tsvector later
    const { rows } = await this.db.query(`
      SELECT c.id FROM calls c
      JOIN transcripts t ON t.call_id = c.id
      WHERE t.text ILIKE $1
      ORDER BY c.uploaded_at DESC
      LIMIT $2
    `, [`%${query}%`, limit]);

    if (rows.length === 0) return [];

    // Get full details for matching calls
    const allDetails = await this.getCallsWithDetails();
    const matchIds = new Set(rows.map((r) => r.id));
    return allDetails.filter((c) => matchIds.has(c.id));
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
    const { rows } = await this.db.query("SELECT * FROM usage_records ORDER BY timestamp DESC");
    return rows.map(mapUsageRecord);
  }

  // ── Data Retention ────────────────────────────────────────
  async purgeExpiredCalls(retentionDays: number): Promise<number> {
    const { rowCount } = await this.db.query(
      "DELETE FROM calls WHERE uploaded_at < NOW() - INTERVAL '1 day' * $1",
      [retentionDays],
    );
    // Audio cleanup in S3 would need to be handled separately (S3 lifecycle rules recommended)
    return rowCount ?? 0;
  }
}
