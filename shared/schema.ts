import { z } from "zod";

// --- USER SCHEMAS ---
export const insertUserSchema = z.object({
  username: z.string(),
  passwordHash: z.string(),
  name: z.string(),
  role: z.string().default("viewer"),
});

export const userSchema = insertUserSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- EMPLOYEE SCHEMAS ---
export const insertEmployeeSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  email: z.string(),
  initials: z.string().max(2).optional(),
  status: z.string().default("Active").optional(),
});

export const employeeSchema = insertEmployeeSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- CALL SCHEMAS ---
export const insertCallSchema = z.object({
  employeeId: z.string(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  status: z.string().default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
});

export const callSchema = insertCallSchema.extend({
  id: z.string(),
  uploadedAt: z.string().optional(),
});

// --- TRANSCRIPT SCHEMAS ---
export const insertTranscriptSchema = z.object({
  callId: z.string(),
  text: z.string().optional(),
  confidence: z.string().optional(),
  words: z.any().optional(),
});

export const transcriptSchema = insertTranscriptSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- SENTIMENT ANALYSIS SCHEMAS ---
export const insertSentimentAnalysisSchema = z.object({
  callId: z.string(),
  overallSentiment: z.string().optional(),
  overallScore: z.string().optional(),
  segments: z.any().optional(),
});

export const sentimentAnalysisSchema = insertSentimentAnalysisSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- CALL ANALYSIS SCHEMAS ---
export const insertCallAnalysisSchema = z.object({
  callId: z.string(),
  performanceScore: z.string().optional(),
  talkTimeRatio: z.string().optional(),
  responseTime: z.string().optional(),
  keywords: z.any().optional(),
  topics: z.any().optional(),
  summary: z.string().optional(),
  actionItems: z.any().optional(),
  feedback: z.any().optional(),
  lemurResponse: z.any().optional(),
});

export const callAnalysisSchema = insertCallAnalysisSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- TYPES ---
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof userSchema>;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = z.infer<typeof employeeSchema>;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = z.infer<typeof callSchema>;

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export type InsertSentimentAnalysis = z.infer<typeof insertSentimentAnalysisSchema>;
export type SentimentAnalysis = z.infer<typeof sentimentAnalysisSchema>;

export type InsertCallAnalysis = z.infer<typeof insertCallAnalysisSchema>;
export type CallAnalysis = z.infer<typeof callAnalysisSchema>;

// --- COMBINED TYPES ---
export type CallWithDetails = Call & {
  employee: Employee;
  transcript?: Transcript;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

export type DashboardMetrics = {
  totalCalls: number;
  avgSentiment: number;
  avgTranscriptionTime: number;
  avgPerformanceScore: number;
};

export type SentimentDistribution = {
  positive: number;
  neutral: number;
  negative: number;
};
