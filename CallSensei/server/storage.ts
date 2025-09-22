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
  type SentimentDistribution
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Employee operations
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByEmail(email: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  getAllEmployees(): Promise<Employee[]>;

  // Call operations
  getCall(id: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  getCallsByEmployee(employeeId: string): Promise<Call[]>;
  getAllCalls(): Promise<Call[]>;
  getCallsWithDetails(): Promise<CallWithDetails[]>;

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
  getTopPerformers(limit?: number): Promise<(Employee & { score: number })[]>;

  // Search and filtering
  searchCalls(query: string): Promise<CallWithDetails[]>;
  getCallsByStatus(status: string): Promise<CallWithDetails[]>;
  getCallsBySentiment(sentiment: string): Promise<CallWithDetails[]>;
}

export class MemStorage implements IStorage {
  private employees: Map<string, Employee> = new Map();
  private calls: Map<string, Call> = new Map();
  private transcripts: Map<string, Transcript> = new Map();
  private sentimentAnalysis: Map<string, SentimentAnalysis> = new Map();
  private callAnalysis: Map<string, CallAnalysis> = new Map();

  constructor() {
    this.seedData();
  }

  private seedData() {
    // Create sample employees
    const employees: Employee[] = [
      {
        id: "emp-1",
        name: "Sarah Martinez",
        role: "Senior Agent",
        email: "sarah@company.com",
        initials: "SM",
        createdAt: new Date(),
      },
      {
        id: "emp-2", 
        name: "James Davis",
        role: "Agent",
        email: "james@company.com",
        initials: "JD",
        createdAt: new Date(),
      },
      {
        id: "emp-3",
        name: "Anna Lopez", 
        role: "Agent",
        email: "anna@company.com",
        initials: "AL",
        createdAt: new Date(),
      },
    ];

    employees.forEach(emp => this.employees.set(emp.id, emp));
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    return this.employees.get(id);
  }

  async getEmployeeByEmail(email: string): Promise<Employee | undefined> {
    return Array.from(this.employees.values()).find(emp => emp.email === email);
  }

  async createEmployee(insertEmployee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const employee: Employee = {
      ...insertEmployee,
      id,
      createdAt: new Date(),
    };
    this.employees.set(id, employee);
    return employee;
  }

  async getAllEmployees(): Promise<Employee[]> {
    return Array.from(this.employees.values());
  }

  async getCall(id: string): Promise<Call | undefined> {
    return this.calls.get(id);
  }

  async createCall(insertCall: InsertCall): Promise<Call> {
    const id = randomUUID();
    const call: Call = {
      ...insertCall,
      id,
      uploadedAt: new Date(),
    };
    this.calls.set(id, call);
    return call;
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const call = this.calls.get(id);
    if (!call) return undefined;
    
    const updatedCall = { ...call, ...updates };
    this.calls.set(id, updatedCall);
    return updatedCall;
  }

  async getCallsByEmployee(employeeId: string): Promise<Call[]> {
    return Array.from(this.calls.values()).filter(call => call.employeeId === employeeId);
  }

  async getAllCalls(): Promise<Call[]> {
    return Array.from(this.calls.values());
  }

  async getCallsWithDetails(): Promise<CallWithDetails[]> {
    const calls = Array.from(this.calls.values());
    const callsWithDetails: CallWithDetails[] = [];

    for (const call of calls) {
      const employee = await this.getEmployee(call.employeeId);
      const transcript = this.transcripts.get(call.id);
      const sentiment = this.sentimentAnalysis.get(call.id);
      const analysis = this.callAnalysis.get(call.id);

      if (employee) {
        callsWithDetails.push({
          ...call,
          employee,
          transcript,
          sentiment,
          analysis,
        });
      }
    }

    return callsWithDetails.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async getTranscript(callId: string): Promise<Transcript | undefined> {
    return this.transcripts.get(callId);
  }

  async createTranscript(insertTranscript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const transcript: Transcript = {
      ...insertTranscript,
      id,
      createdAt: new Date(),
    };
    this.transcripts.set(transcript.callId, transcript);
    return transcript;
  }

  async getSentimentAnalysis(callId: string): Promise<SentimentAnalysis | undefined> {
    return this.sentimentAnalysis.get(callId);
  }

  async createSentimentAnalysis(insertSentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const sentiment: SentimentAnalysis = {
      ...insertSentiment,
      id,
      createdAt: new Date(),
    };
    this.sentimentAnalysis.set(sentiment.callId, sentiment);
    return sentiment;
  }

  async getCallAnalysis(callId: string): Promise<CallAnalysis | undefined> {
    return this.callAnalysis.get(callId);
  }

  async createCallAnalysis(insertAnalysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const analysis: CallAnalysis = {
      ...insertAnalysis,
      id,
      createdAt: new Date(),
    };
    this.callAnalysis.set(analysis.callId, analysis);
    return analysis;
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const calls = Array.from(this.calls.values());
    const sentiments = Array.from(this.sentimentAnalysis.values());
    const analyses = Array.from(this.callAnalysis.values());

    const avgSentiment = sentiments.length > 0 
      ? sentiments.reduce((sum, s) => sum + s.overallScore, 0) / sentiments.length * 10
      : 0;

    const avgTranscriptionTime = 2.3; // Mock value in minutes
    
    const teamScore = analyses.length > 0
      ? analyses.reduce((sum, a) => sum + a.performanceScore, 0) / analyses.length
      : 0;

    return {
      totalCalls: calls.length,
      avgSentiment: Number(avgSentiment.toFixed(1)),
      avgTranscriptionTime,
      teamScore: Number(teamScore.toFixed(1)),
    };
  }

  async getSentimentDistribution(): Promise<SentimentDistribution> {
    const sentiments = Array.from(this.sentimentAnalysis.values());
    const total = sentiments.length || 1;

    const positive = sentiments.filter(s => s.overallSentiment === 'positive').length;
    const neutral = sentiments.filter(s => s.overallSentiment === 'neutral').length;
    const negative = sentiments.filter(s => s.overallSentiment === 'negative').length;

    return {
      positive: Math.round((positive / total) * 100),
      neutral: Math.round((neutral / total) * 100),
      negative: Math.round((negative / total) * 100),
    };
  }

  async getTopPerformers(limit = 3): Promise<(Employee & { score: number })[]> {
    const analyses = Array.from(this.callAnalysis.values());
    const employeeScores = new Map<string, number[]>();

    // Group scores by employee
    for (const analysis of analyses) {
      const call = this.calls.get(analysis.callId);
      if (call) {
        if (!employeeScores.has(call.employeeId)) {
          employeeScores.set(call.employeeId, []);
        }
        employeeScores.get(call.employeeId)!.push(analysis.performanceScore);
      }
    }

    // Calculate average scores
    const performers: (Employee & { score: number })[] = [];
    for (const [employeeId, scores] of employeeScores.entries()) {
      const employee = this.employees.get(employeeId);
      if (employee && scores.length > 0) {
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        performers.push({
          ...employee,
          score: Number(avgScore.toFixed(1)),
        });
      }
    }

    return performers
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchCalls(query: string): Promise<CallWithDetails[]> {
    const callsWithDetails = await this.getCallsWithDetails();
    const lowerQuery = query.toLowerCase();

    return callsWithDetails.filter(call => 
      call.employee.name.toLowerCase().includes(lowerQuery) ||
      call.fileName.toLowerCase().includes(lowerQuery) ||
      call.transcript?.text.toLowerCase().includes(lowerQuery) ||
      call.analysis?.keywords?.some(keyword => keyword.toLowerCase().includes(lowerQuery))
    );
  }

  async getCallsByStatus(status: string): Promise<CallWithDetails[]> {
    const callsWithDetails = await this.getCallsWithDetails();
    return callsWithDetails.filter(call => call.status === status);
  }

  async getCallsBySentiment(sentiment: string): Promise<CallWithDetails[]> {
    const callsWithDetails = await this.getCallsWithDetails();
    return callsWithDetails.filter(call => call.sentiment?.overallSentiment === sentiment);
  }
}

export const storage = new MemStorage();
