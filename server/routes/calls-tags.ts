import type { Router } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { getPool } from "../db/pool";
import { validateIdParam, validateParams } from "./utils";
import { canViewerAccessCall } from "./calls";

const validateIdAndTagId = validateParams({ id: "uuid", tagId: "uuid" });
const validateIdAndAnnotationId = validateParams({ id: "uuid", annotationId: "uuid" });

export function registerCallTagRoutes(router: Router) {

  // ==================== CALL TAGGING ROUTES ====================

  router.get("/api/calls/:id/tags", requireAuth, validateIdParam, async (req, res) => {
    try {
      const callId = req.params.id;
      // Verify call exists and user has access
      const call = await storage.getCall(callId);
      if (!call) return res.status(404).json({ message: "Call not found" });
      // Phase 3: viewer-scoped — only own or unassigned calls.
      if (!(await canViewerAccessCall(req, call))) {
        return res.status(403).json({ message: "You can only access your own calls" });
      }
      const pool = getPool();
      if (pool) {
        const result = await pool.query(
          "SELECT id, tag, created_by, created_at FROM call_tags WHERE call_id = $1 ORDER BY created_at",
          [callId]
        );
        return res.json(result.rows.map((r: any) => ({ id: r.id, tag: r.tag, createdBy: r.created_by, createdAt: r.created_at })));
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  router.post("/api/calls/:id/tags", requireAuth, validateIdParam, async (req, res) => {
    try {
      const callId = req.params.id;
      const { tag } = req.body;
      if (!tag || typeof tag !== "string" || tag.length > 100) {
        return res.status(400).json({ message: "Tag is required (max 100 characters)" });
      }
      const normalizedTag = tag.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9 _./-]*$/.test(normalizedTag) || normalizedTag.length === 0) {
        return res.status(400).json({ message: "Tags must contain only letters, numbers, spaces, dots, underscores, hyphens, and slashes" });
      }
      const pool = getPool();
      if (!pool) {
        return res.status(503).json({ message: "Tagging requires a database connection" });
      }
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

  router.delete("/api/calls/:id/tags/:tagId", requireAuth, validateIdAndTagId, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Tagging requires a database connection" });
      // Author-or-manager check: only the tag's creator or a manager+ may
      // delete it. Mirrors the annotation delete flow below so viewers can't
      // remove tags attributed to other users. Previously any authenticated
      // user could delete any tag because the handler only required auth.
      const lookup = await pool.query(
        "SELECT tag, created_by FROM call_tags WHERE id = $1 AND call_id = $2",
        [req.params.tagId, req.params.id]
      );
      if (lookup.rows.length === 0) return res.status(404).json({ message: "Tag not found" });
      const tagCreatedBy = lookup.rows[0].created_by as string;
      // F-08: creation (line 55) stores created_by as req.user.username.
      // Compare against username first for an exact match, then fall back
      // to display name for backward compatibility with pre-fix tags.
      const username = req.user?.username || "";
      const displayName = req.user?.name || "";
      const userRole = req.user?.role || "viewer";
      const isAuthor = tagCreatedBy === username || (displayName && tagCreatedBy === displayName);
      const isManagerOrAdmin = userRole === "manager" || userRole === "admin";
      if (!isAuthor && !isManagerOrAdmin) {
        return res.status(403).json({ message: "Only the tag's author or a manager can delete this tag" });
      }
      await pool.query("DELETE FROM call_tags WHERE id = $1 AND call_id = $2", [req.params.tagId, req.params.id]);
      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "tag_removed", resourceType: "call", resourceId: req.params.id, detail: lookup.rows[0].tag });
      res.json({ message: "Tag removed" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove tag" });
    }
  });

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

  router.get("/api/calls/by-tag/:tag", requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.json([]);
      const tag = req.params.tag.toLowerCase();
      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "search_calls_by_tag", resourceType: "call", detail: tag });
      const result = await pool.query(
        `SELECT c.id, c.file_name, c.status, c.duration, c.call_category, c.uploaded_at, c.employee_id,
                e.name as employee_name
         FROM calls c
         INNER JOIN call_tags ct ON ct.call_id = c.id
         LEFT JOIN employees e ON c.employee_id = e.id
         -- Synthetic-call isolation: tag search excludes simulated calls.
         WHERE ct.tag = $1 AND c.synthetic = FALSE
         ORDER BY c.uploaded_at DESC
         LIMIT 100`,
        [tag]
      );
      // Phase 3: viewer-scoped tag search. Post-filter in JS since the SQL query
      // already returns only tagged calls (bounded to 100 by LIMIT).
      let rows = result.rows;
      const userRole = req.user?.role || "viewer";
      if (userRole === "viewer") {
        const checks = await Promise.all(
          rows.map((r: any) => canViewerAccessCall(req, { employeeId: r.employee_id }))
        );
        rows = rows.filter((_: any, i: number) => checks[i]);
      }
      res.json(rows.map((r: any) => ({
        id: r.id, fileName: r.file_name, status: r.status, duration: r.duration,
        callCategory: r.call_category, uploadedAt: r.uploaded_at,
        employeeId: r.employee_id, employeeName: r.employee_name,
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls by tag" });
    }
  });

  // ==================== ANNOTATIONS ====================

  router.get("/api/calls/:id/annotations", requireAuth, validateIdParam, async (req, res) => {
    try {
      // Phase 3: viewer-scoped — only own or unassigned calls.
      const callForScope = await storage.getCall(req.params.id);
      if (callForScope && !(await canViewerAccessCall(req, callForScope))) {
        res.status(403).json({ message: "You can only access your own calls" });
        return;
      }

      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "view_annotations", resourceType: "annotation", resourceId: req.params.id });
      const pool = getPool();
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

  router.post("/api/calls/:id/annotations", requireAuth, validateIdParam, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ message: "Annotations require PostgreSQL" });
        return;
      }
      const { timestampMs, text } = req.body;
      // A35/F88: validate both fields strictly.
      if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs < 0) {
        res.status(400).json({ message: "timestampMs must be a non-negative finite number" });
        return;
      }
      if (typeof text !== "string" || !text.trim() || text.length > 2000) {
        res.status(400).json({ message: "text must be a non-empty string ≤ 2000 chars" });
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

  router.delete("/api/calls/:id/annotations/:annotationId", requireAuth, validateIdAndAnnotationId, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ message: "Annotations require PostgreSQL" });
        return;
      }
      // Author-or-manager check: only the original author or manager+ may delete
      const { rows } = await pool.query(
        "SELECT author FROM annotations WHERE id = $1 AND call_id = $2",
        [req.params.annotationId, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: "Annotation not found" });
      }
      const annotationAuthor = rows[0].author;
      const userIdentifier = req.user?.name || req.user?.username || "";
      const userRole = req.user?.role || "viewer";
      const isAuthor = annotationAuthor === userIdentifier;
      const isManagerOrAdmin = userRole === "manager" || userRole === "admin";
      if (!isAuthor && !isManagerOrAdmin) {
        return res.status(403).json({ message: "Only the author or a manager can delete this annotation" });
      }
      await pool.query("DELETE FROM annotations WHERE id = $1 AND call_id = $2", [req.params.annotationId, req.params.id]);
      logPhiAccess({ ...auditContext(req), timestamp: new Date().toISOString(), event: "annotation_deleted", resourceType: "annotation", resourceId: req.params.annotationId });
      res.json({ message: "Annotation deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });
}
