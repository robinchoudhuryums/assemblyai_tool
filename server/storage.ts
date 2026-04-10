import {
  type User,
  type InsertUser,
  type DbUser,
  type Employee,
  type InsertEmployee,
  type Call,
  type InsertCall,
  type Transcript,
  type InsertTranscript,
  type SentimentAnalysis,
  type InsertSentimentAnalysis,
  type CallAnalysis,
  type InsertCallAnalysis,
  type CallWithDetails,
  type DashboardMetrics,
  type SentimentDistribution,
  type AccessRequest,
  type InsertAccessRequest,
  type PromptTemplate,
  type InsertPromptTemplate,
  type CoachingSession,
  type InsertCoachingSession,
  type PerformerSummary,
  type ABTest,
  type InsertABTest,
  type UsageRecord,
  type Badge,
  type InsertBadge,
  type LeaderboardRow,
} from "@shared/schema";
import { S3Client } from "./services/s3";
import { getPool } from "./db/pool";
import { PostgresStorage, type UpdateCallAnalysisInput } from "./storage-postgres";
import { randomUUID } from "crypto";
import { safeFloat } from "./routes/utils";

export type { UpdateCallAnalysisInput };

/** F35: Pre-aggregated result for /api/reports/filtered — avoids loading all calls into memory. */
export interface FilteredReportResult {
  metrics: { totalCalls: number; avgSentiment: number; avgPerformanceScore: number };
  sentiment: { positive: number; neutral: number; negative: number };
  performers: Array<{ id: string; name: string; role: string; avgPerformanceScore: number | null; totalCalls: number }>;
  trends: Array<{ month: string; calls: number; avgScore: number | null; positive: number; neutral: number; negative: number }>;
  avgSubScores: { compliance: number; customerExperience: number; communication: number; resolution: number } | null;
  autoAssignedCount: number;
}

/** F35: Lightweight call data for insights — excludes transcript text/words. */
export interface InsightsCallData {
  id: string;
  status: string;
  uploadedAt: string | null;
  employeeName: string | null;
  sentiment: string | null;
  performanceScore: string | null;
  confidenceScore: string | null;
  summary: string | null;
  topics: string[];
  detectedAgentName: string | null;
}

/** Common interface for S3 object storage client */
export interface ObjectStorageClient {
  uploadJson(objectName: string, data: unknown): Promise<void>;
  uploadFile(objectName: string, buffer: Buffer, contentType: string): Promise<void>;
  downloadJson<T>(objectName: string): Promise<T | undefined>;
  downloadFile(objectName: string): Promise<Buffer | undefined>;
  listObjects(prefix: string): Promise<string[]>;
  listObjectsWithMetadata(prefix: string): Promise<Array<{ name: string; size: string; updated: string }>>;
  listAndDownloadJson<T>(prefix: string): Promise<T[]>;
  deleteObject(objectName: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  getPresignedUrl?(objectName: string, expiresInSeconds?: number): Promise<string>;
}

export interface IStorage {
  // User operations (env-var-based, legacy)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // DB User operations (PostgreSQL-backed user management)
  getDbUser(id: string): Promise<DbUser | undefined>;
  getDbUserByUsername(username: string): Promise<DbUser | undefined>;
  getAllDbUsers(): Promise<DbUser[]>;
  createDbUser(user: { username: string; passwordHash: string; role: string; displayName: string }): Promise<DbUser>;
  updateDbUser(id: string, updates: { role?: string; displayName?: string; active?: boolean }): Promise<DbUser | undefined>;
  getDbUserPasswordHistory(id: string): Promise<string[]>;
  updateDbUserPassword(id: string, passwordHash: string, oldPasswordHash?: string): Promise<boolean>;

