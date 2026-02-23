import {
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
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema';
import { eq, desc, count, avg, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface IStorage {
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
  getCallsWithDetails(filters?: { status?: string; sentiment?: string; employee?: string; }): Promise<CallWithDetails[]>;

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
  getTopPerformers(limit?: number): Promise<any[]>; // Adjusted return type

  // Search and filtering
  searchCalls(query: string): Promise<CallWithDetails[]>;
}

export class DbStorage implements IStorage {
  private db;

  constructor(databaseUrl?: string) {
    const connectionString = databaseUrl || process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is not set in environment or passed to constructor.");
    }

    const pool = new Pool({ connectionString });
    this.db = drizzle(pool, { schema });
  }

  // --- Employee Methods ---
  async getEmployee(id: string) {
    return await this.db.query.employees.findFirst({ where: eq(schema.employees.id, id) });
  }
  async getEmployeeByEmail(email: string) {
    return await this.db.query.employees.findFirst({ where: eq(schema.employees.email, email) });
  }
  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const newId = randomUUID(); // 1. Generate a new unique ID

    const newEmployee = {
      ...employee,
      id: newId, // 2. Add the new ID to the employee object
    };
    
    // 3. Save the complete object (with an ID) to the database
    const result = await this.db.insert(schema.employees).values(newEmployee).returning();
    return result[0];
  }

  async updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const result = await this.db.update(schema.employees)
      .set(updates)
      .where(eq(schema.employees.id, id))
      .returning();
    return result[0];
  }
async getAllEmployees() {
    console.log("Attempting to fetch all employees from the database...");
    try {
      const employeesResult = await this.db.select().from(schema.employees);
      console.log(`Found ${employeesResult.length} employees in the database.`);
      return employeesResult;
    } catch (error) {
      console.error("Error fetching employees from database:", error);
      return []; // Return an empty array on error
    }
  }

  // --- Call Methods ---
  async getCall(id: string) {
    return await this.db.query.calls.findFirst({ where: eq(schema.calls.id, id) });
  }
  async createCall(call: InsertCall): Promise<Call> {
    const newId = randomUUID(); // 1. Generate a new unique ID

    const newCall = {
      ...call,
      id: newId, // 2. Add the new ID to the call object
    };
    
    // 3. Save the complete object (with an ID) to the database
    const result = await this.db.insert(schema.calls).values(newCall).returning();
    return result[0];
  }
  async updateCall(id: string, updates: Partial<Call>) {
    const result = await this.db.update(schema.calls).set(updates).where(eq(schema.calls.id, id)).returning();
    return result[0];
  }
  async deleteCall(id: string): Promise<void> {
    await this.db.delete(schema.calls).where(eq(schema.calls.id, id));
  }
  async getAllCalls() {
    return await this.db.query.calls.findMany({ orderBy: [desc(schema.calls.uploadedAt)] });
  }
