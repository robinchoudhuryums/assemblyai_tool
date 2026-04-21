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

// --- DB USER SCHEMAS (PostgreSQL-backed user management) ---
export const dbUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  passwordHash: z.string(),
  role: z.enum(["viewer", "manager", "admin"]).default("viewer"),
  displayName: z.string().min(1),
  active: z.boolean().default(true),
  mfaSecret: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** User object without password_hash — safe for API responses */
export const dbUserResponseSchema = dbUserSchema.omit({ passwordHash: true, mfaSecret: true });

/** Password complexity: 12+ chars, uppercase, lowercase, digit, special char (HIPAA) */
const passwordSchema = z.string().min(12).refine(
  (pwd) => /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd),
  { message: "Password must contain uppercase, lowercase, digit, and special character" },
);

/** Schema for POST /api/users (admin creating a new user) */
export const createDbUserSchema = z.object({
  username: z.string().min(1).max(255),
  password: passwordSchema,
  role: z.enum(["viewer", "manager", "admin"]).default("viewer"),
  displayName: z.string().min(1).max(255),
});

/** Schema for PATCH /api/users/:id (admin updating a user) */
export const updateDbUserSchema = z.object({
  role: z.enum(["viewer", "manager", "admin"]).optional(),
  displayName: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
});

/** Schema for POST /api/users/:id/reset-password (admin resetting password) */
export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

/** Schema for PATCH /api/users/me/password (self-service password change) */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type DbUser = z.infer<typeof dbUserSchema>;
export type DbUserResponse = z.infer<typeof dbUserResponseSchema>;
export type CreateDbUser = z.infer<typeof createDbUserSchema>;
export type UpdateDbUser = z.infer<typeof updateDbUserSchema>;

// --- EMPLOYEE SCHEMAS ---
export const insertEmployeeSchema = z.object({
  name: z.string().min(1).max(255),
  role: z.string().max(100).optional(),
  email: z.string().email("Invalid email address"),
  initials: z.string().max(2).optional(),
  status: z.enum(["Active", "Inactive"]).default("Active").optional(),
  subTeam: z.string().max(100).optional(),
  pseudonym: z.string().max(255).optional(), // Display name with pseudonym, e.g. "Camila (Cheshta) Bhutani"
  extension: z.string().max(20).optional(), // 8x8 direct extension number
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
export const CALL_CATEGORY_VALUES = CALL_CATEGORIES.map(c => c.value);

export const insertCallSchema = z.object({
  employeeId: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  status: z.string().default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
  callCategory: z.enum(["inbound", "outbound", "internal", "vendor"]).optional(),
  contentHash: z.string().optional(),
  externalId: z.string().max(255).optional(),
  // Synthetic flag: set to TRUE only for calls promoted from the Simulated
  // Call Generator. These rows are excluded from all aggregate/learning paths.
  synthetic: z.boolean().optional(),
  // Manager-set exclusion flag. When TRUE, the call is omitted from aggregate
  // metrics (leaderboards, dashboards, filtered reports, badge evaluation,
  // coaching outcomes) but still visible in lists / search / detail views.
  excludedFromMetrics: z.boolean().optional(),
});

export const callSchema = insertCallSchema.extend({
  id: z.string(),
  uploadedAt: z.string().optional(),
});

// --- Reusable schemas for AI data that may be strings or objects ---
// Bedrock may return objects where strings are expected.
// Accept both forms here; normalizeStringArray() coerces objects to strings at the storage layer.
const aiStringOrObject = z.union([z.string(), z.record(z.unknown())]);
const aiStringArray = z.array(aiStringOrObject).optional();

// LeMUR response: structured AI response object with known top-level fields.
// Accepts null (not used), string (raw response), or an object with common LeMUR fields.
const lemurResponseSchema = z.union([
  z.null(),
  z.string(),
  z.object({
    response: z.string().optional(),
    request_id: z.string().optional(),
    model: z.string().optional(),
    usage: z.object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    }).passthrough().optional(),
  }).passthrough(),
]).optional();

// --- TRANSCRIPT SCHEMAS ---
export const insertTranscriptSchema = z.object({
  callId: z.string(),
  text: z.string().optional(),
  confidence: z.string().optional(),
  words: z.array(z.object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
    confidence: z.number(),
    speaker: z.string().optional(),
  })).optional(),
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
  segments: z.array(z.object({
    text: z.string().optional(),
    sentiment: z.string().optional(),
    confidence: z.number().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
    speaker: z.string().optional(),
  })).optional(),
});

export const sentimentAnalysisSchema = insertSentimentAnalysisSchema.extend({
  id: z.string(),
  createdAt: z.string().optional(),
});

