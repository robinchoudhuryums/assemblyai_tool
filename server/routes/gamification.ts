/**
 * Gamification API routes — leaderboard, badges, and points.
 * All routes require authentication.
 */
import { Router } from "express";
import { storage } from "../storage";
import { getLeaderboard, computePoints } from "../services/gamification";
import { BADGE_TYPES } from "@shared/schema";

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

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
      console.error("Leaderboard error:", (error as Error).message);
      res.status(500).json({ message: "Failed to compute leaderboard" });
    }
  });

  // GET /api/gamification/badges/:employeeId — badges for a specific employee
  router.get("/api/gamification/badges/:employeeId", requireAuth, async (req, res) => {
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
      console.error("Badges error:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch badges" });
    }
  });

  // GET /api/gamification/badge-types — list all available badge types and their definitions
  router.get("/api/gamification/badge-types", requireAuth, (_req, res) => {
    res.json(BADGE_TYPES);
  });

  // GET /api/gamification/stats/:employeeId — gamification stats for a single employee
  router.get("/api/gamification/stats/:employeeId", requireAuth, async (req, res) => {
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
        if (score >= 8.0) currentStreak++;
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
      console.error("Gamification stats error:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch gamification stats" });
    }
  });
}