// In server/storage.ts, inside the DbStorage class
  async getCallsWithDetails(filters: { status?: string; sentiment?: string; employee?: string; } = {}): Promise<CallWithDetails[]> {
    console.log("Fetching calls with details, using filters:", filters);

    // This query tells Drizzle to fetch calls and include all their related data
    // from the other tables (employee, transcript, etc.)
    const calls = await this.db.query.calls.findMany({
      with: {
        employee: true,
        transcript: true,
        sentiment: true,
        analysis: true,
      },
      orderBy: [desc(schema.calls.uploadedAt)],
    });

    console.log(`Found ${calls.length} total calls with details from the database.`);

    // --- In-memory filtering (can be moved to the database for more efficiency later) ---
    let filteredCalls = calls;
    if (filters.status) {
      filteredCalls = filteredCalls.filter(call => call.status === filters.status);
    }
    if (filters.sentiment) {
      filteredCalls = filteredCalls.filter(call => call.sentiment?.overallSentiment === filters.sentiment);
    }
    if (filters.employee) {
      filteredCalls = filteredCalls.filter(call => call.employeeId === filters.employee);
    }
    
    console.log(`Returning ${filteredCalls.length} filtered calls to the front-end.`);
    return filteredCalls as CallWithDetails[];
  }

  // --- Transcript Methods ---
  async getTranscript(callId: string) {
    return await this.db.query.transcripts.findFirst({ where: eq(schema.transcripts.callId, callId) });
  }
  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const newId = randomUUID();
    const newTranscript = { ...transcript, id: newId };
    const result = await this.db.insert(schema.transcripts).values(newTranscript).returning();
    return result[0];
  }

  // --- Sentiment Analysis Methods ---
  async getSentimentAnalysis(callId: string) {
    return await this.db.query.sentiments.findFirst({ where: eq(schema.sentiments.callId, callId) });
  }
  async createSentimentAnalysis(sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const newId = randomUUID();
    const newSentiment = { ...sentiment, id: newId };
    const result = await this.db.insert(schema.sentiments).values(newSentiment).returning();
    return result[0];
  }

  // --- Call Analysis Methods ---
  async getCallAnalysis(callId: string) {
    return await this.db.query.analyses.findFirst({ where: eq(schema.analyses.callId, callId) });
  }
  async createCallAnalysis(analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const newId = randomUUID();
    const newAnalysis = { ...analysis, id: newId };
    const result = await this.db.insert(schema.analyses).values(newAnalysis).returning();
    return result[0];
  }
  
  // --- Dashboard and Reporting Methods ---
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const totalCallsResult = await this.db.select({ value: count() }).from(schema.calls);
    const avgSentimentResult = await this.db.select({ value: avg(schema.sentiments.overallScore) }).from(schema.sentiments);
    const avgPerformanceScoreResult = await this.db.select({ value: avg(schema.analyses.performanceScore) }).from(schema.analyses);

    return {
      totalCalls: totalCallsResult[0]?.value ?? 0,
      avgSentiment: parseFloat(avgSentimentResult[0]?.value ?? '0') * 10,
      avgPerformanceScore: parseFloat(avgPerformanceScoreResult[0]?.value ?? '0'),
      avgTranscriptionTime: 2.3, // Mock value
    };
  }

  async getSentimentDistribution(): Promise<SentimentDistribution> {
    const result = await this.db
      .select({
        sentiment: schema.sentiments.overallSentiment,
        count: count(schema.sentiments.id),
      })
      .from(schema.sentiments)
      .groupBy(schema.sentiments.overallSentiment);

    const distribution: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    result.forEach(item => {
      if (item.sentiment && item.sentiment in distribution) {
        distribution[item.sentiment as keyof SentimentDistribution] = item.count;
      }
    });
    return distribution;
  }

  async getTopPerformers(limit = 3) {
    // This is a more complex query that joins calls, analyses, and employees
    const performers = await this.db
      .select({
        id: schema.employees.id,
        name: schema.employees.name,
        role: schema.employees.role,
        avgPerformanceScore: avg(schema.analyses.performanceScore),
        totalCalls: count(schema.calls.id),
      })
      .from(schema.employees)
      .leftJoin(schema.calls, eq(schema.employees.id, schema.calls.employeeId))
      .leftJoin(schema.analyses, eq(schema.calls.id, schema.analyses.callId))
      .groupBy(schema.employees.id)
      .orderBy(desc(avg(schema.analyses.performanceScore)))
      .limit(limit);

    return performers;
  }
  
  async searchCalls(query: string): Promise<CallWithDetails[]> {
    // Search transcripts for matching text, then return associated calls with details
    const searchPattern = `%${query}%`;

    const matchingTranscripts = await this.db
      .select({ callId: schema.transcripts.callId })
      .from(schema.transcripts)
      .where(sql`${schema.transcripts.text} ILIKE ${searchPattern}`);

    if (matchingTranscripts.length === 0) {
      return [];
    }

    const matchingCallIds = matchingTranscripts.map(t => t.callId);

    // Fetch full call details for matching calls
    const calls = await this.db.query.calls.findMany({
      with: {
        employee: true,
        transcript: true,
        sentiment: true,
        analysis: true,
      },
      where: sql`${schema.calls.id} IN (${sql.join(matchingCallIds.map(id => sql`${id}`), sql`, `)})`,
      orderBy: [desc(schema.calls.uploadedAt)],
    });

    return calls as CallWithDetails[];
  }
}

export const storage = new DbStorage();
