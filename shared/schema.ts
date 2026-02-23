import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  role: text("role").notNull(),
  email: text("email"),
  initials: text("initials").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  duration: integer("duration"), // in seconds
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status").notNull().default("processing"), // processing, completed, failed
  assemblyAiId: text("assembly_ai_id"),
});

export const transcripts = pgTable("transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  text: text("text").notNull(),
  confidence: real("confidence"),
  words: jsonb("words"), // array of word objects with timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sentimentAnalysis = pgTable("sentiment_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  overallSentiment: text("overall_sentiment").notNull(), // positive, negative, neutral
  overallScore: real("overall_score").notNull(), // 0-1
  segments: jsonb("segments"), // array of sentiment segments
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const callAnalysis = pgTable("call_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").references(() => calls.id).notNull(),
  performanceScore: real("performance_score").notNull(),
  talkTimeRatio: real("talk_time_ratio"), // employee talk time / total time
  responseTime: real("response_time"), // average response time in seconds
  keywords: text("keywords").array(),
  topics: text("topics").array(),
  summary: text("summary"),
  actionItems: text("action_items").array(),
  feedback: jsonb("feedback"), // AI-generated feedback object
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  uploadedAt: true,
});

export const insertTranscriptSchema = createInsertSchema(transcripts).omit({
  id: true,
  createdAt: true,
});

export const insertSentimentAnalysisSchema = createInsertSchema(sentimentAnalysis).omit({
  id: true,
  createdAt: true,
});

export const insertCallAnalysisSchema = createInsertSchema(callAnalysis).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = typeof transcripts.$inferSelect;

export type InsertSentimentAnalysis = z.infer<typeof insertSentimentAnalysisSchema>;
export type SentimentAnalysis = typeof sentimentAnalysis.$inferSelect;

export type InsertCallAnalysis = z.infer<typeof insertCallAnalysisSchema>;
export type CallAnalysis = typeof callAnalysis.$inferSelect;

// Combined types for frontend
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
