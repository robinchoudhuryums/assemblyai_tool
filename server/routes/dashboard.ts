import { Router } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { clampInt } from "./utils";

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

      res.json({
        employee: { id: employee.id, name: employee.name },
        recentCalls: completedCalls.slice(0, 10),
        coaching: coaching.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
        avgScore: scoredCount > 0 ? totalScore / scoredCount : null,
        callCount: completedCalls.length,
        positivePct: completedCalls.length > 0 ? Math.round((positiveCount / completedCalls.length) * 100) : 0,
      });
    } catch (error) {
      console.error("My performance error:", (error as Error).message);
      res.status(500).json({ message: "Failed to load performance data" });
    }
  });
}
