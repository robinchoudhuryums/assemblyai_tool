import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { assemblyAIService } from "./services/assemblyai";
import { insertCallSchema, insertEmployeeSchema } from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
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
      const { status, sentiment, employee, search } = req.query;
      let calls = await storage.getCallsWithDetails();

      // Apply filters
      if (status) {
        calls = calls.filter(call => call.status === status);
      }
      if (sentiment) {
        calls = calls.filter(call => call.sentiment?.overallSentiment === sentiment);
      }
      if (employee) {
        calls = calls.filter(call => call.employeeId === employee);
      }
      if (search) {
        calls = await storage.searchCalls(search as string);
      }

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
  app.post("/api/calls/upload", upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "Employee ID is required" });
        return;
      }

      // Verify employee exists
      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
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

      // Start processing asynchronously
      processAudioFile(call.id, req.file.path, req.file.buffer || fs.readFileSync(req.file.path))
        .catch(error => {
          console.error(`Failed to process call ${call.id}:`, error);
          storage.updateCall(call.id, { status: "failed" });
        });

      res.status(201).json(call);
    } catch (error) {
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
    try {
      // Upload to AssemblyAI
      const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
      
      // Start transcription
      const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
      
      // Update call with AssemblyAI ID
      await storage.updateCall(callId, { assemblyAiId: transcriptId });
      
      // Poll for completion
      const response = await assemblyAIService.pollTranscript(transcriptId);
      
      // Process results
      const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(response, callId);
      
      // Store results
      await storage.createTranscript(transcript);
      await storage.createSentimentAnalysis(sentiment);
      await storage.createCallAnalysis(analysis);
      
      // Update call status
      await storage.updateCall(callId, { 
        status: "completed",
        duration: Math.floor((response.words?.[response.words.length - 1]?.end || 0) / 1000)
      });
      
      // Cleanup uploaded file
      await cleanupFile(filePath);
      
    } catch (error) {
      console.error('Failed to process audio:', error);
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

  const httpServer = createServer(app);
  return httpServer;
}
