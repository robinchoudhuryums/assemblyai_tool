import { Router } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { safeFloat } from "./utils";

export function register(router: Router) {
  // ==================== COMPANY INSIGHTS API ====================

  router.get("/api/insights", requireAuth, async (_req, res) => {
    try {
      const allCalls = await storage.getCallsWithDetails();
      const completed = allCalls.filter(c => c.status === "completed" && c.analysis);

      // Aggregate topic frequency across all calls
      const topicCounts = new Map<string, number>();
      const complaintsAndFrustrations: Array<{ topic: string; callId: string; date: string; sentiment: string }> = [];
      const escalationPatterns: Array<{ summary: string; callId: string; date: string; score: number }> = [];
      const sentimentByWeek = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();

      for (const call of completed) {
        const topics = (call.analysis?.topics as string[]) || [];
        for (const t of topics) {
          topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
        }

        // Track negative/frustration calls
        const sentiment = call.sentiment?.overallSentiment;
        if (sentiment === "negative") {
          for (const t of topics) {
            complaintsAndFrustrations.push({
              topic: t,
              callId: call.id,
              date: call.uploadedAt || "",
              sentiment: sentiment,
            });
          }
        }

        // Track low-score calls as escalation patterns
        const score = safeFloat(call.analysis?.performanceScore, 10);
        if (score <= 4) {
          escalationPatterns.push({
            summary: call.analysis?.summary || "",
            callId: call.id,
            date: call.uploadedAt || "",
            score,
          });
        }

        // Weekly sentiment trend
        if (call.uploadedAt) {
          const d = new Date(call.uploadedAt);
          const weekStart = new Date(d);
          weekStart.setDate(d.getDate() - d.getDay());
          const weekKey = weekStart.toISOString().slice(0, 10);
          const entry = sentimentByWeek.get(weekKey) || { positive: 0, neutral: 0, negative: 0, total: 0 };
          entry.total++;
          if (sentiment === "positive") entry.positive++;
          else if (sentiment === "negative") entry.negative++;
          else entry.neutral++;
          sentimentByWeek.set(weekKey, entry);
        }
      }

      // Aggregate complaint topics (topics that appear in negative calls)
      const complaintTopicCounts = new Map<string, number>();
      for (const c of complaintsAndFrustrations) {
        complaintTopicCounts.set(c.topic, (complaintTopicCounts.get(c.topic) || 0) + 1);
      }

      // Sort topics by frequency
      const topTopics = Array.from(topicCounts.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      const topComplaints = Array.from(complaintTopicCounts.entries())
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      // Weekly trend sorted chronologically
      const weeklyTrend = Array.from(sentimentByWeek.entries())
        .map(([week, data]) => ({ week, ...data }))
        .sort((a, b) => a.week.localeCompare(b.week));

      // Low-confidence calls
      const lowConfidenceCalls = completed
        .filter(c => {
          const conf = safeFloat(c.analysis?.confidenceScore, 1);
          return conf < 0.7;
        })
        .map(c => ({
          callId: c.id,
          date: c.uploadedAt || "",
          confidence: safeFloat(c.analysis?.confidenceScore),
          employee: c.employee?.name || "Unassigned",
        }));

      res.json({
        totalAnalyzed: completed.length,
        topTopics,
        topComplaints,
        escalationPatterns: escalationPatterns.sort((a, b) => a.score - b.score).slice(0, 20),
        weeklyTrend,
        lowConfidenceCalls: lowConfidenceCalls.slice(0, 20),
        summary: {
          avgScore: completed.length > 0
            ? completed.reduce((sum, c) => sum + safeFloat(c.analysis?.performanceScore), 0) / completed.length
            : 0,
          negativeCallRate: completed.length > 0
            ? completed.filter(c => c.sentiment?.overallSentiment === "negative").length / completed.length
            : 0,
          escalationRate: completed.length > 0
            ? escalationPatterns.length / completed.length
            : 0,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute company insights" });
    }
  });
}
