import type { Router } from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createHash } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { recordDataAccess } from "../services/security-monitor";
import { getPool } from "../db/pool";
import { CALL_CATEGORIES, analysisEditSchema } from "@shared/schema";
import type { JobQueue } from "../services/job-queue";
import { cleanupFile, TaskQueue } from "./utils";
import { registerCallTagRoutes } from "./calls-tags";

/** Type for the processAudioFile function passed from the main routes module. */
export type ProcessAudioFn = (
  callId: string,
  filePath: string,
  audioBuffer: Buffer,
  originalName: string,
  mimeType: string,
  callCategory?: string,
  uploadedBy?: string,
  processingMode?: string,
  language?: string,
) => Promise<void>;

// Limit concurrent audio processing to 3 parallel jobs (fallback when no DB)
const audioProcessingQueue = new TaskQueue(3);

const assignCallSchema = z.object({
  employeeId: z.string().optional(),
}).strict();

/**
 * Register all call-related API routes.
 * Core routes (list, get, upload, audio, analysis, assign, delete) are here.
 * Tags, annotations, and bulk ops are in calls-tags.ts.
 */
export function registerCallRoutes(
  router: Router,
  uploadMiddleware: any,
  processAudioFn: ProcessAudioFn,
  getJobQueue: () => JobQueue | null,
) {
  // Delegate tag and annotation routes to sub-module
  registerCallTagRoutes(router);

  // ==================== CALL LIST & RETRIEVAL ====================

  router.get("/api/calls", requireAuth, async (req, res) => {
    try {
      const { status, sentiment, employee, cursor } = req.query;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 25, 200));
      const filters = {
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
      };

      if (cursor || req.query.mode === "cursor") {
        const result = await storage.getCallsPaginated({
          filters,
          cursor: cursor as string | undefined,
          limit,
        });
        const totalPages = Math.ceil(result.total / limit);
        res.json({
          calls: result.calls,
          pagination: { page: 1, limit, total: result.total, totalPages },
          nextCursor: result.nextCursor,
          hasMore: result.nextCursor !== null,
        });
      } else {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        // Note: offset pagination loads all matching calls into memory for slicing.
        // For large datasets, clients should use cursor mode (?mode=cursor) which
        // uses SQL-level pagination via getCallsPaginated().
        const calls = await storage.getCallsWithDetails(filters);
        const total = calls.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginated = calls.slice(offset, offset + limit);
        res.json({
          calls: paginated,
          pagination: { page, limit, total, totalPages },
        });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get calls" });
    }
  });

  router.get("/api/calls/:id", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

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

      res.json({ ...call, employee, transcript, sentiment, analysis });
    } catch (error) {
      res.status(500).json({ message: "Failed to get call" });
    }
  });

  // ==================== UPLOAD & AUDIO ====================

  router.post("/api/calls/upload", requireAuth, uploadMiddleware, async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const sanitizedName = path.basename(req.file.originalname);
      if (sanitizedName !== req.file.originalname) {
        req.file.originalname = sanitizedName;
      }

      const { employeeId } = req.body;
      const validCategories = CALL_CATEGORIES.map(c => c.value) as string[];
      const callCategory = validCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;
      const processingMode = (req.body.processingMode === "immediate" || req.body.processingMode === "batch")
        ? req.body.processingMode as "immediate" | "batch"
        : undefined;
      const validLanguages = ["en", "es", "fr", "pt", "de"];
      const language = validLanguages.includes(req.body.language) ? req.body.language : undefined;

      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      const audioBuffer = await fs.promises.readFile(req.file.path);

      const contentHash = createHash("sha256").update(audioBuffer).digest("hex");
      const allCalls = await storage.getAllCalls();
      const duplicate = allCalls.find(c =>
        c.contentHash === contentHash &&
        (c.status === "processing" || c.status === "completed" || c.status === "awaiting_analysis" || c.status === "failed")
      );
      if (duplicate) {
        await cleanupFile(req.file.path);
        res.status(409).json({
          message: "This audio file has already been uploaded.",
          existingCallId: duplicate.id,
          existingStatus: duplicate.status,
        });
        return;
      }

      const call = await storage.createCall({
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        status: "processing",
        callCategory: callCategory || undefined,
        contentHash,
      });
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const uploadUser = (req.user as any)?.username || "unknown";

      try {
        await storage.uploadAudio(call.id, originalName, audioBuffer, mimeType);
      } catch (archiveError) {
        console.warn(`[${call.id}] Warning: Failed to archive audio to S3 (continuing):`, archiveError);
      }

      const jobQueue = getJobQueue();
      if (jobQueue) {
        await jobQueue.enqueue("process_audio", {
          callId: call.id,
          filePath: req.file.path,
          originalName,
          mimeType,
          callCategory: callCategory || null,
          uploadedBy: uploadUser,
          processingMode: processingMode || null,
          language: language || null,
        });
      } else {
        audioProcessingQueue.add(() => processAudioFn(call.id, req.file!.path, audioBuffer, originalName, mimeType, callCategory, uploadUser, processingMode, language))
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
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  router.get("/api/calls/:id/audio", requireAuth, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: req.query.download === "true" ? "download_audio" : "stream_audio",
        resourceType: "audio",
        resourceId: req.params.id,
      });

      const audioFiles = await storage.getAudioFiles(req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      const audioBuffer = await storage.downloadAudio(audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json({ message: "Audio file could not be retrieved" });
        return;
      }

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

      if (req.query.download === 'true') {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        // Sanitize: take basename, strip non-safe chars, remove quotes to prevent header injection
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_").replace(/"/g, "");
        // Use RFC 6266 format with both filename (ASCII) and filename* (UTF-8) for broad compatibility
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');

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

  // ==================== TRANSCRIPT & ANALYSIS ====================

  router.get("/api/calls/:id/transcript", requireAuth, async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });
      if (req.user?.username) recordDataAccess(req.user.username, "transcript");

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

  router.get("/api/calls/:id/sentiment", requireAuth, async (req, res) => {
    try {
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

  router.get("/api/calls/:id/analysis", requireAuth, async (req, res) => {
    try {
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

  router.patch("/api/calls/:id/analysis", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;
      const { updates, reason } = req.body;

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "edit_call_analysis",
        resourceType: "analysis",
        resourceId: callId,
        detail: `reason: ${reason}; fields: ${updates ? Object.keys(updates).join(",") : "none"}`,
      });

      const parsed = analysisEditSchema.safeParse({ updates, reason });
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid edit data", errors: parsed.error.flatten() });
        return;
      }

      const existing = await storage.getCallAnalysis(callId);
      if (!existing) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      const user = (req as any).user;
      const editedBy = user?.name || user?.username || "Unknown User";

      const previousEdits = Array.isArray(existing.manualEdits) ? existing.manualEdits : [];
      const editRecord = {
        editedBy,
        editedAt: new Date().toISOString(),
        reason: reason.trim(),
        fieldsChanged: Object.keys(updates),
        previousValues: {} as Record<string, any>,
      };

      for (const key of Object.keys(updates)) {
        editRecord.previousValues[key] = (existing as any)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      await storage.createCallAnalysis(updatedAnalysis);

      console.log(`[${callId}] Manual edit by ${editedBy}: ${reason} (fields: ${editRecord.fieldsChanged.join(", ")})`);
      res.json(updatedAnalysis);
    } catch (error) {
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

  // ==================== ASSIGN & DELETE ====================

  router.patch("/api/calls/:id/assign", requireAuth, requireRole("manager", "admin"), async (req, res) => {
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

  router.delete("/api/calls/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "delete_call",
        resourceType: "call",
        resourceId: callId,
      });

      await storage.deleteCall(callId);

      console.log(`Successfully deleted call ID: ${callId}`);
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

  // ==================== BULK RE-ANALYSIS (admin only) ====================
  router.post("/api/calls/bulk-reanalyze", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const { callIds } = req.body;
      if (!Array.isArray(callIds) || callIds.length === 0) {
        res.status(400).json({ message: "callIds must be a non-empty array" });
        return;
      }
      if (callIds.length > 50) {
        res.status(400).json({ message: "Maximum 50 calls can be re-analyzed at once" });
        return;
      }

      const jobQueue = getJobQueue();
      const results: { callId: string; status: string }[] = [];

      for (const callId of callIds) {
        const call = await storage.getCall(callId);
        if (!call) {
          results.push({ callId, status: "not_found" });
          continue;
        }
        if (call.status === "processing") {
          results.push({ callId, status: "already_processing" });
          continue;
        }

        const audioFiles = await storage.getAudioFiles(callId);
        if (audioFiles.length === 0) {
          results.push({ callId, status: "no_audio" });
          continue;
        }

        await storage.updateCall(callId, { status: "processing" });

        const uploadUser = (req as any).user?.username || "admin";

        if (jobQueue) {
          await jobQueue.enqueue("process_audio", {
            callId,
            filePath: "",
            originalName: call.fileName || "reanalysis",
            mimeType: "audio/mpeg",
            callCategory: call.callCategory || null,
            uploadedBy: uploadUser,
            processingMode: null,
            language: null,
          });
        } else {
          const audioBuffer = await storage.downloadAudio(audioFiles[0]);
          if (audioBuffer) {
            const audioQueue = new TaskQueue(3);
            audioQueue.add(() => processAudioFn(
              callId, "", audioBuffer, call.fileName || "reanalysis",
              "audio/mpeg", call.callCategory, uploadUser,
            )).catch(async (error) => {
              console.error(`Failed to re-analyze call ${callId}:`, error);
              await storage.updateCall(callId, { status: "failed" });
            });
          }
        }

        results.push({ callId, status: "queued" });
      }

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "bulk_reanalyze",
        resourceType: "calls",
        resourceId: callIds.join(","),
        detail: `Bulk re-analysis of ${callIds.length} calls`,
      });

      res.json({
        message: `${results.filter(r => r.status === "queued").length} of ${callIds.length} calls queued for re-analysis`,
        results,
      });
    } catch (error) {
      console.error("Bulk re-analysis failed:", (error as Error).message);
      res.status(500).json({ message: "Failed to start bulk re-analysis" });
    }
  });
}
