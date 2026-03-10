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
  subTeam: z.string().optional(),
});

export const employeeSchema = insertEmployeeSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- POWER MOBILITY SUB-TEAMS (in chronological process order) ---
export const POWER_MOBILITY_SUBTEAMS = [
  "PPD",
  "MA Education",
  "Appt Scheduling",
  "PT Education",
  "Appt Passed",
  "PT Eval",
  "MDO Follow-Up",
  "Medical Review",
  "Prior Authorization",
] as const;

// --- CALL CATEGORY ---
export const CALL_CATEGORIES = [
  { value: "inbound", label: "Inbound Call", description: "Customer/patient calling into the company" },
  { value: "outbound", label: "Outbound Call", description: "Employee calling a customer/patient" },
  { value: "internal", label: "Internal", description: "Call between coworkers or departments" },
  { value: "vendor", label: "Vendor/Partner", description: "Call with an external vendor or partner" },
] as const;

export type CallCategory = typeof CALL_CATEGORIES[number]["value"];

// --- CALL SCHEMAS ---
export const insertCallSchema = z.object({
  employeeId: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  status: z.string().default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
  callCategory: z.string().optional(),
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
  callPartyType: z.string().optional(),
  flags: z.any().optional(),
  manualEdits: z.any().optional(),
  confidenceScore: z.string().optional(),
  confidenceFactors: z.any().optional(),
  subScores: z.object({
    compliance: z.number().min(0).max(10).optional(),
    customerExperience: z.number().min(0).max(10).optional(),
    communication: z.number().min(0).max(10).optional(),
    resolution: z.number().min(0).max(10).optional(),
  }).optional(),
  detectedAgentName: z.string().optional(),
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

// --- ACCESS REQUEST SCHEMAS ---
export const insertAccessRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  reason: z.string().optional(),
  requestedRole: z.enum(["viewer", "manager"]).default("viewer"),
});

export const accessRequestSchema = insertAccessRequestSchema.extend({
  id: z.string(),
  status: z.enum(["pending", "approved", "denied"]).default("pending"),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

export type InsertAccessRequest = z.infer<typeof insertAccessRequestSchema>;
export type AccessRequest = z.infer<typeof accessRequestSchema>;

// --- PROMPT TEMPLATE SCHEMAS ---
export const promptTemplateSchema = z.object({
  id: z.string(),
  callCategory: z.string(),
  name: z.string(),
  evaluationCriteria: z.string(),
  requiredPhrases: z.array(z.object({
    phrase: z.string(),
    label: z.string(),
    severity: z.enum(["required", "recommended"]).default("required"),
  })).optional(),
  scoringWeights: z.object({
    compliance: z.number().min(0).max(100).default(25),
    customerExperience: z.number().min(0).max(100).default(25),
    communication: z.number().min(0).max(100).default(25),
    resolution: z.number().min(0).max(100).default(25),
  }).optional(),
  additionalInstructions: z.string().optional(),
  isActive: z.boolean().default(true),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});

export const insertPromptTemplateSchema = promptTemplateSchema.omit({ id: true });

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;

// --- ROLE DEFINITIONS ---
export const USER_ROLES = [
  {
    value: "viewer" as const,
    label: "Viewer",
    description: "View-only access to dashboards, reports, transcripts, and team data. Cannot edit or delete anything.",
  },
  {
    value: "manager" as const,
    label: "Manager / QA",
    description: "Everything a Viewer can do, plus: assign calls, edit analysis, manage employees, and export reports.",
  },
  {
    value: "admin" as const,
    label: "Administrator",
    description: "Full access. Manage users, approve access requests, bulk import, delete calls, and configure system settings.",
  },
] as const;

export type UserRole = typeof USER_ROLES[number]["value"];

// --- COACHING SESSION SCHEMAS ---
export const COACHING_CATEGORIES = [
  { value: "compliance", label: "Compliance" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "communication", label: "Communication" },
  { value: "resolution", label: "Resolution" },
  { value: "general", label: "General" },
] as const;

export const insertCoachingSessionSchema = z.object({
  employeeId: z.string(),
  callId: z.string().optional(),
  assignedBy: z.string(),
  category: z.string().default("general"),
  title: z.string(),
  notes: z.string().optional(),
  actionPlan: z.array(z.object({
    task: z.string(),
    completed: z.boolean().default(false),
  })).optional(),
  status: z.enum(["pending", "in_progress", "completed", "dismissed"]).default("pending"),
  dueDate: z.string().optional(),
});

export const coachingSessionSchema = insertCoachingSessionSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type InsertCoachingSession = z.infer<typeof insertCoachingSessionSchema>;
export type CoachingSession = z.infer<typeof coachingSessionSchema>;

// --- A/B MODEL TEST SCHEMAS ---
export const BEDROCK_MODEL_PRESETS = [
  { value: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Current)", cost: "$$" },
  { value: "us.anthropic.claude-sonnet-4-20250514", label: "Claude Sonnet 4", cost: "$$" },
  { value: "us.anthropic.claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", cost: "$" },
  { value: "anthropic.claude-3-haiku-20240307", label: "Claude 3 Haiku (Cheapest)", cost: "$" },
  { value: "anthropic.claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet v2", cost: "$$" },
] as const;

export const insertABTestSchema = z.object({
  fileName: z.string(),
  callCategory: z.string().optional(),
  baselineModel: z.string(),
  testModel: z.string(),
  status: z.string().default("processing"),
  transcriptText: z.string().optional(),
  baselineAnalysis: z.any().optional(),
  testAnalysis: z.any().optional(),
  baselineLatencyMs: z.number().optional(),
  testLatencyMs: z.number().optional(),
  notes: z.string().optional(),
  createdBy: z.string(),
});

export const abTestSchema = insertABTestSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

export type InsertABTest = z.infer<typeof insertABTestSchema>;
export type ABTest = z.infer<typeof abTestSchema>;

// --- USAGE TRACKING SCHEMAS ---
export const usageRecordSchema = z.object({
  id: z.string(),
  callId: z.string(),
  type: z.enum(["call", "ab-test"]),
  timestamp: z.string(),
  user: z.string(),
  services: z.object({
    assemblyai: z.object({
      durationSeconds: z.number().default(0),
      estimatedCost: z.number().default(0),
    }).optional(),
    bedrock: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
    bedrockSecondary: z.object({
      model: z.string(),
      estimatedInputTokens: z.number().default(0),
      estimatedOutputTokens: z.number().default(0),
      estimatedCost: z.number().default(0),
      latencyMs: z.number().optional(),
    }).optional(),
  }),
  totalEstimatedCost: z.number(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

// --- COMBINED TYPES ---
export type CallWithDetails = Call & {
  employee?: Employee;
  transcript?: Transcript;
  sentiment?: SentimentAnalysis;
  analysis?: CallAnalysis;
};

export type PerformerSummary = {
  id: string;
  name: string;
  role?: string;
  avgPerformanceScore: number | null;
  totalCalls: number;
};

export type PaginatedCalls = {
  calls: CallWithDetails[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
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
