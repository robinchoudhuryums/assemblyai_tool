import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import passport from "passport";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { aiProvider } from "./services/ai-factory";
import { requireAuth } from "./auth";
import { insertEmployeeSchema } from "@shared/schema";
import { z } from "zod";

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
    const allowedTypes = ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'), false);
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

  // Create employee
  app.post("/api/employees", requireAuth, async (req, res) => {
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

      const employee = call.employeeId ? await storage.getEmployee(call.employeeId) : undefined;
      const transcript = await storage.getTranscript(call.id);
      const sentiment = await storage.getSentimentAnalysis(call.id);
      const analysis = await storage.getCallAnalysis(call.id);

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
        status: "processing"
      });

      // Read file buffer for API upload, then start async processing
      const audioBuffer = fs.readFileSync(req.file.path);
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      processAudioFile(call.id, req.file.path, audioBuffer, originalName, mimeType)
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

// Process audio file with AssemblyAI and archive to GCS
async function processAudioFile(callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string) {
  console.log(`[${callId}] Starting audio processing...`);
  try {
    // Step 1a: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload to AssemblyAI successful.`);

    // Step 1b: Archive audio to GCS
    console.log(`[${callId}] Step 1b/7: Archiving audio file to GCS...`);
    try {
      await storage.uploadAudioToGcs(callId, originalName, audioBuffer, mimeType);
      console.log(`[${callId}] Step 1b/7: Audio archived to GCS.`);
    } catch (gcsError) {
      console.warn(`[${callId}] Warning: Failed to archive audio to GCS (continuing):`, gcsError);
    }

    // Step 2: Start transcription
    console.log(`[${callId}] Step 2/7: Submitting for transcription...`);
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    console.log(`[${callId}] Step 2/7: Transcription submitted. Transcript ID: ${transcriptId}`);

    await storage.updateCall(callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion
    console.log(`[${callId}] Step 3/7: Polling for transcript results...`);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    // --- CRITICAL SAFETY CHECK ---
    // This prevents the crash if polling fails to return a valid result.
    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    console.log(`[${callId}] Step 3/7: Polling complete. Status: ${transcriptResponse.status}`);

    // Step 4: AI analysis (Gemini or Bedrock/Claude — or fall back to defaults)
    let aiAnalysis = null;
    if (aiProvider.isAvailable && transcriptResponse.text) {
      try {
        console.log(`[${callId}] Step 4/6: Running AI analysis (${aiProvider.name})...`);
        aiAnalysis = await aiProvider.analyzeCallTranscript(transcriptResponse.text, callId);
        console.log(`[${callId}] Step 4/6: AI analysis complete.`);
      } catch (aiError) {
        console.warn(`[${callId}] AI analysis failed (continuing with defaults):`, (aiError as Error).message);
      }
    } else if (!aiProvider.isAvailable) {
      console.log(`[${callId}] Step 4/6: AI provider not configured, using transcript-based defaults.`);
    }

    // Step 5: Process combined results
    console.log(`[${callId}] Step 5/6: Processing combined transcript and analysis data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId);
    console.log(`[${callId}] Step 5/6: Data processing complete.`);

    // Step 6: Store rich results in GCS
    console.log(`[${callId}] Step 6/6: Saving rich analysis to GCS...`);
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: GCS updated. Status is now 'completed'.`);

    await cleanupFile(filePath);
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, error);
    await storage.updateCall(callId, { status: "failed" });
    await cleanupFile(filePath);
  }
}

  // Stream audio file from GCS for playback or download
  app.get("/api/calls/:id/audio", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // List audio files for this call in GCS (stored under audio/{callId}/)
      const audioFiles = await storage.getAudioFiles(req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      // Download the first audio file
      const audioBuffer = await storage.downloadAudioFromGcs(audioFiles[0]);
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
        const fileName = call.fileName || `call-${req.params.id}${ext}`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.send(audioBuffer);
    } catch (error) {
      console.error("Failed to stream audio:", error);
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  // Get transcript for a call
  app.get("/api/calls/:id/transcript", requireAuth, async (req, res) => {
    try {
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

  app.delete("/api/calls/:id", requireAuth, async (req, res) => {
  try {
    const callId = req.params.id;
    
    // You'll need to implement deleteCall in your storage/db logic
    await storage.deleteCall(callId); 
    
    console.log(`Successfully deleted call ID: ${callId}`);
    // Send a 204 No Content response for a successful deletion
    res.status(204).send(); 
  } catch (error) {
    console.error("Failed to delete call:", error);
    res.status(500).json({ message: "Failed to delete call" });
  }
});

  const httpServer = createServer(app);
  return httpServer;
}
