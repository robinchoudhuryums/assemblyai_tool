/**
 * Gamification Service
 *
 * Evaluates badge eligibility after each call analysis completes.
 * Computes leaderboard rankings from existing performance data.
 * Non-blocking — failures don't affect the pipeline.
 *
 * Badge types:
 *   - Milestone: first_call, calls_25, calls_50, calls_100
 *   - Score: perfect_10
 *   - Streak: streak_3, streak_5, streak_10
 *   - Sub-score excellence: compliance_star, empathy_champion, resolution_ace
 *   - Improvement: most_improved (evaluated weekly, not per-call)
 *
 * Points system:
 *   - Base: 10 points per completed call
 *   - Score bonus: (score - 5) * 5 points (so an 8.0 = 10 + 15 = 25 pts)
 *   - Badge bonus: 50 points per badge earned
 *   - Streak multiplier: active streak multiplies base by 1.5x
 */
import { storage } from "../storage";
import { broadcastCallUpdate } from "./websocket";
import type { Badge, InsertBadge, LeaderboardEntry } from "@shared/schema";
import { STREAK_SCORE_THRESHOLD } from "../constants";

const STREAK_THRESHOLD = STREAK_SCORE_THRESHOLD;

interface SubScores {
  compliance?: number;
  customerExperience?: number;
  communication?: number;
  resolution?: number;
}

/**
 * Evaluate and award badges after a call analysis completes.
 * Called from the pipeline as a non-blocking fire-and-forget.
 */
export async function evaluateBadges(
  callId: string,
  employeeId: string,
  score: number,
  subScores?: SubScores,
): Promise<Badge[]> {
  const awarded: Badge[] = [];

  try {
    // Get employee's call history for streak/milestone calculations
    const allCalls = await storage.getCallsWithDetails({ employee: employeeId });
    const completedCalls = allCalls
      .filter(c => c.status === "completed" && c.analysis?.performanceScore)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

    const totalCalls = completedCalls.length;

    // --- Milestone badges ---
    if (totalCalls === 1) {
      awarded.push(...await tryAwardBadge(employeeId, "first_call", callId));
    }
    if (totalCalls >= 25) {
      awarded.push(...await tryAwardBadge(employeeId, "calls_25", callId));
    }
    if (totalCalls >= 50) {
      awarded.push(...await tryAwardBadge(employeeId, "calls_50", callId));
    }
    if (totalCalls >= 100) {
      awarded.push(...await tryAwardBadge(employeeId, "calls_100", callId));
    }

    // --- Perfect score badge ---
    if (score >= 10.0) {
      awarded.push(...await tryAwardBadge(employeeId, "perfect_10", callId));
    }

    // --- Streak badges (consecutive calls scoring >= 8.0) ---
    const currentStreak = computeCurrentStreak(completedCalls);
    if (currentStreak >= 3) {
      awarded.push(...await tryAwardBadge(employeeId, "streak_3", callId));
    }
    if (currentStreak >= 5) {
      awarded.push(...await tryAwardBadge(employeeId, "streak_5", callId));
    }
    if (currentStreak >= 10) {
      awarded.push(...await tryAwardBadge(employeeId, "streak_10", callId));
    }

    // --- Sub-score excellence badges (5 consecutive calls with sub-score 9+) ---
    if (subScores) {
      const recentSubScores = completedCalls.slice(0, 5).map(c => c.analysis?.subScores as SubScores | undefined).filter(Boolean);
      if (recentSubScores.length >= 5) {
        if (recentSubScores.every(s => (s?.compliance ?? 0) >= 9)) {
          awarded.push(...await tryAwardBadge(employeeId, "compliance_star", callId));
        }
        if (recentSubScores.every(s => (s?.customerExperience ?? 0) >= 9)) {
          awarded.push(...await tryAwardBadge(employeeId, "empathy_champion", callId));
        }
        if (recentSubScores.every(s => (s?.resolution ?? 0) >= 9)) {
          awarded.push(...await tryAwardBadge(employeeId, "resolution_ace", callId));
        }
      }
    }

    // Broadcast new badges via WebSocket
    if (awarded.length > 0) {
      broadcastCallUpdate(callId, "badges_earned", {
        employeeId,
        badges: awarded.map(b => b.badgeType),
        count: awarded.length,
      });
      console.log(`[${callId}] Badges earned: ${awarded.map(b => b.badgeType).join(", ")}`);
    }
  } catch (error) {
    console.warn("[GAMIFICATION] Badge evaluation error:", (error as Error).message);
  }

  return awarded;
}

