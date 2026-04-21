import type { Router } from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createHash } from "crypto";
import { logger } from "../services/logger";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup, getUserEmployeeId } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { recordDataAccess } from "../services/security-monitor";
import { getPool } from "../db/pool";
import { CALL_CATEGORIES, analysisEditSchema, assignCallSchema } from "@shared/schema";
import type { JobQueue } from "../services/job-queue";
import { cleanupFile, validateIdParam, validateParams, sendError, sendValidationError, resolveBulkReanalyzeCallIds } from "./utils";
import { registerCallTagRoutes } from "./calls-tags";

// Shared audio processing queue (A11) — single singleton across pipeline.ts,
// calls.ts, admin-content.ts. Bounded with maxQueueSize + per-task timeout.
import { audioProcessingQueue, type ProcessAudioOptions } from "./pipeline";

/** Type for the processAudioFile function passed from the main routes module (A22). */
export type ProcessAudioFn = (
  callId: string,
  audio: Buffer,
  options: ProcessAudioOptions,
) => Promise<void>;

// assignCallSchema imported from @shared/schema

/**
 * #1 Phase 2: check whether a viewer may access a specific call.
 * Returns true for manager/admin. For viewers, the call's employeeId must
 * match the viewer's linked employee, OR the call has no employee yet
 * (unassigned — viewers can see calls they may have uploaded).
 *
 * Exported so other route modules (reports/search, calls-tags, analytics)
 * can apply the same check uniformly.
 */
