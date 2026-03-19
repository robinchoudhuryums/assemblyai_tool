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
}