// --- CALL ANALYSIS SCHEMAS ---
export const insertCallAnalysisSchema = z.object({
  callId: z.string(),
  performanceScore: z.union([z.string(), z.number()])
    .transform(v => typeof v === "number" ? v.toString() : v)
    .optional(),
  talkTimeRatio: z.string().optional(),
  responseTime: z.string().optional(),
  keywords: aiStringArray,
  topics: aiStringArray,
  summary: z.string().optional(),
  actionItems: aiStringArray,
  feedback: z.object({
    strengths: aiStringArray,
    suggestions: aiStringArray,
  }).optional(),
  lemurResponse: lemurResponseSchema,
  callPartyType: z.string().optional(),
  flags: z.array(aiStringOrObject).optional(),
  manualEdits: z.array(z.object({
    editedBy: z.string().optional(),
    editedAt: z.string().optional(),
    reason: z.string().optional(),
    changes: z.record(z.unknown()).optional(),
  })).optional(),
  confidenceScore: z.string().optional(),
  confidenceFactors: z.object({
    transcriptConfidence: z.number().optional(),
    wordCount: z.number().optional(),
    callDurationSeconds: z.number().optional(),
    callDuration: z.number().optional(),
    transcriptLength: z.number().optional(),
    aiAnalysisCompleted: z.boolean().optional(),
    overallScore: z.number().optional(),
    agentSpeakerLabel: z.string().optional(),
    utteranceMetrics: z.object({
      interruptionCount: z.number().optional(),
      avgResponseLatencyMs: z.number().optional(),
      monologueSegments: z.number().optional(),
      questionCount: z.number().optional(),
    }).optional(),
  }).optional(),
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

// --- ANALYSIS EDIT SCHEMA (shared for client + server validation) ---
export const analysisEditSchema = z.object({
  updates: z.object({
    summary: z.string().optional(),
    performanceScore: z.union([z.string(), z.number()])
      .transform(v => typeof v === "string" ? parseFloat(v) : v)
      .pipe(z.number().min(0).max(10))
      .transform(v => v.toString())
      .optional(),
    topics: z.array(z.string()).optional(),
    actionItems: z.array(z.string()).optional(),
    feedback: z.object({
      strengths: z.array(aiStringOrObject).optional(),
      suggestions: z.array(aiStringOrObject).optional(),
    }).optional(),
    flags: z.array(z.string()).optional(),
    sentiment: z.string().optional(),
    sentimentScore: z.union([z.string(), z.number()])
      .transform(v => typeof v === "string" ? parseFloat(v) : v)
      .pipe(z.number().min(0).max(10))
      .optional(),
    subScores: z.record(z.string(), z.number().min(0).max(10)).optional(),
  }).strict().refine(obj => Object.keys(obj).length > 0, { message: "At least one field must be updated" }),
  reason: z.string().min(1, "A reason for the edit is required").max(1000),
}).strict();

export type AnalysisEdit = z.infer<typeof analysisEditSchema>;

// --- CALL ASSIGNMENT SCHEMA (shared between call and employee routes) ---
export const assignCallSchema = z.object({
  employeeId: z.string().optional(),
}).strict();

// --- LOGIN SCHEMA (client-side validation) ---
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

// --- ACCESS REQUEST FORM SCHEMA (client-side validation) ---
export const accessRequestFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Please enter a valid email address"),
  reason: z.string().optional(),
  requestedRole: z.enum(["viewer", "manager"]).default("viewer"),
});

// --- COACHING FORM SCHEMA (client-side validation) ---
export const coachingFormSchema = z.object({
  employeeId: z.string().min(1, "Please select an employee"),
  title: z.string().min(1, "Title is required").max(500),
  category: z.string().default("general"),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
  callId: z.string().optional(),
});

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
  category: z.enum(["compliance", "customer_experience", "communication", "resolution", "general", "performance", "recognition"]).default("general"),
  title: z.string().min(1).max(500),
  notes: z.string().optional(),
  actionPlan: z.array(z.object({
    task: z.string(),
    completed: z.boolean().default(false),
  })).optional(),
  status: z.enum(["pending", "in_progress", "completed", "dismissed"]).default("pending"),
  dueDate: z.string().optional(),
  // Manager-supplied subjective effectiveness rating captured at session
  // close. Complements the statistical before/after outcome metric with
  // causal judgment — "did this coaching actually help this agent?".
  // Optional so existing sessions don't need backfill.
  effectivenessRating: z.enum(["helpful", "neutral", "not_helpful"]).optional(),
  effectivenessNote: z.string().max(1000).optional(),
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
  baselineAnalysis: z.record(z.unknown()).optional(),
  testAnalysis: z.record(z.unknown()).optional(),
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

