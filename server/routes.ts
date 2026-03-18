import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import passport from "passport";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { aiProvider } from "./services/ai-factory";
import { BedrockProvider } from "./services/bedrock";
import { buildAgentSummaryPrompt, buildAnalysisPrompt, parseJsonResponse } from "./services/ai-provider";
import { requireAuth, requireRole } from "./auth";
import { broadcastCallUpdate } from "./services/websocket";
import { logPhiAccess, auditContext } from "./services/audit-log";
import { JobQueue, type Job } from "./services/job-queue";
import { bedrockBatchService, type PendingBatchItem, type BatchJob } from "./services/bedrock-batch";
import { getPool } from "./db/pool";
import { insertEmployeeSchema, insertAccessRequestSchema, insertPromptTemplateSchema, insertCoachingSessionSchema, CALL_CATEGORIES, BEDROCK_MODEL_PRESETS, type UsageRecord } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import csv from "csv-parser";

/** Parse an integer query param with bounds, returning defaultVal on NaN/missing. */
function clampInt(value: string | undefined, defaultVal: number, min: number, max: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultVal : Math.max(min, Math.min(n, max));
}

/** Parse a date query param, returning undefined if invalid. */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Safe parseFloat that returns fallback on NaN. */
function safeFloat(value: string | undefined | null, fallback = 0): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/** Safe JSON.parse that returns fallback on failure. */
function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Concurrency-limited task queue for expensive async operations. */
class TaskQueue {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private concurrency: number) {}
  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        fn().then(resolve, reject).finally(() => {
          this.running--;
          if (this.queue.length > 0) this.queue.shift()!();
        });
      };
      if (this.running < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}

// Limit concurrent audio processing to 3 parallel jobs (fallback when no DB)
const audioProcessingQueue = new TaskQueue(3);

// Durable job queue (initialized if PostgreSQL is available)
let jobQueue: JobQueue | null = null;

/** Estimate Bedrock cost based on model and token counts. Prices per 1K tokens (input/output).
 *  Note: When BEDROCK_BATCH_MODE=true, actual cost is 50% of these rates. Callers
 *  for batch usage should multiply result by 0.5. */
function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number {
  // Approximate on-demand pricing per 1K tokens (input, output) — updated as of 2026
  const pricing: Record<string, [number, number]> = {
    "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
    "us.anthropic.claude-sonnet-4-20250514": [0.003, 0.015],
    "us.anthropic.claude-haiku-4-5-20251001": [0.001, 0.005],
    "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
    "anthropic.claude-3-5-sonnet-20241022": [0.003, 0.015],
  };
  const [inputRate, outputRate] = pricing[model] || [0.003, 0.015]; // default to Sonnet pricing
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

/** Estimate AssemblyAI cost: base $0.15/hr + sentiment $0.02/hr = $0.17/hr = ~$0.0000472/sec */
function estimateAssemblyAICost(durationSeconds: number): number {
  return durationSeconds * 0.0000472;
}

/**
 * Determine if batch processing should be used for a given upload.
 * Considers: BEDROCK_BATCH_MODE env var, time-of-day schedule, and per-upload override.
 *
 * Schedule: BATCH_SCHEDULE_START / BATCH_SCHEDULE_END (24h format, e.g. "18:00" / "08:00")
 * When set, batch mode is only active during the scheduled window.
 * Outside the window, on-demand is used even if BEDROCK_BATCH_MODE=true.
 *
 * Per-upload override: "immediate" forces on-demand, "batch" forces batch.
 */
function shouldUseBatchMode(perUploadOverride?: string): boolean {
  // Per-upload override takes priority
  if (perUploadOverride === "immediate") return false;
  if (perUploadOverride === "batch") return bedrockBatchService.isAvailable;

  // Must have batch mode enabled at all
  if (!bedrockBatchService.isAvailable) return false;

  // Check time-of-day schedule
  const scheduleStart = process.env.BATCH_SCHEDULE_START; // e.g. "18:00"
  const scheduleEnd = process.env.BATCH_SCHEDULE_END;     // e.g. "08:00"

  if (scheduleStart && scheduleEnd) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = scheduleStart.split(":").map(Number);
    const [endH, endM] = scheduleEnd.split(":").map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);

    if (startMinutes <= endMinutes) {
      // Same-day window (e.g. 09:00 - 17:00)
      if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
    } else {
      // Overnight window (e.g. 18:00 - 08:00)
      if (currentMinutes < startMinutes && currentMinutes >= endMinutes) return false;
    }
  }

  return true;
}

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit (sufficient for typical call recordings)
  },
  fileFilter: (req, file, cb) => {
    // Validate both file extension and MIME type
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'];
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/flac', 'audio/x-flac',
      'audio/ogg', 'audio/vorbis', 'video/mp4',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    if (allowedTypes.includes(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files (MP3, WAV, M4A, MP4, FLAC, OGG) are allowed.'), false);
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {

  // ==================== AUTH ROUTES (unauthenticated) ====================
  // Users are managed via AUTH_USERS environment variable (no registration)

  // Login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
      });
    })(req, res, next);
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        res.status(500).json({ message: "Failed to logout" });
        return;
      }
      res.json({ message: "Logged out" });
    });
  });

  // Get current session user
  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  // ==================== ACCESS REQUEST ROUTES (unauthenticated) ====================

  // Submit an access request (public — anyone can request from login page)
  app.post("/api/access-requests", async (req, res) => {
    try {
      const parsed = insertAccessRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request data", errors: parsed.error.flatten() });
        return;
      }
      const request = await storage.createAccessRequest(parsed.data);
      res.status(201).json({ message: "Access request submitted. An administrator will review your request.", id: request.id });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit access request" });
    }
  });

  // ==================== ACCESS REQUEST ADMIN ROUTES (admin only) ====================

  // List all access requests
  app.get("/api/access-requests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const requests = await storage.getAllAccessRequests();
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch access requests" });
    }
  });

  // Approve or deny an access request
  const accessRequestUpdateSchema = z.object({
    status: z.enum(["approved", "denied"]),
  }).strict();

  app.patch("/api/access-requests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const parsed = accessRequestUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Status must be 'approved' or 'denied'" });
        return;
      }
      const updated = await storage.updateAccessRequest(req.params.id, {
        status: parsed.data.status,
        reviewedBy: req.user?.username,
        reviewedAt: new Date().toISOString(),
      });
      if (!updated) {
        res.status(404).json({ message: "Access request not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update access request" });
    }
  });

  // ==================== PROMPT TEMPLATE ROUTES (admin only) ====================

  app.get("/api/prompt-templates", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const templates = await storage.getAllPromptTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch prompt templates" });
    }
  });

  app.post("/api/prompt-templates", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: parsed.error.flatten() });
        return;
      }
      const template = await storage.createPromptTemplate({
        ...parsed.data,
        updatedBy: req.user?.username,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to create prompt template" });
    }
  });

  app.patch("/api/prompt-templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      // Validate the update: allow only known template fields
      const { updatedBy: _ignore, id: _ignoreId, ...bodyWithoutMeta } = req.body;
      const templateUpdateParsed = insertPromptTemplateSchema.partial().safeParse(bodyWithoutMeta);
      if (!templateUpdateParsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: templateUpdateParsed.error.flatten() });
        return;
      }
      const updated = await storage.updatePromptTemplate(req.params.id, {
        ...templateUpdateParsed.data,
        updatedBy: req.user?.username,
      });
      if (!updated) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update prompt template" });
    }
  });

  app.delete("/api/prompt-templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePromptTemplate(req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ==================== PROTECTED ROUTES ====================

  // Dashboard metrics
  app.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Failed to get dashboard metrics:", (error as Error).message);
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  app.get("/api/dashboard/sentiment", requireAuth, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      console.error("Failed to get sentiment distribution:", (error as Error).message);
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  app.get("/api/dashboard/performers", requireAuth, async (req, res) => {
    try {
      const limit = clampInt(req.query.limit as string | undefined, 3, 1, 100);
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
      console.error("Failed to get top performers:", (error as Error).message);
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });

  // Get all employees
  app.get("/api/employees", requireAuth, async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });

  // HIPAA: Only managers and admins can create employees
  app.post("/api/employees", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const validatedData = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(validatedData);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid employee data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create employee" });
      }
    }
  });

  // HIPAA: Only managers and admins can update employees
  const updateEmployeeSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role: z.string().optional(),
    status: z.string().optional(),
    initials: z.string().max(2).optional(),
    subTeam: z.string().optional(),
  }).strict();

  app.patch("/api/employees/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateEmployeeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const employee = await storage.getEmployee(req.params.id);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }
      const updated = await storage.updateEmployee(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  // Assign/reassign employee to a call (managers and admins only)
  const assignCallSchema = z.object({
    employeeId: z.string().optional(),
  }).strict();

  app.patch("/api/calls/:id/assign", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = assignCallSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request data", errors: parsed.error.flatten() });
        return;
      }
      const { employeeId } = parsed.data;
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }
      const updated = await storage.updateCall(req.params.id, { employeeId: employeeId || undefined });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign employee to call" });
    }
  });

  // HIPAA: Only admins can bulk import employees
  app.post("/api/employees/import-csv", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const csvFilePath = path.resolve("employees.csv");
      if (!fs.existsSync(csvFilePath)) {
        res.status(404).json({ message: "employees.csv not found on server" });
        return;
      }

      const MAX_CSV_ROWS = 500;
      const results: Array<{ name: string; action: string }> = [];
      const rows: any[] = [];

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(csv())
          .on("data", (row: any) => {
            if (rows.length < MAX_CSV_ROWS) rows.push(row);
          })
          .on("end", resolve)
          .on("error", reject);
      });

      if (rows.length === 0) {
        res.status(400).json({ message: "CSV file is empty or has no valid rows" });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      for (const row of rows) {
        const name = (row["Agent Name"] || "").trim();
        const department = (row["Department"] || "").trim();
        const extension = (row["Extension"] || "").trim().replace(/[^\w.-]/g, "");
        const pseudonym = (row["Pseudonym"] || row["Display Name"] || "").trim();
        const status = (row["Status"] || "Active").trim();

        if (!name || name.length > 100) continue;

        const email = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
          ? `${extension}@company.com`
          : `${name.toLowerCase().replace(/\s+/g, ".")}@company.com`;

        if (!emailRegex.test(email)) {
          results.push({ name, action: "skipped (invalid email)" });
          continue;
        }

        const nameParts = name.split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase();

        const validExtension = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
          ? extension : undefined;

        try {
          const existing = await storage.getEmployeeByEmail(email);
          if (existing) {
            // Update pseudonym/extension if provided and not already set
            if ((pseudonym || validExtension) && (!existing.pseudonym && !existing.extension)) {
              await storage.updateEmployee(existing.id, {
                pseudonym: pseudonym || existing.pseudonym,
                extension: validExtension || existing.extension,
              });
              results.push({ name, action: "updated (pseudonym/extension)" });
            } else {
              results.push({ name, action: "skipped (exists)" });
            }
          } else {
            await storage.createEmployee({
              name, email, role: department, initials, status,
              pseudonym: pseudonym || undefined,
              extension: validExtension,
            });
            results.push({ name, action: "created" });
          }
        } catch (err) {
          results.push({ name, action: `error: ${(err as Error).message}` });
        }
      }

      const created = results.filter(r => r.action === "created").length;
      const skipped = results.filter(r => r.action.startsWith("skipped")).length;
      res.json({ message: `Import complete: ${created} created, ${skipped} skipped`, details: results });
    } catch (error) {
      console.error("CSV import failed:", error);
      res.status(500).json({ message: "Failed to import employees from CSV" });
    }
  });

  // Get all calls with details (paginated)
