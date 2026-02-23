import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { insertCallSchema, insertEmployeeSchema } from "@shared/schema";
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
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Dashboard metrics
  app.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  app.get("/api/dashboard/sentiment", async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  app.get("/api/dashboard/performers", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 3;
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });

  // Get all employees
  app.get("/api/employees", async (req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to get employees" });
    }
  });

  // Create employee
  app.post("/api/employees", async (req, res) => {
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
app.get("/api/calls", async (req, res) => {
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
  app.get("/api/calls/:id", async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      const employee = await storage.getEmployee(call.employeeId);
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
  app.post("/api/calls/upload", upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId } = req.body;
      if (!employeeId) {
        // HIPAA: Clean up uploaded file if validation fails
        await cleanupFile(req.file.path);
        res.status(400).json({ message: "Employee ID is required" });
        return;
      }

      // Verify employee exists
      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        await cleanupFile(req.file.path);
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      // Create call record
      const call = await storage.createCall({
        employeeId,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: "processing"
      });

      // Read file buffer for API upload, then start async processing
      const audioBuffer = fs.readFileSync(req.file.path);
      processAudioFile(call.id, req.file.path, audioBuffer)
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

// Process audio file with AssemblyAI
async function processAudioFile(callId: string, filePath: string, audioBuffer: Buffer) {
  console.log(`[${callId}] Starting audio processing...`);
  try {
    // Step 1: Upload to AssemblyAI
    console.log(`[${callId}] Step 1/7: Uploading audio file to AssemblyAI...`);
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    console.log(`[${callId}] Step 1/7: Upload successful. Audio URL: ${audioUrl}`);

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

    // Step 4: Submit task to LeMUR (returns result synchronously)
    console.log(`[${callId}] Step 4/6: Submitting task to LeMUR...`);
    const lemurResponse = await assemblyAIService.submitLeMURTask(transcriptId);
    console.log(`[${callId}] Step 4/6: LeMUR analysis complete.`);

    // Step 5: Process combined results
    console.log(`[${callId}] Step 5/6: Processing combined transcript and LeMUR data...`);
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, lemurResponse, callId);
    console.log(`[${callId}] Step 5/6: Data processing complete.`);

    // Step 6: Store rich results
    console.log(`[${callId}] Step 6/6: Saving rich analysis to the database...`);
    await storage.createTranscript(transcript);
    await storage.createSentimentAnalysis(sentiment);
    await storage.createCallAnalysis(analysis);

    await storage.updateCall(callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000)
    });
    console.log(`[${callId}] Step 6/6: Database updated. Status is now 'completed'.`);

    await cleanupFile(filePath);
    console.log(`[${callId}] Processing finished successfully.`);

  } catch (error) {
    console.error(`[${callId}] A critical error occurred during audio processing:`, error);
    await storage.updateCall(callId, { status: "failed" });
    await cleanupFile(filePath);
  }
}

  // Get transcript for a call
  app.get("/api/calls/:id/transcript", async (req, res) => {
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
  app.get("/api/calls/:id/sentiment", async (req, res) => {
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
  app.get("/api/calls/:id/analysis", async (req, res) => {
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
  app.get("/api/search", async (req, res) => {
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
app.get("/api/performance", async (req, res) => {
  try {
    // We can reuse the existing function to get top performers
    const performers = await storage.getTopPerformers(10); // Get top 10
    res.json(performers);
  } catch (error) {
    console.error("Failed to get performance data:", error);
    res.status(500).json({ message: "Failed to get performance data" });
  }
});

  app.get("/api/reports/summary", async (req, res) => {
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

  app.delete("/api/calls/:id", async (req, res) => {
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
