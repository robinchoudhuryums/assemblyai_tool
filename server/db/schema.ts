import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar, jsonb, integer, decimal } from 'drizzle-orm/pg-core';

// --- EMPLOYEES TABLE ---
export const employees = pgTable('employees', {
  id: varchar('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email').notNull().unique(),
  initials: varchar('initials', { length: 2 }),
  status: text('status').default('Active'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- CALLS TABLE ---
export const calls = pgTable('calls', {
  id: varchar('id').primaryKey(),
  employeeId: varchar('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  fileName: text('file_name'),
  filePath: text('file_path'),
  status: text('status').default('pending').notNull(),
  duration: integer('duration'),
  assemblyAiId: text('assemblyai_id'),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
});

// --- TRANSCRIPTS TABLE ---
export const transcripts = pgTable('transcripts', {
  id: varchar('id').primaryKey(),
  callId: varchar('call_id').references(() => calls.id, { onDelete: 'cascade' }).notNull().unique(),
  text: text('text'),
  confidence: decimal('confidence'),
  words: jsonb('words'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- SENTIMENT ANALYSIS TABLE ---
export const sentiments = pgTable('sentiments', {
  id: varchar('id').primaryKey(),
  callId: varchar('call_id').references(() => calls.id, { onDelete: 'cascade' }).notNull().unique(),
  overallSentiment: text('overall_sentiment'),
  overallScore: decimal('overall_score'),
  segments: jsonb('segments'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- CALL ANALYSIS TABLE ---
export const analyses = pgTable('analyses', {
  id: varchar('id').primaryKey(),
  callId: varchar('call_id').references(() => calls.id, { onDelete: 'cascade' }).notNull().unique(),
  performanceScore: decimal('performance_score'),
  talkTimeRatio: decimal('talk_time_ratio'),
  responseTime: decimal('response_time'),
  keywords: jsonb('keywords'),
  topics: jsonb('topics'),
  summary: text('summary'),
  actionItems: jsonb('action_items'),
  feedback: jsonb('feedback'),
  createdAt: timestamp('created_at').defaultNow(),
});


// --- RELATIONS (for joining tables easily) ---
export const employeesRelations = relations(employees, ({ many }) => ({
  calls: many(calls),
}));

export const callsRelations = relations(calls, ({ one }) => ({
  employee: one(employees, {
    fields: [calls.employeeId],
    references: [employees.id],
  }),
  transcript: one(transcripts, {
    fields: [calls.id],
    references: [transcripts.callId],
  }),
  sentiment: one(sentiments, {
    fields: [calls.id],
    references: [sentiments.callId],
  }),
  analysis: one(analyses, {
    fields: [calls.id],
    references: [analyses.callId],
  }),
}));