// --- WEBHOOK CONFIG SCHEMAS ---
// Retry policy override per webhook. All fields optional; undefined values
// fall back to the service-level defaults (4 in-process retries, circuit
// breaker opens at 5 consecutive failures for 5 minutes). Mission-critical
// consumers (CRM hooks) can raise the retry count; low-priority consumers
// (Slack alerts) can lower the circuit threshold so flaky receivers get
// skipped sooner. Clamps keep operator error from creating DoS vectors.
export const webhookRetryPolicySchema = z.object({
  maxInProcessRetries: z.number().int().min(0).max(10).optional(),
  circuitThreshold: z.number().int().min(1).max(50).optional(),
  circuitResetMs: z.number().int().min(10_000).max(60 * 60_000).optional(),
}).strict();

export const webhookConfigSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(1),
  active: z.boolean().default(true),
  retryPolicy: webhookRetryPolicySchema.optional(),
  createdBy: z.string(),
  createdAt: z.string(),
}).strict();

export const insertWebhookConfigSchema = webhookConfigSchema.omit({ id: true, createdAt: true, createdBy: true });

// Strict whitelist for PATCH /api/admin/webhooks/:id — only these fields may
// be updated; passing extra keys is rejected.
export const updateWebhookConfigSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().min(1).optional(),
  active: z.boolean().optional(),
  retryPolicy: webhookRetryPolicySchema.nullable().optional(),
}).strict().refine(o => Object.keys(o).length > 0, { message: "At least one field must be updated" });

export type WebhookRetryPolicy = z.infer<typeof webhookRetryPolicySchema>;
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type InsertWebhookConfig = z.infer<typeof insertWebhookConfigSchema>;

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

export interface Annotation {
  id: string;
  callId: string;
  timestampMs: number;
  text: string;
  author: string;
  createdAt: string;
}

export type PaginatedCalls = {
  calls: CallWithDetails[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Cursor-based pagination fields (present when cursor mode is used) */
  nextCursor?: string | null;
  hasMore?: boolean;
};

// --- GAMIFICATION SCHEMAS ---

/** Badge types available in the system */
export const BADGE_TYPES = [
  { value: "perfect_10", label: "Perfect 10", description: "Scored a perfect 10/10 on a call", icon: "star" },
  { value: "streak_3", label: "Hat Trick", description: "3 consecutive calls scored 8+", icon: "fire" },
  { value: "streak_5", label: "On Fire", description: "5 consecutive calls scored 8+", icon: "fire" },
  { value: "streak_10", label: "Unstoppable", description: "10 consecutive calls scored 8+", icon: "lightning" },
  { value: "first_call", label: "First Call", description: "Completed first analyzed call", icon: "rocket" },
  { value: "calls_25", label: "Quarter Century", description: "25 calls analyzed", icon: "trophy" },
  { value: "calls_50", label: "Half Century", description: "50 calls analyzed", icon: "trophy" },
  { value: "calls_100", label: "Century Club", description: "100 calls analyzed", icon: "crown" },
  // A13/F10/D1: most_improved was never implemented in evaluateBadges — there
  // is no code path that awards it. Removing it from BADGE_TYPES so the badge
  // catalog matches the actual evaluation logic.
  { value: "compliance_star", label: "Compliance Star", description: "Compliance sub-score 9+ on 5 consecutive calls", icon: "shield" },
  { value: "empathy_champion", label: "Empathy Champion", description: "Customer Experience sub-score 9+ on 5 consecutive calls", icon: "heart" },
  { value: "resolution_ace", label: "Resolution Ace", description: "Resolution sub-score 9+ on 5 consecutive calls", icon: "check-circle" },
] as const;

export type BadgeType = typeof BADGE_TYPES[number]["value"];

export const badgeSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  badgeType: z.string(),
  callId: z.string().optional(),
  earnedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type Badge = z.infer<typeof badgeSchema>;

export const insertBadgeSchema = badgeSchema.omit({ id: true });
export type InsertBadge = z.infer<typeof insertBadgeSchema>;

/** Leaderboard entry (computed, not stored) */
export type LeaderboardEntry = {
  employeeId: string;
  employeeName: string;
  subTeam?: string;
  totalCalls: number;
  avgScore: number;
  totalPoints: number;
  currentStreak: number;
  badges: Badge[];
  rank: number;
};

/**
 * A4/F13: Storage-level row for the leaderboard. Aggregated server-side so
 * the gamification service doesn't have to scan every call in memory.
 * `recentScores` is the most recent N performance scores in DESC order
 * by uploaded_at — used by the streak calculation. `recentScoresLimit`
 * documents how many were fetched (the storage layer caps this).
 */
export type LeaderboardRow = {
  employeeId: string;
  employeeName: string;
  subTeam?: string;
  totalCalls: number;
  scoreSum: number;
  scoreCount: number;
  recentScores: number[]; // newest first
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
