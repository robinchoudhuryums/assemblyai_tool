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
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations (env-var-based, no-op for GCS)
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

  // Audio file operations (GCS-specific)
  uploadAudioToGcs(callId: string, fileName: string, buffer: Buffer, contentType: string): Promise<void>;
}

export class GcsStorage implements IStorage {
  private gcs: GcsClient;

  constructor() {
    const bucketName = process.env.GCS_BUCKET || "ums-call-archive";
    this.gcs = new GcsClient(bucketName);
    console.log(`GCS storage initialized with bucket: ${bucketName}`);
  }

  // --- User Methods (env-var-based, users are managed in auth.ts) ---
  async getUser(_id: string): Promise<User | undefined> {
    return undefined; // Users come from env vars, not GCS
  }
  async getUserByUsername(_username: string): Promise<User | undefined> {
    return undefined; // Users come from env vars, not GCS
  }
  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("Users are managed via AUTH_USERS environment variable");
  }

  // --- Employee Methods ---
  async getEmployee(id: string): Promise<Employee | undefined> {
    return this.gcs.downloadJson<Employee>(`employees/${id}.json`);
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
    await this.gcs.uploadJson(`employees/${id}.json`, newEmployee);
    return newEmployee;
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const employee = await this.getEmployee(id);
    if (!employee) return undefined;
    const updated = { ...employee, ...updates };
    await this.gcs.uploadJson(`employees/${id}.json`, updated);
    return updated;
  }

  async getAllEmployees(): Promise<Employee[]> {
    console.log("Fetching all employees from GCS...");
    try {
      const employees = await this.gcs.listAndDownloadJson<Employee>("employees/");
      console.log(`Found ${employees.length} employees in GCS.`);
      return employees;
    } catch (error) {
      console.error("Error fetching employees from GCS:", error);
      return [];
    }
  }

  // --- Call Methods ---
  async getCall(id: string): Promise<Call | undefined> {
    return this.gcs.downloadJson<Call>(`calls/${id}.json`);
  }

  async createCall(call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const newCall: Call = {
      ...call,
      id,
      uploadedAt: new Date().toISOString(),
    };
    await this.gcs.uploadJson(`calls/${id}.json`, newCall);
    return newCall;
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = await this.getCall(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    await this.gcs.uploadJson(`calls/${id}.json`, updated);
    return updated;
  }

  async deleteCall(id: string): Promise<void> {
    await Promise.all([
      this.gcs.deleteObject(`calls/${id}.json`),
      this.gcs.deleteObject(`transcripts/${id}.json`),
      this.gcs.deleteObject(`sentiments/${id}.json`),
      this.gcs.deleteObject(`analyses/${id}.json`),
      this.gcs.deleteByPrefix(`audio/${id}/`),
    ]);
  }

  async getAllCalls(): Promise<Call[]> {
    const calls = await this.gcs.listAndDownloadJson<Call>("calls/");
    return calls.sort(
      (a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
    );
  }

  async getCallsWithDetails(
    filters: { status?: string; sentiment?: string; employee?: string } = {}
  ): Promise<CallWithDetails[]> {
    console.log("Fetching calls with details from GCS, filters:", filters);

    const calls = await this.getAllCalls();
    const results: CallWithDetails[] = [];

    // Fetch details for all calls in parallel
    await Promise.all(
      calls.map(async (call) => {
        const [employee, transcript, sentiment, analysis] = await Promise.all([
          this.getEmployee(call.employeeId),
          this.getTranscript(call.id),
          this.getSentimentAnalysis(call.id),
          this.getCallAnalysis(call.id),
        ]);

        results.push({
          ...call,
          employee: employee!,
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
    return this.gcs.downloadJson<Transcript>(`transcripts/${callId}.json`);
  }

  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const newTranscript: Transcript = {
      ...transcript,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.gcs.uploadJson(`transcripts/${transcript.callId}.json`, newTranscript);
    return newTranscript;
  }

  // --- Sentiment Analysis Methods ---
  async getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined> {
    return this.gcs.downloadJson<SentimentAnalysis>(`sentiments/${callId}.json`);
  }

  async createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const newSentiment: SentimentAnalysis = {
      ...sentiment,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.gcs.uploadJson(`sentiments/${sentiment.callId}.json`, newSentiment);
    return newSentiment;
  }

  // --- Call Analysis Methods ---
  async getCallAnalysis(callId: string): Promise<CallAnalysis | undefined> {
    return this.gcs.downloadJson<CallAnalysis>(`analyses/${callId}.json`);
  }

  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const newAnalysis: CallAnalysis = {
      ...analysis,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.gcs.uploadJson(`analyses/${analysis.callId}.json`, newAnalysis);
    return newAnalysis;
  }

  // --- Audio File Methods ---
  async uploadAudioToGcs(
    callId: string,
    fileName: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    await this.gcs.uploadFile(`audio/${callId}/${fileName}`, buffer, contentType);
  }

  // --- Dashboard and Reporting Methods ---
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [calls, sentiments, analyses] = await Promise.all([
      this.gcs.listObjects("calls/"),
      this.gcs.listAndDownloadJson<SentimentAnalysis>("sentiments/"),
      this.gcs.listAndDownloadJson<CallAnalysis>("analyses/"),
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
    const sentiments = await this.gcs.listAndDownloadJson<SentimentAnalysis>("sentiments/");
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
      this.gcs.listAndDownloadJson<Call>("calls/"),
      this.gcs.listAndDownloadJson<CallAnalysis>("analyses/"),
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
}

export const storage = new GcsStorage();
