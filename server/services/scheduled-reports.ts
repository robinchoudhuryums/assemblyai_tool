/**
 * Scheduled Reports Service
 *
 * Generates periodic performance summaries (weekly/monthly).
 * Stores report data for download via API.
 * Email delivery can be added when SMTP is configured.
 */
import { storage } from "../storage";
import { randomUUID } from "crypto";

export interface ScheduledReport {
  id: string;
  type: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  data: ReportData;
}

interface ReportData {
  totalCalls: number;
  completedCalls: number;
  avgScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topPerformers: { name: string; avgScore: number; callCount: number }[];
  lowPerformers: { name: string; avgScore: number; callCount: number }[];
  coachingSessions: number;
  newCoachingPlans: number;
}

// In-memory report store (falls back; production would use PostgreSQL)
const reports: ScheduledReport[] = [];

export async function generateReport(
  type: "weekly" | "monthly",
  generatedBy: string,
): Promise<ScheduledReport> {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(
    type === "weekly" ? now.getTime() - 7 * 86400000 : now.getTime() - 30 * 86400000
  ).toISOString();

  const allCalls = await storage.getCallsWithDetails();
  const periodCalls = allCalls.filter(c => {
    const uploaded = new Date(c.uploadedAt || 0).getTime();
    return uploaded >= new Date(periodStart).getTime() && uploaded <= new Date(periodEnd).getTime();
  });

  const completedCalls = periodCalls.filter(c => c.status === "completed");
  let totalScore = 0, scoredCount = 0;
  const sentiment = { positive: 0, neutral: 0, negative: 0 };

  // Per-employee aggregation
  const employeeStats = new Map<string, { name: string; totalScore: number; count: number }>();

  for (const call of completedCalls) {
    const score = call.analysis?.performanceScore ? Number(call.analysis.performanceScore) : null;
    if (score != null) {
      totalScore += score;
      scoredCount++;
    }
    const sent = call.sentiment?.overallSentiment;
    if (sent === "positive") sentiment.positive++;
    else if (sent === "negative") sentiment.negative++;
    else sentiment.neutral++;

    if (call.employee) {
      const existing = employeeStats.get(call.employee.id) || { name: call.employee.name, totalScore: 0, count: 0 };
      if (score != null) {
        existing.totalScore += score;
        existing.count++;
      }
      employeeStats.set(call.employee.id, existing);
    }
  }

  const rankedEmployees = Array.from(employeeStats.values())
    .filter(e => e.count >= 2) // Minimum 2 calls for ranking
    .map(e => ({ name: e.name, avgScore: e.totalScore / e.count, callCount: e.count }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Count coaching sessions in period
  const allCoaching = await storage.getAllCoachingSessions();
  const periodCoaching = allCoaching.filter(c =>
    new Date(c.createdAt || 0).getTime() >= new Date(periodStart).getTime()
  );
  const aiPlans = periodCoaching.filter(c =>
    c.assignedBy === "System (AI Coaching Plan)"
  );

  const report: ScheduledReport = {
    id: randomUUID(),
    type,
    periodStart,
    periodEnd,
    generatedAt: now.toISOString(),
    generatedBy,
    data: {
      totalCalls: periodCalls.length,
      completedCalls: completedCalls.length,
      avgScore: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 10) / 10 : null,
      sentimentBreakdown: sentiment,
      topPerformers: rankedEmployees.slice(0, 5),
      lowPerformers: rankedEmployees.slice(-3).reverse(),
      coachingSessions: periodCoaching.length,
      newCoachingPlans: aiPlans.length,
    },
  };

  reports.unshift(report);
  // Keep max 50 reports in memory
  if (reports.length > 50) reports.length = 50;

  console.log(`[Reports] Generated ${type} report: ${report.id} (${completedCalls.length} calls, avg score: ${report.data.avgScore})`);
  return report;
}

export function getReports(): ScheduledReport[] {
  return reports;
}

export function getReport(id: string): ScheduledReport | undefined {
  return reports.find(r => r.id === id);
}

/**
 * Auto-generate weekly report every Monday at midnight (called from scheduler).
 */
export function startReportScheduler(): void {
  const checkAndGenerate = async () => {
    const now = new Date();
    // Generate weekly on Monday (day 1)
    if (now.getDay() === 1 && now.getHours() === 0) {
      try {
        await generateReport("weekly", "System (Scheduler)");
      } catch (error) {
        console.error("[Reports] Failed to auto-generate weekly report:", (error as Error).message);
      }
    }
    // Generate monthly on 1st of month
    if (now.getDate() === 1 && now.getHours() === 0) {
      try {
        await generateReport("monthly", "System (Scheduler)");
      } catch (error) {
        console.error("[Reports] Failed to auto-generate monthly report:", (error as Error).message);
      }
    }
  };

  // Check every hour
  setInterval(checkAndGenerate, 60 * 60 * 1000);
  console.log("[Reports] Scheduler started (weekly on Monday, monthly on 1st)");
}