app.get("/api/calls", requireAuth, async (req, res) => {
  try {
    const { status, sentiment, employee } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 200));

    const calls = await storage.getCallsWithDetails({
      status: status as string,
      sentiment: sentiment as string,
      employee: employee as string
    });

    const total = calls.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = calls.slice(offset, offset + limit);

    res.json({
      calls: paginated,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get calls" });
  }
});

  // Get single call with details
  app.get("/api/calls/:id", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // HIPAA: Log PHI access (viewing call details includes transcript & analysis)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_call_details",
        resourceType: "call",
        resourceId: req.params.id,
      });

      const employee = call.employeeId ? await storage.getEmployee(call.employeeId) : undefined;
      const transcript = await storage.getTranscript(call.id);
      const sentiment = await storage.getSentimentAnalysis(call.id);
      const rawAnalysis = await storage.getCallAnalysis(call.id);

      // Normalize analysis for backward-compatibility with older stored data
      const analysis = rawAnalysis ? {
        ...rawAnalysis,
        topics: Array.isArray(rawAnalysis.topics) ? rawAnalysis.topics : [],
        actionItems: Array.isArray(rawAnalysis.actionItems) ? rawAnalysis.actionItems : [],
        flags: Array.isArray(rawAnalysis.flags) ? rawAnalysis.flags : [],
        feedback: (rawAnalysis.feedback && typeof rawAnalysis.feedback === "object" && !Array.isArray(rawAnalysis.feedback))
          ? rawAnalysis.feedback
          : { strengths: [], suggestions: [] },
        summary: typeof rawAnalysis.summary === "string" ? rawAnalysis.summary : "",
      } : undefined;

      res.json({
        ...call,
        employee,
        transcript,
        sentiment,
        analysis
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get call" });
    }
  });

  // Upload call recording
  app.post("/api/calls/upload", requireAuth, upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId } = req.body;
      const validCategories = CALL_CATEGORIES.map(c => c.value) as string[];
      const callCategory = validCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;
      const processingMode = (req.body.processingMode === "immediate" || req.body.processingMode === "batch")
        ? req.body.processingMode as "immediate" | "batch"
        : undefined;

      // If employeeId provided, verify employee exists
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      // Create call record (employeeId is optional — can be assigned later)
      const call = await storage.createCall({
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: "processing",
        callCategory: callCategory || undefined,
      });

      // Read file buffer for API upload, then start async processing
      const audioBuffer = await fs.promises.readFile(req.file.path);
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const uploadUser = (req.user as any)?.username || "unknown";

      // Archive audio to S3 immediately (before queuing)
      try {
        await storage.uploadAudio(call.id, originalName, audioBuffer, mimeType);
      } catch (archiveError) {
        console.warn(`[${call.id}] Warning: Failed to archive audio to S3 (continuing):`, archiveError);
      }

      // Use durable job queue if PostgreSQL is available, otherwise fall back to in-memory queue
      if (jobQueue) {
        await jobQueue.enqueue("process_audio", {
          callId: call.id,
          filePath: req.file.path,
          originalName,
          mimeType,
          callCategory: callCategory || null,
          uploadedBy: uploadUser,
          processingMode: processingMode || null,
        });
      } else {
        audioProcessingQueue.add(() => processAudioFile(call.id, req.file!.path, audioBuffer, originalName, mimeType, callCategory, uploadUser, processingMode))
          .catch(async (error) => {
            console.error(`Failed to process call ${call.id}:`, error);
            try {
              await storage.updateCall(call.id, { status: "failed" });
            } catch (updateErr) {
              console.error(`Failed to mark call ${call.id} as failed:`, updateErr);
            }
          });
      }

      res.status(201).json(call);
    } catch (error) {
      console.error("Error during file upload:", error);
      // HIPAA: Ensure file is cleaned up on any error
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  // Delete uploaded file after processing
  async function cleanupFile(filePath: string) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Failed to cleanup file:', error);
    }
  }

