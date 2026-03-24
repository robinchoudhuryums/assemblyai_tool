import { Router } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { clampInt } from "./utils";
import { computePoints } from "../services/gamification";
import { BADGE_TYPES } from "@shared/schema";

export function register(router: Router) {
  // Dashboard metrics
  router.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Failed to get dashboard metrics:", (error as Error).message);
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  router.get("/api/dashboard/sentiment", requireAuth, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      console.error("Failed to get sentiment distribution:", (error as Error).message);
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  router.get("/api/dashboard/performers", requireAuth, async (req, res) => {
    try {
      const limit = clampInt(req.query.limit as string | undefined, 3, 1, 100);
      const performers = await storage.getTopPerformers(limit);
      res.json(performers);
    } catch (error) {
      console.error("Failed to get top performers:", (error as Error).message);
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });

  // Agent self-service: my performance data
  router.get("/api/my-performance", requireAuth, async (req, res) => {
    try {
      const username = req.user?.username;
      const displayName = req.user?.name;
      if (!username) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      // Find employee linked to this user (match by name)
      const allEmployees = await storage.getAllEmployees();
      const employee = allEmployees.find(e =>
        e.name.toLowerCase() === displayName?.toLowerCase() ||
        e.email?.toLowerCase() === username.toLowerCase()
      ) || null;

      if (!employee) {
        res.json({ employee: null, recentCalls: [], coaching: [], avgScore: null, callCount: 0, positivePct: 0 });
        return;
      }

      const calls = await storage.getCallsWithDetails({ employee: employee.id });
      const completedCalls = calls.filter(c => c.status === "completed");
      const coaching = await storage.getCoachingSessionsByEmployee(employee.id);

      let totalScore = 0, scoredCount = 0, positiveCount = 0;
      for (const call of completedCalls) {
        if (call.analysis?.performanceScore != null) {
          totalScore += Number(call.analysis.performanceScore);
          scoredCount++;
        }
        if (call.sentiment?.overallSentiment === "positive") positiveCount++;
      }

      // Gamification: badges + streak + points
      const badges = await storage.getBadgesByEmployee(employee.id);
      const enrichedBadges = badges.map(b => {
        const def = BADGE_TYPES.find(bt => bt.value === b.badgeType);
        return { ...b, label: def?.label || b.badgeType, description: def?.description || "", icon: def?.icon || "star" };
      });

      const sortedByDate = completedCalls
        .filter(c => c.analysis?.performanceScore)
        .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

      let currentStreak = 0;
      for (const call of sortedByDate) {
        const score = parseFloat(call.analysis?.performanceScore || "0");
        if (score >= 8.0) currentStreak++;
        else break;
      }

      const totalPoints = computePoints(sortedByDate, badges.length);

      // Weekly score trend (last 8 weeks)
      const weeklyTrend: Array<{ week: string; avgScore: number; count: number }> = [];
      const now = new Date();
      for (let w = 7; w >= 0; w--) {
        const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000);
        const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
        const weekCalls = sortedByDate.filter(c => {
          const d = new Date(c.uploadedAt || 0);
          return d >= weekStart && d < weekEnd;
        });
        if (weekCalls.length > 0) {
          const sum = weekCalls.reduce((s, c) => s + parseFloat(c.analysis?.performanceScore || "0"), 0);
          weeklyTrend.push({
            week: weekStart.toISOString().slice(0, 10),
            avgScore: Math.round((sum / weekCalls.length) * 10) / 10,
            count: weekCalls.length,
          });
        }
      }

      res.json({
        employee: { id: employee.id, name: employee.name },
        recentCalls: completedCalls.slice(0, 10),
        coaching: coaching.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
        avgScore: scoredCount > 0 ? totalScore / scoredCount : null,
        callCount: completedCalls.length,
        positivePct: completedCalls.length > 0 ? Math.round((positiveCount / completedCalls.length) * 100) : 0,
        // New agent portal fields
        badges: enrichedBadges,
        currentStreak,
        totalPoints,
        weeklyTrend,
      });
    } catch (error) {
      console.error("My performance error:", (error as Error).message);
      res.status(500).json({ message: "Failed to load performance data" });
    }
  });
}
