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
import { logger } from "./logger";

// A4/F03: limit applied to recent-call queries used by badge eval. Sub-score
// excellence checks need 5 recent calls; streak badges need ≤10. 25 covers
// both with headroom and is the cap we send to storage.getRecentCallsForBadgeEval.
const BADGE_EVAL_RECENT_LIMIT = 25;

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
    // A4/F03: previously this scanned all of an employee's calls + analyses.
    // Now we use two indexed queries: a fast COUNT for milestone thresholds
    // and a small LIMIT for streak/sub-score windows.
    const [totalCalls, recentCalls] = await Promise.all([
      storage.countCompletedCallsByEmployee(employeeId),
      storage.getRecentCallsForBadgeEval(employeeId, BADGE_EVAL_RECENT_LIMIT),
    ]);
    const completedCalls = recentCalls.filter(c => c.analysis?.performanceScore);

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
      logger.info("badges earned", {
        callId,
        employeeId,
        badgeTypes: awarded.map(b => b.badgeType),
        count: awarded.length,
      });
    }
  } catch (error) {
    logger.warn("badge evaluation error", {
      callId,
      employeeId,
      error: (error as Error).message,
    });
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

// --- A4/F13: leaderboard with server-side aggregation + 60s cache ---
//
// Previously this loaded every call + every analysis into memory and looped
// over employees * calls in JS. The new version pushes the aggregation into
// SQL via storage.getLeaderboardData() and caches the result for 60s — the
// leaderboard is hit hard from the dashboard but tolerates up to a minute
// of staleness.

const LEADERBOARD_CACHE_TTL_MS = 60_000;
type LeaderboardCacheEntry = { value: LeaderboardEntry[]; expiresAt: number };
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();

/** Test seam: clear the leaderboard cache. */
export function clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

/** Compute streak from a NEWEST-FIRST array of numeric scores. */
function computeStreakFromScores(scores: number[]): number {
  let streak = 0;
  for (const s of scores) {
    if (s >= STREAK_THRESHOLD) streak++;
    else break;
  }
  return streak;
}

/** Compute points from precomputed totals + a recent-score window. */
function computePointsFromAggregate(
  recentScores: number[],
  scoreSum: number,
  scoreCount: number,
  badgeCount: number,
): number {
  // Per-call: base 10 + score bonus = scoreCount*10 + max(0, sum-(5*count))*5
  const callBase = scoreCount * 10;
  const scoreBonus = Math.max(0, scoreSum - 5 * scoreCount) * 5;
  // Streak multiplier: only the recent streak gets 1.5x (which adds half of
  // the per-call points for each call inside the streak). recentScores is
  // newest-first; the streak is the count of consecutive scores >= threshold.
  const streak = computeStreakFromScores(recentScores);
  let streakBonus = 0;
  if (streak > 0) {
    for (let i = 0; i < streak; i++) {
      const s = recentScores[i];
      const callPts = 10 + Math.max(0, s - 5) * 5;
      streakBonus += callPts * 0.5; // 1.5x - 1x = 0.5x
    }
  }
  const total = callBase + scoreBonus + streakBonus + badgeCount * 50;
  return Math.round(total);
}

/**
 * Generate the leaderboard from existing data.
 * Optionally filter by time period.
 *
 * Cache: results are cached for 60s per period key. Any badge insert
 * (createBadge) does NOT invalidate the cache — staleness up to 60s is
 * acceptable for this view.
 */
export async function getLeaderboard(period?: "week" | "month" | "all"): Promise<LeaderboardEntry[]> {
  const cacheKey = period ?? "all";
  const cached = leaderboardCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let since: Date | undefined;
  if (period === "week") since = new Date(now - 7 * 86400000);
  else if (period === "month") since = new Date(now - 30 * 86400000);

  // Server-side aggregation: one row per employee (with totals + recent scores)
  const [rows, allBadges] = await Promise.all([
    storage.getLeaderboardData({ since }),
    storage.getAllBadges(),
  ]);

  const entries: LeaderboardEntry[] = rows
    .filter(r => r.totalCalls > 0)
    .map(r => {
      const empBadges = allBadges.filter(b => b.employeeId === r.employeeId);
      const avgScore = r.scoreCount > 0 ? r.scoreSum / r.scoreCount : 0;
      const streak = computeStreakFromScores(r.recentScores);
      const points = computePointsFromAggregate(r.recentScores, r.scoreSum, r.scoreCount, empBadges.length);
      return {
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        subTeam: r.subTeam,
        totalCalls: r.totalCalls,
        avgScore: Math.round(avgScore * 10) / 10,
        totalPoints: points,
        currentStreak: streak,
        badges: empBadges,
        rank: 0, // filled below
      };
    });

  // Sort by points descending, then avg score as tiebreaker
  entries.sort((a, b) => b.totalPoints - a.totalPoints || b.avgScore - a.avgScore);
  entries.forEach((e, i) => { e.rank = i + 1; });

  leaderboardCache.set(cacheKey, { value: entries, expiresAt: now + LEADERBOARD_CACHE_TTL_MS });
  return entries;
}
