/**
 * Gamification API routes — leaderboard, badges, and points.
 * All routes require authentication.
 */
import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireSelfOrManager } from "../auth";
import { getLeaderboard, computePoints } from "../services/gamification";
import { BADGE_TYPES } from "@shared/schema";
import { STREAK_SCORE_THRESHOLD } from "../constants";
import { validateParams } from "./utils";
import { logger } from "../services/logger";

export function registerGamificationRoutes(router: Router): void {
  // GET /api/gamification/leaderboard — ranked list of employees with points, badges, streaks
  router.get("/api/gamification/leaderboard", requireAuth, async (req, res) => {
    try {
      const period = (req.query.period as string) || "all";
      const validPeriods = ["week", "month", "all"];
      const selectedPeriod = validPeriods.includes(period) ? period as "week" | "month" | "all" : "all";
      const leaderboard = await getLeaderboard(selectedPeriod);
      res.json({ leaderboard, period: selectedPeriod });
    } catch (error) {
      logger.error("leaderboard error", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to compute leaderboard" });
    }
  });

  // GET /api/gamification/badges/:employeeId — badges for a specific employee.
  // #1 Phase 1: restrict to self-or-manager so viewers can't see other agents' badges.
  router.get("/api/gamification/badges/:employeeId", requireAuth, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
    try {
      const badges = await storage.getBadgesByEmployee(req.params.employeeId);
      // Enrich with badge metadata (label, description, icon)
      const enriched = badges.map(b => {
        const def = BADGE_TYPES.find(bt => bt.value === b.badgeType);
        return {
          ...b,
          label: def?.label || b.badgeType,
          description: def?.description || "",
          icon: def?.icon || "star",
        };
      });
      res.json(enriched);
    } catch (error) {
      logger.error("badges error", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch badges" });
    }
  });

  // GET /api/gamification/badge-types — list all available badge types and their definitions
  router.get("/api/gamification/badge-types", requireAuth, (_req, res) => {
    res.json(BADGE_TYPES);
  });

  // GET /api/gamification/stats/:employeeId — gamification stats for a single employee.
  // #1 Phase 1: restrict to self-or-manager.
  router.get("/api/gamification/stats/:employeeId", requireAuth, validateParams({ employeeId: "uuid" }), requireSelfOrManager(req => req.params.employeeId), async (req, res) => {
    try {
      const employeeId = req.params.employeeId;
      const [badges, employee] = await Promise.all([
        storage.getBadgesByEmployee(employeeId),
        storage.getEmployee(employeeId),
      ]);

      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const allCalls = await storage.getCallsWithDetails({ employee: employeeId });
      const completedCalls = allCalls
        .filter(c => c.status === "completed" && c.analysis?.performanceScore)
        .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

      const totalPoints = computePoints(completedCalls, badges.length);

      // Compute current streak
      let currentStreak = 0;
      for (const call of completedCalls) {
        const score = parseFloat(call.analysis?.performanceScore || "0");
        if (score >= STREAK_SCORE_THRESHOLD) currentStreak++;
        else break;
      }

      // Enrich badges
      const enrichedBadges = badges.map(b => {
        const def = BADGE_TYPES.find(bt => bt.value === b.badgeType);
        return { ...b, label: def?.label || b.badgeType, description: def?.description || "", icon: def?.icon || "star" };
      });

      res.json({
        employeeId,
        employeeName: employee.name,
        totalPoints,
        currentStreak,
        totalCalls: completedCalls.length,
        badges: enrichedBadges,
      });
    } catch (error) {
      logger.error("gamification stats error", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to fetch gamification stats" });
    }
  });
}