  // Employee operations
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByEmail(email: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined>;
  getAllEmployees(): Promise<Employee[]>;
  /** Paginated employee list (A20). Defaults applied by impl if unspecified. */
  getEmployeesPaginated(options: { limit: number; offset: number; status?: "Active" | "Inactive" }): Promise<{ employees: Employee[]; total: number }>;
  findEmployeeByName(name: string): Promise<Employee | undefined>;

  // Call operations
  getCall(id: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  /**
   * Atomically assign employee only if not already assigned. Returns true if
   * assignment was made, false if the call was already assigned.
   *
   * ATOMICITY CONTRACT (A44/F59): implementations MUST guarantee that
   * concurrent calls for the same callId cannot both succeed. PostgresStorage
   * enforces this via a single conditional UPDATE (`WHERE employee_id IS NULL`);
   * MemStorage uses a JS-level single-turn check-and-set which is atomic on
   * Node's single-threaded event loop. CloudStorage (S3-only) is best-effort
   * because S3 lacks compare-and-swap — the fallback is acceptable because
   * that backend is dev-only.
   */
  atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean>;
  /**
   * Explicit assign/reassign/unassign of a call's employee. Used by the
   * manager-facing PATCH /api/calls/:id/assign route, where reassignment
   * (clobber of an existing employee_id) is intentional. Pass null to unassign.
   * Regular updateCall rejects employeeId in its updates payload (F14).
   */
  setCallEmployee(callId: string, employeeId: string | null): Promise<Call | undefined>;
  deleteCall(id: string): Promise<void>;
  getAllCalls(): Promise<Call[]>;
  /**
   * A7/F14: indexed status lookup. Replaces full-table scan + filter used by
   * batch orphan recovery and background workers.
   */
  getCallsByStatus(status: string): Promise<Call[]>;
  /**
   * A7/F14: return calls created on or after the given date. Backed by the
   * existing created_at index. Used by auto-calibration and windowed analytics.
   */
  getCallsSince(since: Date): Promise<Call[]>;
  /** Find a call by its content hash (A21). Returns undefined if not found. */
  findCallByContentHash(contentHash: string): Promise<Call | undefined>;
  /**
   * A10: Find a call by its upstream-source external id (e.g. an 8x8 recording id).
   * Indexed lookup; returns undefined if not found. Used by telephony auto-ingest
   * to dedupe before downloading audio bytes.
   */
  findCallByExternalId(externalId: string): Promise<Call | undefined>;
  getCallsWithDetails(filters?: { status?: string; sentiment?: string; employee?: string }): Promise<CallWithDetails[]>;
  /**
   * A4/F03: count completed calls for one employee. Replaces a
   * `getCallsWithDetails({ employee }).filter(...)` scan in the badge
   * evaluator. PostgresStorage uses an indexed COUNT.
   */
  countCompletedCallsByEmployee(employeeId: string): Promise<number>;
  /**
   * A4/F03: return the N most recent completed calls for one employee
   * with their analyses joined. Replaces full call+analysis scans in
   * gamification + coaching weakness checks.
   */
  getRecentCallsForBadgeEval(employeeId: string, limit: number): Promise<CallWithDetails[]>;
  /**
   * A4/F13: server-side leaderboard aggregation. Returns one row per
   * employee with totals for calls, scores, and recent-streak input.
   * The window applied here is "all completed calls" — `period` filtering
   * (week / month / all) is applied at the SQL level by callers because
   * it's cheaper to push down than to compute over an O(employees * calls)
   * in-memory scan.
   */
  getLeaderboardData(options: { since?: Date }): Promise<LeaderboardRow[]>;
  /**
   * A4/F15: return calls completed since a given date with all
   * details joined. Replaces 6 hot-path `getCallsWithDetails()` scans
   * (insights, scheduled reports, analytics fallback) that were loading
   * the full call universe to filter by date in JS.
   */
  getCallsSinceWithDetails(since: Date, employeeId?: string): Promise<CallWithDetails[]>;
  getCallsPaginated(options: {
    filters?: { status?: string; sentiment?: string; employee?: string };
    cursor?: string; // ISO timestamp:id cursor
    limit?: number;
  }): Promise<{ calls: CallWithDetails[]; nextCursor: string | null; total: number }>;

  // Transcript operations
  getTranscript(callId: string): Promise<Transcript | undefined>;
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;

  // Sentiment analysis operations
  getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined>;
  createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis>;

  // Call analysis operations
  getCallAnalysis(callId: string): Promise<CallAnalysis | undefined>;
  /**
   * F03: Bulk fetch analyses for multiple call IDs in a single query.
   * Returns a Map keyed by callId. Missing analyses are omitted (not undefined).
   * Used by auto-calibration to avoid N+1 query patterns.
   */
  getCallAnalysesBulk(callIds: string[]): Promise<Map<string, CallAnalysis>>;
  createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis>;
  updateCallAnalysis(callId: string, updates: UpdateCallAnalysisInput): Promise<void>;

  // Dashboard metrics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getSentimentDistribution(): Promise<SentimentDistribution>;
  getTopPerformers(limit?: number): Promise<PerformerSummary[]>;

  /**
   * F35: SQL-level aggregation for /api/reports/filtered. Replaces loading
   * all calls into memory then filtering/aggregating in JS.
   */
  getFilteredReportMetrics(filters: {
    from?: string;
    to?: string;
    employeeId?: string;
    role?: string;
    callPartyType?: string;
  }): Promise<FilteredReportResult>;

  /**
   * F35: Lightweight call data for /api/insights — returns only the fields
   * the insights endpoint needs (no transcript text/words), bounded by date
   * window. Avoids loading full CallWithDetails for every call.
   */
  getInsightsData(since: Date): Promise<InsightsCallData[]>;

  // Search and filtering (limit controls max results returned)
  searchCalls(query: string, limit?: number): Promise<CallWithDetails[]>;

  // Audio file operations
  uploadAudio(callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void>;
  getAudioFiles(callId: string): Promise<string[]>;
  downloadAudio(objectName: string): Promise<Buffer | undefined>;
  /** Get a pre-signed S3 URL for direct audio access (avoids buffering). Returns undefined if not supported. */
  getAudioPresignedUrl?(objectName: string): Promise<string | undefined>;

  // Access request operations
  createAccessRequest(request: InsertAccessRequest): Promise<AccessRequest>;
  getAllAccessRequests(): Promise<AccessRequest[]>;
  getAccessRequest(id: string): Promise<AccessRequest | undefined>;
  updateAccessRequest(id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined>;

  // Prompt template operations
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  getPromptTemplateByCategory(callCategory: string): Promise<PromptTemplate | undefined>;
  getAllPromptTemplates(): Promise<PromptTemplate[]>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(id: string): Promise<void>;

  // Coaching session operations
  createCoachingSession(session: InsertCoachingSession): Promise<CoachingSession>;
  getCoachingSession(id: string): Promise<CoachingSession | undefined>;
  getAllCoachingSessions(): Promise<CoachingSession[]>;
  getCoachingSessionsByEmployee(employeeId: string): Promise<CoachingSession[]>;
  updateCoachingSession(id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined>;

  // A/B model test operations
  createABTest(test: InsertABTest): Promise<ABTest>;
  getABTest(id: string): Promise<ABTest | undefined>;
  getAllABTests(): Promise<ABTest[]>;
  updateABTest(id: string, updates: Partial<ABTest>): Promise<ABTest | undefined>;
  deleteABTest(id: string): Promise<void>;

  // Usage tracking
  createUsageRecord(record: UsageRecord): Promise<void>;
  getAllUsageRecords(): Promise<UsageRecord[]>;

  // Data retention
  purgeExpiredCalls(retentionDays: number): Promise<number>;

  // Gamification
  createBadge(badge: InsertBadge): Promise<Badge>;
  getBadgesByEmployee(employeeId: string): Promise<Badge[]>;
  hasBadge(employeeId: string, badgeType: string): Promise<boolean>;
  getAllBadges(): Promise<Badge[]>;

  // Object storage access (for batch inference, webhooks, admin operations)
  // Returns the underlying S3 client, or undefined if not configured.
  getObjectStorageClient(): ObjectStorageClient | undefined;
}

/**
 * In-memory storage fallback for when cloud credentials are not configured.
 * Data lives only for the lifetime of the process.
 */
export class MemStorage implements IStorage {
  private employees = new Map<string, Employee>();
  private calls = new Map<string, Call>();
  private transcripts = new Map<string, Transcript>();
  private sentiments = new Map<string, SentimentAnalysis>();
  private analyses = new Map<string, CallAnalysis>();
  private badges = new Map<string, Badge>();
  private audioFiles = new Map<string, Buffer>(); // objectName -> buffer
  private accessRequests = new Map<string, AccessRequest>();
  private promptTemplates = new Map<string, PromptTemplate>();
  private coachingSessions = new Map<string, CoachingSession>();
  private abTests = new Map<string, ABTest>();
  private usageRecords = new Map<string, UsageRecord>();

  async getUser(_id: string): Promise<User | undefined> { return undefined; }
  async getUserByUsername(_username: string): Promise<User | undefined> { return undefined; }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }

  // DB User operations — not supported in memory mode
  async getDbUser(_id: string): Promise<DbUser | undefined> { return undefined; }
  async getDbUserByUsername(_username: string): Promise<DbUser | undefined> { return undefined; }
  async getAllDbUsers(): Promise<DbUser[]> { return []; }
  async createDbUser(_user: { username: string; passwordHash: string; role: string; displayName: string }): Promise<DbUser> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async updateDbUser(_id: string, _updates: { role?: string; displayName?: string; active?: boolean }): Promise<DbUser | undefined> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async getDbUserPasswordHistory(_id: string): Promise<string[]> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async updateDbUserPassword(_id: string, _passwordHash: string, _oldPasswordHash?: string): Promise<boolean> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    return this.employees.get(id);
  }
  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    return [...this.employees.values()].find((e) => e.email === email);
  }
  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const newEmployee: Employee = { ...employee, id, createdAt: new Date().toISOString() };
    this.employees.set(id, newEmployee);
    return newEmployee;
  }
  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const employee = this.employees.get(id);
    if (!employee) return undefined;
    const updated = { ...employee, ...updates };
    this.employees.set(id, updated);
    return updated;
  }
  async getAllEmployees(): Promise<Employee[]> {
    return [...this.employees.values()];
  }
  async getEmployeesPaginated(options: { limit: number; offset: number; status?: "Active" | "Inactive" }): Promise<{ employees: Employee[]; total: number }> {
    let all = [...this.employees.values()];
    if (options.status) all = all.filter(e => e.status === options.status);
    const total = all.length;
    const employees = all.slice(options.offset, options.offset + options.limit);
    return { employees, total };
  }
  async findEmployeeByName(name: string): Promise<Employee | undefined> {
    const normalized = name.toLowerCase().trim();
    const all = [...this.employees.values()];
    const exact = all.find(e => e.name.toLowerCase() === normalized);
    if (exact) return exact;
    const firstNameMatches = all.filter(e => e.name.toLowerCase().split(" ")[0] === normalized);
    return firstNameMatches.length === 1 ? firstNameMatches[0] : undefined;
  }

  async getCall(id: string): Promise<Call | undefined> {
    return this.calls.get(id);
  }
  async createCall(call: InsertCall): Promise<Call> {
    // F20: enforce content_hash uniqueness in MemStorage to mirror the
    // PostgresStorage UNIQUE INDEX (idx_calls_content_hash_unique). The
    // route handler in routes/calls.ts catches pg error code 23505 — match
    // that shape so dev parity holds.
    if (call.contentHash) {
      for (const existing of this.calls.values()) {
        if (existing.contentHash === call.contentHash) {
          const err = new Error(
            `duplicate key value violates unique constraint "idx_calls_content_hash_unique"`,
          ) as Error & { code?: string };
          err.code = "23505";
          throw err;
        }
      }
    }
    const id = randomUUID();
    const newCall: Call = { ...call, id, uploadedAt: new Date().toISOString() };
    this.calls.set(id, newCall);
    return newCall;
  }
  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    if (Object.prototype.hasOwnProperty.call(updates, "employeeId")) {
      throw new Error(
        "updateCall: employeeId cannot be modified via updateCall — use atomicAssignEmployee or setCallEmployee",
      );
    }
    const call = this.calls.get(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    this.calls.set(id, updated);
    return updated;
  }
  async atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean> {
    const call = this.calls.get(callId);
    if (!call || call.employeeId) return false;
    call.employeeId = employeeId;
    this.calls.set(callId, call);
    return true;
  }
  async setCallEmployee(callId: string, employeeId: string | null): Promise<Call | undefined> {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    const updated = { ...call, employeeId: employeeId ?? undefined };
    this.calls.set(callId, updated);
    return updated;
  }
  async deleteCall(id: string): Promise<void> {
    this.calls.delete(id);
    this.transcripts.delete(id);
    this.sentiments.delete(id);
    this.analyses.delete(id);
    // Delete audio files for this call
    for (const key of this.audioFiles.keys()) {
      if (key.startsWith(`audio/${id}/`)) this.audioFiles.delete(key);
    }
  }
  async getAllCalls(): Promise<Call[]> {
    return [...this.calls.values()].sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );
  }
  async getCallsByStatus(status: string): Promise<Call[]> {
    return [...this.calls.values()].filter(c => c.status === status);
  }
  async getCallsSince(since: Date): Promise<Call[]> {
    const sinceMs = since.getTime();
    return [...this.calls.values()].filter(c => new Date(c.uploadedAt || 0).getTime() >= sinceMs);
  }
  async findCallByContentHash(contentHash: string): Promise<Call | undefined> {
    for (const c of this.calls.values()) {
      if (c.contentHash === contentHash) return c;
    }
    return undefined;
  }
  async findCallByExternalId(externalId: string): Promise<Call | undefined> {
    for (const c of this.calls.values()) {
      if ((c as any).externalId === externalId) return c;
    }
    return undefined;
  }
  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    let calls = await this.getAllCalls();

