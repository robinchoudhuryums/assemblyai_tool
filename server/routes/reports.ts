import { Router } from "express";
import { logger } from "../services/logger";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup, requireSelfOrManager, getUserEmployeeId } from "../auth";
import { canViewerAccessCall } from "./calls";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { aiProvider } from "../services/ai-factory";
import { buildAgentSummaryPrompt } from "../services/ai-provider";
import { getSnapshots } from "../services/performance-snapshots";
import { getRecentCorrectionsByUser, getUserCorrectionStats, getScoringQualityAlerts, getCorrectionStats } from "../services/scoring-feedback";
import { getLatestCalibrationSnapshot } from "../services/auto-calibration";
import { clampInt, parseDate, safeFloat, safeJsonParse, filterCallsByDateRange, countFrequency, calculateSentimentBreakdown, calculateAvgScore, validateParams, buildCsv, writeCsvResponse, buildPdfBuffer, writePdfResponse, type CsvSection } from "./utils";
import { expandMedicalSynonyms } from "../services/medical-synonyms";
import { embeddingCosineSimilarity } from "../services/call-clustering";
import { getPool, isPgvectorAvailable } from "../db/pool";
import type { CallWithDetails } from "@shared/schema";

export function registerReportRoutes(router: Router) {
  // Search calls
  router.get("/api/search", requireAuth, async (req, res) => {
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
      // Expand medical abbreviations for better search recall (e.g., "O2" → also matches "oxygen")
      const expandedQuery = expandMedicalSynonyms(query);
      const results = await storage.searchCalls(expandedQuery, limit);

      // Phase 3: viewer-scoped search. Filter results to calls the viewer may access
      // (their own calls or unassigned calls). Manager/admin get all results.
      let filtered = results;
      const userRole = req.user?.role || "viewer";
      if (userRole === "viewer") {
        const accessChecks = await Promise.all(
          results.map(c => canViewerAccessCall(req, c))
        );
        filtered = results.filter((_, i) => accessChecks[i]);
      }

      // Apply optional client-side filters for sentiment, score range, date range
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
      filtered = filterCallsByDateRange(filtered, req.query.from as string, req.query.to as string);

      res.json(filtered);
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls" });
    }
  });

  // Query embedding LFU-ish cache. Repeated queries (e.g. user refining
  // filters on the same q) reuse the embedding instead of re-paying Bedrock
  // cost. Bounded to 200 entries, 5-minute TTL — same conservative bounds
  // the call-embedding cache uses in bedrock.ts. Insertion-order Map +
  // delete-then-set on hit gives true LRU semantics.
  const QUERY_EMBED_CACHE_MAX = 200;
  const QUERY_EMBED_CACHE_TTL_MS = 5 * 60_000;
  const queryEmbedCache = new Map<string, { vec: number[]; expiresAt: number }>();
  function getCachedQueryEmbedding(query: string): number[] | null {
    const entry = queryEmbedCache.get(query);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      queryEmbedCache.delete(query);
      return null;
    }
    queryEmbedCache.delete(query);
    queryEmbedCache.set(query, entry);
    return entry.vec;
  }
  function setCachedQueryEmbedding(query: string, vec: number[]): void {
    if (queryEmbedCache.size >= QUERY_EMBED_CACHE_MAX && !queryEmbedCache.has(query)) {
      const oldest = queryEmbedCache.keys().next().value;
      if (oldest !== undefined) queryEmbedCache.delete(oldest);
    }
    queryEmbedCache.set(query, { vec, expiresAt: Date.now() + QUERY_EMBED_CACHE_TTL_MS });
  }

  // Semantic search — embedding-based similarity over completed calls.
  // Complements the keyword-based /api/search by matching meaning rather than
  // exact word overlap. Reuses the same embedding model that call-clustering
  // computes during the pipeline (already stored on call_analyses.embedding).
  router.get("/api/search/semantic", requireAuth, async (req, res) => {
    try {
      const query = (req.query.q as string || "").trim();
      if (!query) {
        res.status(400).json({ message: "Search query is required" });
        return;
      }
      if (query.length > 500) {
        res.status(400).json({ message: "Search query too long (max 500 characters)" });
        return;
      }

      // Mode: "semantic" (embedding only), "hybrid" (semantic + keyword
      // weighted), or "keyword-fallback" (auto-selected when embedding fails).
      // Default semantic. Anything unrecognized clamps to semantic.
      const mode: "semantic" | "hybrid" = req.query.mode === "hybrid" ? "hybrid" : "semantic";
      // Hybrid mix: alpha = weight of semantic (cosine), 1-alpha = weight of
      // keyword (BM25-ish rank). Clamped to [0, 1]. Default 0.5.
      const alphaRaw = parseFloat((req.query.alpha as string) || "0.5");
      const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.5;
      // Relevance threshold on the FINAL score (semantic similarity in
      // [0,1] or hybrid combined score in [0,1]). Default 0.25 — drops
      // the long tail of weak matches that pad the top-N. Set to 0 to
      // disable. Clamped to [0, 1].
      const thresholdRaw = parseFloat((req.query.threshold as string) || "0.25");
      const threshold = Number.isFinite(thresholdRaw) ? Math.max(0, Math.min(1, thresholdRaw)) : 0.25;
      const limit = clampInt(req.query.limit as string | undefined, 20, 1, 100);

      // Optional layered filters — applied AFTER scoring + viewer scoping
      // so that semantic ranking still operates on the full candidate pool.
      // Cheap to apply in JS at this point; date/employee/sentiment are
      // pre-existing filter dimensions on the keyword search route.
      const dateFrom = (req.query.from as string | undefined)?.trim();
      const dateTo = (req.query.to as string | undefined)?.trim();
      const filterSentiment = (req.query.sentiment as string | undefined)?.trim();
      const filterEmployeeId = (req.query.employeeId as string | undefined)?.trim();

      const applyClientFilters = (calls: CallWithDetails[]): CallWithDetails[] => {
        let out = calls;
        if (dateFrom) {
          const from = new Date(dateFrom).getTime();
          if (Number.isFinite(from)) {
            out = out.filter(c => new Date(c.uploadedAt || 0).getTime() >= from);
          }
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setUTCHours(23, 59, 59, 999);
          const toMs = toDate.getTime();
          if (Number.isFinite(toMs)) {
            out = out.filter(c => new Date(c.uploadedAt || 0).getTime() <= toMs);
          }
        }
        if (filterSentiment && filterSentiment !== "all") {
          out = out.filter(c => c.sentiment?.overallSentiment === filterSentiment);
        }
        if (filterEmployeeId) {
          out = out.filter(c => c.employeeId === filterEmployeeId);
        }
        return out;
      };

      // Embed the query (with cache). If embedding is unavailable (Bedrock
      // unreachable or not configured), fall through to keyword search for
      // graceful degrade — applies to both semantic and hybrid modes.
      let queryEmbedding: number[] | null = getCachedQueryEmbedding(query);
      if (!queryEmbedding) {
        try {
          queryEmbedding = aiProvider.generateEmbedding
            ? await aiProvider.generateEmbedding(query)
            : null;
          if (queryEmbedding) setCachedQueryEmbedding(query, queryEmbedding);
        } catch (err) {
          logger.warn("semantic search: embedding failed, falling back to keyword", {
            error: (err as Error).message,
          });
        }
      }

      if (!queryEmbedding) {
        const fallback = await storage.searchCalls(expandMedicalSynonyms(query), limit);
        const filtered = applyClientFilters(fallback);
        res.json({ mode: "keyword-fallback", results: filtered });
        return;
      }

      // For hybrid mode, also pull keyword results so we can fuse rankings.
      // Limit larger so the fusion has more candidates to consider.
      const keywordResults = mode === "hybrid"
        ? await storage.searchCalls(expandMedicalSynonyms(query), Math.max(limit * 2, 40))
        : [];
      // Build a [0..1] rank-based keyword score: top hit = 1.0, last = 1/N.
      // Reciprocal-rank rather than absolute BM25 lets us combine cleanly
      // with the cosine similarity scale.
      const keywordScores = new Map<string, number>();
      keywordResults.forEach((c, i) => {
        keywordScores.set(c.id, 1 - i / Math.max(keywordResults.length, 1));
      });

      // pgvector fast path: SQL-native cosine similarity with ivfflat index.
      const pool = getPool();
      const pgvectorReady = pool && isPgvectorAvailable();
      const userRole = req.user?.role || "viewer";

      // Common scoring + return path: takes a map of callId -> semantic similarity
      // plus the candidate hydrated calls, fuses with keyword scores when in
      // hybrid mode, applies the relevance threshold, sorts, slices.
      const scoreAndRespond = (
        backend: "pgvector" | "in-memory",
        simByCallId: Map<string, number>,
        accessible: CallWithDetails[],
        coverage: { totalAccessible: number; withEmbeddings: number },
      ) => {
        const filtered = applyClientFilters(accessible);
        const scored = filtered
          .map(c => {
            const sim = simByCallId.get(c.id);
            if (sim === undefined) return null;
            const kw = keywordScores.get(c.id) ?? 0;
            const combined = mode === "hybrid"
              ? alpha * sim + (1 - alpha) * kw
              : sim;
            return { call: c, similarity: sim, keyword: kw, score: combined };
          })
          .filter((x): x is { call: CallWithDetails; similarity: number; keyword: number; score: number } => x !== null)
          .filter(x => x.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        res.json({
          mode,
          backend,
          alpha: mode === "hybrid" ? alpha : undefined,
          threshold,
          results: scored.map(x => ({
            ...x.call,
            similarity: Math.round(x.similarity * 1000) / 1000,
            keywordScore: mode === "hybrid" ? Math.round(x.keyword * 1000) / 1000 : undefined,
            score: Math.round(x.score * 1000) / 1000,
          })),
          coverage,
        });
      };

      if (pgvectorReady) {
        const candidateLimit = Math.max(limit * 3, limit + 20);
        const { rows } = await pool.query(
          `SELECT c.id, 1 - (a.embedding_vec <=> $1::vector) AS similarity
           FROM call_analyses a
           JOIN calls c ON c.id = a.call_id
           WHERE a.embedding_vec IS NOT NULL
             AND c.status = 'completed'
             AND c.synthetic = FALSE
           ORDER BY a.embedding_vec <=> $1::vector
           LIMIT $2`,
          [`[${queryEmbedding.join(",")}]`, candidateLimit],
        );
        const { rows: coverageRows } = await pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM call_analyses a JOIN calls c ON c.id = a.call_id
              WHERE c.status = 'completed' AND c.synthetic = FALSE) AS total_accessible,
             (SELECT COUNT(*)::int FROM call_analyses a JOIN calls c ON c.id = a.call_id
              WHERE c.status = 'completed' AND c.synthetic = FALSE AND a.embedding_vec IS NOT NULL) AS with_embeddings`,
        );
        const simByCallId = new Map<string, number>(rows.map(r => [r.id, parseFloat(r.similarity)]));
        // For hybrid, also include keyword-only hits (which may have different
        // candidate IDs than pgvector returned). Hydrate the union via the
        // ID-bulk helper so we fetch ONLY the candidates (~60 rows) instead
        // of scanning every completed call in the table. This is the second
        // half of the pgvector performance win — the first half is the
        // vector-indexed SELECT above; without this we still paid O(N) for
        // hydration which partially undid the SQL-native speedup.
        const candidateIds = new Set<string>(simByCallId.keys());
        if (mode === "hybrid") {
          for (const c of keywordResults) candidateIds.add(c.id);
        }
        let hydrated = await storage.getCallsWithDetailsByIds(Array.from(candidateIds));
        // Synthesize a default similarity for keyword-only hits so they
        // can still pass through the pipeline. Reuse a low floor so they
        // can only win via keyword weight.
        for (const c of hydrated) {
          if (!simByCallId.has(c.id)) simByCallId.set(c.id, 0);
        }
        if (userRole === "viewer") {
          const checks = await Promise.all(hydrated.map(c => canViewerAccessCall(req, c)));
          hydrated = hydrated.filter((_, i) => checks[i]);
        }
        scoreAndRespond("pgvector", simByCallId, hydrated, {
          totalAccessible: coverageRows[0]?.total_accessible ?? 0,
          withEmbeddings: coverageRows[0]?.with_embeddings ?? 0,
        });
        return;
      }

      // In-memory fallback: pulls all completed calls. Works for small
      // deployments (< 10k calls); pgvector path is required for scale.
      const all = await storage.getCallsWithDetails({ status: "completed" });
      let accessible = all;
      if (userRole === "viewer") {
        const checks = await Promise.all(all.map(c => canViewerAccessCall(req, c)));
        accessible = all.filter((_, i) => checks[i]);
      }

      const simByCallIdInMem = new Map<string, number>();
      for (const c of accessible) {
        const emb = (c.analysis as { embedding?: number[] } | undefined)?.embedding;
        if (emb && Array.isArray(emb) && emb.length > 0) {
          simByCallIdInMem.set(c.id, embeddingCosineSimilarity(queryEmbedding, emb));
        } else if (mode === "hybrid" && keywordScores.has(c.id)) {
          // Keyword-only hit: include with similarity 0 so it can still
          // win on keyword weight.
          simByCallIdInMem.set(c.id, 0);
        }
      }
      scoreAndRespond("in-memory", simByCallIdInMem, accessible, {
        totalAccessible: accessible.length,
        withEmbeddings: Array.from(simByCallIdInMem.values()).filter(v => v > 0).length,
      });
    } catch (error) {
      logger.error("semantic search failed", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to run semantic search" });
    }
  });

  // F-02: performance rankings expose individual employee scores. Restrict to
  // manager+ so agents can't see each other's performance metrics.
router.get("/api/performance", requireAuth, requireRole("manager", "admin"), async (req, res) => {
  try {
    // We can reuse the existing function to get top performers
    const performers = await storage.getTopPerformers(10); // Get top 10
    res.json(performers);
  } catch (error) {
    logger.error("failed to get performance data", { error });
    res.status(500).json({ message: "Failed to get performance data" });
  }
});

  // F-02: summary includes performer rankings with individual scores.
  router.get("/api/reports/summary", requireAuth, requireRole("manager", "admin"), async (req, res) => {
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
    logger.error("failed to generate report data", { error });
    res.status(500).json({ message: "Failed to generate report data" });
  }
});

  // Filtered reports: accepts date range, employee, role filters
  // F35: uses storage.getFilteredReportMetrics() for SQL-level aggregation
  // instead of loading all calls into memory.
  router.get("/api/reports/filtered", requireAuth, async (req, res) => {
    try {
      // A15/F14: query param renamed from `department` to `role` because
      // the filter actually compares against employees.role (not a separate
      // department field). Accept both names during the transition window —
      // `role` takes precedence. Also decodeURIComponent so percent-encoded
      // values from URL bookmarks (e.g. "Customer%20Service") match.
      const { from, to, employeeId, callPartyType } = req.query;
      const rawRole = (req.query.role as string | undefined) ?? (req.query.department as string | undefined);
      let role: string | undefined;
      if (rawRole) {
        try {
          role = decodeURIComponent(rawRole);
        } catch {
          role = rawRole; // malformed encoding — fall back to literal value
        }
      }

      // Viewer-scoped filtered reports: force employeeId to the viewer's own ID
      // regardless of what they pass. Unlinked viewers get empty results.
      let scopedEmployeeId = employeeId as string | undefined;
      const userRole = req.user?.role || "viewer";
      if (userRole === "viewer") {
        const myEmployeeId = await getUserEmployeeId(req.user?.username, req.user?.name);
        if (!myEmployeeId) {
          // No linked employee — return empty-shaped result without hitting the DB
          // (employee_id is UUID-typed, so any sentinel would cause a cast error).
          res.json({
            metrics: { totalCalls: 0, avgSentiment: 0, avgPerformanceScore: 0 },
            sentiment: { positive: 0, neutral: 0, negative: 0 },
            performers: [],
            trends: [],
            avgSubScores: null,
            autoAssignedCount: 0,
          });
          return;
        }
        scopedEmployeeId = myEmployeeId;
      }

      const result = await storage.getFilteredReportMetrics({
        from: from as string | undefined,
        to: to as string | undefined,
        employeeId: scopedEmployeeId,
        role,
        callPartyType: callPartyType as string | undefined,
      });

      res.json(result);
    } catch (error) {
      logger.error("failed to generate filtered report", { error });
      res.status(500).json({ message: "Failed to generate filtered report" });
    }
  });

  // Server-side CSV export for filtered reports — replaces the client-built
  // TXT export with a full server-generated CSV so the export is first-class
  // auditable (direct HIPAA PHI access entry, no reliance on a client beacon)
  // and supports richer formats (sub-score columns, trend rows).
  router.get("/api/reports/filtered/export.csv", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { from, to, employeeId, callPartyType } = req.query;
      const rawRole = (req.query.role as string | undefined) ?? (req.query.department as string | undefined);
      let role: string | undefined;
      if (rawRole) {
        try { role = decodeURIComponent(rawRole); } catch { role = rawRole; }
      }

      const result = await storage.getFilteredReportMetrics({
        from: from as string | undefined,
        to: to as string | undefined,
        employeeId: employeeId as string | undefined,
        role,
        callPartyType: callPartyType as string | undefined,
      });

      const summaryRows: unknown[][] = [
        ["Summary", "Total Calls", result.metrics.totalCalls],
        ["Summary", "Average Performance Score", result.metrics.avgPerformanceScore.toFixed(2)],
        ["Summary", "Average Sentiment", result.metrics.avgSentiment.toFixed(2)],
        ["Summary", "Auto-assigned Calls", result.autoAssignedCount],
        ["Sentiment", "Positive", result.sentiment.positive],
        ["Sentiment", "Neutral", result.sentiment.neutral],
        ["Sentiment", "Negative", result.sentiment.negative],
      ];
      if (result.avgSubScores) {
        summaryRows.push(["Sub-Scores", "Compliance", result.avgSubScores.compliance]);
        summaryRows.push(["Sub-Scores", "Customer Experience", result.avgSubScores.customerExperience]);
        summaryRows.push(["Sub-Scores", "Communication", result.avgSubScores.communication]);
        summaryRows.push(["Sub-Scores", "Resolution", result.avgSubScores.resolution]);
      }

      const csv = buildCsv([
        { headers: ["Section", "Field", "Value"], rows: summaryRows },
        {
          headers: ["Performer", "Role", "Call Count", "Average Score"],
          rows: result.performers.map(p => [p.name, p.role, p.totalCalls, p.avgPerformanceScore ?? ""]),
        },
        {
          headers: ["Month", "Calls", "Avg Score", "Positive", "Neutral", "Negative"],
          rows: result.trends.map(t => [t.month, t.calls, t.avgScore ?? "", t.positive, t.neutral, t.negative]),
        },
      ]);

      const fromStr = (from as string | undefined) || "all";
      const toStr = (to as string | undefined) || "all";
      writeCsvResponse(res, csv, `filtered-report-${fromStr}-to-${toStr}.csv`, () => {
        // HIPAA: first-class audit entry (replaces client beacon for this surface).
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "export_report",
          resourceType: "report",
          detail: `format=csv; reportType=filtered; from=${from ?? ""}; to=${toStr}; employeeId=${employeeId ?? ""}; role=${role ?? ""}`,
        });
      });
    } catch (error) {
      logger.error("failed to export filtered report", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to export filtered report" });
    }
  });

  // Server-side PDF export of the same filtered report. Uses the same
  // CsvSection shape fed into buildPdfBuffer. Audit event identical to the
  // CSV variant but with format=pdf.
  router.get("/api/reports/filtered/export.pdf", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { from, to, employeeId, callPartyType } = req.query;
      const rawRole = (req.query.role as string | undefined) ?? (req.query.department as string | undefined);
      let role: string | undefined;
      if (rawRole) {
        try { role = decodeURIComponent(rawRole); } catch { role = rawRole; }
      }

      const result = await storage.getFilteredReportMetrics({
        from: from as string | undefined,
        to: to as string | undefined,
        employeeId: employeeId as string | undefined,
        role,
        callPartyType: callPartyType as string | undefined,
      });

      const summaryRows: unknown[][] = [
        ["Summary", "Total Calls", result.metrics.totalCalls],
        ["Summary", "Average Performance Score", result.metrics.avgPerformanceScore.toFixed(2)],
        ["Summary", "Average Sentiment", result.metrics.avgSentiment.toFixed(2)],
        ["Summary", "Auto-assigned Calls", result.autoAssignedCount],
        ["Sentiment", "Positive", result.sentiment.positive],
        ["Sentiment", "Neutral", result.sentiment.neutral],
        ["Sentiment", "Negative", result.sentiment.negative],
      ];
      if (result.avgSubScores) {
        summaryRows.push(["Sub-Scores", "Compliance", result.avgSubScores.compliance]);
        summaryRows.push(["Sub-Scores", "Customer Experience", result.avgSubScores.customerExperience]);
        summaryRows.push(["Sub-Scores", "Communication", result.avgSubScores.communication]);
        summaryRows.push(["Sub-Scores", "Resolution", result.avgSubScores.resolution]);
      }

      const fromStr = (from as string | undefined) || "all";
      const toStr = (to as string | undefined) || "all";

      const pdfBuffer = await buildPdfBuffer(
        [
          { headers: ["Section", "Field", "Value"], rows: summaryRows },
          {
            headers: ["Performer", "Role", "Call Count", "Average Score"],
            rows: result.performers.map(p => [p.name, p.role, p.totalCalls, p.avgPerformanceScore ?? ""]),
          },
          {
            headers: ["Month", "Calls", "Avg Score", "Positive", "Neutral", "Negative"],
            rows: result.trends.map(t => [t.month, t.calls, t.avgScore ?? "", t.positive, t.neutral, t.negative]),
            // Line chart visualizes the monthly avg-score trajectory above
            // the table. Skipped automatically when fewer than 2 months.
            chart: result.trends.length >= 2 ? {
              type: "line" as const,
              title: "Monthly average score trend",
              series: [
                {
                  label: "Avg score",
                  points: result.trends.map(t => ({ x: t.month, y: t.avgScore })),
                },
              ],
            } : undefined,
          },
        ],
        {
          title: "Filtered Performance Report",
          kicker: "Performance · Filtered",
          companyName: process.env.COMPANY_NAME || "UniversalMed Supply",
          period: `${fromStr} → ${toStr}`,
          generatedAt: new Date(),
        },
      );

      writePdfResponse(res, pdfBuffer, `filtered-report-${fromStr}-to-${toStr}.pdf`, () => {
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "export_report",
          resourceType: "report",
          detail: `format=pdf; reportType=filtered; from=${from ?? ""}; to=${toStr}; employeeId=${employeeId ?? ""}; role=${role ?? ""}`,
        });
      });
    } catch (error) {
      logger.error("failed to export filtered report pdf", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to export filtered report PDF" });
    }
  });

  // Agent profile: aggregated feedback across all calls for an employee.
  // #1 Phase 1: restrict to self-or-manager — profile exposes individual PHI.
  router.get("/api/reports/agent-profile/:employeeId", requireAuth, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
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
      const filtered = filterCallsByDateRange(allCalls, from as string | undefined, to as string | undefined);

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

      const avgScore = calculateAvgScore(scores);
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
      logger.error("failed to generate agent profile", { error });
      res.status(500).json({ message: "Failed to generate agent profile" });
    }
  });

  // Server-side CSV export of an agent profile — summary, call history,
  // sub-scores, flagged calls, and topic frequencies. Written as a first-
  // class export_report HIPAA audit entry so no client beacon is required.
  router.get("/api/reports/agent-profile/:employeeId/export.csv", requireAuth, requireMFASetup, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.query;

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ message: "Employee not found" });

      const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });
      const filtered = filterCallsByDateRange(allCalls, from as string | undefined, to as string | undefined);

      const scores: number[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
      const topicFreq: Record<string, number> = {};
      const callRows: unknown[][] = [];
      for (const call of filtered) {
        const score = call.analysis?.performanceScore ? safeFloat(call.analysis.performanceScore) : null;
        if (score !== null && Number.isFinite(score)) scores.push(score);
        const s = call.sentiment?.overallSentiment;
        if (s === "positive" || s === "neutral" || s === "negative") sentimentCounts[s]++;
        for (const topic of call.analysis?.topics || []) {
          const t = typeof topic === "string" ? topic : (topic as { name?: string })?.name;
          if (t) topicFreq[t] = (topicFreq[t] || 0) + 1;
        }
        callRows.push([
          call.id,
          call.uploadedAt || "",
          call.fileName || "",
          call.duration ?? "",
          score ?? "",
          s ?? "",
          (call.analysis?.summary || "").replace(/\s+/g, " ").slice(0, 300),
          (call.analysis?.flags || []).join("|"),
        ]);
      }
      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const topicRows = Object.entries(topicFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([topic, count]) => [topic, count]);

      const csv = buildCsv([
        {
          headers: ["Field", "Value"],
          rows: [
            ["Employee", employee.name],
            ["Email", employee.email || ""],
            ["Role", employee.role || ""],
            ["Sub-Team", employee.subTeam || ""],
            ["Window From", (from as string | undefined) || "all"],
            ["Window To", (to as string | undefined) || "all"],
            ["Call Count", filtered.length],
            ["Average Score", avgScore === null ? "" : avgScore.toFixed(2)],
            ["Positive Sentiment", sentimentCounts.positive],
            ["Neutral Sentiment", sentimentCounts.neutral],
            ["Negative Sentiment", sentimentCounts.negative],
          ],
        },
        {
          headers: ["Call ID", "Uploaded At", "File Name", "Duration (s)", "Score", "Sentiment", "Summary", "Flags"],
          rows: callRows,
        },
        {
          headers: ["Topic", "Count"],
          rows: topicRows,
        },
      ]);

      const fromStr = (from as string | undefined) || "all";
      const toStr = (to as string | undefined) || "all";
      const safeName = (employee.name || employeeId).replace(/[^a-zA-Z0-9-_]/g, "_");
      writeCsvResponse(res, csv, `agent-profile-${safeName}-${fromStr}-to-${toStr}.csv`, () => {
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "export_report",
          resourceType: "report",
          resourceId: employeeId,
          detail: `format=csv; reportType=agent-profile; employeeId=${employeeId}; from=${fromStr}; to=${toStr}; callCount=${filtered.length}`,
        });
      });
    } catch (error) {
      logger.error("failed to export agent profile", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to export agent profile" });
    }
  });

  // PDF export of the same agent profile. Audit event format=pdf.
  router.get("/api/reports/agent-profile/:employeeId/export.pdf", requireAuth, requireMFASetup, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.query;

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ message: "Employee not found" });

      const allCalls = await storage.getCallsWithDetails({ status: "completed", employee: employeeId });
      const filtered = filterCallsByDateRange(allCalls, from as string | undefined, to as string | undefined);

      const scores: number[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
      const topicFreq: Record<string, number> = {};
      const callRows: unknown[][] = [];
      for (const call of filtered) {
        const score = call.analysis?.performanceScore ? safeFloat(call.analysis.performanceScore) : null;
        if (score !== null && Number.isFinite(score)) scores.push(score);
        const s = call.sentiment?.overallSentiment;
        if (s === "positive" || s === "neutral" || s === "negative") sentimentCounts[s]++;
        for (const topic of call.analysis?.topics || []) {
          const t = typeof topic === "string" ? topic : (topic as { name?: string })?.name;
          if (t) topicFreq[t] = (topicFreq[t] || 0) + 1;
        }
        callRows.push([
          call.uploadedAt ? String(call.uploadedAt).slice(0, 10) : "",
          call.duration ?? "",
          score ?? "",
          s ?? "",
          // PDF column is narrower than CSV — trim harder.
          (call.analysis?.summary || "").replace(/\s+/g, " ").slice(0, 120),
        ]);
      }
      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const topicRows = Object.entries(topicFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([topic, count]) => [topic, count]);

      const fromStr = (from as string | undefined) || "all";
      const toStr = (to as string | undefined) || "all";

      const pdfBuffer = await buildPdfBuffer(
        [
          {
            headers: ["Field", "Value"],
            rows: [
              ["Employee", employee.name],
              ["Email", employee.email || ""],
              ["Role", employee.role || ""],
              ["Sub-Team", employee.subTeam || ""],
              ["Window", `${fromStr} → ${toStr}`],
              ["Call Count", filtered.length],
              ["Average Score", avgScore === null ? "—" : avgScore.toFixed(2)],
              ["Positive Sentiment", sentimentCounts.positive],
              ["Neutral Sentiment", sentimentCounts.neutral],
              ["Negative Sentiment", sentimentCounts.negative],
            ],
          },
          {
            headers: ["Date", "Duration (s)", "Score", "Sentiment", "Summary"],
            rows: callRows,
          },
          {
            headers: ["Topic", "Count"],
            rows: topicRows,
          },
        ],
        {
          title: `Agent Profile — ${employee.name}`,
          kicker: "Performance · Agent Profile",
          companyName: process.env.COMPANY_NAME || "UniversalMed Supply",
          period: `${fromStr} → ${toStr}`,
          generatedAt: new Date(),
        },
      );

      const safeName = (employee.name || employeeId).replace(/[^a-zA-Z0-9-_]/g, "_");
      writePdfResponse(res, pdfBuffer, `agent-profile-${safeName}-${fromStr}-to-${toStr}.pdf`, () => {
        logPhiAccess({
          ...auditContext(req),
          timestamp: new Date().toISOString(),
          event: "export_report",
          resourceType: "report",
          resourceId: employeeId,
          detail: `format=pdf; reportType=agent-profile; employeeId=${employeeId}; from=${fromStr}; to=${toStr}; callCount=${filtered.length}`,
        });
      });
    } catch (error) {
      logger.error("failed to export agent profile pdf", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to export agent profile PDF" });
    }
  });

  // Generate AI narrative summary for an agent's performance.
  // #1 Phase 1: restrict to self-or-manager.
  router.post("/api/reports/agent-summary/:employeeId", requireAuth, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
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

      const filtered = filterCallsByDateRange(allCalls, from, to);

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

      const avgScore = calculateAvgScore(scores);

      const dateRange = `${from || "all time"} to ${to || "present"}`;

      // Fetch prior performance snapshots for longitudinal context
      const priorSnapshots = await getSnapshots("employee", employeeId, 6);
      let priorContext = "";
      if (priorSnapshots.length > 0) {
        priorContext = "\n\nPRIOR PERFORMANCE REVIEW HISTORY (use this to identify trends, improvements, and regressions):\n";
        for (const snap of priorSnapshots) {
          priorContext += `\n--- ${snap.periodStart} to ${snap.periodEnd} ---\n`;
          priorContext += `Calls: ${snap.metrics.totalCalls}, Avg Score: ${snap.metrics.avgScore?.toFixed(1) ?? "N/A"}/10\n`;
          if (snap.aiSummary) {
            const condensed = snap.aiSummary.length > 400 ? snap.aiSummary.slice(0, 400) + "..." : snap.aiSummary;
            priorContext += `Prior Assessment: ${condensed}\n`;
          }
        }
      }

      const prompt = buildAgentSummaryPrompt({
        name: employee.name,
        role: employee.role,
        totalCalls: filtered.length,
        avgScore,
        highScore: scores.length > 0 ? Math.max(...scores) : null,
        lowScore: scores.length > 0 ? Math.min(...scores) : null,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFrequency(allStrengths),
        topSuggestions: countFrequency(allSuggestions),
        commonTopics: countFrequency(allTopics),
        dateRange,
      }) + priorContext;

      logger.info("generating AI summary", { employeeId, calls: filtered.length, priorSnapshots: priorSnapshots.length });
      const summary = await aiProvider.generateText(prompt);
      logger.info("AI summary generated", { employeeId });

      res.json({ summary });
    } catch (error) {
      logger.error("failed to generate agent summary", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to generate AI summary" });
    }
  });

  // HIPAA: Only managers and admins can delete call records
  router.delete("/api/calls/:id", requireAuth, requireMFASetup, requireRole("manager", "admin"), async (req, res) => {
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

    logger.info("successfully deleted call", { callId });
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
    logger.error("failed to delete call", { error: (error as Error).message });
    res.status(500).json({ message: "Failed to delete call" });
  }
});

  // ==================== SCORING CORRECTION FEEDBACK ====================
  // Surfaces the user's own corrections + rolling stats so managers can see
  // the feedback loop they're contributing to. Read-only, authenticated —
  // any role can fetch their own data; no MFA gate because it reveals no
  // new PHI (only the user's own recent edits already in the audit trail).

  router.get("/api/scoring-corrections/mine", requireAuth, (req, res) => {
    try {
      const username = req.user!.username;
      const sinceDays = clampInt(typeof req.query.days === "string" ? req.query.days : undefined, 30, 1, 365);
      const limit = clampInt(typeof req.query.limit === "string" ? req.query.limit : undefined, 20, 1, 100);
      const stats = getUserCorrectionStats(username, sinceDays);
      const recent = getRecentCorrectionsByUser(username, limit);
      // Return a lean shape — the full ScoringCorrection contains call
      // summary + topics which can be large. Managers only need headline
      // fields for the dashboard widget.
      res.json({
        stats,
        corrections: recent.map(c => ({
          id: c.id,
          callId: c.callId,
          callCategory: c.callCategory,
          correctedAt: c.correctedAt,
          originalScore: c.originalScore,
          correctedScore: c.correctedScore,
          direction: c.direction,
          reason: c.reason,
          subScoreChanges: c.subScoreChanges,
        })),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to load scoring corrections" });
    }
  });

  // Manager correction impact dashboard (Tier 2 #5).
  //
  // Finds completed calls that the AI scored in a similar range to this
  // manager's recent corrections, but that this manager has NOT touched yet.
  // The hypothesis: if a manager repeatedly corrects AI scores of ~3.5 up
  // to ~5.0 in inbound calls, other inbound calls AI scored ~3.5 may be
  // similarly mis-scored. Surfacing them closes the feedback loop.
  //
  // Quick heuristic (no embedding lookup required): group corrections by
  // category + direction, compute the mean "original" (AI-assigned) score,
  // and find completed calls in the same category where the AI score is
  // within WINDOW points of that mean AND the call has no manualEdits entry
  // from this user. Pure read; no mutations.
  router.get("/api/scoring-corrections/similar-uncorrected", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const username = req.user!.username;
      const windowScore = 0.5;
      const perGroupLimit = 5;
      const totalCap = clampInt(typeof req.query.limit === "string" ? req.query.limit : undefined, 20, 1, 50);
      const sinceDays = clampInt(typeof req.query.days === "string" ? req.query.days : undefined, 30, 1, 180);

      // Source corrections: the user's last ~20 in the window.
      const corrections = getRecentCorrectionsByUser(username, 20)
        .filter(c => {
          const t = new Date(c.correctedAt).getTime();
          return Number.isFinite(t) && t >= Date.now() - sinceDays * 86400000;
        });
      if (corrections.length === 0) {
        res.json({ suggestions: [], groups: [] });
        return;
      }

      // Group by (category || 'general', direction). Mean of originalScore is
      // our "this is what AI tends to mis-score" centroid.
      type GroupKey = string;
      const groups = new Map<GroupKey, {
        category: string;
        direction: "upgraded" | "downgraded";
        centroid: number;
        count: number;
      }>();
      for (const c of corrections) {
        const category = c.callCategory || "general";
        const key = `${category}::${c.direction}`;
        const existing = groups.get(key);
        if (existing) {
          existing.centroid = (existing.centroid * existing.count + c.originalScore) / (existing.count + 1);
          existing.count += 1;
        } else {
          groups.set(key, { category, direction: c.direction, centroid: c.originalScore, count: 1 });
        }
      }

      // Require at least 2 corrections per group so a single outlier doesn't
      // generate a suggestion surface.
      const qualifyingGroups = [...groups.values()]
        .filter(g => g.count >= 2)
        .sort((a, b) => b.count - a.count);

      if (qualifyingGroups.length === 0) {
        res.json({ suggestions: [], groups: [] });
        return;
      }

      // Pull a window of recent completed calls, filter per-group.
      const sinceDate = new Date(Date.now() - sinceDays * 86400000);
      const recentCalls = await storage.getCallsSinceWithDetails(sinceDate);

      const alreadyCorrectedCallIds = new Set(
        corrections.filter(c => c.correctedBy === username).map(c => c.callId),
      );

      type Suggestion = {
        callId: string;
        aiScore: number;
        callCategory: string | null | undefined;
        direction: "upgraded" | "downgraded";
        centroid: number;
        uploadedAt: string | undefined;
        employeeName: string | undefined;
      };
      const suggestions: Suggestion[] = [];

      for (const group of qualifyingGroups) {
        const perGroup: Suggestion[] = [];
        for (const call of recentCalls) {
          if (alreadyCorrectedCallIds.has(call.id)) continue;
          const rawScore = call.analysis?.performanceScore;
          if (rawScore === undefined || rawScore === null || String(rawScore) === "") continue;
          const aiScore = parseFloat(String(rawScore));
          if (!Number.isFinite(aiScore)) continue;

          // Category match: "general" centroid matches any category (global
          // pattern); otherwise require exact match.
          const callCat = call.callCategory || "general";
          if (group.category !== "general" && callCat !== group.category) continue;

          // Score proximity to the group's centroid.
          if (Math.abs(aiScore - group.centroid) > windowScore) continue;

          // Exclude calls that already have manualEdits entries from this user.
          const edits = Array.isArray(call.analysis?.manualEdits) ? call.analysis!.manualEdits : [];
          const userAlreadyEdited = edits.some(
            (e: any) => typeof e?.editedBy === "string" && e.editedBy === username,
          );
          if (userAlreadyEdited) continue;

          perGroup.push({
            callId: call.id,
            aiScore,
            callCategory: call.callCategory,
            direction: group.direction,
            centroid: Math.round(group.centroid * 10) / 10,
            uploadedAt: call.uploadedAt,
            employeeName: call.employee?.name,
          });
          if (perGroup.length >= perGroupLimit) break;
        }
        suggestions.push(...perGroup);
        if (suggestions.length >= totalCap) break;
      }

      res.json({
        suggestions: suggestions.slice(0, totalCap),
        groups: qualifyingGroups.map(g => ({
          category: g.category,
          direction: g.direction,
          centroid: Math.round(g.centroid * 10) / 10,
          count: g.count,
        })),
      });
    } catch (error) {
      logger.error("failed to compute similar-uncorrected suggestions", {
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to compute suggestions" });
    }
  });

  // Manager-scoped scoring-quality dashboard (Tier A #3).
  //
  // Surfaces the same scoring-quality signals that powered the admin-only
  // /api/admin/calibration response (correction stats + auto-calibration
  // quality alerts + regression-detection summary), but to manager+ roles.
  // The goal is to shift AI-trust accountability from admin-only into
  // direct manager visibility: if the AI is systematically scoring their
  // team too low, managers see the signal first-hand rather than waiting
  // on an admin.
  //
  // Data is currently global — `scoring-feedback` tracks corrections
  // across every user and `auto-calibration` operates on the full call
  // corpus. Per-team scoping would require filtering corrections by the
  // manager's reports and is deferred as a follow-on.
  //
  // Read-only; no MFA gate (reveals no new PHI — stats only, no call-level
  // data). Viewers get 403.
  router.get("/api/scoring-quality", requireAuth, requireRole("manager", "admin"), async (_req, res) => {
    try {
      const correctionStats = getCorrectionStats();
      const qualityAlerts = getScoringQualityAlerts();

      // Calibration snapshot — lightweight projection, only timestamp + the
      // drift-detected flag. Full snapshot stays admin-scoped via
      // /api/admin/calibration.
      let calibrationSummary: {
        lastSnapshotAt: string | null;
        driftDetected: boolean;
        observedMean: number | null;
        configuredMean: number | null;
      } = {
        lastSnapshotAt: null,
        driftDetected: false,
        observedMean: null,
        configuredMean: null,
      };
      try {
        const snapshot = await getLatestCalibrationSnapshot();
        if (snapshot) {
          calibrationSummary = {
            lastSnapshotAt: snapshot.timestamp,
            driftDetected: snapshot.driftDetected,
            observedMean: snapshot.observed?.mean ?? null,
            configuredMean: snapshot.current?.aiModelMean ?? null,
          };
        }
      } catch {
        /* snapshot unavailable — leave defaults */
      }

      res.json({
        correctionStats,
        qualityAlerts,
        calibration: calibrationSummary,
      });
    } catch (error) {
      logger.error("failed to fetch scoring quality dashboard", {
        error: (error as Error).message,
      });
      res.status(500).json({ message: "Failed to fetch scoring quality" });
    }
  });
}
