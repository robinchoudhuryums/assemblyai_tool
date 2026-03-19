import type { Router } from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createHash } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { recordDataAccess } from "../services/security-monitor";
import { broadcastCallUpdate } from "../services/websocket";
import { getPool } from "../db/pool";
import { CALL_CATEGORIES, analysisEditSchema } from "@shared/schema";
import type { JobQueue } from "../services/job-queue";
import { cleanupFile } from "./utils";
import { TaskQueue } from "./utils";

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
 *
 * @param router - Express Router instance
 * @param uploadMiddleware - Multer upload middleware (upload.single('audioFile'))
 * @param processAudioFn - The processAudioFile function from the main module
 * @param getJobQueue - Returns the current jobQueue reference (may be null)
 */
export function registerCallRoutes(
  router: Router,
  uploadMiddleware: any,
  processAudioFn: ProcessAudioFn,
  getJobQueue: () => JobQueue | null,
) {
  // Get all calls with details (paginated — supports offset and cursor modes)
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
        // Cursor-based pagination (efficient for large datasets)
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
        // Legacy offset-based pagination (backward compatible)
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
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

  // Get single call with details
  router.get("/api/calls/:id", requireAuth, async (req, res) => {
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
  router.post("/api/calls/upload", requireAuth, uploadMiddleware, async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      // Sanitize file name to prevent path traversal
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

      // If employeeId provided, verify employee exists
      if (employeeId) {
        const employee = await storage.getEmployee(employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      // Read file buffer early for idempotency check and API upload
      const audioBuffer = await fs.promises.readFile(req.file.path);

      // Idempotency: hash audio content to detect duplicate uploads.
      // If the same file was already uploaded and is processing/completed, return the existing call.
      const contentHash = createHash("sha256").update(audioBuffer).digest("hex");
      const allCalls = await storage.getAllCalls();
      const duplicate = allCalls.find(c =>
        c.contentHash === contentHash &&
        (c.status === "processing" || c.status === "completed" || c.status === "awaiting_analysis")
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

      // Create call record (employeeId is optional — can be assigned later)
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

      // Archive audio to S3 immediately (before queuing)
      try {
        await storage.uploadAudio(call.id, originalName, audioBuffer, mimeType);
      } catch (archiveError) {
        console.warn(`[${call.id}] Warning: Failed to archive audio to S3 (continuing):`, archiveError);
      }

      // Use durable job queue if PostgreSQL is available, otherwise fall back to in-memory queue
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
      // HIPAA: Ensure file is cleaned up on any error
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  // Stream audio file from cloud storage for playback or download
  router.get("/api/calls/:id/audio", requireAuth, async (req, res) => {
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
  router.get("/api/calls/:id/transcript", requireAuth, async (req, res) => {
    try {
      // HIPAA: Log PHI access (transcript is PHI)
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });
      // Security: Track data access for bulk exfiltration detection
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

  // Get sentiment analysis for a call
  router.get("/api/calls/:id/sentiment", requireAuth, async (req, res) => {
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
  router.get("/api/calls/:id/analysis", requireAuth, async (req, res) => {
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
  router.patch("/api/calls/:id/analysis", requireAuth, requireRole("manager", "admin"), async (req, res) => {
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

      // Validate using shared Zod schema (type checks + range validation + whitelist)
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

  // Assign/reassign employee to a call (managers and admins only)
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

  // HIPAA: Only managers and admins can delete call records
  router.delete("/api/calls/:id", requireAuth, requireRole("manager", "admin"), async (req, res) => {
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

  // ==================== CALL TAGGING ROUTES ====================

  // Get tags for a call
  router.get("/api/calls/:id/tags", requireAuth, async (req, res) => {
    try {
      const callId = req.params.id;
      const pool = getPool();
      if (pool) {
        const result = await pool.query(
          "SELECT id, tag, created_by, created_at FROM call_tags WHERE call_id = $1 ORDER BY created_at",
          [callId]
        );
        return res.json(result.rows.map((r: any) => ({ id: r.id, tag: r.tag, createdBy: r.created_by, createdAt: r.created_at })));
      }
      // In-memory fallback: tags not supported without DB
      res.json([]);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  // Add a tag to a call
  router.post("/api/calls/:id/tags", requireAuth, async (req, res) => {
    try {
      const callId = req.params.id;
      const { tag } = req.body;
      if (!tag || typeof tag !== "string" || tag.length > 100) {
        return res.status(400).json({ message: "Tag is required (max 100 characters)" });
      }
      const normalizedTag = tag.trim().toLowerCase();
      // SECURITY: Allowlist validation — tags must be alphanumeric with limited punctuation.
      // Prevents stored XSS if tags are rendered in HTML contexts.
      if (!/^[a-z0-9][a-z0-9 _./-]*$/.test(normalizedTag) || normalizedTag.length === 0) {
        return res.status(400).json({ message: "Tags must contain only letters, numbers, spaces, dots, underscores, hyphens, and slashes" });
      }
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ message: "Tagging requires a database connection" });
      }
      // Verify call exists
      const call = await storage.getCall(callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const result = await pool.query(
        "INSERT INTO call_tags (call_id, tag, created_by) VALUES ($1, $2, $3) ON CONFLICT (call_id, tag) DO NOTHING RETURNING id, tag, created_by, created_at",
        [callId, normalizedTag, req.user!.username]
      );
      if (result.rows.length === 0) {
        return res.status(409).json({ message: "Tag already exists on this call" });
      }
      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "tag_added", resourceType: "call", resourceId: callId, detail: normalizedTag });
      res.status(201).json({ id: result.rows[0].id, tag: result.rows[0].tag, createdBy: result.rows[0].created_by, createdAt: result.rows[0].created_at });
    } catch (error) {
      res.status(500).json({ message: "Failed to add tag" });
    }
  });

  // Remove a tag from a call
  router.delete("/api/calls/:id/tags/:tagId", requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Tagging requires a database connection" });
      const result = await pool.query("DELETE FROM call_tags WHERE id = $1 AND call_id = $2 RETURNING tag", [req.params.tagId, req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Tag not found" });
      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "tag_removed", resourceType: "call", resourceId: req.params.id, detail: result.rows[0].tag });
      res.json({ message: "Tag removed" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove tag" });
    }
  });

  // Get all unique tags (for autocomplete/filtering)
  router.get("/api/tags", requireAuth, async (_req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.json([]);
      const result = await pool.query("SELECT tag, COUNT(*) as count FROM call_tags GROUP BY tag ORDER BY count DESC LIMIT 100");
      res.json(result.rows.map((r: any) => ({ tag: r.tag, count: parseInt(r.count) })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  // Search calls by tag
  router.get("/api/calls/by-tag/:tag", requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.json([]);
      const tag = req.params.tag.toLowerCase();
      const result = await pool.query(
        `SELECT c.id, c.file_name, c.status, c.duration, c.call_category, c.uploaded_at, c.employee_id,
                e.name as employee_name
         FROM calls c
         INNER JOIN call_tags ct ON ct.call_id = c.id
         LEFT JOIN employees e ON c.employee_id = e.id
         WHERE ct.tag = $1
         ORDER BY c.uploaded_at DESC
         LIMIT 100`,
        [tag]
      );
      res.json(result.rows.map((r: any) => ({
        id: r.id, fileName: r.file_name, status: r.status, duration: r.duration,
        callCategory: r.call_category, uploadedAt: r.uploaded_at,
        employeeId: r.employee_id, employeeName: r.employee_name,
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls by tag" });
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

        // Get audio from storage
        const audioFiles = await storage.getAudioFiles(callId);
        if (audioFiles.length === 0) {
          results.push({ callId, status: "no_audio" });
          continue;
        }

        // Reset call status to processing
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
          // Fallback: use in-memory queue
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

  // ==================== ANNOTATIONS ====================

  // Get annotations for a call
  router.get("/api/calls/:id/annotations", requireAuth, async (req, res) => {
    try {
      const pool = (await import("../db/pool")).getPool();
      if (!pool) {
        res.json([]);
        return;
      }
      const { rows } = await pool.query(
        "SELECT * FROM annotations WHERE call_id = $1 ORDER BY timestamp_ms ASC",
        [req.params.id]
      );
      res.json(rows.map(r => ({
        id: r.id,
        callId: r.call_id,
        timestampMs: r.timestamp_ms,
        text: r.text,
        author: r.author,
        createdAt: r.created_at?.toISOString?.() ?? r.created_at,
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to get annotations" });
    }
  });

  // Create annotation
  router.post("/api/calls/:id/annotations", requireRole("manager", "admin"), async (req, res) => {
    try {
      const pool = (await import("../db/pool")).getPool();
      if (!pool) {
        res.status(503).json({ message: "Annotations require PostgreSQL" });
        return;
      }
      const { timestampMs, text } = req.body;
      if (typeof timestampMs !== "number" || !text?.trim()) {
        res.status(400).json({ message: "timestampMs (number) and text (string) are required" });
        return;
      }
      const { rows } = await pool.query(
        `INSERT INTO annotations (call_id, timestamp_ms, text, author) VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, timestampMs, text.trim(), req.user?.name || req.user?.username || "unknown"]
      );
      const r = rows[0];
      res.json({
        id: r.id, callId: r.call_id, timestampMs: r.timestamp_ms,
        text: r.text, author: r.author, createdAt: r.created_at?.toISOString?.() ?? r.created_at,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to create annotation" });
    }
  });

  // Delete annotation
  router.delete("/api/calls/:id/annotations/:annotationId", requireRole("manager", "admin"), async (req, res) => {
    try {
      const pool = (await import("../db/pool")).getPool();
      if (!pool) {
        res.status(503).json({ message: "Annotations require PostgreSQL" });
        return;
      }
      await pool.query("DELETE FROM annotations WHERE id = $1 AND call_id = $2", [req.params.annotationId, req.params.id]);
      res.json({ message: "Annotation deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });
}