// Process audio file with AssemblyAI and archive to cloud storage
async function processAudioFile(callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string, uploadedBy?: string, processingMode?: string) {
  console.log(`[${callId}] Starting audio processing...`);
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." });
  try {
    // Step 1a: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload to AssemblyAI successful.`);

    // Step 1b: Archive audio to cloud storage (skip if already archived by job queue)
    const existingAudio = await storage.getAudioFiles(callId);
    if (existingAudio.length === 0) {
      console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
      try {
        await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
        console.log(`[${callId}] Step 1b/7: Audio archived.`);
      } catch (archiveError) {
        console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, archiveError);
      }
    } else {
      console.log(`[${callId}] Step 1b/7: Audio already archived, skipping.`);
    }

    // Step 2: Start transcription (with agent name word boost for correct spelling)
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." });
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);

    // Build word boost list from employee names (helps AssemblyAI spell names correctly)
    let wordBoost: string[] | undefined;
    try {
      const allEmployees = await storage.getAllEmployees();
      const nameWords = new Set<string>();
      for (const emp of allEmployees) {
        // Add each part of the name (first name, last name) and pseudonym parts
        for (const part of emp.name.split(/\s+/)) {
          if (part.length >= 3) nameWords.add(part);
        }
        if (emp.pseudonym) {
          // Extract names from pseudonym like "Camila (Cheshta) Bhutani"
          const cleaned = emp.pseudonym.replace(/[()]/g, " ");
          for (const part of cleaned.split(/\s+/)) {
            if (part.length >= 3) nameWords.add(part);
          }
        }
      }
      // Also add common company-specific terms
      nameWords.add("UMS");
      if (nameWords.size > 0) {
        wordBoost = Array.from(nameWords).slice(0, 100); // AssemblyAI limit: 100 words
      }
    } catch (boostErr) {
      console.warn(`[${callId}] Failed to build word boost list (non-blocking):`, (boostErr as Error).message);
    }

    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl, wordBoost);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." });
    console.log(`[${callId}] Step 3/7: Polling for transcript results...`);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    // --- CRITICAL SAFETY CHECK ---
    // This prevents the crash if polling fails to return a valid result.
    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Step 4: AI analysis (Bedrock/Claude — or fall back to defaults)
    broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." });
    let aiAnalysis = null;

    // Load custom prompt template for this call category (if configured)
    let promptTemplate = undefined;
    if (callCategory) {
      try {
        const tmpl = await storage.getPromptTemplateByCategory(callCategory);
        if (tmpl) {
          promptTemplate = {
            evaluationCriteria: tmpl.evaluationCriteria,
            requiredPhrases: tmpl.requiredPhrases,
            scoringWeights: tmpl.scoringWeights,
            additionalInstructions: tmpl.additionalInstructions,
          };
          console.log(`[${callId}] Using custom prompt template: ${tmpl.name}`);
        }
      } catch (tmplError) {
        console.warn(`[${callId}] Failed to load prompt template (using defaults):`, (tmplError as Error).message);
      }
    }

    // Batch mode: defer AI analysis for 50% cost savings
    // Checks: env var enabled, time-of-day schedule, and per-upload override
    if (shouldUseBatchMode(processingMode) && aiProvider.isAvailable && transcriptResponse.text) {
      const prompt = buildAnalysisPrompt(transcriptResponse.text, callCategory, promptTemplate);
      const pendingItem: PendingBatchItem = {
        callId,
        prompt,
        callCategory,
        uploadedBy,
        timestamp: new Date().toISOString(),
      };

      try {
        // Save pending item and transcript data to S3 for batch processing
        const s3Client = (storage as any).audioClient || (storage as any).client;
        if (s3Client) {
          await s3Client.uploadJson(`batch-inference/pending/${callId}.json`, {
            ...pendingItem,
            transcriptResponse: {
              text: transcriptResponse.text,
              confidence: transcriptResponse.confidence,
              words: transcriptResponse.words,
              sentiment_analysis_results: transcriptResponse.sentiment_analysis_results,
              status: transcriptResponse.status,
            },
          });
        }
        console.log(`[${callId}] Step 4/6: Deferred to batch analysis (50% cost savings). Will be processed in next batch cycle.`);
        broadcastCallUpdate(callId, "awaiting_analysis", { step: 4, totalSteps: 6, label: "Queued for batch analysis..." });

        // Store transcript and sentiment now (analysis will come later from batch)
        const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId);
        await storage.createTranscript(transcript);
        await storage.createSentimentAnalysis(sentiment);
        // Store partial analysis with defaults — batch will overwrite when complete
        analysis.confidenceScore = "0.300";
        analysis.confidenceFactors = {
          transcriptConfidence: transcriptResponse.confidence || 0,
          wordCount: transcriptResponse.words?.length || 0,
          callDurationSeconds: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
          transcriptLength: transcriptResponse.text.length,
          aiAnalysisCompleted: false,
          overallScore: 0.3,
        };
        const existingFlags = (analysis.flags as string[]) || [];
        existingFlags.push("awaiting_batch_analysis");
        analysis.flags = existingFlags;
        await storage.createCallAnalysis(analysis);

        await storage.updateCall(callId, {
          status: "awaiting_analysis",
          duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
        });

        // Track usage (transcription only — Bedrock cost tracked when batch completes)
        try {
          const audioDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
          const assemblyaiCost = estimateAssemblyAICost(audioDuration);
          const usageRecord: UsageRecord = {
            id: randomUUID(),
            callId,
            type: "call",
            timestamp: new Date().toISOString(),
            user: uploadedBy || "unknown",
            services: {
              assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
            },
            totalEstimatedCost: Math.round(assemblyaiCost * 10000) / 10000,
          };
          await storage.createUsageRecord(usageRecord);
        } catch (usageErr) {
          console.warn(`[${callId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
        }

        await cleanupFile(filePath);
        console.log(`[${callId}] Transcription complete, awaiting batch analysis.`);
        return; // Exit early — batch scheduler handles the rest
      } catch (batchErr) {
        console.warn(`[${callId}] Failed to defer to batch (falling back to on-demand):`, (batchErr as Error).message);
        // Fall through to on-demand analysis
      }
    }

    if (aiProvider.isAvailable && transcriptResponse.text) {
      try {
        const transcriptText = transcriptResponse.text;
        const transcriptCharCount = transcriptText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name}). Transcript: ${transcriptCharCount} chars (~${estimatedTokens} tokens)`);

        if (estimatedTokens > 100000) {
          console.warn(`[${callId}] Very long transcript (${estimatedTokens} estimated tokens). Analysis quality may be reduced for the longest calls.`);
        }

        aiAnalysis = await aiProvider.analyzeCallTranscript(transcriptText, callId, callCategory, promptTemplate);
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, (aiError as Error).message);
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." });
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);

    // Compute confidence score based on transcript quality and analysis completeness
    const transcriptConfidence = transcriptResponse.confidence || 0;
    const wordCount = transcriptResponse.words?.length || 0;
    const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
    const hasAiAnalysis = aiAnalysis !== null;

    // Factors: transcript confidence (0-1), word count adequacy, AI analysis success, call duration
    const wordConfidence = Math.min(wordCount / 50, 1); // <50 words = low confidence
    const durationConfidence = callDuration > 30 ? 1 : callDuration / 30; // <30s = low confidence
    const aiConfidence = hasAiAnalysis ? 1 : 0.3;

    const confidenceScore = (
      transcriptConfidence * 0.4 +
      wordConfidence * 0.2 +
      durationConfidence * 0.15 +
      aiConfidence * 0.25
    );

    const transcriptCharCount = (transcriptResponse.text || "").length;
    const confidenceFactors = {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: transcriptCharCount,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(confidenceScore * 100) / 100,
    };

    // Attach confidence to analysis
    analysis.confidenceScore = confidenceScore.toFixed(3);
    analysis.confidenceFactors = confidenceFactors;

    // Attach sub-scores from AI analysis
    if (aiAnalysis?.sub_scores) {
      analysis.subScores = {
        compliance: aiAnalysis.sub_scores.compliance ?? 0,
        customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
        communication: aiAnalysis.sub_scores.communication ?? 0,
        resolution: aiAnalysis.sub_scores.resolution ?? 0,
      };
    }

    // Attach detected agent name
    if (aiAnalysis?.detected_agent_name) {
      analysis.detectedAgentName = aiAnalysis.detected_agent_name;
    }

    // Flag low confidence
    if (confidenceScore < 0.7) {
      const existingFlags = (analysis.flags as string[]) || [];
      existingFlags.push("low_confidence");
      analysis.flags = existingFlags;
    }

    console.log(`[${callId}] Step 5/6: Data processing complete. Confidence: ${(confidenceScore * 100).toFixed(0)}%`);

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." });
    console.log(`[${callId}] Step 6/6: Saving analysis results...`);
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    // Auto-assign to employee based on detected agent name (if call is unassigned)
    const currentCall = await storage.getCall(callId);
    let autoAssigned = false;
    if (!currentCall?.employeeId && aiAnalysis?.detected_agent_name) {
      const detectedName = aiAnalysis.detected_agent_name.toLowerCase().trim();
      const allEmployees = await storage.getAllEmployees();

      // Priority 1: Exact full name match
      let matchedEmployee = allEmployees.find(emp =>
        emp.name.toLowerCase() === detectedName
      );

      // Priority 2: First name match — only if exactly one employee matches (avoid ambiguity)
      if (!matchedEmployee) {
        const firstNameMatches = allEmployees.filter(emp =>
          emp.name.toLowerCase().split(" ")[0] === detectedName
        );
        if (firstNameMatches.length === 1) {
          matchedEmployee = firstNameMatches[0];
        } else if (firstNameMatches.length > 1) {
          console.log(`[${callId}] Detected agent "${detectedName}" matches ${firstNameMatches.length} employees — skipping ambiguous auto-assign.`);
        }
      }

      if (matchedEmployee) {
        await storage.updateCall(callId, { employeeId: matchedEmployee.id });
        autoAssigned = true;
        console.log(`[${callId}] Auto-assigned to employee: ${matchedEmployee.name} (${matchedEmployee.id})`);
      } else {
        console.log(`[${callId}] Detected agent name "${detectedName}" but no matching employee found.`);
      }
    }

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${autoAssigned ? " (auto-assigned)" : ""}`);


    // Track usage/cost
    try {
      const audioDuration = callDuration || 0;
      const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
      const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500; // transcript + prompt overhead
      const estimatedOutputTokens = 800; // typical analysis response
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const bedrockCost = hasAiAnalysis ? estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) : 0;

      const usageRecord: UsageRecord = {
        id: randomUUID(),
        callId,
        type: "call",
        timestamp: new Date().toISOString(),
        user: uploadedBy || "unknown",
        services: {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
          bedrock: hasAiAnalysis ? {
            model: bedrockModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(bedrockCost * 10000) / 10000,
          } : undefined,
        },
        totalEstimatedCost: Math.round((assemblyaiCost + bedrockCost) * 10000) / 10000,
      };
      await storage.createUsageRecord(usageRecord);
    } catch (usageErr) {
      console.warn(`[${callId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
    }

    await cleanupFile(filePath);
    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" });
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    // HIPAA: Only log error message, not full stack which may contain PHI
    console.error(`[${callId}] A critical error occurred during audio processing:`, (error as Error).message);
    await storage.updateCall(callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" });
    await cleanupFile(filePath);
  }
}

  // Stream audio file from cloud storage for playback or download
  app.get("/api/calls/:id/audio", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // HIPAA: Log PHI access (audio recording is PHI)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: req.query.download === "true" ? "download_audio" : "stream_audio",
        resourceType: "audio",
        resourceId: req.params.id,
      });

      // List audio files for this call (stored under audio/{callId}/)
      const audioFiles = await storage.getAudioFiles(req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      // Download the first audio file
      const audioBuffer = await storage.downloadAudio(audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json({ message: "Audio file could not be retrieved" });
        return;
      }

      // Determine content type from file extension
      const ext = path.extname(audioFiles[0]).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
      };
      const contentType = mimeTypes[ext] || 'audio/mpeg';

      // If ?download=true, set Content-Disposition to force download
      if (req.query.download === 'true') {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        // Sanitize filename: remove path traversal, control chars, and non-ASCII
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_");
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      // HIPAA: Prevent browser/proxy caching of PHI audio data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');

      // Support HTTP Range requests for audio seeking/streaming
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : audioBuffer.length - 1;
          const chunkSize = end - start + 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${audioBuffer.length}`);
          res.setHeader('Content-Length', chunkSize.toString());
          res.send(audioBuffer.subarray(start, end + 1));
          return;
        }
      }

      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.send(audioBuffer);
    } catch (error) {
      console.error("Failed to stream audio:", error);
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  // Get transcript for a call
  app.get("/api/calls/:id/transcript", requireAuth, async (req, res) => {
    try {
      // HIPAA: Log PHI access (transcript is PHI)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });

      const transcript = await storage.getTranscript(req.params.id);
      if (!transcript) {
        res.status(404).json({ message: "Transcript not found" });
        return;
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json({ message: "Failed to get transcript" });
    }
  });

  // Get sentiment analysis for a call
  app.get("/api/calls/:id/sentiment", requireAuth, async (req, res) => {
    try {
      // HIPAA: Log PHI access (sentiment analysis may contain PHI)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_sentiment",
        resourceType: "sentiment",
        resourceId: req.params.id,
      });

      const sentiment = await storage.getSentimentAnalysis(req.params.id);
      if (!sentiment) {
        res.status(404).json({ message: "Sentiment analysis not found" });
        return;
      }
      res.json(sentiment);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment analysis" });
    }
  });

  // Get analysis for a call
  app.get("/api/calls/:id/analysis", requireAuth, async (req, res) => {
    try {
      // HIPAA: Log PHI access (call analysis may contain PHI)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_analysis",
        resourceType: "analysis",
        resourceId: req.params.id,
      });

      const analysis = await storage.getCallAnalysis(req.params.id);
      if (!analysis) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ message: "Failed to get call analysis" });
    }
  });

  // HIPAA: Only managers and admins can manually edit call analysis
  app.patch("/api/calls/:id/analysis", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;
      const { updates, reason } = req.body;

      // HIPAA: Log PHI modification
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "edit_call_analysis",
        resourceType: "analysis",
        resourceId: callId,
        detail: `reason: ${reason}; fields: ${updates ? Object.keys(updates).join(",") : "none"}`,
      });

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ message: "A reason for the manual edit is required." });
        return;
      }

      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        res.status(400).json({ message: "Updates must be a non-empty object." });
        return;
      }

      // Whitelist allowed fields to prevent arbitrary overwrites
      const ALLOWED_FIELDS = new Set([
        "summary", "performanceScore", "topics", "actionItems",
        "feedback", "flags", "sentiment", "sentimentScore",
      ]);
      const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
      if (disallowed.length > 0) {
        res.status(400).json({ message: `Cannot edit fields: ${disallowed.join(", ")}` });
        return;
      }

      const existing = await storage.getCallAnalysis(callId);
      if (!existing) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      // Get the current user for the audit signature
      const user = (req as any).user;
      const editedBy = user?.name || user?.username || "Unknown User";

      // Record the manual edit in the audit trail
      const previousEdits = Array.isArray(existing.manualEdits) ? existing.manualEdits : [];
      const editRecord = {
        editedBy,
        editedAt: new Date().toISOString(),
        reason: reason.trim(),
        fieldsChanged: Object.keys(updates),
        previousValues: {} as Record<string, any>,
      };

      // Capture previous values for changed fields
      for (const key of Object.keys(updates)) {
        editRecord.previousValues[key] = (existing as any)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      // Re-save the analysis
      await storage.createCallAnalysis(updatedAnalysis);

      console.log(`[${callId}] Manual edit by ${editedBy}: ${reason} (fields: ${editRecord.fieldsChanged.join(", ")})`);
      res.json(updatedAnalysis);
    } catch (error) {
      // HIPAA: Log failed modification attempts
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "edit_call_analysis_failed",
        resourceType: "analysis",
        resourceId: req.params.id,
        detail: (error as Error).message,
      });
      console.error("Failed to update call analysis:", (error as Error).message);
      res.status(500).json({ message: "Failed to update call analysis" });
    }
  });

  // Search calls
  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ message: "Search query is required" });
        return;
      }
      if (query.length > 500) {
        res.status(400).json({ message: "Search query too long (max 500 characters)" });
        return;
      }

      const limit = clampInt(req.query.limit as string | undefined, 50, 1, 200);
      const results = await storage.searchCalls(query, limit);

      // Apply optional client-side filters for sentiment, score range, date range
      let filtered = results;
      const sentimentParam = req.query.sentiment as string;
      if (sentimentParam && sentimentParam !== "all") {
        filtered = filtered.filter(c => c.sentiment?.overallSentiment === sentimentParam);
      }
      const minScore = parseFloat(req.query.minScore as string);
      const maxScore = parseFloat(req.query.maxScore as string);
      if (!isNaN(minScore)) {
        filtered = filtered.filter(c => parseFloat(c.analysis?.performanceScore || "0") >= minScore);
      }
      if (!isNaN(maxScore)) {
        filtered = filtered.filter(c => parseFloat(c.analysis?.performanceScore || "10") <= maxScore);
      }
      const fromDate = parseDate(req.query.from as string);
      const toDate = parseDate(req.query.to as string);
      if (fromDate) {
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate!);
      }
      if (toDate) {
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate!);
      }

      res.json(filtered);
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls" });
    }
  });

  // This new route will handle requests for the Performance page
app.get("/api/performance", requireAuth, async (req, res) => {
  try {
    // We can reuse the existing function to get top performers
    const performers = await storage.getTopPerformers(10); // Get top 10
    res.json(performers);
  } catch (error) {
    console.error("Failed to get performance data:", error);
    res.status(500).json({ message: "Failed to get performance data" });
  }
});

  app.get("/api/reports/summary", requireAuth, async (req, res) => {
  try {
    const metrics = await storage.getDashboardMetrics();
    const sentiment = await storage.getSentimentDistribution();
    const performers = await storage.getTopPerformers(5);

    const reportData = {
      metrics,
      sentiment,
      performers,
    };

    res.json(reportData);
  } catch (error) {
    console.error("Failed to generate report data:", error);
    res.status(500).json({ message: "Failed to generate report data" });
  }
});

  // Filtered reports: accepts date range, employee, department filters
  app.get("/api/reports/filtered", requireAuth, async (req, res) => {
    try {
      const { from, to, employeeId, department, callPartyType } = req.query;

      const allCalls = await storage.getCallsWithDetails({ status: "completed" });
      const employees = await storage.getAllEmployees();

      // Build employee lookup maps
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      // Filter by date range (validate dates)
      let filtered = allCalls;
      const fromDate = parseDate(from as string | undefined);
      if (fromDate) {
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      const toDate = parseDate(to as string | undefined);
      if (toDate) {
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Filter by employee
      if (employeeId) {
        filtered = filtered.filter(c => c.employeeId === employeeId);
      }

      // Filter by department
      if (department) {
        filtered = filtered.filter(c => {
          if (!c.employeeId) return false;
          const emp = employeeMap.get(c.employeeId);
          return emp?.role === department;
        });
      }

      // Filter by call party type
      if (callPartyType) {
        filtered = filtered.filter(c => {
          const partyType = (c.analysis as any)?.callPartyType;
          return partyType === callPartyType;
        });
      }

      // Compute metrics from filtered set
      const totalCalls = filtered.length;
      const sentiments = filtered.map(c => c.sentiment).filter(Boolean);
      const analyses = filtered.map(c => c.analysis).filter(Boolean);

      const avgSentiment = sentiments.length > 0
        ? (sentiments.reduce((sum, s) => sum + safeFloat(s!.overallScore), 0) / sentiments.length) * 10
        : 0;
      const avgPerformanceScore = analyses.length > 0
        ? analyses.reduce((sum, a) => sum + safeFloat(a!.performanceScore), 0) / analyses.length
        : 0;

      const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
      for (const s of sentiments) {
        const key = s!.overallSentiment as keyof typeof sentimentDist;
        if (key in sentimentDist) sentimentDist[key]++;
      }

      // Per-employee stats for performers list
      const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
      for (const call of filtered) {
        if (!call.employeeId) continue;
        const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
        stats.callCount++;
        if (call.analysis?.performanceScore) {
          stats.totalScore += safeFloat(call.analysis.performanceScore);
        }
        employeeStats.set(call.employeeId, stats);
      }

      const performers = Array.from(employeeStats.entries())
        .map(([empId, stats]) => {
          const emp = employeeMap.get(empId);
          return {
            id: empId,
            name: emp?.name || "Unknown",
            role: emp?.role || "",
            avgPerformanceScore: stats.callCount > 0
              ? Math.round((stats.totalScore / stats.callCount) * 100) / 100
              : null,
            totalCalls: stats.callCount,
          };
        })
        .filter(p => p.totalCalls > 0)
        .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0));

      // Trend data: group by month
      const trendMap = new Map<string, { calls: number; totalScore: number; scored: number; positive: number; neutral: number; negative: number }>();
      for (const call of filtered) {
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const entry = trendMap.get(monthKey) || { calls: 0, totalScore: 0, scored: 0, positive: 0, neutral: 0, negative: 0 };
        entry.calls++;
        if (call.analysis?.performanceScore) {
          entry.totalScore += safeFloat(call.analysis.performanceScore);
          entry.scored++;
        }
        if (call.sentiment?.overallSentiment) {
          const sent = call.sentiment.overallSentiment as "positive" | "neutral" | "negative";
          if (sent in entry) entry[sent]++;
        }
        trendMap.set(monthKey, entry);
      }

      const trends = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          calls: data.calls,
          avgScore: data.scored > 0 ? Math.round((data.totalScore / data.scored) * 100) / 100 : null,
          positive: data.positive,
          neutral: data.neutral,
          negative: data.negative,
        }));

      // Aggregate sub-scores across all analyzed calls
      const subScoreTotals = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0, count: 0 };
      for (const call of filtered) {
        const ss = (call.analysis as any)?.subScores;
        if (ss && (ss.compliance || ss.customerExperience || ss.communication || ss.resolution)) {
          subScoreTotals.compliance += ss.compliance || 0;
          subScoreTotals.customerExperience += ss.customerExperience || 0;
          subScoreTotals.communication += ss.communication || 0;
          subScoreTotals.resolution += ss.resolution || 0;
          subScoreTotals.count++;
        }
      }

      const avgSubScores = subScoreTotals.count > 0 ? {
        compliance: Math.round((subScoreTotals.compliance / subScoreTotals.count) * 100) / 100,
        customerExperience: Math.round((subScoreTotals.customerExperience / subScoreTotals.count) * 100) / 100,
        communication: Math.round((subScoreTotals.communication / subScoreTotals.count) * 100) / 100,
        resolution: Math.round((subScoreTotals.resolution / subScoreTotals.count) * 100) / 100,
      } : null;

      // Count auto-assigned calls
      const autoAssignedCount = filtered.filter(c => (c.analysis as any)?.detectedAgentName).length;

      res.json({
        metrics: {
          totalCalls,
          avgSentiment: Math.round(avgSentiment * 100) / 100,
          avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
        },
        sentiment: sentimentDist,
        performers,
        trends,
        avgSubScores,
        autoAssignedCount,
      });
    } catch (error) {
      console.error("Failed to generate filtered report:", error);
      res.status(500).json({ message: "Failed to generate filtered report" });
    }
  });

  // Agent profile: aggregated feedback across all calls for an employee
  app.get("/api/reports/agent-profile/:employeeId", requireAuth, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.query;

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });

      // Apply optional date filters (validate dates)
      let filtered = allCalls;
      const fromDate = parseDate(from as string | undefined);
      if (fromDate) {
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      const toDate = parseDate(to as string | undefined);
      if (toDate) {
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Aggregate all analysis feedback
      const allStrengths: string[] = [];
      const allSuggestions: string[] = [];
      const allTopics: string[] = [];
      const scores: number[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

      // Flagged calls (exceptional and problematic)
      const flaggedCalls: Array<{
        id: string;
        fileName?: string;
        uploadedAt?: string;
        score: number | null;
        summary?: string;
        flags: string[];
        sentiment?: string;
        flagType: "good" | "bad";
      }> = [];

      // Trend over time for this agent
      const monthlyScores = new Map<string, { total: number; count: number }>();

      for (const call of filtered) {
        if (call.analysis) {
          if (call.analysis.performanceScore) {
            scores.push(safeFloat(call.analysis.performanceScore));
          }
          if (call.analysis.feedback) {
            const fb = safeJsonParse<{ strengths: Array<string | { text: string }>; suggestions: Array<string | { text: string }> }>(call.analysis.feedback, { strengths: [], suggestions: [] });
            if (fb.strengths) {
              for (const s of fb.strengths) {
                allStrengths.push(typeof s === "string" ? s : s.text);
              }
            }
            if (fb.suggestions) {
              for (const s of fb.suggestions) {
                allSuggestions.push(typeof s === "string" ? s : s.text);
              }
            }
          }
          if (call.analysis.topics) {
            const topics = safeJsonParse(call.analysis.topics, []);
            if (Array.isArray(topics)) allTopics.push(...topics);
          }

          // Collect flagged calls
          const callFlags = Array.isArray(call.analysis.flags) ? call.analysis.flags as string[] : [];
          const isExceptional = callFlags.includes("exceptional_call");
          const isBad = callFlags.includes("low_score") || callFlags.some((f: unknown) => typeof f === "string" && f.startsWith("agent_misconduct"));
          if (isExceptional || isBad) {
            flaggedCalls.push({
              id: call.id,
              fileName: call.fileName,
              uploadedAt: call.uploadedAt,
              score: call.analysis.performanceScore ? safeFloat(call.analysis.performanceScore) : null,
              summary: call.analysis.summary,
              flags: callFlags,
              sentiment: call.sentiment?.overallSentiment,
              flagType: isExceptional ? "good" : "bad",
            });
          }
        }
        if (call.sentiment?.overallSentiment) {
          const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
          if (s in sentimentCounts) sentimentCounts[s]++;
        }

        // Monthly trend
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (call.analysis?.performanceScore) {
          const entry = monthlyScores.get(monthKey) || { total: 0, count: 0 };
          entry.total += safeFloat(call.analysis.performanceScore);
          entry.count++;
          monthlyScores.set(monthKey, entry);
        }
      }

      // Count frequency of strengths, suggestions, topics
      const countFrequency = (arr: string[]) => {
        const freq = new Map<string, number>();
        for (const item of arr) {
          const normalized = item.trim().toLowerCase();
          freq.set(normalized, (freq.get(normalized) || 0) + 1);
        }
        return Array.from(freq.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([text, count]) => ({ text, count }));
      };

      const avgScore = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : null;
      const highScore = scores.length > 0 ? Math.max(...scores) : null;
      const lowScore = scores.length > 0 ? Math.min(...scores) : null;

      const scoreTrend = Array.from(monthlyScores.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          avgScore: Math.round((data.total / data.count) * 100) / 100,
          calls: data.count,
        }));

      res.json({
        employee: { id: employee.id, name: employee.name, role: employee.role, status: employee.status },
        totalCalls: filtered.length,
        avgPerformanceScore: avgScore,
        highScore,
        lowScore,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFrequency(allStrengths),
        topSuggestions: countFrequency(allSuggestions),
        commonTopics: countFrequency(allTopics),
        scoreTrend,
        flaggedCalls: flaggedCalls.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()),
      });
    } catch (error) {
      console.error("Failed to generate agent profile:", error);
      res.status(500).json({ message: "Failed to generate agent profile" });
    }
  });

  // Generate AI narrative summary for an agent's performance
  app.post("/api/reports/agent-summary/:employeeId", requireAuth, async (req, res) => {
    try {
      if (!aiProvider.isAvailable || !aiProvider.generateText) {
        res.status(503).json({ message: "AI provider not configured. Set up Bedrock or Gemini credentials." });
        return;
      }

      const { employeeId } = req.params;
      const { from, to } = req.body;

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });

      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      if (filtered.length === 0) {
        res.json({ summary: "No analyzed calls found for this employee in the selected period." });
        return;
      }

      // Aggregate data
      const scores: number[] = [];
      const allStrengths: string[] = [];
      const allSuggestions: string[] = [];
      const allTopics: string[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

      for (const call of filtered) {
        if (call.analysis?.performanceScore) {
          scores.push(safeFloat(call.analysis.performanceScore));
        }
        if (call.analysis?.feedback) {
          const fb = safeJsonParse<{ strengths: Array<string | { text: string }>; suggestions: Array<string | { text: string }> }>(call.analysis.feedback, { strengths: [], suggestions: [] });
          if (fb.strengths) {
            for (const s of fb.strengths) {
              allStrengths.push(typeof s === "string" ? s : s.text);
            }
          }
          if (fb.suggestions) {
            for (const s of fb.suggestions) {
              allSuggestions.push(typeof s === "string" ? s : s.text);
            }
          }
        }
        if (call.analysis?.topics) {
          const topics = safeJsonParse(call.analysis.topics, []);
          if (Array.isArray(topics)) allTopics.push(...topics);
        }
        if (call.sentiment?.overallSentiment) {
          const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
          if (s in sentimentCounts) sentimentCounts[s]++;
        }
      }

      const countFreq = (arr: string[]) => {
        const freq = new Map<string, number>();
        for (const item of arr) {
          const n = item.trim().toLowerCase();
          freq.set(n, (freq.get(n) || 0) + 1);
        }
        return Array.from(freq.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([text, count]) => ({ text, count }));
      };

      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      const dateRange = `${from || "all time"} to ${to || "present"}`;

      const prompt = buildAgentSummaryPrompt({
        name: employee.name,
        role: employee.role,
        totalCalls: filtered.length,
        avgScore,
        highScore: scores.length > 0 ? Math.max(...scores) : null,
        lowScore: scores.length > 0 ? Math.min(...scores) : null,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFreq(allStrengths),
        topSuggestions: countFreq(allSuggestions),
        commonTopics: countFreq(allTopics),
        dateRange,
      });

      console.log(`[${req.params.id}] Generating AI summary (${filtered.length} calls)...`);
      const summary = await aiProvider.generateText(prompt);
      console.log(`[${req.params.id}] AI summary generated.`);

      res.json({ summary });
    } catch (error) {
      console.error("Failed to generate agent summary:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate AI summary" });
    }
  });

  // HIPAA: Only managers and admins can delete call records
  app.delete("/api/calls/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
  try {
    const callId = req.params.id;

    // HIPAA: Log PHI deletion
    logPhiAccess({
      ...auditContext(req),
      timestamp: new Date().toISOString(),
      event: "delete_call",
      resourceType: "call",
      resourceId: callId,
    });

    await storage.deleteCall(callId);
    
    console.log(`Successfully deleted call ID: ${callId}`);
    // Send a 204 No Content response for a successful deletion
    res.status(204).send(); 
  } catch (error) {
    logPhiAccess({
      ...auditContext(req),
      timestamp: new Date().toISOString(),
      event: "delete_call_failed",
      resourceType: "call",
      resourceId: req.params.id,
      detail: (error as Error).message,
    });
    console.error("Failed to delete call:", (error as Error).message);
    res.status(500).json({ message: "Failed to delete call" });
  }
});

  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  app.get("/api/coaching", requireAuth, requireRole("manager", "admin"), async (_req, res) => {
    try {
      const [sessions, employees] = await Promise.all([
        storage.getAllCoachingSessions(),
        storage.getAllEmployees(),
      ]);
      // Build employee lookup map to avoid N+1 queries
      const empMap = new Map(employees.map(e => [e.id, e]));
      const enriched = sessions.map(s => ({
        ...s,
        employeeName: empMap.get(s.employeeId)?.name || "Unknown",
      }));
      res.json(enriched.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Get coaching sessions for a specific employee
  app.get("/api/coaching/employee/:employeeId", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getCoachingSessionsByEmployee(req.params.employeeId);
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Create a coaching session (managers and admins)
  app.post("/api/coaching", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid coaching data", errors: parsed.error.flatten() });
        return;
      }
      const session = await storage.createCoachingSession(parsed.data);
      res.status(201).json(session);
    } catch (error) {
      res.status(500).json({ message: "Failed to create coaching session" });
    }
  });

  // Update a coaching session (status, notes, action plan progress)
  const updateCoachingSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "dismissed"]).optional(),
    notes: z.string().optional(),
    actionPlan: z.array(z.object({ task: z.string(), completed: z.boolean() })).optional(),
    title: z.string().min(1).optional(),
    category: z.string().optional(),
    dueDate: z.string().optional(),
  }).strict();

  app.patch("/api/coaching/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const updates: Record<string, any> = { ...parsed.data };
      if (updates.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }
      const updated = await storage.updateCoachingSession(req.params.id, updates);
      if (!updated) {
        res.status(404).json({ message: "Coaching session not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update coaching session" });
    }
  });

  // ==================== COMPANY INSIGHTS API ====================

  app.get("/api/insights", requireAuth, async (_req, res) => {
    try {
      const allCalls = await storage.getCallsWithDetails();
      const completed = allCalls.filter(c => c.status === "completed" && c.analysis);

      // Aggregate topic frequency across all calls
      const topicCounts = new Map<string, number>();
      const complaintsAndFrustrations: Array<{ topic: string; callId: string; date: string; sentiment: string }> = [];
      const escalationPatterns: Array<{ summary: string; callId: string; date: string; score: number }> = [];
      const sentimentByWeek = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();

      for (const call of completed) {
        const topics = (call.analysis?.topics as string[]) || [];
        for (const t of topics) {
          topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
        }

        // Track negative/frustration calls
        const sentiment = call.sentiment?.overallSentiment;
        if (sentiment === "negative") {
          for (const t of topics) {
            complaintsAndFrustrations.push({
              topic: t,
              callId: call.id,
              date: call.uploadedAt || "",
              sentiment: sentiment,
            });
          }
        }

        // Track low-score calls as escalation patterns
        const score = safeFloat(call.analysis?.performanceScore, 10);
        if (score <= 4) {
          escalationPatterns.push({
            summary: call.analysis?.summary || "",
            callId: call.id,
            date: call.uploadedAt || "",
            score,
          });
        }

        // Weekly sentiment trend
        if (call.uploadedAt) {
          const d = new Date(call.uploadedAt);
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - d.getDay());
          const weekKey = weekStart.toISOString().slice(0, 10);
          const entry = sentimentByWeek.get(weekKey) || { positive: 0, neutral: 0, negative: 0, total: 0 };
          entry.total++;
          if (sentiment === "positive") entry.positive++;
          else if (sentiment === "negative") entry.negative++;
          else entry.neutral++;
          sentimentByWeek.set(weekKey, entry);
        }
      }

      // Aggregate complaint topics (topics that appear in negative calls)
      const complaintTopicCounts = new Map<string, number>();
      for (const c of complaintsAndFrustrations) {
        complaintTopicCounts.set(c.topic, (complaintTopicCounts.get(c.topic) || 0) + 1);
      }

      // Sort topics by frequency
      const topTopics = Array.from(topicCounts.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      const topComplaints = Array.from(complaintTopicCounts.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      // Weekly trend sorted chronologically
      const weeklyTrend = Array.from(sentimentByWeek.entries())
        .map(([week, data]) => ({ week, ...data }))
        .sort((a, b) => a.week.localeCompare(b.week));

      // Low-confidence calls
      const lowConfidenceCalls = completed
        .filter(c => {
          const conf = safeFloat(c.analysis?.confidenceScore, 1);
          return conf < 0.7;
        })
        .map(c => ({
          callId: c.id,
          date: c.uploadedAt || "",
          confidence: safeFloat(c.analysis?.confidenceScore),
          employee: c.employee?.name || "Unassigned",
        }));

      res.json({
        totalAnalyzed: completed.length,
        topTopics,
        topComplaints,
        escalationPatterns: escalationPatterns.sort((a, b) => a.score - b.score).slice(0, 20),
        weeklyTrend,
        lowConfidenceCalls: lowConfidenceCalls.slice(0, 20),
        summary: {
          avgScore: completed.length > 0
            ? completed.reduce((sum, c) => sum + safeFloat(c.analysis?.performanceScore), 0) / completed.length
            : 0,
          negativeCallRate: completed.length > 0
            ? completed.filter(c => c.sentiment?.overallSentiment === "negative").length / completed.length
            : 0,
          escalationRate: completed.length > 0
            ? escalationPatterns.length / completed.length
            : 0,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute company insights" });
    }
  });

  // ==================== USAGE TRACKING ROUTES (admin only) ====================

  app.get("/api/usage", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const records = await storage.getAllUsageRecords();
      res.json(records);
    } catch (error) {
      console.error("Error fetching usage records:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch usage data" });
    }
  });

  // ==================== A/B MODEL TESTING ROUTES (admin only) ====================

  // List all A/B tests
  app.get("/api/ab-tests", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const tests = await storage.getAllABTests();
      res.json(tests);
    } catch (error) {
      console.error("Error fetching A/B tests:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch A/B tests" });
    }
  });

  // Get a single A/B test
  app.get("/api/ab-tests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      res.json(test);
    } catch (error) {
      console.error("Error fetching A/B test:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch A/B test" });
    }
  });

  // Upload audio for A/B model comparison
  app.post("/api/ab-tests/upload", requireAuth, requireRole("admin"), upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { testModel } = req.body;
      const validModels = BEDROCK_MODEL_PRESETS.map(m => m.value) as string[];
      if (!testModel || !validModels.includes(testModel)) {
        await cleanupFile(req.file.path);
        res.status(400).json({ message: `Invalid model. Must be one of: ${validModels.join(", ")}` });
        return;
      }
      const abValidCategories = CALL_CATEGORIES.map(c => c.value) as string[];
      const callCategory = abValidCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;

      const user = req.user as any;
      const baselineModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";

      // Create the A/B test record
      const abTest = await storage.createABTest({
        fileName: req.file.originalname,
        callCategory: callCategory || undefined,
        baselineModel,
        testModel,
        status: "processing",
        createdBy: user?.username || "admin",
      });

      // Read file and kick off async processing
      const audioBuffer = await fs.promises.readFile(req.file.path);
      const filePath = req.file.path;

      audioProcessingQueue.add(() => processABTest(abTest.id, filePath, audioBuffer, callCategory))
        .catch(async (error) => {
          console.error(`[AB-${abTest.id}] Processing failed:`, (error as Error).message);
          try {
            await storage.updateABTest(abTest.id, { status: "failed" });
          } catch (updateErr) {
            console.error(`[AB-${abTest.id}] Failed to mark as failed:`, (updateErr as Error).message);
          }
        });

      res.status(201).json(abTest);
    } catch (error) {
      console.error("Error starting A/B test:", (error as Error).message);
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to start A/B test" });
    }
  });

  // Delete an A/B test
  app.delete("/api/ab-tests/:id", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const test = await storage.getABTest(req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      await storage.deleteABTest(req.params.id);
      res.json({ message: "A/B test deleted" });
    } catch (error) {
      console.error("Error deleting A/B test:", (error as Error).message);
      res.status(500).json({ message: "Failed to delete A/B test" });
    }
  });

  // A/B test processing pipeline
  async function processABTest(testId: string, filePath: string, audioBuffer: Buffer, callCategory?: string) {
    console.log(`[AB-${testId}] Starting A/B model comparison...`);
    try {
      const abTest = await storage.getABTest(testId);
      if (!abTest) throw new Error("A/B test record not found");

      // Step 1: Upload to AssemblyAI and transcribe
      console.log(`[AB-${testId}] Step 1: Uploading to AssemblyAI...`);
      const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
      const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

      if (!transcriptResponse || transcriptResponse.status !== 'completed') {
        throw new Error(`Transcription failed. Status: ${transcriptResponse?.status}`);
      }

      const transcriptText = transcriptResponse.text || "";
      await storage.updateABTest(testId, { transcriptText, status: "analyzing" });
      console.log(`[AB-${testId}] Transcription complete (${transcriptText.length} chars)`);

      // Load prompt template if applicable
      let promptTemplate = undefined;
      if (callCategory) {
        try {
          const tmpl = await storage.getPromptTemplateByCategory(callCategory);
          if (tmpl) {
            promptTemplate = {
              evaluationCriteria: tmpl.evaluationCriteria,
              requiredPhrases: tmpl.requiredPhrases,
              scoringWeights: tmpl.scoringWeights,
              additionalInstructions: tmpl.additionalInstructions,
            };
          }
        } catch (e) {
          console.warn(`[AB-${testId}] Failed to load prompt template:`, (e as Error).message);
        }
      }

      // Step 2: Run both models in parallel
      console.log(`[AB-${testId}] Step 2: Running analysis with both models...`);
      const baselineProvider = BedrockProvider.createWithModel(abTest.baselineModel);
      const testProvider = BedrockProvider.createWithModel(abTest.testModel);

      const [baselineResult, testResult] = await Promise.allSettled([
        (async () => {
          const start = Date.now();
          const analysis = await baselineProvider.analyzeCallTranscript(transcriptText, `ab-baseline-${testId}`, callCategory, promptTemplate);
          return { analysis, latencyMs: Date.now() - start };
        })(),
        (async () => {
          const start = Date.now();
          const analysis = await testProvider.analyzeCallTranscript(transcriptText, `ab-test-${testId}`, callCategory, promptTemplate);
          return { analysis, latencyMs: Date.now() - start };
        })(),
      ]);

      const updates: Record<string, any> = { status: "completed" };

      if (baselineResult.status === "fulfilled") {
        updates.baselineAnalysis = baselineResult.value.analysis;
        updates.baselineLatencyMs = baselineResult.value.latencyMs;
        console.log(`[AB-${testId}] Baseline (${abTest.baselineModel}): score=${baselineResult.value.analysis.performance_score}, ${baselineResult.value.latencyMs}ms`);
      } else {
        console.error(`[AB-${testId}] Baseline model failed:`, baselineResult.reason?.message);
        updates.baselineAnalysis = { error: baselineResult.reason?.message || "Analysis failed" };
      }

      if (testResult.status === "fulfilled") {
        updates.testAnalysis = testResult.value.analysis;
        updates.testLatencyMs = testResult.value.latencyMs;
        console.log(`[AB-${testId}] Test (${abTest.testModel}): score=${testResult.value.analysis.performance_score}, ${testResult.value.latencyMs}ms`);
      } else {
        console.error(`[AB-${testId}] Test model failed:`, testResult.reason?.message);
        updates.testAnalysis = { error: testResult.reason?.message || "Analysis failed" };
      }

      // If both failed, mark as failed
      if (baselineResult.status === "rejected" && testResult.status === "rejected") {
        updates.status = "failed";
      }

      await storage.updateABTest(testId, updates);

      // Track usage/cost for A/B test
      try {
        const audioDuration = transcriptText.length > 0
          ? Math.max(30, Math.ceil(transcriptText.length / 20)) // rough estimate from text length
          : 60;
        const assemblyaiCost = estimateAssemblyAICost(audioDuration);
        const estimatedInputTokens = Math.ceil(transcriptText.length / 4) + 500;
        const estimatedOutputTokens = 800;

        let baselineCost = 0;
        let testCost = 0;
        const services: UsageRecord["services"] = {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
        };

        if (baselineResult.status === "fulfilled") {
          baselineCost = estimateBedrockCost(abTest.baselineModel, estimatedInputTokens, estimatedOutputTokens);
          services.bedrock = {
            model: abTest.baselineModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(baselineCost * 10000) / 10000,
            latencyMs: baselineResult.value.latencyMs,
          };
        }
        if (testResult.status === "fulfilled") {
          testCost = estimateBedrockCost(abTest.testModel, estimatedInputTokens, estimatedOutputTokens);
          services.bedrockSecondary = {
            model: abTest.testModel,
            estimatedInputTokens,
            estimatedOutputTokens,
            estimatedCost: Math.round(testCost * 10000) / 10000,
            latencyMs: testResult.value.latencyMs,
          };
        }

        const usageRecord: UsageRecord = {
          id: randomUUID(),
          callId: testId,
          type: "ab-test",
          timestamp: new Date().toISOString(),
          user: abTest.createdBy,
          services,
          totalEstimatedCost: Math.round((assemblyaiCost + baselineCost + testCost) * 10000) / 10000,
        };
        await storage.createUsageRecord(usageRecord);
      } catch (usageErr) {
        console.warn(`[AB-${testId}] Failed to record usage (non-blocking):`, (usageErr as Error).message);
      }

      await cleanupFile(filePath);
      broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete" });
      console.log(`[AB-${testId}] A/B comparison complete.`);

    } catch (error) {
      console.error(`[AB-${testId}] Processing error:`, (error as Error).message);
      await storage.updateABTest(testId, { status: "failed" });
      await cleanupFile(filePath);
    }
  }

  // ==================== ADMIN: QUEUE STATUS ====================
  app.get("/api/admin/queue-status", requireRole("admin"), async (_req, res) => {
    try {
      if (jobQueue) {
        const stats = await jobQueue.getStats();
        res.json(stats);
      } else {
        res.json({ pending: 0, running: 0, completedToday: 0, failedToday: 0, backend: "in-memory" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get queue status" });
    }
  });

  // ==================== ADMIN: DEAD-LETTER QUEUE ====================

  // List dead-letter jobs (failed after max retries)
  app.get("/api/admin/dead-jobs", requireRole("admin"), async (_req, res) => {
    try {
      if (jobQueue) {
        const deadJobs = await jobQueue.getDeadJobs();
        res.json(deadJobs);
      } else {
        res.json([]);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get dead-letter jobs" });
    }
  });

  // Retry a dead-letter job
  app.post("/api/admin/dead-jobs/:id/retry", requireRole("admin"), async (req, res) => {
    try {
      if (!jobQueue) {
        res.status(400).json({ message: "Job queue not available (no database configured)" });
        return;
      }
      const retried = await jobQueue.retryJob(req.params.id);
      if (retried) {
        res.json({ message: "Job re-queued for processing" });
      } else {
        res.status(404).json({ message: "Dead job not found or already retried" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  // ==================== EXPORT: CSV DOWNLOAD ====================

  // Export calls as CSV
  app.get("/api/export/calls", requireAuth, async (req, res) => {
    try {
      const { status, sentiment, employee } = req.query;
      const calls = await storage.getCallsWithDetails({
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
      });

      const header = "Date,Employee,Duration (s),Sentiment,Score,Party Type,Status,Flags,Summary\n";
      const rows = calls.map(c => {
        const date = c.uploadedAt ? new Date(c.uploadedAt).toISOString() : "";
        const employee = (c.employee?.name || "Unassigned").replace(/"/g, '""');
        const duration = c.duration || "";
        const sentiment = c.sentiment?.overallSentiment || "";
        const score = c.analysis?.performanceScore || "";
        const party = c.analysis?.callPartyType || "";
        const status = c.status || "";
        const flags = Array.isArray(c.analysis?.flags) ? (c.analysis.flags as string[]).join("; ") : "";
        const summary = (typeof c.analysis?.summary === "string" ? c.analysis.summary : "").replace(/"/g, '""').replace(/\n/g, " ");
        return `"${date}","${employee}","${duration}","${sentiment}","${score}","${party}","${status}","${flags}","${summary}"`;
      }).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="calls-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(header + rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to export calls" });
    }
  });

  // ==================== ADMIN: BATCH INFERENCE STATUS ====================
  app.get("/api/admin/batch-status", requireRole("admin"), async (_req, res) => {
    try {
      const s3Client = (storage as any).audioClient || (storage as any).client;
      if (!s3Client || !bedrockBatchService.isAvailable) {
        res.json({ enabled: false, message: "Batch mode not enabled. Set BEDROCK_BATCH_MODE=true and BEDROCK_BATCH_ROLE_ARN." });
        return;
      }

      // Count pending items
      const pendingKeys = await s3Client.listObjects("batch-inference/pending/");
      const activeJobs = await s3Client.listAndDownloadJson<BatchJob>("batch-inference/active-jobs/");

      const scheduleStart = process.env.BATCH_SCHEDULE_START || null;
      const scheduleEnd = process.env.BATCH_SCHEDULE_END || null;

      res.json({
        enabled: true,
        currentMode: shouldUseBatchMode() ? "batch" : "immediate",
        schedule: scheduleStart && scheduleEnd
          ? { start: scheduleStart, end: scheduleEnd, description: `Batch from ${scheduleStart} to ${scheduleEnd}, immediate otherwise` }
          : { description: "Always batch (no schedule set — set BATCH_SCHEDULE_START/END for time-based)" },
        pendingItems: pendingKeys.length,
        activeJobs: activeJobs.map((j: BatchJob) => ({
          jobId: j.jobId,
          status: j.status,
          callCount: j.callIds.length,
          createdAt: j.createdAt,
        })),
        batchIntervalMinutes: parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10),
        costSavings: "50% on Bedrock inference",
        perUploadOverride: "Uploads can include processingMode='immediate' or 'batch' to override schedule",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get batch status" });
    }
  });

  // ==================== BATCH INFERENCE SCHEDULER ====================
  if (bedrockBatchService.isAvailable) {
    const batchIntervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || "15", 10);
    console.log(`[BATCH] Batch inference mode enabled. Scheduling every ${batchIntervalMinutes} minutes.`);

    const runBatchCycle = async () => {
      try {
        const s3Client = (storage as any).audioClient || (storage as any).client;
        if (!s3Client) return;

        // 1. Check active jobs for completion
        const activeJobKeys = await s3Client.listObjects("batch-inference/active-jobs/");
        for (const jobKey of activeJobKeys) {
          try {
            const job = await s3Client.downloadJson<BatchJob>(jobKey);
            if (!job) continue;

            const status = await bedrockBatchService.getJobStatus(job.jobArn);
            console.log(`[BATCH] Job ${job.jobId}: ${status.status}`);

            if (status.status === "Completed") {
              // Read results and process
              const results = await bedrockBatchService.readBatchOutput(job.outputS3Uri);
              console.log(`[BATCH] Job ${job.jobId} completed. Processing ${results.size} results.`);

              for (const [callId, analysis] of results) {
                try {
                  // Read the pending data for this call
                  const pendingData = await s3Client.downloadJson<any>(`batch-inference/pending/${callId}.json`);
                  const transcriptResponse = pendingData?.transcriptResponse;

                  if (!transcriptResponse) {
                    console.warn(`[BATCH] No transcript data found for call ${callId}, skipping.`);
                    continue;
                  }

                  // Reprocess with the AI analysis
                  const { transcript: _, sentiment: __, analysis: updatedAnalysis } =
                    assemblyAIService.processTranscriptData(transcriptResponse, analysis, callId);

                  // Compute confidence
                  const transcriptConfidence = transcriptResponse.confidence || 0;
                  const wordCount = transcriptResponse.words?.length || 0;
                  const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
                  const wordConfidence = Math.min(wordCount / 50, 1);
                  const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
                  const confidenceScore = transcriptConfidence * 0.4 + wordConfidence * 0.2 + durationConfidence * 0.15 + 0.25;

                  updatedAnalysis.confidenceScore = confidenceScore.toFixed(3);
                  updatedAnalysis.confidenceFactors = {
                    transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
                    wordCount,
                    callDurationSeconds: callDuration,
                    transcriptLength: (transcriptResponse.text || "").length,
                    aiAnalysisCompleted: true,
                    overallScore: Math.round(confidenceScore * 100) / 100,
                  };

                  if (analysis.sub_scores) {
                    updatedAnalysis.subScores = {
                      compliance: analysis.sub_scores.compliance ?? 0,
                      customerExperience: analysis.sub_scores.customer_experience ?? 0,
                      communication: analysis.sub_scores.communication ?? 0,
                      resolution: analysis.sub_scores.resolution ?? 0,
                    };
                  }

                  if (analysis.detected_agent_name) {
                    updatedAnalysis.detectedAgentName = analysis.detected_agent_name;
                  }

                  // Remove the awaiting_batch_analysis flag
                  if (Array.isArray(updatedAnalysis.flags)) {
                    updatedAnalysis.flags = (updatedAnalysis.flags as string[]).filter(f => f !== "awaiting_batch_analysis");
                  }

                  if (confidenceScore < 0.7) {
                    const flags = (updatedAnalysis.flags as string[]) || [];
                    flags.push("low_confidence");
                    updatedAnalysis.flags = flags;
                  }

                  // Update existing analysis (overwrite the placeholder)
                  await storage.createCallAnalysis(updatedAnalysis);
                  await storage.updateCall(callId, { status: "completed" });

                  // Auto-assign employee
                  if (analysis.detected_agent_name) {
                    const currentCall = await storage.getCall(callId);
                    if (currentCall && !currentCall.employeeId) {
                      const detectedName = analysis.detected_agent_name.toLowerCase().trim();
                      const allEmployees = await storage.getAllEmployees();
                      let matchedEmployee = allEmployees.find(emp => emp.name.toLowerCase() === detectedName);
                      if (!matchedEmployee) {
                        const firstNameMatches = allEmployees.filter(emp =>
                          emp.name.toLowerCase().split(" ")[0] === detectedName
                        );
                        if (firstNameMatches.length === 1) matchedEmployee = firstNameMatches[0];
                      }
                      if (matchedEmployee) {
                        await storage.updateCall(callId, { employeeId: matchedEmployee.id });
                        console.log(`[BATCH] Auto-assigned call ${callId} to ${matchedEmployee.name}`);
                      }
                    }
                  }

                  // Track Bedrock usage (at batch pricing — 50% off)
                  try {
                    const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
                    const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
                    const estimatedOutputTokens = 800;
                    const bedrockCost = estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) * 0.5;

                    const usageRecord: UsageRecord = {
                      id: randomUUID(),
                      callId,
                      type: "call",
                      timestamp: new Date().toISOString(),
                      user: pendingData?.uploadedBy || "batch",
                      services: {
                        bedrock: {
                          model: bedrockModel,
                          estimatedInputTokens,
                          estimatedOutputTokens,
                          estimatedCost: Math.round(bedrockCost * 10000) / 10000,
                        },
                      },
                      totalEstimatedCost: Math.round(bedrockCost * 10000) / 10000,
                    };
                    await storage.createUsageRecord(usageRecord);
                  } catch {}

                  broadcastCallUpdate(callId, "completed", { label: "Batch analysis complete" });

                  // Clean up pending file
                  await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
                  console.log(`[BATCH] Call ${callId} analysis stored successfully.`);
                } catch (callErr) {
                  console.warn(`[BATCH] Failed to process result for ${callId}:`, (callErr as Error).message);
                }
              }

              // Clean up active job record
              await s3Client.deleteObject(jobKey);
            } else if (status.status === "Failed" || status.status === "Stopped" || status.status === "Expired") {
              console.error(`[BATCH] Job ${job.jobId} failed: ${status.message || status.status}`);
              // Mark calls as failed and clean up
              for (const callId of job.callIds) {
                await storage.updateCall(callId, { status: "failed" });
                broadcastCallUpdate(callId, "failed", { label: "Batch analysis failed" });
                await s3Client.deleteObject(`batch-inference/pending/${callId}.json`);
              }
              await s3Client.deleteObject(jobKey);
            }
            // For InProgress/Submitted/Scheduled/Validating — keep polling next cycle
          } catch (jobErr) {
            console.warn(`[BATCH] Error checking job status:`, (jobErr as Error).message);
          }
        }

        // 2. Collect pending items and submit new batch if any
        const pendingKeys = await s3Client.listObjects("batch-inference/pending/");
        if (pendingKeys.length === 0) return;

        // Minimum batch size to avoid overhead (unless items are > 30 min old)
        const MIN_BATCH_SIZE = 5;
        if (pendingKeys.length < MIN_BATCH_SIZE) {
          // Check if any pending items are old enough to force-batch
          const oldestItem = await s3Client.downloadJson<PendingBatchItem>(pendingKeys[0]);
          if (oldestItem) {
            const age = Date.now() - new Date(oldestItem.timestamp).getTime();
            if (age < batchIntervalMinutes * 60 * 1000 * 2) {
              // Not old enough — wait for more items
              console.log(`[BATCH] ${pendingKeys.length} pending items (below threshold of ${MIN_BATCH_SIZE}). Waiting for more.`);
              return;
            }
          }
        }

        console.log(`[BATCH] Collecting ${pendingKeys.length} pending items for batch submission.`);

        const items: PendingBatchItem[] = [];
        for (const key of pendingKeys) {
          const data = await s3Client.downloadJson<PendingBatchItem & { transcriptResponse: any }>(key);
          if (data) items.push({ callId: data.callId, prompt: data.prompt, callCategory: data.callCategory, uploadedBy: data.uploadedBy, timestamp: data.timestamp });
        }

        if (items.length === 0) return;

        // Create and submit batch
        const { s3Uri, batchId } = await bedrockBatchService.createBatchInput(items);
        const callIds = items.map(i => i.callId);
        const batchJob = await bedrockBatchService.createJob(s3Uri, batchId, callIds);

        // Save active job record
        await s3Client.uploadJson(`batch-inference/active-jobs/${batchJob.jobId}.json`, batchJob);
        console.log(`[BATCH] Submitted batch job ${batchJob.jobId} with ${items.length} calls.`);

      } catch (batchErr) {
        console.error(`[BATCH] Batch cycle error:`, (batchErr as Error).message);
      }
    };

    // Run batch cycle on interval
    setTimeout(runBatchCycle, 60_000); // First run after 1 minute
    setInterval(runBatchCycle, batchIntervalMinutes * 60 * 1000);
  }

  // ==================== JOB QUEUE INITIALIZATION ====================
  const dbPool = getPool();
  if (dbPool) {
    const concurrency = parseInt(process.env.JOB_CONCURRENCY || "5", 10);
    const pollInterval = parseInt(process.env.JOB_POLL_INTERVAL_MS || "5000", 10);
    jobQueue = new JobQueue(dbPool, concurrency, pollInterval);

    // Job handler: dispatches to the correct processor based on job type
    jobQueue.start(async (job: Job) => {
      if (job.type === "process_audio") {
        const { callId, filePath, originalName, mimeType, callCategory, uploadedBy, processingMode } = job.payload as {
          callId: string; filePath: string; originalName: string;
          mimeType: string; callCategory?: string; uploadedBy?: string; processingMode?: string;
        };

        // Re-read audio from S3 (it was archived before enqueueing)
        const audioFiles = await storage.getAudioFiles(callId);
        let audioBuffer: Buffer | undefined;
        if (audioFiles.length > 0) {
          audioBuffer = await storage.downloadAudio(audioFiles[0]);
        }

        if (!audioBuffer) {
          // Fall back to local file if still available
          if (fs.existsSync(filePath)) {
            audioBuffer = await fs.promises.readFile(filePath);
          } else {
            throw new Error(`No audio data available for call ${callId}`);
          }
        }

        await processAudioFile(callId, filePath, audioBuffer, originalName, mimeType, callCategory, uploadedBy, processingMode);
      } else {
        console.warn(`[JOB_QUEUE] Unknown job type: ${job.type}`);
      }
    });
  }

  const httpServer = createServer(app);
  return httpServer;
}
