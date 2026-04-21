import { Router } from "express";
import { logger } from "../services/logger";
import { storage } from "../storage";
import { requireAuth, requireRole, requireMFASetup, requireSelfOrManager, getUserEmployeeId } from "../auth";
import { canViewerAccessCall } from "./calls";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { aiProvider } from "../services/ai-factory";
import { buildAgentSummaryPrompt } from "../services/ai-provider";
import { getSnapshots } from "../services/performance-snapshots";
import { getRecentCorrectionsByUser, getUserCorrectionStats } from "../services/scoring-feedback";
import { clampInt, parseDate, safeFloat, safeJsonParse, filterCallsByDateRange, countFrequency, calculateSentimentBreakdown, calculateAvgScore, validateParams, escapeCsvValue } from "./utils";
import { expandMedicalSynonyms } from "../services/medical-synonyms";
import { embeddingCosineSimilarity } from "../services/call-clustering";

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
      const limit = clampInt(req.query.limit as string | undefined, 20, 1, 100);

      // Embed the query. If embedding is unavailable (Bedrock unreachable or
      // not configured), fall through to keyword search for graceful degrade.
      let queryEmbedding: number[] | null = null;
      try {
        queryEmbedding = aiProvider.generateEmbedding
          ? await aiProvider.generateEmbedding(query)
          : null;
      } catch (err) {
        logger.warn("semantic search: embedding failed, falling back to keyword", {
          error: (err as Error).message,
        });
      }

      if (!queryEmbedding) {
        const fallback = await storage.searchCalls(expandMedicalSynonyms(query), limit);
        res.json({ mode: "keyword-fallback", results: fallback });
        return;
      }

      // Pull completed calls + apply viewer scoping. Embeddings live on the
      // analysis record; skip calls without one rather than re-embedding here
      // (re-embedding on every search would be hot-path wasteful).
      const all = await storage.getCallsWithDetails({ status: "completed" });
      const userRole = req.user?.role || "viewer";
      let accessible = all;
      if (userRole === "viewer") {
        const checks = await Promise.all(all.map(c => canViewerAccessCall(req, c)));
        accessible = all.filter((_, i) => checks[i]);
      }

      const scored = accessible
        .map(c => {
          const emb = (c.analysis as { embedding?: number[] } | undefined)?.embedding;
          if (!emb || !Array.isArray(emb) || emb.length === 0) return null;
          return { call: c, similarity: embeddingCosineSimilarity(queryEmbedding!, emb) };
        })
        .filter((x): x is { call: typeof all[number]; similarity: number } => x !== null)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      res.json({
        mode: "semantic",
        results: scored.map(x => ({ ...x.call, similarity: Math.round(x.similarity * 1000) / 1000 })),
        coverage: { totalAccessible: accessible.length, withEmbeddings: scored.length },
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

      const lines: string[] = [];
      lines.push("Section,Field,Value");
      lines.push(`Summary,Total Calls,${escapeCsvValue(result.metrics.totalCalls)}`);
      lines.push(`Summary,Average Performance Score,${escapeCsvValue(result.metrics.avgPerformanceScore.toFixed(2))}`);
      lines.push(`Summary,Average Sentiment,${escapeCsvValue(result.metrics.avgSentiment.toFixed(2))}`);
      lines.push(`Summary,Auto-assigned Calls,${escapeCsvValue(result.autoAssignedCount)}`);
      lines.push(`Sentiment,Positive,${escapeCsvValue(result.sentiment.positive)}`);
      lines.push(`Sentiment,Neutral,${escapeCsvValue(result.sentiment.neutral)}`);
      lines.push(`Sentiment,Negative,${escapeCsvValue(result.sentiment.negative)}`);
      if (result.avgSubScores) {
        lines.push(`Sub-Scores,Compliance,${escapeCsvValue(result.avgSubScores.compliance)}`);
        lines.push(`Sub-Scores,Customer Experience,${escapeCsvValue(result.avgSubScores.customerExperience)}`);
        lines.push(`Sub-Scores,Communication,${escapeCsvValue(result.avgSubScores.communication)}`);
        lines.push(`Sub-Scores,Resolution,${escapeCsvValue(result.avgSubScores.resolution)}`);
      }
      lines.push("");
      lines.push("Performer,Role,Call Count,Average Score");
      for (const p of result.performers) {
        lines.push([
          escapeCsvValue(p.name),
          escapeCsvValue(p.role),
          escapeCsvValue(p.totalCalls),
          escapeCsvValue(p.avgPerformanceScore ?? ""),
        ].join(","));
      }
      lines.push("");
      lines.push("Month,Calls,Avg Score,Positive,Neutral,Negative");
      for (const t of result.trends) {
        lines.push([
          escapeCsvValue(t.month),
          escapeCsvValue(t.calls),
          escapeCsvValue(t.avgScore ?? ""),
          escapeCsvValue(t.positive),
          escapeCsvValue(t.neutral),
          escapeCsvValue(t.negative),
        ].join(","));
      }

      // HIPAA: first-class audit entry for this export (replaces the
      // client-fire-and-forget beacon pattern for this endpoint).
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "export_report",
        resourceType: "report",
        detail: `format=csv; reportType=filtered; from=${from ?? ""}; to=${to ?? ""}; employeeId=${employeeId ?? ""}; role=${role ?? ""}`,
      });

      const fromStr = (from as string | undefined) || "all";
      const toStr = (to as string | undefined) || "all";
      const filename = `filtered-report-${fromStr}-to-${toStr}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(lines.join("\n"));
    } catch (error) {
      logger.error("failed to export filtered report", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to export filtered report" });
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

  // HIPAA audit beacon for client-side report exports.
  // The export file is built in the browser today (see client/src/pages/reports.tsx),
  // so the server never sees the bytes leave. This endpoint receives a beacon BEFORE
  // the download fires, so the access still lands in the audit log. Full server-side
  // export generation is the long-term fix and is tracked in the roadmap.
  router.post("/api/reports/export-beacon", requireAuth, async (req, res) => {
    try {
      const body = req.body ?? {};
      const format = typeof body.format === "string" ? body.format.slice(0, 16) : "unknown";
      const reportType = typeof body.reportType === "string" ? body.reportType.slice(0, 32) : "unknown";
      const fromDate = typeof body.from === "string" ? body.from.slice(0, 32) : "";
      const toDate = typeof body.to === "string" ? body.to.slice(0, 32) : "";
      const targetId = typeof body.targetId === "string" ? body.targetId.slice(0, 64) : "";

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "export_report_clientside",
        resourceType: "report",
        resourceId: targetId || undefined,
        detail: `format=${format}; reportType=${reportType}; from=${fromDate}; to=${toDate}`,
      });

      res.status(204).send();
    } catch (error) {
      // Don't leak details — beacon is fire-and-forget. Log on the server side.
      logger.error("failed to record export beacon", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to record export" });
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
}