/**
 * Try to award a badge. Returns the badge if newly awarded, empty array if already held.
 */
async function tryAwardBadge(employeeId: string, badgeType: string, callId: string): Promise<Badge[]> {
  const alreadyHas = await storage.hasBadge(employeeId, badgeType);
  if (alreadyHas) return [];

  const badge: InsertBadge = {
    employeeId,
    badgeType,
    callId,
    earnedAt: new Date().toISOString(),
  };

  const created = await storage.createBadge(badge);
  return [created];
}

/**
 * Compute current streak (consecutive calls scoring >= threshold, most recent first).
 */
function computeCurrentStreak(
  completedCalls: Array<{ analysis?: { performanceScore?: string } | null }>,
): number {
  let streak = 0;
  for (const call of completedCalls) {
    const score = parseFloat(call.analysis?.performanceScore || "0");
    if (score >= STREAK_THRESHOLD) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Compute points for an employee based on their calls and badges.
 */
export function computePoints(
  completedCalls: Array<{ analysis?: { performanceScore?: string } | null }>,
  badgeCount: number,
): number {
  let total = 0;
  const streak = computeCurrentStreak(completedCalls);

  for (const call of completedCalls) {
    const score = parseFloat(call.analysis?.performanceScore || "0");
    // Base points + score bonus
    let callPoints = 10 + Math.max(0, (score - 5)) * 5;
    // Streak multiplier for calls in the active streak
    if (streak > 0 && completedCalls.indexOf(call) < streak) {
      callPoints *= 1.5;
    }
    total += callPoints;
  }

  // Badge bonus
  total += badgeCount * 50;

  return Math.round(total);
}

/**
 * Generate the leaderboard from existing data.
 * Optionally filter by time period.
 */
export async function getLeaderboard(period?: "week" | "month" | "all"): Promise<LeaderboardEntry[]> {
  const employees = await storage.getAllEmployees();
  const allBadges = await storage.getAllBadges();
  const allCalls = await storage.getCallsWithDetails({});

  // Filter calls by time period
  const now = new Date();
  let cutoff: Date | null = null;
  if (period === "week") {
    cutoff = new Date(now.getTime() - 7 * 86400000);
  } else if (period === "month") {
    cutoff = new Date(now.getTime() - 30 * 86400000);
  }

  const entries: LeaderboardEntry[] = [];

  for (const emp of employees) {
    let empCalls = allCalls.filter(
      c => c.employeeId === emp.id && c.status === "completed" && c.analysis?.performanceScore
    );
    if (cutoff) {
      empCalls = empCalls.filter(c => new Date(c.uploadedAt || 0) >= cutoff!);
    }

    if (empCalls.length === 0) continue;

    // Sort by date desc for streak calculation
    empCalls.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

    const scores = empCalls.map(c => parseFloat(c.analysis?.performanceScore || "0"));
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const empBadges = allBadges.filter(b => b.employeeId === emp.id);
    const streak = computeCurrentStreak(empCalls);
    const points = computePoints(empCalls, empBadges.length);

    entries.push({
      employeeId: emp.id,
      employeeName: emp.name,
      subTeam: emp.subTeam,
      totalCalls: empCalls.length,
      avgScore: Math.round(avgScore * 10) / 10,
      totalPoints: points,
      currentStreak: streak,
      badges: empBadges,
      rank: 0, // filled below
    });
  }

  // Sort by points descending, then avg score as tiebreaker
  entries.sort((a, b) => b.totalPoints - a.totalPoints || b.avgScore - a.avgScore);
  entries.forEach((e, i) => { e.rank = i + 1; });

  return entries;
}
