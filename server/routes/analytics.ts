import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { getPool } from "../db/pool";
import { logPhiAccess, auditContext } from "../services/audit-log";

export function register(router: Router) {
  // ==================== TEAM ANALYTICS ROUTES ====================

  // Comparative team analytics — performance by sub-team
  router.get("/api/analytics/teams", requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) {
        // Fallback for in-memory: basic aggregation
        const employees = await storage.getAllEmployees();
        const calls = await storage.getAllCalls();
        const teams = new Map<string, { team: string; employeeCount: number; callCount: number; avgScore: number; scores: number[] }>();
        for (const emp of employees) {
          const team = emp.subTeam || "Unassigned";
          if (!teams.has(team)) teams.set(team, { team, employeeCount: 0, callCount: 0, avgScore: 0, scores: [] });
          teams.get(team)!.employeeCount++;
        }
        for (const call of calls) {
          if (!call.employeeId) continue;
          const emp = employees.find((e) => e.id === call.employeeId);
          const team = emp?.subTeam || "Unassigned";
          if (!teams.has(team)) teams.set(team, { team, employeeCount: 0, callCount: 0, avgScore: 0, scores: [] });
          teams.get(team)!.callCount++;
        }
        return res.json(Array.from(teams.values()).map(({ scores, ...rest }) => rest));
      }

      // PostgreSQL: rich analytics with sub-scores
      const dateFrom = req.query.from as string | undefined;
      const dateTo = req.query.to as string | undefined;

      let dateFilter = "";
      const params: any[] = [];
      if (dateFrom) { params.push(dateFrom); dateFilter += ` AND c.uploaded_at >= $${params.length}`; }
      if (dateTo) { params.push(dateTo); dateFilter += ` AND c.uploaded_at <= $${params.length}`; }

      const result = await pool.query(
        `SELECT
           COALESCE(e.sub_team, 'Unassigned') as team,
           COUNT(DISTINCT e.id) as employee_count,
           COUNT(c.id) as call_count,
           ROUND(AVG(NULLIF(ca.performance_score, '')::numeric), 1) as avg_score,
           ROUND(AVG(NULLIF(ca.confidence_score, '')::numeric), 1) as avg_confidence,
           COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_calls,
           COUNT(CASE WHEN c.status = 'failed' THEN 1 END) as failed_calls,
           ROUND(AVG(c.duration), 0) as avg_duration,
           jsonb_agg(DISTINCT e.name) FILTER (WHERE e.name IS NOT NULL) as employee_names
         FROM employees e
         LEFT JOIN calls c ON c.employee_id = e.id ${dateFilter}
         LEFT JOIN call_analyses ca ON ca.call_id = c.id
         WHERE e.status = 'Active'
         GROUP BY COALESCE(e.sub_team, 'Unassigned')
         ORDER BY avg_score DESC NULLS LAST`,
        params
      );

      res.json(result.rows.map((r: any) => ({
        team: r.team,
        employeeCount: parseInt(r.employee_count),
        callCount: parseInt(r.call_count),
        avgScore: r.avg_score ? parseFloat(r.avg_score) : null,
        avgConfidence: r.avg_confidence ? parseFloat(r.avg_confidence) : null,
        completedCalls: parseInt(r.completed_calls),
        failedCalls: parseInt(r.failed_calls),
        avgDuration: r.avg_duration ? parseInt(r.avg_duration) : null,
        employees: r.employee_names || [],
      })));
    } catch (error) {
      console.error("Failed to fetch team analytics:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch team analytics" });
    }
  });

  // Individual employee comparison within a team
  router.get("/api/analytics/team/:teamName", requireAuth, async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.json([]);

      const teamName = decodeURIComponent(req.params.teamName);
      const dateFrom = req.query.from as string | undefined;
      const dateTo = req.query.to as string | undefined;

      const params: any[] = [teamName === "Unassigned" ? null : teamName];
      let dateFilter = "";
      if (dateFrom) { params.push(dateFrom); dateFilter += ` AND c.uploaded_at >= $${params.length}`; }
      if (dateTo) { params.push(dateTo); dateFilter += ` AND c.uploaded_at <= $${params.length}`; }

      const teamCondition = teamName === "Unassigned" ? "e.sub_team IS NULL" : "e.sub_team = $1";

      const result = await pool.query(
        `SELECT
           e.id, e.name, e.email, e.initials, e.pseudonym,
           COUNT(c.id) as call_count,
           ROUND(AVG(NULLIF(ca.performance_score, '')::numeric), 1) as avg_score,
           ROUND(AVG(c.duration), 0) as avg_duration,
           MAX(c.uploaded_at) as last_call_date
         FROM employees e
         LEFT JOIN calls c ON c.employee_id = e.id ${dateFilter}
         LEFT JOIN call_analyses ca ON ca.call_id = c.id
         WHERE ${teamCondition} AND e.status = 'Active'
         GROUP BY e.id, e.name, e.email, e.initials, e.pseudonym
         ORDER BY avg_score DESC NULLS LAST`,
        params
      );

      res.json(result.rows.map((r: any) => ({
        id: r.id, name: r.name, email: r.email, initials: r.initials, pseudonym: r.pseudonym,
        callCount: parseInt(r.call_count),
        avgScore: r.avg_score ? parseFloat(r.avg_score) : null,
        avgDuration: r.avg_duration ? parseInt(r.avg_duration) : null,
        lastCallDate: r.last_call_date,
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch team member analytics" });
    }
  });

  // ==================== EXPORT / REPORT ROUTES ====================

  // Export calls as CSV
  router.get("/api/export/calls", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const pool = getPool();
      const dateFrom = req.query.from as string | undefined;
      const dateTo = req.query.to as string | undefined;
      const employeeId = req.query.employee as string | undefined;

      let rows: any[];

      if (pool) {
        const params: any[] = [];
        let where = "WHERE 1=1";
        if (dateFrom) { params.push(dateFrom); where += ` AND c.uploaded_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); where += ` AND c.uploaded_at <= $${params.length}`; }
        if (employeeId) { params.push(employeeId); where += ` AND c.employee_id = $${params.length}`; }

        const result = await pool.query(
          `SELECT c.id, c.file_name, c.status, c.duration, c.call_category, c.uploaded_at,
                  e.name as employee_name, e.sub_team,
                  ca.performance_score, ca.summary,
                  sa.overall_sentiment, sa.overall_score as sentiment_score
           FROM calls c
           LEFT JOIN employees e ON c.employee_id = e.id
           LEFT JOIN call_analyses ca ON ca.call_id = c.id
           LEFT JOIN sentiment_analyses sa ON sa.call_id = c.id
           ${where}
           ORDER BY c.uploaded_at DESC
           LIMIT 5000`,
          params
        );
        rows = result.rows;
      } else {
        const calls = await storage.getCallsWithDetails({});
        rows = calls.map((c) => ({
          id: c.id, file_name: c.fileName, status: c.status, duration: c.duration,
          call_category: c.callCategory, uploaded_at: c.uploadedAt,
          employee_name: c.employee?.name, performance_score: c.analysis?.performanceScore,
          overall_sentiment: c.sentiment?.overallSentiment,
        }));
      }

      // Build CSV
      const headers = ["Call ID", "File Name", "Status", "Duration (sec)", "Category", "Uploaded At", "Employee", "Sub-Team", "Score", "Sentiment", "Summary"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        const escapeCsv = (val: any) => {
          const s = String(val ?? "");
          return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
        };
        csvRows.push([
          r.id, r.file_name, r.status, r.duration, r.call_category, r.uploaded_at,
          r.employee_name, r.sub_team, r.performance_score, r.overall_sentiment,
          r.summary ? r.summary.substring(0, 200) : "",
        ].map(escapeCsv).join(","));
      }

      logPhiAccess({ ...auditContext(req as any), timestamp: new Date().toISOString(), event: "export_calls_csv", resourceType: "export", detail: `${rows.length} calls exported` });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="calls-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csvRows.join("\n"));
    } catch (error) {
      console.error("Failed to export calls:", (error as Error).message);
      res.status(500).json({ message: "Failed to export calls" });
    }
  });

  // Export team analytics as CSV
  router.get("/api/export/team-analytics", requireAuth, requireRole("manager", "admin"), async (req, res) => {
    try {
      const pool = getPool();
      if (!pool) return res.status(503).json({ message: "Team export requires a database connection" });

      const result = await pool.query(
        `SELECT
           COALESCE(e.sub_team, 'Unassigned') as team,
           e.name as employee_name,
           COUNT(c.id) as call_count,
           ROUND(AVG(NULLIF(ca.performance_score, '')::numeric), 1) as avg_score,
           ROUND(AVG(c.duration), 0) as avg_duration
         FROM employees e
         LEFT JOIN calls c ON c.employee_id = e.id
         LEFT JOIN call_analyses ca ON ca.call_id = c.id
         WHERE e.status = 'Active'
         GROUP BY COALESCE(e.sub_team, 'Unassigned'), e.name
         ORDER BY team, avg_score DESC NULLS LAST`
      );

      const headers = ["Team", "Employee", "Call Count", "Avg Score", "Avg Duration (sec)"];
      const csvRows = [headers.join(",")];
      for (const r of result.rows) {
        csvRows.push([r.team, r.employee_name, r.call_count, r.avg_score, r.avg_duration].map((v) => String(v ?? "")).join(","));
      }

      logPhiAccess({ ...auditContext(req as any), timestamp: new Date().toISOString(), event: "export_team_csv", resourceType: "export" });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="team-analytics-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csvRows.join("\n"));
    } catch (error) {
      res.status(500).json({ message: "Failed to export team analytics" });
    }
  });
}
