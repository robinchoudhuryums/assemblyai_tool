import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import passport from "passport";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { aiProvider } from "./services/ai-factory";
import { buildAgentSummaryPrompt } from "./services/ai-provider";
import { requireAuth, requireRole } from "./auth";
import { broadcastCallUpdate } from "./services/websocket";
import { logPhiAccess, auditContext } from "./services/audit-log";
import { insertEmployeeSchema, insertAccessRequestSchema, insertPromptTemplateSchema, insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";
import csv from "csv-parser";

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (reasonable for audio files)
  },
  fileFilter: (req, file, cb) => {
    // Validate both file extension and MIME type
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'];
    const allowedMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/flac', 'audio/x-flac',
      'audio/ogg', 'audio/vorbis', 'video/mp4', 'application/octet-stream',
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
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  app.get("/api/dashboard/sentiment", requireAuth, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  app.get("/api/dashboard/performers", requireAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 3;
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
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

      const results: Array<{ name: string; action: string }> = [];
      const rows: any[] = [];

      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(csv())
          .on("data", (row: any) => rows.push(row))
          .on("end", resolve)
          .on("error", reject);
      });

      for (const row of rows) {
        const name = (row["Agent Name"] || "").trim();
        const department = (row["Department"] || "").trim();
        const extension = (row["Extension"] || "").trim();
        const status = (row["Status"] || "Active").trim();

        if (!name) continue;

        const email = extension && extension !== "NA" && extension !== "N/A" && extension !== "a"
          ? `${extension}@company.com`
          : `${name.toLowerCase().replace(/\s+/g, ".")}@company.com`;

        const nameParts = name.split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase();

        try {
          const existing = await storage.getEmployeeByEmail(email);
          if (existing) {
            results.push({ name, action: "skipped (exists)" });
          } else {
            await storage.createEmployee({ name, email, role: department, initials, status });
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

  // Get all calls with details
app.get("/api/calls", requireAuth, async (req, res) => {
  try {
    const { status, sentiment, employee } = req.query;
    // Pass the filters directly to the storage function
    const calls = await storage.getCallsWithDetails({ 
      status: status as string, 
      sentiment: sentiment as string, 
      employee: employee as string 
    });
    res.json(calls);
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

      const { employeeId, callCategory } = req.body;

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
      const audioBuffer = fs.readFileSync(req.file.path);
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      processAudioFile(call.id, req.file.path, audioBuffer, originalName, mimeType, callCategory)
        .catch(error => {
          console.error(`Failed to process call ${call.id}:`, error);
          storage.updateCall(call.id, { status: "failed" });
        });

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
async function processAudioFile(callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string) {
  console.log(`[${callId}] Starting audio processing...`);
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." });
  try {
    // Step 1a: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload to AssemblyAI successful.`);

    // Step 1b: Archive audio to cloud storage
    console.log(`[${callId}] Step 1b/7: Archiving audio file to cloud storage...`);
    try {
      await storage.uploadAudio(callId, originalName, audioBuffer, mimeType);
      console.log(`[${callId}] Step 1b/7: Audio archived.`);
    } catch (archiveError) {
      console.warn(`[${callId}] Warning: Failed to archive audio (continuing):`, archiveError);
    }

    // Step 2: Start transcription
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." });
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
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

    // Step 4: AI analysis (Gemini or Bedrock/Claude — or fall back to defaults)
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
      const matchedEmployee = allEmployees.find(emp => {
        const empName = emp.name.toLowerCase();
        // Match on first name, last name, or full name
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });
      if (matchedEmployee) {
        await storage.updateCall(callId, { employeeId: matchedEmployee.id });
        autoAssigned = true;
        console.log(`[${callId}] Auto-assigned to employee: ${matchedEmployee.name} (detected name: "${aiAnalysis.detected_agent_name}")`);
      } else {
        console.log(`[${callId}] Detected agent name "${aiAnalysis.detected_agent_name}" but no matching employee found.`);
      }
    }

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Done. Status is now 'completed'.${autoAssigned ? " (auto-assigned)" : ""}`);


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
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      // HIPAA: Prevent browser/proxy caching of PHI audio data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
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
      console.error("Failed to update call analysis:", error);
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
      
      const results = await storage.searchCalls(query);
      res.json(results);
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

      // Filter by date range
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
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
        ? (sentiments.reduce((sum, s) => sum + parseFloat(s!.overallScore || "0"), 0) / sentiments.length) * 10
        : 0;
      const avgPerformanceScore = analyses.length > 0
        ? analyses.reduce((sum, a) => sum + parseFloat(a!.performanceScore || "0"), 0) / analyses.length
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
          stats.totalScore += parseFloat(call.analysis.performanceScore);
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
          entry.totalScore += parseFloat(call.analysis.performanceScore);
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

      // Apply optional date filters
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
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
            scores.push(parseFloat(call.analysis.performanceScore));
          }
          if (call.analysis.feedback) {
            const fb = typeof call.analysis.feedback === "string"
              ? JSON.parse(call.analysis.feedback)
              : call.analysis.feedback;
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
            const topics = typeof call.analysis.topics === "string"
              ? JSON.parse(call.analysis.topics)
              : call.analysis.topics;
            if (Array.isArray(topics)) allTopics.push(...topics);
          }

          // Collect flagged calls
          const callFlags = Array.isArray(call.analysis.flags) ? call.analysis.flags as string[] : [];
          const isExceptional = callFlags.includes("exceptional_call");
          const isBad = callFlags.includes("low_score") || callFlags.some((f: string) => f.startsWith("agent_misconduct"));
          if (isExceptional || isBad) {
            flaggedCalls.push({
              id: call.id,
              fileName: call.fileName,
              uploadedAt: call.uploadedAt,
              score: call.analysis.performanceScore ? parseFloat(call.analysis.performanceScore) : null,
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
          entry.total += parseFloat(call.analysis.performanceScore);
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
          scores.push(parseFloat(call.analysis.performanceScore));
        }
        if (call.analysis?.feedback) {
          const fb = typeof call.analysis.feedback === "string"
            ? JSON.parse(call.analysis.feedback) : call.analysis.feedback;
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
          const topics = typeof call.analysis.topics === "string"
            ? JSON.parse(call.analysis.topics) : call.analysis.topics;
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

      console.log(`Generating AI summary for ${employee.name} (${filtered.length} calls)...`);
      const summary = await aiProvider.generateText(prompt);
      console.log(`AI summary generated for ${employee.name}.`);

      res.json({ summary });
    } catch (error) {
      console.error("Failed to generate agent summary:", error);
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
    console.error("Failed to delete call:", error);
    res.status(500).json({ message: "Failed to delete call" });
  }
});

  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  app.get("/api/coaching", requireAuth, requireRole("manager", "admin"), async (_req, res) => {
    try {
      const sessions = await storage.getAllCoachingSessions();
      // Enrich with employee names
      const enriched = await Promise.all(sessions.map(async s => {
        const emp = await storage.getEmployee(s.employeeId);
        return { ...s, employeeName: emp?.name || "Unknown" };
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
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
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
        const score = parseFloat(call.analysis?.performanceScore || "10");
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
          const conf = parseFloat(c.analysis?.confidenceScore || "1");
          return conf < 0.7;
        })
        .map(c => ({
          callId: c.id,
          date: c.uploadedAt || "",
          confidence: parseFloat(c.analysis?.confidenceScore || "0"),
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
            ? completed.reduce((sum, c) => sum + parseFloat(c.analysis?.performanceScore || "0"), 0) / completed.length
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

  const httpServer = createServer(app);
  return httpServer;
}
