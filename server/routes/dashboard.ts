import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { clampInt } from "./utils";
import { computePoints } from "../services/gamification";
import { BADGE_TYPES } from "@shared/schema";
import type { CallWithDetails } from "@shared/schema";
import { logger } from "../services/logger";

export function register(router: Router) {
  // Dashboard metrics
  router.get("/api/dashboard/metrics", requireAuth, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      logger.error("failed to get dashboard metrics", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  router.get("/api/dashboard/sentiment", requireAuth, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution();
      res.json(distribution);
    } catch (error) {
      logger.error("failed to get sentiment distribution", { error: (error as Error).message });
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
      logger.error("failed to get top performers", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });

  // Weekly change narrative: what changed this week vs last week.
  // Compares current 7-day window against the previous 7-day window and
  // surfaces top movers, new flags, and coaching-worthy regressions.
  // Designed to power a "what changed this week" dashboard widget that turns
  // raw metrics into actionable story ("Compliance dropped 0.5 in Team X").
  // F-02: weekly-changes returns per-agent score deltas, flagged calls with
  // employee names, and noteworthy calls (individual performance data).
  // Restrict to manager+ so agents can't see each other's score movements.
  router.get("/api/dashboard/weekly-changes", requireAuth, requireRole("manager", "admin"), async (_req, res) => {
    try {
      const now = Date.now();
      const weekMs = 7 * 86400000;
      const fourteenDaysAgo = new Date(now - 2 * weekMs);
      const oneWeekAgo = new Date(now - weekMs);

      // Pull two weeks of calls in one shot
      const twoWeeksCalls = await storage.getCallsSinceWithDetails(fourteenDaysAgo);
      const completed = twoWeeksCalls.filter(c => c.status === "completed");

      const currentWeek: CallWithDetails[] = [];
      const previousWeek: CallWithDetails[] = [];
      for (const c of completed) {
        const t = new Date(c.uploadedAt || 0).getTime();
        if (t >= oneWeekAgo.getTime()) currentWeek.push(c);
        else previousWeek.push(c);
      }

      const avgScore = (calls: CallWithDetails[]): number | null => {
        const scored = calls
          .map(c => parseFloat(String(c.analysis?.performanceScore ?? "")))
          .filter(s => Number.isFinite(s) && s >= 0 && s <= 10);
        if (scored.length === 0) return null;
        return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100;
      };

      const positivePct = (calls: CallWithDetails[]): number | null => {
        if (calls.length === 0) return null;
        const pos = calls.filter(c => c.sentiment?.overallSentiment === "positive").length;
        return Math.round((pos / calls.length) * 100);
      };

      const countFlag = (calls: CallWithDetails[], flag: string): number => {
        return calls.filter(c => {
          const flags = (c.analysis?.flags as string[]) || [];
          return flags.some(f => f === flag || f.startsWith(`${flag}:`));
        }).length;
      };

      // Summary metrics
      const currentAvg = avgScore(currentWeek);
      const previousAvg = avgScore(previousWeek);
      const scoreDelta = currentAvg !== null && previousAvg !== null
        ? Math.round((currentAvg - previousAvg) * 100) / 100
        : null;

      const currentPos = positivePct(currentWeek);
      const previousPos = positivePct(previousWeek);
      const positiveDelta = currentPos !== null && previousPos !== null
        ? currentPos - previousPos
        : null;

      // Per-agent score deltas — find biggest movers
      const agentScores = new Map<string, {
        employeeId: string;
        employeeName: string;
        currentAvg: number | null;
        previousAvg: number | null;
        delta: number | null;
        currentCount: number;
        previousCount: number;
      }>();

      const accumulate = (bucket: "current" | "previous", calls: CallWithDetails[]) => {
        const perEmployee = new Map<string, { sum: number; count: number; name: string }>();
        for (const c of calls) {
          if (!c.employeeId) continue;
          const score = parseFloat(String(c.analysis?.performanceScore ?? ""));
          if (!Number.isFinite(score)) continue;
          const existing = perEmployee.get(c.employeeId) || { sum: 0, count: 0, name: c.employee?.name || "Unknown" };
          existing.sum += score;
          existing.count += 1;
          existing.name = c.employee?.name || existing.name;
          perEmployee.set(c.employeeId, existing);
        }
        for (const [employeeId, { sum, count, name }] of perEmployee) {
          const avg = Math.round((sum / count) * 100) / 100;
          const entry = agentScores.get(employeeId) || {
            employeeId, employeeName: name, currentAvg: null, previousAvg: null, delta: null,
            currentCount: 0, previousCount: 0,
          };
          if (bucket === "current") { entry.currentAvg = avg; entry.currentCount = count; }
          else { entry.previousAvg = avg; entry.previousCount = count; }
          entry.employeeName = name || entry.employeeName;
          agentScores.set(employeeId, entry);
        }
      };
      accumulate("current", currentWeek);
      accumulate("previous", previousWeek);

      // Compute deltas, require at least 2 calls in both weeks to count
      const agentDeltas: Array<{ employeeId: string; employeeName: string; currentAvg: number; previousAvg: number; delta: number; currentCount: number; previousCount: number }> = [];
      for (const entry of agentScores.values()) {
        if (entry.currentAvg === null || entry.previousAvg === null) continue;
        if (entry.currentCount < 2 || entry.previousCount < 2) continue;
        const delta = Math.round((entry.currentAvg - entry.previousAvg) * 100) / 100;
        agentDeltas.push({
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          currentAvg: entry.currentAvg,
          previousAvg: entry.previousAvg,
          delta,
          currentCount: entry.currentCount,
          previousCount: entry.previousCount,
        });
      }

      // Top 3 improvers and top 3 regressions
      const topImprovers = [...agentDeltas].sort((a, b) => b.delta - a.delta).slice(0, 3).filter(a => a.delta > 0);
      const topRegressions = [...agentDeltas].sort((a, b) => a.delta - b.delta).slice(0, 3).filter(a => a.delta < 0);

      // Flag counts: low scores, exceptional calls, compliance issues, misconduct
      const flags = {
        lowScore: {
          current: countFlag(currentWeek, "low_score"),
          previous: countFlag(previousWeek, "low_score"),
        },
        exceptional: {
          current: countFlag(currentWeek, "exceptional_call"),
          previous: countFlag(previousWeek, "exceptional_call"),
        },
        agentMisconduct: {
          current: countFlag(currentWeek, "agent_misconduct"),
          previous: countFlag(previousWeek, "agent_misconduct"),
        },
        missingRequiredPhrase: {
          current: countFlag(currentWeek, "missing_required_phrase"),
          previous: countFlag(previousWeek, "missing_required_phrase"),
        },
        promptInjection: {
          current: countFlag(currentWeek, "prompt_injection_detected"),
          previous: countFlag(previousWeek, "prompt_injection_detected"),
        },
      };

      // Surface up to 3 "noteworthy" calls: top 1 by score + top 1 flagged low
      const noteworthy: Array<{ callId: string; fileName: string | null; score: number | null; employeeName: string | null; kind: "exceptional" | "regression" | "flag" }> = [];
      const sortedByScore = [...currentWeek]
        .map(c => ({ call: c, score: parseFloat(String(c.analysis?.performanceScore ?? "")) }))
        .filter(x => Number.isFinite(x.score));
      sortedByScore.sort((a, b) => b.score - a.score);
      if (sortedByScore[0] && sortedByScore[0].score >= 9) {
        noteworthy.push({
          callId: sortedByScore[0].call.id,
          fileName: sortedByScore[0].call.fileName || null,
          score: Math.round(sortedByScore[0].score * 10) / 10,
          employeeName: sortedByScore[0].call.employee?.name || null,
          kind: "exceptional",
        });
      }
      const lowest = [...sortedByScore].reverse().find(x => x.score <= 4);
      if (lowest) {
        noteworthy.push({
          callId: lowest.call.id,
          fileName: lowest.call.fileName || null,
          score: Math.round(lowest.score * 10) / 10,
          employeeName: lowest.call.employee?.name || null,
          kind: "regression",
        });
      }
      const firstFlagged = currentWeek.find(c => {
        const f = (c.analysis?.flags as string[]) || [];
        return f.some(x => x.startsWith("agent_misconduct") || x.startsWith("missing_required_phrase"));
      });
      if (firstFlagged) {
        noteworthy.push({
          callId: firstFlagged.id,
          fileName: firstFlagged.fileName || null,
          score: firstFlagged.analysis?.performanceScore
            ? parseFloat(String(firstFlagged.analysis.performanceScore))
            : null,
          employeeName: firstFlagged.employee?.name || null,
          kind: "flag",
        });
      }

      // Build a short natural-language narrative headline
      let narrative = "";
      if (currentWeek.length === 0) {
        narrative = "No completed calls this week.";
      } else {
        const scorePhrase = scoreDelta === null
          ? `Average score: ${currentAvg ?? "n/a"}.`
          : Math.abs(scoreDelta) < 0.1
            ? `Average score steady at ${currentAvg}.`
            : scoreDelta > 0
              ? `Average score up ${scoreDelta} to ${currentAvg}.`
              : `Average score down ${Math.abs(scoreDelta)} to ${currentAvg}.`;
        const volumePhrase = `${currentWeek.length} calls processed${previousWeek.length > 0 ? ` (${previousWeek.length} last week)` : ""}.`;
        narrative = `${scorePhrase} ${volumePhrase}`;
        if (topRegressions.length > 0) {
          narrative += ` ${topRegressions[0].employeeName} regressed by ${Math.abs(topRegressions[0].delta)} points.`;
        } else if (topImprovers.length > 0) {
          narrative += ` ${topImprovers[0].employeeName} improved by ${topImprovers[0].delta} points.`;
        }
      }

      res.json({
        windowDays: 7,
        currentWeek: {
          callCount: currentWeek.length,
          avgScore: currentAvg,
          positivePct: currentPos,
          start: oneWeekAgo.toISOString(),
          end: new Date(now).toISOString(),
        },
        previousWeek: {
          callCount: previousWeek.length,
          avgScore: previousAvg,
          positivePct: previousPos,
          start: fourteenDaysAgo.toISOString(),
          end: oneWeekAgo.toISOString(),
        },
        scoreDelta,
        positiveDelta,
        topImprovers,
        topRegressions,
        flags,
        noteworthy,
        narrative,
      });
    } catch (error) {
      logger.error("failed to get weekly changes", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to get weekly changes" });
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
      logger.error("my performance error", { error: (error as Error).message });
      res.status(500).json({ message: "Failed to load performance data" });
    }
  });
}
