import {
  type User,
  type InsertUser,
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
} from "@shared/schema";
import { GcsClient } from "./services/gcs";
import { S3Client } from "./services/s3";
import { randomUUID } from "crypto";

/** Common interface for GCS and S3 object storage clients */
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
}

export interface IStorage {
  // User operations (env-var-based)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Employee operations
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByEmail(email: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined>;
  getAllEmployees(): Promise<Employee[]>;

  // Call operations
  getCall(id: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  deleteCall(id: string): Promise<void>;
  getAllCalls(): Promise<Call[]>;
  getCallsWithDetails(filters?: { status?: string; sentiment?: string; employee?: string }): Promise<CallWithDetails[]>;

  // Transcript operations
  getTranscript(callId: string): Promise<Transcript | undefined>;
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;

  // Sentiment analysis operations
  getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined>;
  createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis>;

  // Call analysis operations
  getCallAnalysis(callId: string): Promise<CallAnalysis | undefined>;
  createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis>;

  // Dashboard metrics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getSentimentDistribution(): Promise<SentimentDistribution>;
  getTopPerformers(limit?: number): Promise<any[]>;

  // Search and filtering
  searchCalls(query: string): Promise<CallWithDetails[]>;

  // Audio file operations
  uploadAudio(callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void>;
  getAudioFiles(callId: string): Promise<string[]>;
  downloadAudio(objectName: string): Promise<Buffer | undefined>;

  // Data retention
  purgeExpiredCalls(retentionDays: number): Promise<number>;
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
  private audioFiles = new Map<string, Buffer>(); // objectName -> buffer

  async getUser(_id: string): Promise<User | undefined> { return undefined; }
  async getUserByUsername(_username: string): Promise<User | undefined> { return undefined; }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
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

  async getCall(id: string): Promise<Call | undefined> {
    return this.calls.get(id);
  }
  async createCall(call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const newCall: Call = { ...call, id, uploadedAt: new Date().toISOString() };
    this.calls.set(id, newCall);
    return newCall;
  }
  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = this.calls.get(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    this.calls.set(id, updated);
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
  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    const calls = await this.getAllCalls();
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
    if (filters.status) results = results.filter((c) => c.status === filters.status);
    if (filters.sentiment) results = results.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    if (filters.employee) results = results.filter((c) => c.employeeId === filters.employee);
    return results;
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
  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = { ...analysis, id, createdAt: new Date().toISOString() };
    this.analyses.set(analysis.callId, newAnalysis);
    return newAnalysis;
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
      ? (sentiments.reduce((sum, s) => sum + parseFloat(s.overallScore || "0"), 0) / sentiments.length) * 10
      : 0;
    const avgPerformanceScore = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + parseFloat(a.performanceScore || "0"), 0) / analyses.length
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

  async getTopPerformers(limit = 3): Promise<any[]> {
    const calls = [...this.calls.values()];
    const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
    for (const call of calls) {
      if (!call.employeeId) continue;
      const analysis = this.analyses.get(call.id);
      const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
      stats.callCount++;
      if (analysis?.performanceScore) stats.totalScore += parseFloat(analysis.performanceScore);
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

  async searchCalls(query: string): Promise<CallWithDetails[]> {
    const allCalls = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();
    return allCalls.filter((call) => call.transcript?.text?.toLowerCase().includes(lowerQuery));
  }

  async purgeExpiredCalls(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    let purged = 0;
    for (const call of this.calls.values()) {
      if (new Date(call.uploadedAt || 0) < cutoff) {
        await this.deleteCall(call.id);
        purged++;
      }
    }
    return purged;
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
    console.log("Fetching all employees...");
    try {
      const employees = await this.client.listAndDownloadJson<Employee>("employees/");
      console.log(`Found ${employees.length} employees.`);
      return employees;
    } catch (error) {
      console.error("Error fetching employees:", error);
      return [];
    }
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
    const call = await this.getCall(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    await this.client.uploadJson(`calls/${id}.json`, updated);
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

  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    console.log("Fetching calls with details, filters:", filters);

    const calls = await this.getAllCalls();
    const results: CallWithDetails[] = [];

    // Fetch details for all calls in parallel
    await Promise.all(
      calls.map(async (call) => {
        const [employee, transcript, sentiment, analysis] = await Promise.all([
          call.employeeId ? this.getEmployee(call.employeeId) : Promise.resolve(undefined),
          this.getTranscript(call.id),
          this.getSentimentAnalysis(call.id),
          this.getCallAnalysis(call.id),
        ]);

        results.push({
          ...call,
          employee,
          transcript: transcript || undefined,
          sentiment: sentiment || undefined,
          analysis: analysis || undefined,
        });
      })
    );

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

    console.log(`Returning ${filtered.length} filtered calls.`);
    return filtered;
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
        ? (sentiments.reduce((sum, s) => sum + parseFloat(s.overallScore || "0"), 0) /
            sentiments.length) *
          10
        : 0;

    const avgPerformanceScore =
      analyses.length > 0
        ? analyses.reduce((sum, a) => sum + parseFloat(a.performanceScore || "0"), 0) /
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

  async getTopPerformers(limit = 3): Promise<any[]> {
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
        stats.totalScore += parseFloat(analysis.performanceScore);
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

  async searchCalls(query: string): Promise<CallWithDetails[]> {
    const allCalls = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();

    return allCalls.filter((call) =>
      call.transcript?.text?.toLowerCase().includes(lowerQuery)
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
}

function createStorage(): IStorage {
  const storageBackend = process.env.STORAGE_BACKEND?.toLowerCase();

  // Explicit S3 or auto-detect via AWS credentials + S3_BUCKET
  if (storageBackend === "s3" || (!storageBackend && process.env.S3_BUCKET)) {
    const bucket = process.env.S3_BUCKET || "ums-call-archive";
    console.log(`[STORAGE] Using S3 (bucket: ${bucket})`);
    return new CloudStorage(new S3Client(bucket));
  }

  // Explicit GCS or auto-detect via GCS credentials
  if (storageBackend === "gcs" || process.env.GCS_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const bucket = process.env.GCS_BUCKET || "ums-call-archive";
    console.log(`[STORAGE] Using GCS (bucket: ${bucket})`);
    return new CloudStorage(new GcsClient(bucket));
  }

  console.log("[STORAGE] No cloud credentials — using in-memory storage (data will not persist across restarts)");
  return new MemStorage();
}

export const storage = createStorage();