export async function canViewerAccessCall(
  req: import("express").Request,
  call: { employeeId?: string | null },
): Promise<boolean> {
  const userRole = req.user?.role || "viewer";
  if (userRole === "manager" || userRole === "admin") return true;
  if (!call.employeeId) return true;
  const myEmployeeId = await getUserEmployeeId(req.user?.username, req.user?.name);
  return myEmployeeId === call.employeeId;
}

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

      // #1 Phase 2: viewers can only see their own calls. Force the employee
      // filter to their linked employee ID. If no employee link exists, return
      // empty results (same behavior as /api/my-performance).
      let employeeFilter = employee as string;
      const userRole = req.user?.role || "viewer";
      if (userRole === "viewer") {
        const myEmployeeId = await getUserEmployeeId(req.user?.username, req.user?.name);
        if (!myEmployeeId) {
          res.json({ calls: [], pagination: { page: 1, limit, total: 0, totalPages: 0 }, nextCursor: null, hasMore: false });
          return;
        }
        employeeFilter = myEmployeeId;
      }

      const filters = {
        status: status as string,
        sentiment: sentiment as string,
        employee: employeeFilter,
      };

      // A20/F20: SQL-level pagination is now the only path. Legacy offset
      // mode previously loaded the full result set into memory which could
      // OOM at scale; it now delegates to getCallsPaginated as well.
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
    } catch (error) {
      res.status(500).json({ message: "Failed to get calls" });
    }
  });

  router.get("/api/calls/:id", requireAuth, validateIdParam, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // #1 Phase 2: viewers can only access their own calls.
      if (!(await canViewerAccessCall(req, call))) {
        res.status(403).json({ message: "You can only access your own calls" });
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

      // When the call is still awaiting batch inference, include queue
      // position + batch interval so the UI can show "your call is #3 of 12
      // in the next batch submission (every 15 min)". Best-effort — failures
      // fall back to omitting the field so the normal response still returns.
      let batchStatus: Awaited<ReturnType<typeof import("../services/batch-scheduler").getBatchQueueStatus>> | null = null;
      if (call.status === "awaiting_analysis") {
        try {
          const { getBatchQueueStatus } = await import("../services/batch-scheduler");
          batchStatus = await getBatchQueueStatus(call.id);
        } catch (batchErr) {
          logger.warn("calls: failed to compute batch queue status", { callId: call.id, error: (batchErr as Error).message });
        }
      }

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

      res.json({ ...call, employee, transcript, sentiment, analysis, batchStatus });
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
      // A21/F17: rely on DB UNIQUE(content_hash) constraint instead of an
      // O(n) scan of getAllCalls. createCall surfaces pg error 23505 on
      // duplicate — look up the existing call and 409.
      let call;
      try {
        call = await storage.createCall({
          employeeId: employeeId || undefined,
          fileName: req.file.originalname,
          filePath: req.file.path,
          status: "processing",
          callCategory: callCategory || undefined,
          contentHash,
        });
      } catch (err) {
        if ((err as { code?: string })?.code === "23505") {
          const existing = await storage.findCallByContentHash?.(contentHash);
          await cleanupFile(req.file.path);
          res.status(409).json({
            message: "This audio file has already been uploaded.",
            existingCallId: existing?.id,
            existingStatus: existing?.status,
          });
          return;
        }
        throw err;
      }
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const uploadUser = req.user!.username;

      try {
        await storage.uploadAudio(call.id, originalName, audioBuffer, mimeType);
      } catch (archiveError) {
        logger.warn("failed to archive audio to S3 (continuing)", { callId: call.id, error: archiveError });
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
        audioProcessingQueue.add(() => processAudioFn(call.id, audioBuffer, {
          filePath: req.file!.path,
          originalName,
          mimeType,
          callCategory,
          uploadedBy: uploadUser,
          processingMode,
          language,
        }))
          .catch(async (error) => {
            logger.error("failed to process call", { callId: call.id, error });
            try {
              await storage.updateCall(call.id, { status: "failed" });
            } catch (updateErr) {
              logger.error("failed to mark call as failed", { callId: call.id, error: updateErr });
            }
          });
      }

      res.status(201).json(call);
    } catch (error) {
      logger.error("error during file upload", { error });
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  router.get("/api/calls/:id/audio", requireAuth, validateIdParam, async (req, res) => {
    try {
      const call = await storage.getCall(req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      if (!(await canViewerAccessCall(req, call))) {
        res.status(403).json({ message: "You can only access your own calls" });
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
        // A33/F38: tight single-range regex; reject multi-range and malformed.
        // Validate numeric bounds and 416 on invalid.
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (!match) {
          res.setHeader("Content-Range", `bytes */${audioBuffer.length}`);
          res.status(416).end();
          return;
        }
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : audioBuffer.length - 1;
        if (
          !Number.isFinite(start) || !Number.isFinite(end) ||
          start < 0 || end < start || end >= audioBuffer.length
        ) {
          res.setHeader("Content-Range", `bytes */${audioBuffer.length}`);
          res.status(416).end();
          return;
        }
        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${audioBuffer.length}`);
        res.setHeader("Content-Length", chunkSize.toString());
        res.send(audioBuffer.subarray(start, end + 1));
        return;
      }

      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.send(audioBuffer);
    } catch (error) {
      logger.error("failed to stream audio", { error });
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  // ==================== TRANSCRIPT & ANALYSIS ====================

  router.get("/api/calls/:id/transcript", requireAuth, validateIdParam, async (req, res) => {
    try {
      // #1 Phase 2: viewer scope check
      const callForScope = await storage.getCall(req.params.id);
      if (callForScope && !(await canViewerAccessCall(req, callForScope))) {
        res.status(403).json({ message: "You can only access your own calls" });
        return;
      }

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

  router.get("/api/calls/:id/sentiment", requireAuth, validateIdParam, async (req, res) => {
    try {
      const callForScope = await storage.getCall(req.params.id);
      if (callForScope && !(await canViewerAccessCall(req, callForScope))) {
        res.status(403).json({ message: "You can only access your own calls" });
        return;
      }

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

  router.get("/api/calls/:id/analysis", requireAuth, validateIdParam, async (req, res) => {
    try {
      const callForScope = await storage.getCall(req.params.id);
      if (callForScope && !(await canViewerAccessCall(req, callForScope))) {
        res.status(403).json({ message: "You can only access your own calls" });
        return;
      }

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

  router.patch("/api/calls/:id/analysis", requireAuth, requireMFASetup, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const callId = req.params.id;

      const parsed = analysisEditSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid edit data", parsed.error);
        return;
      }
      const { updates, reason } = parsed.data;

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "edit_call_analysis",
        resourceType: "analysis",
        resourceId: callId,
        detail: `reason: ${reason}; fields: ${Object.keys(updates).join(",")}`,
      });

      const existing = await storage.getCallAnalysis(callId);
      if (!existing) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      const user = req.user;
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
        editRecord.previousValues[key] = (existing as Record<string, unknown>)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      await storage.createCallAnalysis(updatedAnalysis);

      logger.info("manual edit", { callId, editedBy, reason, fields: editRecord.fieldsChanged.join(", ") });

      // Record scoring correction for the feedback loop (improves future AI analysis).
      // Synthetic-call isolation: corrections on simulated calls must NOT be
      // captured — they'd be injected into future real-call prompts as
      // "RECENT SCORING CORRECTIONS" and bias the AI's judgment of real agents.
      if (updates.performanceScore || updates.subScores) {
        const callRow = await storage.getCall(callId);
        if (callRow?.synthetic) {
          logger.info("skipping scoring correction capture for synthetic call", { callId });
        } else {
          import("../services/scoring-feedback").then(({ recordScoringCorrection }) => {
            const origScore = parseFloat(editRecord.previousValues.performanceScore || existing.performanceScore || "0");
            const newScore = parseFloat((updates.performanceScore || existing.performanceScore || "0") as string);
            const subChanges: Record<string, { original: number; corrected: number }> = {};
            if (updates.subScores && existing.subScores) {
              const orig = existing.subScores as Record<string, number>;
              const corr = updates.subScores as Record<string, number>;
              for (const dim of Object.keys(corr)) {
                if (orig[dim] !== undefined && orig[dim] !== corr[dim]) {
                  subChanges[dim] = { original: orig[dim], corrected: corr[dim] };
                }
              }
            }
            recordScoringCorrection({
              callId, correctedBy: editedBy, reason: reason.trim(),
              originalScore: origScore, correctedScore: newScore,
              subScoreChanges: Object.keys(subChanges).length > 0 ? subChanges : undefined,
            }).catch(() => {}); // fire-and-forget
          }).catch(() => {});
        }
      }

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
      logger.error("failed to update call analysis", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to update call analysis" });
    }
  });

  // ==================== ASSIGN & DELETE ====================

  router.patch("/api/calls/:id/assign", requireAuth, requireMFASetup, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const parsed = assignCallSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid request data", parsed.error);
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
      // F14: explicit reassign/unassign goes through setCallEmployee.
      // Plain updateCall rejects employeeId in its updates payload.
      const updated = await storage.setCallEmployee(req.params.id, employeeId || null);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign employee to call" });
    }
  });

  // Toggle excluded-from-metrics flag on a call. Flagged calls stay visible in
  // lists and detail views but are omitted from aggregate metrics (leaderboards,
  // dashboards, filtered reports, badge evaluation, coaching outcomes). Used
  // for noisy recordings, roleplay/training calls, or known outliers.
  router.patch("/api/calls/:id/exclude-from-metrics", requireAuth, requireMFASetup, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
    try {
      const { excluded } = (req.body ?? {}) as { excluded?: unknown };
      if (typeof excluded !== "boolean") {
        sendError(res, 400, "Body must include { excluded: boolean }");
        return;
      }
      const call = await storage.getCall(req.params.id);
      if (!call) {
        sendError(res, 404, "Call not found");
        return;
      }
      const updated = await storage.updateCall(req.params.id, { excludedFromMetrics: excluded });
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: excluded ? "call_excluded_from_metrics" : "call_included_in_metrics",
        resourceType: "call",
        resourceId: req.params.id,
      });
      res.json(updated);
    } catch (error) {
      logger.error("failed to toggle excluded-from-metrics flag", { callId: req.params.id, error: (error as Error).message });
      sendError(res, 500, "Failed to update call");
    }
  });

  router.delete("/api/calls/:id", requireAuth, requireMFASetup, requireRole("manager", "admin"), validateIdParam, async (req, res) => {
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

      logger.info("successfully deleted call", { callId });
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
      logger.error("failed to delete call", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to delete call" });
    }
  });

  // ==================== BULK RE-ANALYSIS (admin only) ====================
  // Two request shapes:
  //  1. Explicit: { callIds: [uuid, ...] } — user selected calls in the UI.
  //  2. Filter:   { filter: { callCategory?, from?, to?, employeeId?, limit? } }
  //     — resolves to the N most recent completed calls matching the
  //     filters and re-enqueues them. Useful after prompt template edits
  //     or model swaps to refresh historical scores. Synthetic calls are
  //     always excluded. Limit default 20, cap 100 to bound spend.
  router.post("/api/calls/bulk-reanalyze", requireAuth, requireMFASetup, requireRole("admin"), async (req, res) => {
    try {
      const bulkSchema = z.union([
        z.object({
          callIds: z.array(z.string().uuid()).min(1).max(50),
        }).strict(),
        z.object({
          filter: z.object({
            callCategory: z.enum(["inbound", "outbound", "internal", "vendor"]).optional(),
            from: z.string().optional(),
            to: z.string().optional(),
            employeeId: z.string().uuid().optional(),
            limit: z.number().int().min(1).max(100).default(20),
          }),
        }).strict(),
      ]);
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, "Invalid bulk-reanalyze payload", parsed.error);
        return;
      }

      // Resolve callIds from either payload variant. Tier C #8: filter
      // resolution extracted to `resolveBulkReanalyzeCallIds` in utils.ts so
      // the semantics (category match + date range + newest-first + limit)
      // are unit-testable without mounting the route.
      let callIds: string[];
      if ("callIds" in parsed.data) {
        callIds = parsed.data.callIds;
      } else {
        const { callCategory, from, to, employeeId, limit } = parsed.data.filter;
        // Use the existing getCallsWithDetails filter surface. Filter to
        // completed status so we only re-run calls that have audio and
        // finished a prior pipeline cycle.
        const candidates = await storage.getCallsWithDetails({
          status: "completed",
          employee: employeeId,
        });
        callIds = resolveBulkReanalyzeCallIds(candidates, { callCategory, from, to, limit });
        if (callIds.length === 0) {
          res.json({ message: "No calls matched the filter", results: [] });
          return;
        }
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

        const uploadUser = req.user!.username;

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
            audioProcessingQueue.add(() => processAudioFn(callId, audioBuffer, {
              originalName: call.fileName || "reanalysis",
              mimeType: "audio/mpeg",
              callCategory: call.callCategory ?? undefined,
              uploadedBy: uploadUser,
            })).catch(async (error) => {
              logger.error("failed to re-analyze call", { callId, error });
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
        // Cap resourceId at the first 10 IDs + a count suffix so the audit
        // log row doesn't balloon when filter mode resolves 100 calls.
        resourceId: callIds.length <= 10
          ? callIds.join(",")
          : `${callIds.slice(0, 10).join(",")},+${callIds.length - 10} more`,
        detail: `Bulk re-analysis of ${callIds.length} calls`,
      });

      res.json({
        message: `${results.filter(r => r.status === "queued").length} of ${callIds.length} calls queued for re-analysis`,
        results,
      });
    } catch (error) {
      logger.error("bulk re-analysis failed", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to start bulk re-analysis" });
    }
  });
}