    // Pre-filter on call-level fields BEFORE loading details (avoids unnecessary joins)
    if (filters.status) calls = calls.filter((c) => c.status === filters.status);
    if (filters.employee) calls = calls.filter((c) => c.employeeId === filters.employee);

    let results: CallWithDetails[] = await Promise.all(
      calls.map(async (call) => {
        const [employee, transcript, sentiment, analysis] = await Promise.all([
          call.employeeId ? this.getEmployee(call.employeeId) : Promise.resolve(undefined),
          this.getTranscript(call.id),
          this.getSentimentAnalysis(call.id),
          this.getCallAnalysis(call.id),
        ]);
        return { ...call, employee, transcript, sentiment, analysis } as CallWithDetails;
      })
    );

    // Sentiment filter requires the joined data (can't pre-filter)
    if (filters.sentiment) results = results.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    return results;
  }

  // ── A4/F03/F13/F15: hot-path helpers ───────────────────────
  async countCompletedCallsByEmployee(employeeId: string): Promise<number> {
    let count = 0;
    for (const call of this.calls.values()) {
      if (call.employeeId === employeeId && call.status === "completed") count++;
    }
    return count;
  }

  async getRecentCallsForBadgeEval(employeeId: string, limit: number): Promise<CallWithDetails[]> {
    const calls = [...this.calls.values()]
      .filter(c => c.employeeId === employeeId && c.status === "completed")
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
      .slice(0, Math.max(1, Math.min(limit, 200)));
    return Promise.all(calls.map(async (call) => {
      const analysis = this.analyses.get(call.id);
      return { ...call, employee: undefined, transcript: undefined, sentiment: undefined, analysis } as CallWithDetails;
    }));
  }

  async getLeaderboardData(options: { since?: Date }): Promise<LeaderboardRow[]> {
    const sinceMs = options.since ? options.since.getTime() : 0;
    const byEmployee = new Map<string, LeaderboardRow>();
    const sortedCalls = [...this.calls.values()]
      .filter(c => c.status === "completed" && c.employeeId)
      .filter(c => new Date(c.uploadedAt || 0).getTime() >= sinceMs)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
    for (const call of sortedCalls) {
      const empId = call.employeeId!;
      const analysis = this.analyses.get(call.id);
      if (!analysis?.performanceScore) continue;
      const score = parseFloat(analysis.performanceScore);
      if (!Number.isFinite(score)) continue;
      let row = byEmployee.get(empId);
      if (!row) {
        const emp = this.employees.get(empId);
        if (!emp) continue;
        row = {
          employeeId: empId,
          employeeName: emp.name,
          subTeam: emp.subTeam,
          totalCalls: 0,
          scoreSum: 0,
          scoreCount: 0,
          recentScores: [],
        };
        byEmployee.set(empId, row);
      }
      row.totalCalls++;
      row.scoreSum += score;
      row.scoreCount++;
      if (row.recentScores.length < 50) row.recentScores.push(score);
    }
    return Array.from(byEmployee.values());
  }

  async getCallsSinceWithDetails(since: Date, employeeId?: string): Promise<CallWithDetails[]> {
    const sinceMs = since.getTime();
    const calls = [...this.calls.values()]
      .filter(c => new Date(c.uploadedAt || 0).getTime() >= sinceMs)
      .filter(c => !employeeId || c.employeeId === employeeId);
    return Promise.all(calls.map(async (call) => {
      const [employee, transcript, sentiment, analysis] = await Promise.all([
        call.employeeId ? this.getEmployee(call.employeeId) : Promise.resolve(undefined),
        this.getTranscript(call.id),
        this.getSentimentAnalysis(call.id),
        this.getCallAnalysis(call.id),
      ]);
      return { ...call, employee, transcript, sentiment, analysis } as CallWithDetails;
    }));
  }

  async getCallsPaginated(options: {
    filters?: { status?: string; sentiment?: string; employee?: string };
    cursor?: string;
    limit?: number;
  }): Promise<{ calls: CallWithDetails[]; nextCursor: string | null; total: number }> {
    let all = await this.getCallsWithDetails(options.filters);
    // Sort by uploadedAt DESC, then id DESC for stability
    all.sort((a, b) => {
      const dateA = new Date(a.uploadedAt || 0).getTime();
      const dateB = new Date(b.uploadedAt || 0).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return (b.id > a.id ? 1 : -1);
    });
    const total = all.length;
    // Apply cursor filter
    if (options.cursor) {
      const [cursorDate, cursorId] = options.cursor.split("|");
      const cursorTime = new Date(cursorDate).getTime();
      all = all.filter(c => {
        const t = new Date(c.uploadedAt || 0).getTime();
        return t < cursorTime || (t === cursorTime && c.id < cursorId);
      });
    }
    const limit = options.limit || 25;
    const page = all.slice(0, limit);
    const nextCursor = page.length === limit && all.length > limit
      ? `${page[limit - 1].uploadedAt}|${page[limit - 1].id}`
      : null;
    return { calls: page, nextCursor, total };
  }

  async getTranscript(callId: string): Promise<Transcript | undefined> {
    return this.transcripts.get(callId);
  }
  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const newTranscript: Transcript = { ...transcript, id, createdAt: new Date().toISOString() };
    this.transcripts.set(transcript.callId, newTranscript);
    return newTranscript;
  }

  async getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined> {
    return this.sentiments.get(callId);
  }
  async createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const newSentiment: SentimentAnalysis = { ...sentiment, id, createdAt: new Date().toISOString() };
    this.sentiments.set(sentiment.callId, newSentiment);
    return newSentiment;
  }

  async getCallAnalysis(callId: string): Promise<CallAnalysis | undefined> {
    return this.analyses.get(callId);
  }
  async getCallAnalysesBulk(callIds: string[]): Promise<Map<string, CallAnalysis>> {
    const result = new Map<string, CallAnalysis>();
    for (const id of callIds) {
      const analysis = this.analyses.get(id);
      if (analysis) result.set(id, analysis);
    }
    return result;
  }
  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = { ...analysis, id, createdAt: new Date().toISOString() };
    this.analyses.set(analysis.callId, newAnalysis);
    return newAnalysis;
  }

  async updateCallAnalysis(callId: string, updates: UpdateCallAnalysisInput): Promise<void> {
    const existing = this.analyses.get(callId);
    if (existing) this.analyses.set(callId, { ...existing, ...updates } as CallAnalysis);
  }

  async uploadAudio(callId: string, fileName: string, buffer: Buffer, _contentType: string): Promise<void> {
    this.audioFiles.set(`audio/${callId}/${fileName}`, buffer);
  }
  async getAudioFiles(callId: string): Promise<string[]> {
    return [...this.audioFiles.keys()].filter((k) => k.startsWith(`audio/${callId}/`));
  }
  async downloadAudio(objectName: string): Promise<Buffer | undefined> {
    return this.audioFiles.get(objectName);
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const totalCalls = this.calls.size;
    const sentiments = [...this.sentiments.values()];
    const analyses = [...this.analyses.values()];
    const avgSentiment = sentiments.length > 0
      ? (sentiments.reduce((sum, s) => sum + safeFloat(s.overallScore), 0) / sentiments.length) * 10
      : 0;
    const avgPerformanceScore = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + safeFloat(a.performanceScore), 0) / analyses.length
      : 0;
    return {
      totalCalls,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(): Promise<SentimentDistribution> {
    const distribution: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const s of this.sentiments.values()) {
      const key = s.overallSentiment as keyof SentimentDistribution;
      if (key in distribution) distribution[key]++;
    }
    return distribution;
  }

  async getTopPerformers(limit = 3): Promise<PerformerSummary[]> {
    const calls = [...this.calls.values()];
    const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
    for (const call of calls) {
      if (!call.employeeId) continue;
      const analysis = this.analyses.get(call.id);
      const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
      stats.callCount++;
      if (analysis?.performanceScore) stats.totalScore += safeFloat(analysis.performanceScore);
      employeeStats.set(call.employeeId, stats);
    }
    return [...this.employees.values()]
      .map((emp) => {
        const stats = employeeStats.get(emp.id) || { totalScore: 0, callCount: 0 };
        return {
          id: emp.id, name: emp.name, role: emp.role,
          avgPerformanceScore: stats.callCount > 0 ? Math.round((stats.totalScore / stats.callCount) * 100) / 100 : null,
          totalCalls: stats.callCount,
        };
      })
      .filter((p) => p.totalCalls > 0)
      .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0))
      .slice(0, limit);
  }

  async getFilteredReportMetrics(filters: {
    from?: string; to?: string; employeeId?: string; role?: string; callPartyType?: string;
  }): Promise<FilteredReportResult> {
    let calls = [...this.calls.values()].filter(c => c.status === "completed");
    if (filters.from) { const d = new Date(filters.from).getTime(); calls = calls.filter(c => new Date(c.uploadedAt || 0).getTime() >= d); }
    if (filters.to) { const d = new Date(filters.to).getTime(); calls = calls.filter(c => new Date(c.uploadedAt || 0).getTime() <= d); }
    if (filters.employeeId) calls = calls.filter(c => c.employeeId === filters.employeeId);
    if (filters.role) {
      const empsByRole = new Set([...this.employees.values()].filter(e => e.role === filters.role).map(e => e.id));
      calls = calls.filter(c => c.employeeId && empsByRole.has(c.employeeId));
    }
    if (filters.callPartyType) calls = calls.filter(c => this.analyses.get(c.id)?.callPartyType === filters.callPartyType);

    let totalScore = 0, scoredCount = 0, sentTotal = 0, sentCount = 0;
    const sentDist = { positive: 0, neutral: 0, negative: 0 };
    let autoAssigned = 0;
    const empStats = new Map<string, { total: number; count: number }>();
    const trendMap = new Map<string, { calls: number; total: number; scored: number; positive: number; neutral: number; negative: number }>();
    const subTotals = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0, count: 0 };

    for (const c of calls) {
      const a = this.analyses.get(c.id);
      const s = this.sentiments.get(c.id);
      if (a?.performanceScore) { totalScore += safeFloat(a.performanceScore); scoredCount++; }
      if (s?.overallScore) { sentTotal += safeFloat(s.overallScore); sentCount++; }
      const sent = s?.overallSentiment as keyof typeof sentDist;
      if (sent && sent in sentDist) sentDist[sent]++;
      if (a?.detectedAgentName) autoAssigned++;
      if (c.employeeId) {
        const st = empStats.get(c.employeeId) || { total: 0, count: 0 };
        st.count++; if (a?.performanceScore) st.total += safeFloat(a.performanceScore);
        empStats.set(c.employeeId, st);
      }
      const d = new Date(c.uploadedAt || 0);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const te = trendMap.get(mk) || { calls: 0, total: 0, scored: 0, positive: 0, neutral: 0, negative: 0 };
      te.calls++; if (a?.performanceScore) { te.total += safeFloat(a.performanceScore); te.scored++; }
      if (sent === "positive") te.positive++; else if (sent === "neutral") te.neutral++; else if (sent === "negative") te.negative++;
      trendMap.set(mk, te);
      const ss = a?.subScores as any;
      if (ss && (ss.compliance || ss.customerExperience || ss.communication || ss.resolution)) {
        subTotals.compliance += ss.compliance || 0; subTotals.customerExperience += ss.customerExperience || 0;
        subTotals.communication += ss.communication || 0; subTotals.resolution += ss.resolution || 0; subTotals.count++;
      }
    }
    return {
      metrics: {
        totalCalls: calls.length,
        avgSentiment: sentCount > 0 ? Math.round(sentTotal / sentCount * 10 * 100) / 100 : 0,
        avgPerformanceScore: scoredCount > 0 ? Math.round(totalScore / scoredCount * 100) / 100 : 0,
      },
      sentiment: sentDist,
      performers: [...empStats.entries()].map(([id, st]) => {
        const emp = this.employees.get(id);
        return { id, name: emp?.name || "Unknown", role: emp?.role || "", avgPerformanceScore: st.count > 0 ? Math.round(st.total / st.count * 100) / 100 : null, totalCalls: st.count };
      }).filter(p => p.totalCalls > 0).sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0)),
      trends: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => ({
        month, calls: d.calls, avgScore: d.scored > 0 ? Math.round(d.total / d.scored * 100) / 100 : null,
        positive: d.positive, neutral: d.neutral, negative: d.negative,
      })),
      avgSubScores: subTotals.count > 0 ? {
        compliance: Math.round(subTotals.compliance / subTotals.count * 100) / 100,
        customerExperience: Math.round(subTotals.customerExperience / subTotals.count * 100) / 100,
        communication: Math.round(subTotals.communication / subTotals.count * 100) / 100,
        resolution: Math.round(subTotals.resolution / subTotals.count * 100) / 100,
      } : null,
      autoAssignedCount: autoAssigned,
    };
  }

  async getInsightsData(since: Date): Promise<InsightsCallData[]> {
    const sinceMs = since.getTime();
    const result: InsightsCallData[] = [];
    for (const c of this.calls.values()) {
      if (c.status !== "completed") continue;
      if (new Date(c.uploadedAt || 0).getTime() < sinceMs) continue;
      const a = this.analyses.get(c.id);
      if (!a) continue;
      const s = this.sentiments.get(c.id);
      const emp = c.employeeId ? this.employees.get(c.employeeId) : undefined;
      result.push({
        id: c.id, status: c.status, uploadedAt: c.uploadedAt || null,
        employeeName: emp?.name || null, sentiment: s?.overallSentiment || null,
        performanceScore: a.performanceScore || null, confidenceScore: a.confidenceScore || null,
        summary: a.summary || null, topics: Array.isArray(a.topics) ? a.topics as string[] : [],
        detectedAgentName: a.detectedAgentName || null,
      });
    }
    return result;
  }

  async searchCalls(query: string, limit = 50): Promise<CallWithDetails[]> {
    const allCalls = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();
    const results: CallWithDetails[] = [];
    for (const call of allCalls) {
      if (call.transcript?.text?.toLowerCase().includes(lowerQuery)) {
        results.push(call);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // Access request operations
  async createAccessRequest(request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const newReq: AccessRequest = { ...request, id, status: "pending", createdAt: new Date().toISOString() };
    this.accessRequests.set(id, newReq);
    return newReq;
  }
  async getAllAccessRequests(): Promise<AccessRequest[]> {
    return Array.from(this.accessRequests.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }
  async getAccessRequest(id: string): Promise<AccessRequest | undefined> {
    return this.accessRequests.get(id);
  }
  async updateAccessRequest(id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const req = this.accessRequests.get(id);
    if (!req) return undefined;
    const updated = { ...req, ...updates };
    this.accessRequests.set(id, updated);
    return updated;
  }

  // Prompt template operations
  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    return this.promptTemplates.get(id);
  }
  async getPromptTemplateByCategory(callCategory: string): Promise<PromptTemplate | undefined> {
    return Array.from(this.promptTemplates.values()).find(t => t.callCategory === callCategory && t.isActive);
  }
  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    return Array.from(this.promptTemplates.values());
  }
  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const newTemplate: PromptTemplate = { ...template, id, updatedAt: new Date().toISOString() };
    this.promptTemplates.set(id, newTemplate);
    return newTemplate;
  }
  async updatePromptTemplate(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const tmpl = this.promptTemplates.get(id);
    if (!tmpl) return undefined;
    const updated = { ...tmpl, ...updates, updatedAt: new Date().toISOString() };
    this.promptTemplates.set(id, updated);
    return updated;
  }
  async deletePromptTemplate(id: string): Promise<void> {
    this.promptTemplates.delete(id);
  }

  // Coaching session operations
  async createCoachingSession(session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const newSession: CoachingSession = { ...session, id, createdAt: new Date().toISOString() };
    this.coachingSessions.set(id, newSession);
    return newSession;
  }
  async getCoachingSession(id: string): Promise<CoachingSession | undefined> {
    return this.coachingSessions.get(id);
  }
  async getAllCoachingSessions(): Promise<CoachingSession[]> {
    return Array.from(this.coachingSessions.values());
  }
  async getCoachingSessionsByEmployee(employeeId: string): Promise<CoachingSession[]> {
    return Array.from(this.coachingSessions.values()).filter(s => s.employeeId === employeeId);
  }
  async updateCoachingSession(id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const session = this.coachingSessions.get(id);
    if (!session) return undefined;
    const updated = { ...session, ...updates };
    this.coachingSessions.set(id, updated);
    return updated;
  }

  // A/B test operations
  async createABTest(test: InsertABTest): Promise<ABTest> {
    const id = randomUUID();
    const newTest: ABTest = { ...test, id, createdAt: new Date().toISOString() };
    this.abTests.set(id, newTest);
    return newTest;
  }
  async getABTest(id: string): Promise<ABTest | undefined> {
    return this.abTests.get(id);
  }
  async getAllABTests(): Promise<ABTest[]> {
    return Array.from(this.abTests.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }
  async updateABTest(id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
    const test = this.abTests.get(id);
    if (!test) return undefined;
    const updated = { ...test, ...updates };
    this.abTests.set(id, updated);
    return updated;
  }
  async deleteABTest(id: string): Promise<void> {
    this.abTests.delete(id);
  }

  // Usage tracking
  async createUsageRecord(record: UsageRecord): Promise<void> {
    this.usageRecords.set(record.id, record);
  }
  async getAllUsageRecords(): Promise<UsageRecord[]> {
    return Array.from(this.usageRecords.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async purgeExpiredCalls(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    let purged = 0;
    // Snapshot values before iteration — deleteCall mutates this.calls.
    const snapshot = [...this.calls.values()];
    for (const call of snapshot) {
      if (new Date(call.uploadedAt || 0) < cutoff) {
        await this.deleteCall(call.id);
        purged++;
      }
    }
    return purged;
  }

  // Gamification
  async createBadge(badge: InsertBadge): Promise<Badge> {
    const id = randomUUID();
    const newBadge: Badge = { id, ...badge };
    this.badges.set(id, newBadge);
    return newBadge;
  }
  async getBadgesByEmployee(employeeId: string): Promise<Badge[]> {
    return Array.from(this.badges.values()).filter(b => b.employeeId === employeeId);
  }
  async hasBadge(employeeId: string, badgeType: string): Promise<boolean> {
    return Array.from(this.badges.values()).some(b => b.employeeId === employeeId && b.badgeType === badgeType);
  }
  async getAllBadges(): Promise<Badge[]> {
    return Array.from(this.badges.values());
  }

  getObjectStorageClient(): ObjectStorageClient | undefined {
    return undefined; // MemStorage has no S3 client
  }
}

export class CloudStorage implements IStorage {
  private client: ObjectStorageClient;

  constructor(client: ObjectStorageClient) {
    this.client = client;
  }

  // --- User Methods (env-var-based, users are managed in auth.ts) ---
  async getUser(_id: string): Promise<User | undefined> {
    return undefined; // Users come from env vars
  }
  async getUserByUsername(_username: string): Promise<User | undefined> {
    return undefined; // Users come from env vars
  }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }

  // --- DB User Methods (not supported in S3-only mode) ---
  async getDbUser(_id: string): Promise<DbUser | undefined> { return undefined; }
  async getDbUserByUsername(_username: string): Promise<DbUser | undefined> { return undefined; }
  async getAllDbUsers(): Promise<DbUser[]> { return []; }
  async createDbUser(_user: { username: string; passwordHash: string; role: string; displayName: string }): Promise<DbUser> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async updateDbUser(_id: string, _updates: { role?: string; displayName?: string; active?: boolean }): Promise<DbUser | undefined> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async getDbUserPasswordHistory(_id: string): Promise<string[]> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }
  async updateDbUserPassword(_id: string, _passwordHash: string, _oldPasswordHash?: string): Promise<boolean> {
    throw new Error("DB user management requires PostgreSQL (DATABASE_URL)");
  }

  // --- Employee Methods ---
  async getEmployee(id: string): Promise<Employee | undefined> {
    return this.client.downloadJson<Employee>(`employees/${id}.json`);
  }

  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    const employees = await this.getAllEmployees();
    return employees.find((e) => e.email === email);
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const newEmployee: Employee = {
      ...employee,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`employees/${id}.json`, newEmployee);
    return newEmployee;
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const employee = await this.getEmployee(id);
    if (!employee) return undefined;
    const updated = { ...employee, ...updates };
    await this.client.uploadJson(`employees/${id}.json`, updated);
    return updated;
  }

  async getAllEmployees(): Promise<Employee[]> {
    try {
      return await this.client.listAndDownloadJson<Employee>("employees/");
    } catch (error) {
      console.error("Error fetching employees:", error);
      return [];
    }
  }
  async getEmployeesPaginated(options: { limit: number; offset: number; status?: "Active" | "Inactive" }): Promise<{ employees: Employee[]; total: number }> {
    let all = await this.getAllEmployees();
    if (options.status) all = all.filter(e => e.status === options.status);
    const total = all.length;
    const employees = all.slice(options.offset, options.offset + options.limit);
    return { employees, total };
  }
  async findEmployeeByName(name: string): Promise<Employee | undefined> {
    const normalized = name.toLowerCase().trim();
    const all = await this.getAllEmployees();
    const exact = all.find(e => e.name.toLowerCase() === normalized);
    if (exact) return exact;
    const firstNameMatches = all.filter(e => e.name.toLowerCase().split(" ")[0] === normalized);
    return firstNameMatches.length === 1 ? firstNameMatches[0] : undefined;
  }

  // --- Call Methods ---
  async getCall(id: string): Promise<Call | undefined> {
    return this.client.downloadJson<Call>(`calls/${id}.json`);
  }

  async createCall(call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const newCall: Call = {
      ...call,
      id,
      uploadedAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`calls/${id}.json`, newCall);
    return newCall;
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    if (Object.prototype.hasOwnProperty.call(updates, "employeeId")) {
      throw new Error(
        "updateCall: employeeId cannot be modified via updateCall — use atomicAssignEmployee or setCallEmployee",
      );
    }
    const call = await this.getCall(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    await this.client.uploadJson(`calls/${id}.json`, updated);
    return updated;
  }
  async atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean> {
    // S3 has no atomic conditional update, so do read-check-write (best effort)
    const call = await this.getCall(callId);
    if (!call || call.employeeId) return false;
    await this.client.uploadJson(`calls/${callId}.json`, { ...call, employeeId });
    return true;
  }
  async setCallEmployee(callId: string, employeeId: string | null): Promise<Call | undefined> {
    const call = await this.getCall(callId);
    if (!call) return undefined;
    const updated = { ...call, employeeId: employeeId ?? undefined };
    await this.client.uploadJson(`calls/${callId}.json`, updated);
    return updated;
  }

  async deleteCall(id: string): Promise<void> {
    await Promise.all([
      this.client.deleteObject(`calls/${id}.json`),
      this.client.deleteObject(`transcripts/${id}.json`),
      this.client.deleteObject(`sentiments/${id}.json`),
      this.client.deleteObject(`analyses/${id}.json`),
      this.client.deleteByPrefix(`audio/${id}/`),
    ]);
  }

  async getAllCalls(): Promise<Call[]> {
    const calls = await this.client.listAndDownloadJson<Call>("calls/");
    return calls.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );
  }
  async getCallsByStatus(status: string): Promise<Call[]> {
    // A7/F14: no secondary index in S3-only backend — O(n) is unavoidable here.
    const all = await this.getAllCalls();
    return all.filter(c => c.status === status);
  }
  async getCallsSince(since: Date): Promise<Call[]> {
    const all = await this.getAllCalls();
    const sinceMs = since.getTime();
    return all.filter(c => new Date(c.uploadedAt || 0).getTime() >= sinceMs);
  }
  async findCallByContentHash(contentHash: string): Promise<Call | undefined> {
    // O(n) in S3-only mode — acceptable fallback when no DB is configured.
    const all = await this.getAllCalls();
    return all.find(c => c.contentHash === contentHash);
  }
  async findCallByExternalId(externalId: string): Promise<Call | undefined> {
    // O(n) in S3-only mode — see note above. Indexed in PostgresStorage.
    const all = await this.getAllCalls();
    return all.find(c => (c as any).externalId === externalId);
  }

  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    // Batch load all data in parallel to avoid N+1 queries
    const [calls, allEmployees, allTranscripts, allSentiments, allAnalyses] = await Promise.all([
      this.getAllCalls(),
      this.client.listAndDownloadJson<Employee>("employees/"),
      this.client.listAndDownloadJson<Transcript>("transcripts/"),
      this.client.listAndDownloadJson<SentimentAnalysis>("sentiments/"),
      this.client.listAndDownloadJson<CallAnalysis>("analyses/"),
    ]);

    // Build lookup maps for O(1) access
    const employeeMap = new Map(allEmployees.map(e => [e.id, e]));
    const transcriptMap = new Map(allTranscripts.map(t => [t.callId, t]));
    const sentimentMap = new Map(allSentiments.map(s => [s.callId, s]));
    const analysisMap = new Map(allAnalyses.map(a => [a.callId, a]));

    const results: CallWithDetails[] = calls.map(call => {
      const analysis = analysisMap.get(call.id);
      const normalizedAnalysis = analysis ? {
        ...analysis,
        topics: Array.isArray(analysis.topics) ? analysis.topics : [],
        actionItems: Array.isArray(analysis.actionItems) ? analysis.actionItems : [],
        flags: Array.isArray(analysis.flags) ? analysis.flags : [],
        feedback: (analysis.feedback && typeof analysis.feedback === "object" && !Array.isArray(analysis.feedback))
          ? analysis.feedback
          : { strengths: [], suggestions: [] },
        summary: typeof analysis.summary === "string" ? analysis.summary : "",
      } : undefined;

      return {
        ...call,
        employee: call.employeeId ? employeeMap.get(call.employeeId) : undefined,
        transcript: transcriptMap.get(call.id),
        sentiment: sentimentMap.get(call.id),
        analysis: normalizedAnalysis,
      };
    });

    // Sort by upload date descending
    results.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );

    // Apply filters
    let filtered = results;
    if (filters.status) {
      filtered = filtered.filter((c) => c.status === filters.status);
    }
    if (filters.sentiment) {
      filtered = filtered.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    }
    if (filters.employee) {
      filtered = filtered.filter((c) => c.employeeId === filters.employee);
    }

    return filtered;
  }

  // ── A4/F03/F13/F15: hot-path helpers (CloudStorage) ─────
  // Note: S3-only backend has no secondary indexes, so all of these are
  // O(N) over the call set. Acceptable because CloudStorage is the
  // legacy/dev fallback — production runs PostgresStorage.
  async countCompletedCallsByEmployee(employeeId: string): Promise<number> {
    const calls = await this.getCallsWithDetails({ employee: employeeId, status: "completed" });
    return calls.length;
  }

  async getRecentCallsForBadgeEval(employeeId: string, limit: number): Promise<CallWithDetails[]> {
    const calls = await this.getCallsWithDetails({ employee: employeeId, status: "completed" });
    return calls.slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async getLeaderboardData(options: { since?: Date }): Promise<LeaderboardRow[]> {
    const sinceMs = options.since ? options.since.getTime() : 0;
    const all = await this.getCallsWithDetails({ status: "completed" });
    const byEmployee = new Map<string, LeaderboardRow>();
    const sorted = all
      .filter(c => c.employee && new Date(c.uploadedAt || 0).getTime() >= sinceMs)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
    for (const call of sorted) {
      const empId = call.employeeId!;
      const score = call.analysis?.performanceScore ? parseFloat(call.analysis.performanceScore) : NaN;
      if (!Number.isFinite(score)) continue;
      let row = byEmployee.get(empId);
      if (!row) {
        row = {
          employeeId: empId,
          employeeName: call.employee!.name,
          subTeam: call.employee!.subTeam,
          totalCalls: 0,
          scoreSum: 0,
          scoreCount: 0,
          recentScores: [],
        };
        byEmployee.set(empId, row);
      }
      row.totalCalls++;
      row.scoreSum += score;
      row.scoreCount++;
      if (row.recentScores.length < 50) row.recentScores.push(score);
    }
    return Array.from(byEmployee.values());
  }

  async getCallsSinceWithDetails(since: Date, employeeId?: string): Promise<CallWithDetails[]> {
    const filters: { status?: string; employee?: string } = {};
    if (employeeId) filters.employee = employeeId;
    const all = await this.getCallsWithDetails(filters);
    const sinceMs = since.getTime();
    return all.filter(c => new Date(c.uploadedAt || 0).getTime() >= sinceMs);
  }

  async getCallsPaginated(options: {
    filters?: { status?: string; sentiment?: string; employee?: string };
    cursor?: string;
    limit?: number;
  }): Promise<{ calls: CallWithDetails[]; nextCursor: string | null; total: number }> {
    let all = await this.getCallsWithDetails(options.filters);
    // Already sorted DESC by getCallsWithDetails
    const total = all.length;
    if (options.cursor) {
      const [cursorDate, cursorId] = options.cursor.split("|");
      const cursorTime = new Date(cursorDate).getTime();
      all = all.filter(c => {
        const t = new Date(c.uploadedAt || 0).getTime();
        return t < cursorTime || (t === cursorTime && c.id < cursorId);
      });
    }
    const limit = options.limit || 25;
    const page = all.slice(0, limit);
    const nextCursor = page.length === limit && all.length > limit
      ? `${page[limit - 1].uploadedAt}|${page[limit - 1].id}`
      : null;
    return { calls: page, nextCursor, total };
  }

  // --- Transcript Methods ---
  async getTranscript(callId: string): Promise<Transcript | undefined> {
    return this.client.downloadJson<Transcript>(`transcripts/${callId}.json`);
  }

  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const newTranscript: Transcript = {
      ...transcript,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`transcripts/${transcript.callId}.json`, newTranscript);
    return newTranscript;
  }

  // --- Sentiment Analysis Methods ---
  async getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined> {
    return this.client.downloadJson<SentimentAnalysis>(`sentiments/${callId}.json`);
  }

  async createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const newSentiment: SentimentAnalysis = {
      ...sentiment,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`sentiments/${sentiment.callId}.json`, newSentiment);
    return newSentiment;
  }

  // --- Call Analysis Methods ---
  async getCallAnalysis(callId: string): Promise<CallAnalysis | undefined> {
    return this.client.downloadJson<CallAnalysis>(`analyses/${callId}.json`);
  }
  async getCallAnalysesBulk(callIds: string[]): Promise<Map<string, CallAnalysis>> {
    const result = new Map<string, CallAnalysis>();
    const downloads = await Promise.allSettled(
      callIds.map(async (id) => {
        const analysis = await this.client.downloadJson<CallAnalysis>(`analyses/${id}.json`);
        if (analysis) result.set(id, analysis);
      })
    );
    // Silently skip failed downloads (same as listAndDownloadJson pattern)
    return result;
  }

  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = {
      ...analysis,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.client.uploadJson(`analyses/${analysis.callId}.json`, newAnalysis);
    return newAnalysis;
  }

  async updateCallAnalysis(callId: string, updates: UpdateCallAnalysisInput): Promise<void> {
    const existing = await this.getCallAnalysis(callId);
    if (existing) {
      await this.client.uploadJson(`analyses/${callId}.json`, { ...existing, ...updates });
    }
  }

  // --- Audio File Methods ---
  async uploadAudio(
    callId: string,
    fileName: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    await this.client.uploadFile(`audio/${callId}/${fileName}`, buffer, contentType);
  }

  async getAudioFiles(callId: string): Promise<string[]> {
    return this.client.listObjects(`audio/${callId}/`);
  }

  async downloadAudio(objectName: string): Promise<Buffer | undefined> {
    return this.client.downloadFile(objectName);
  }

  // --- Dashboard and Reporting Methods ---
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [calls, sentiments, analyses] = await Promise.all([
      this.client.listObjects("calls/"),
      this.client.listAndDownloadJson<SentimentAnalysis>("sentiments/"),
      this.client.listAndDownloadJson<CallAnalysis>("analyses/"),
    ]);

    const totalCalls = calls.length;

    const avgSentiment =
      sentiments.length > 0
        ? (sentiments.reduce((sum, s) => sum + safeFloat(s.overallScore), 0) /
            sentiments.length) *
          10
        : 0;

    const avgPerformanceScore =
      analyses.length > 0
        ? analyses.reduce((sum, a) => sum + safeFloat(a.performanceScore), 0) /
          analyses.length
        : 0;

    return {
      totalCalls,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
      avgTranscriptionTime: 2.3, // Estimated average
    };
  }

  async getSentimentDistribution(): Promise<SentimentDistribution> {
    const sentiments = await this.client.listAndDownloadJson<SentimentAnalysis>("sentiments/");
    const distribution: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };

    for (const s of sentiments) {
      const key = s.overallSentiment as keyof SentimentDistribution;
      if (key in distribution) {
        distribution[key]++;
      }
    }

    return distribution;
  }

  async getTopPerformers(limit = 3): Promise<PerformerSummary[]> {
    const [employees, calls, analyses] = await Promise.all([
      this.getAllEmployees(),
      this.client.listAndDownloadJson<Call>("calls/"),
      this.client.listAndDownloadJson<CallAnalysis>("analyses/"),
    ]);

    // Build a map of callId -> analysis
    const analysisMap = new Map<string, CallAnalysis>();
    for (const a of analyses) {
      analysisMap.set(a.callId, a);
    }

    // Build a map of employeeId -> { totalScore, callCount }
    const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
    for (const call of calls) {
      const analysis = analysisMap.get(call.id);
      if (!call.employeeId) continue;

      const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
      stats.callCount++;
      if (analysis?.performanceScore) {
        stats.totalScore += safeFloat(analysis.performanceScore);
      }
      employeeStats.set(call.employeeId, stats);
    }

    // Build performer list
    const performers = employees
      .map((emp) => {
        const stats = employeeStats.get(emp.id) || { totalScore: 0, callCount: 0 };
        return {
          id: emp.id,
          name: emp.name,
          role: emp.role,
          avgPerformanceScore:
            stats.callCount > 0
              ? Math.round((stats.totalScore / stats.callCount) * 100) / 100
              : null,
          totalCalls: stats.callCount,
        };
      })
      .filter((p) => p.totalCalls > 0)
      .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0))
      .slice(0, limit);

    return performers;
  }

  async getFilteredReportMetrics(filters: {
    from?: string; to?: string; employeeId?: string; role?: string; callPartyType?: string;
  }): Promise<FilteredReportResult> {
    // CloudStorage is deprecated (s3-legacy, dev only). Load and filter in JS.
    const allCalls = await this.getCallsWithDetails({ status: "completed" });
    const employees = await this.getAllEmployees();
    const employeeMap = new Map(employees.map(e => [e.id, e]));
    let filtered = allCalls;
    if (filters.from) { const d = new Date(filters.from).getTime(); filtered = filtered.filter(c => new Date(c.uploadedAt || 0).getTime() >= d); }
    if (filters.to) { const d = new Date(filters.to).getTime(); filtered = filtered.filter(c => new Date(c.uploadedAt || 0).getTime() <= d); }
    if (filters.employeeId) filtered = filtered.filter(c => c.employeeId === filters.employeeId);
    if (filters.role) filtered = filtered.filter(c => c.employeeId && employeeMap.get(c.employeeId)?.role === filters.role);
    if (filters.callPartyType) filtered = filtered.filter(c => c.analysis?.callPartyType === filters.callPartyType);

    let totalScore = 0, scoredCount = 0, sentTotal = 0, sentCount = 0, autoAssigned = 0;
    const sentDist = { positive: 0, neutral: 0, negative: 0 };
    const empStats = new Map<string, { total: number; count: number }>();
    const trendMap = new Map<string, { calls: number; total: number; scored: number; positive: number; neutral: number; negative: number }>();
    const subTotals = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0, count: 0 };
    for (const c of filtered) {
      if (c.analysis?.performanceScore) { totalScore += safeFloat(c.analysis.performanceScore); scoredCount++; }
      if (c.sentiment?.overallScore) { sentTotal += safeFloat(c.sentiment.overallScore); sentCount++; }
      const sent = c.sentiment?.overallSentiment as keyof typeof sentDist;
      if (sent && sent in sentDist) sentDist[sent]++;
      if (c.analysis?.detectedAgentName) autoAssigned++;
      if (c.employeeId) {
        const st = empStats.get(c.employeeId) || { total: 0, count: 0 }; st.count++;
        if (c.analysis?.performanceScore) st.total += safeFloat(c.analysis.performanceScore);
        empStats.set(c.employeeId, st);
      }
      const d = new Date(c.uploadedAt || 0);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const te = trendMap.get(mk) || { calls: 0, total: 0, scored: 0, positive: 0, neutral: 0, negative: 0 };
      te.calls++; if (c.analysis?.performanceScore) { te.total += safeFloat(c.analysis.performanceScore); te.scored++; }
      if (sent === "positive") te.positive++; else if (sent === "neutral") te.neutral++; else if (sent === "negative") te.negative++;
      trendMap.set(mk, te);
      const ss = c.analysis?.subScores as any;
      if (ss && (ss.compliance || ss.customerExperience || ss.communication || ss.resolution)) {
        subTotals.compliance += ss.compliance || 0; subTotals.customerExperience += ss.customerExperience || 0;
        subTotals.communication += ss.communication || 0; subTotals.resolution += ss.resolution || 0; subTotals.count++;
      }
    }
    return {
      metrics: { totalCalls: filtered.length, avgSentiment: sentCount > 0 ? Math.round(sentTotal / sentCount * 10 * 100) / 100 : 0, avgPerformanceScore: scoredCount > 0 ? Math.round(totalScore / scoredCount * 100) / 100 : 0 },
      sentiment: sentDist,
      performers: [...empStats.entries()].map(([id, st]) => { const emp = employeeMap.get(id); return { id, name: emp?.name || "Unknown", role: emp?.role || "", avgPerformanceScore: st.count > 0 ? Math.round(st.total / st.count * 100) / 100 : null, totalCalls: st.count }; }).filter(p => p.totalCalls > 0).sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0)),
      trends: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => ({ month, calls: d.calls, avgScore: d.scored > 0 ? Math.round(d.total / d.scored * 100) / 100 : null, positive: d.positive, neutral: d.neutral, negative: d.negative })),
      avgSubScores: subTotals.count > 0 ? { compliance: Math.round(subTotals.compliance / subTotals.count * 100) / 100, customerExperience: Math.round(subTotals.customerExperience / subTotals.count * 100) / 100, communication: Math.round(subTotals.communication / subTotals.count * 100) / 100, resolution: Math.round(subTotals.resolution / subTotals.count * 100) / 100 } : null,
      autoAssignedCount: autoAssigned,
    };
  }

  async getInsightsData(since: Date): Promise<InsightsCallData[]> {
    // CloudStorage is deprecated. Use getCallsSinceWithDetails and map.
    const allCalls = await this.getCallsSinceWithDetails(since);
    return allCalls.filter(c => c.status === "completed" && c.analysis).map(c => ({
      id: c.id, status: c.status, uploadedAt: c.uploadedAt || null,
      employeeName: c.employee?.name || null, sentiment: c.sentiment?.overallSentiment || null,
      performanceScore: c.analysis?.performanceScore || null, confidenceScore: c.analysis?.confidenceScore || null,
      summary: c.analysis?.summary || null, topics: Array.isArray(c.analysis?.topics) ? c.analysis!.topics as string[] : [],
      detectedAgentName: c.analysis?.detectedAgentName || null,
    }));
  }

  async searchCalls(query: string, limit = 50): Promise<CallWithDetails[]> {
    const allCalls = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();
    const results: CallWithDetails[] = [];
    for (const call of allCalls) {
      if (call.transcript?.text?.toLowerCase().includes(lowerQuery)) {
        results.push(call);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // --- Access Request Methods ---
  async createAccessRequest(request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const newReq: AccessRequest = { ...request, id, status: "pending", createdAt: new Date().toISOString() };
    await this.client.uploadJson(`access-requests/${id}.json`, newReq);
    return newReq;
  }

  async getAllAccessRequests(): Promise<AccessRequest[]> {
    const requests = await this.client.listAndDownloadJson<AccessRequest>("access-requests/");
    return requests.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }

  async getAccessRequest(id: string): Promise<AccessRequest | undefined> {
    return this.client.downloadJson<AccessRequest>(`access-requests/${id}.json`);
  }

  async updateAccessRequest(id: string, updates: Partial<AccessRequest>): Promise<AccessRequest | undefined> {
    const req = await this.getAccessRequest(id);
    if (!req) return undefined;
    const updated = { ...req, ...updates };
    await this.client.uploadJson(`access-requests/${id}.json`, updated);
    return updated;
  }

  // --- Prompt Template Methods ---
  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    return this.client.downloadJson<PromptTemplate>(`prompt-templates/${id}.json`);
  }
  async getPromptTemplateByCategory(callCategory: string): Promise<PromptTemplate | undefined> {
    const all = await this.getAllPromptTemplates();
    return all.find(t => t.callCategory === callCategory && t.isActive);
  }
  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    return this.client.listAndDownloadJson<PromptTemplate>("prompt-templates/");
  }
  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const newTemplate: PromptTemplate = { ...template, id, updatedAt: new Date().toISOString() };
    await this.client.uploadJson(`prompt-templates/${id}.json`, newTemplate);
    return newTemplate;
  }
  async updatePromptTemplate(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | undefined> {
    const tmpl = await this.getPromptTemplate(id);
    if (!tmpl) return undefined;
    const updated = { ...tmpl, ...updates, updatedAt: new Date().toISOString() };
    await this.client.uploadJson(`prompt-templates/${id}.json`, updated);
    return updated;
  }
  async deletePromptTemplate(id: string): Promise<void> {
    await this.client.deleteObject(`prompt-templates/${id}.json`);
  }

  // --- Coaching Session Methods ---
  async createCoachingSession(session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const newSession: CoachingSession = { ...session, id, createdAt: new Date().toISOString() };
    await this.client.uploadJson(`coaching/${id}.json`, newSession);
    return newSession;
  }
  async getCoachingSession(id: string): Promise<CoachingSession | undefined> {
    return this.client.downloadJson<CoachingSession>(`coaching/${id}.json`);
  }
  async getAllCoachingSessions(): Promise<CoachingSession[]> {
    return this.client.listAndDownloadJson<CoachingSession>("coaching/");
  }
  async getCoachingSessionsByEmployee(employeeId: string): Promise<CoachingSession[]> {
    const all = await this.getAllCoachingSessions();
    return all.filter(s => s.employeeId === employeeId);
  }
  async updateCoachingSession(id: string, updates: Partial<CoachingSession>): Promise<CoachingSession | undefined> {
    const session = await this.getCoachingSession(id);
    if (!session) return undefined;
    const updated = { ...session, ...updates };
    await this.client.uploadJson(`coaching/${id}.json`, updated);
    return updated;
  }

  // --- A/B Model Test Methods ---
  async createABTest(test: InsertABTest): Promise<ABTest> {
    const id = randomUUID();
    const newTest: ABTest = { ...test, id, createdAt: new Date().toISOString() };
    await this.client.uploadJson(`ab-tests/${id}.json`, newTest);
    return newTest;
  }
  async getABTest(id: string): Promise<ABTest | undefined> {
    return this.client.downloadJson<ABTest>(`ab-tests/${id}.json`);
  }
  async getAllABTests(): Promise<ABTest[]> {
    const tests = await this.client.listAndDownloadJson<ABTest>("ab-tests/");
    return tests.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }
  async updateABTest(id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
    const test = await this.getABTest(id);
    if (!test) return undefined;
    const updated = { ...test, ...updates };
    await this.client.uploadJson(`ab-tests/${id}.json`, updated);
    return updated;
  }
  async deleteABTest(id: string): Promise<void> {
    await this.client.deleteObject(`ab-tests/${id}.json`);
  }

  // --- Usage Tracking Methods ---
  async createUsageRecord(record: UsageRecord): Promise<void> {
    await this.client.uploadJson(`usage/${record.id}.json`, record);
  }
  async getAllUsageRecords(): Promise<UsageRecord[]> {
    const records = await this.client.listAndDownloadJson<UsageRecord>("usage/");
    return records.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  // --- Data Retention ---
  async purgeExpiredCalls(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const calls = await this.getAllCalls();
    let purged = 0;

    for (const call of calls) {
      const uploadDate = new Date(call.uploadedAt || 0);
      if (uploadDate < cutoff) {
        console.log(`[RETENTION] Purging call ${call.id} (uploaded ${uploadDate.toISOString()}, older than ${retentionDays} days)`);
        await this.deleteCall(call.id);
        purged++;
      }
    }

    return purged;
  }

  // Gamification
  async createBadge(badge: InsertBadge): Promise<Badge> {
    const id = randomUUID();
    const newBadge: Badge = { id, ...badge };
    await this.client.uploadJson(`badges/${id}.json`, newBadge);
    return newBadge;
  }
  async getBadgesByEmployee(employeeId: string): Promise<Badge[]> {
    const all = await this.client.listAndDownloadJson<Badge>("badges/");
    return all.filter(b => b.employeeId === employeeId);
  }
  async hasBadge(employeeId: string, badgeType: string): Promise<boolean> {
    const badges = await this.getBadgesByEmployee(employeeId);
    return badges.some(b => b.badgeType === badgeType);
  }
  async getAllBadges(): Promise<Badge[]> {
    return this.client.listAndDownloadJson<Badge>("badges/");
  }

  getObjectStorageClient(): ObjectStorageClient | undefined {
    return this.client;
  }
}

function createStorage(): IStorage {
  // PostgreSQL + S3 (preferred for production)
  const dbPool = getPool();
  if (dbPool) {
    const bucket = process.env.S3_BUCKET || "ums-call-archive";
    if (process.env.NODE_ENV === "production" && !process.env.S3_BUCKET) {
      throw new Error(
        "[STORAGE] S3_BUCKET must be set in production when DATABASE_URL is configured (audio storage required)",
      );
    }
    // Always construct the audio client when a DB pool exists — audio storage
    // is required for the pipeline. Falls back to default bucket name in dev.
    const audioClient = new S3Client(bucket);
    console.log(`[STORAGE] Using PostgreSQL (metadata) + S3 (audio, bucket: ${bucket})`);
    return new PostgresStorage(dbPool, audioClient);
  }

  const storageBackend = process.env.STORAGE_BACKEND?.toLowerCase();

  // F08/F17: CloudStorage (S3-only JSON blob backend) is deprecated. The
  // gate was renamed to STORAGE_BACKEND=s3-legacy so the old "s3" value
  // can no longer silently activate it. Operators on the old value get a
  // hard startup error rather than a silent fallback to MemStorage (which
  // would lose data on every restart).
  if (storageBackend === "s3") {
    throw new Error(
      "[STORAGE] STORAGE_BACKEND=s3 is no longer supported. CloudStorage is deprecated; " +
      "set DATABASE_URL to use PostgresStorage, or set STORAGE_BACKEND=s3-legacy to opt in " +
      "to the legacy S3-only backend (which will be removed in a future release).",
    );
  }

  if (storageBackend === "s3-legacy") {
    const bucket = process.env.S3_BUCKET || "ums-call-archive";
    console.warn(
      `[STORAGE] WARN: CloudStorage backend is deprecated and will be removed. ` +
      `Migrate to PostgresStorage by setting DATABASE_URL. (bucket: ${bucket})`,
    );
    return new CloudStorage(new S3Client(bucket));
  }

  console.log("[STORAGE] No cloud credentials — using in-memory storage (data will not persist across restarts)");
  return new MemStorage();
}

export const storage = createStorage();
