/**
 * Coaching Alerts & AI Coaching Engine
 *
 * Automatically generates coaching sessions when call scores fall below
 * a threshold (low performance) or exceed a high threshold (recognition).
 * Detects recurring weakness patterns across multiple calls and generates
 * AI-powered coaching plans with personalized, specific action items.
 * Notifies managers in real-time via WebSocket.
 */
import { storage } from "../storage";
import { broadcastCallUpdate } from "./websocket";
import { aiProvider } from "./ai-factory";
import type { InsertCoachingSession, CallAnalysis } from "@shared/schema";
import { LOW_SCORE_THRESHOLD, HIGH_SCORE_THRESHOLD, WEAKNESS_CALL_THRESHOLD, WEAKNESS_SCORE_THRESHOLD, LOOKBACK_CALLS } from "../constants";
import { fetchRagContext, isRagEnabled, type RagSource } from "./rag-client";
import { logger } from "./logger";

/**
 * A12/F11/F21: shape passed from the pipeline so we don't re-fetch the
 * analysis from storage. The caller already has the freshly-built analysis
 * record in scope; loading it again is wasteful and racy if the pipeline
 * is mid-update.
 */
type CoachingAnalysisInput = Pick<
  CallAnalysis,
  "feedback" | "subScores" | "flags"
> | undefined;

interface SubScores {
  compliance?: number;
  customerExperience?: number;
  communication?: number;
  resolution?: number;
}

const SUB_SCORE_LABELS: Record<string, string> = {
  compliance: "Compliance & Script Adherence",
  customerExperience: "Customer Experience",
  communication: "Communication Skills",
  resolution: "Issue Resolution",
};

const COACHING_TASKS: Record<string, string[]> = {
  compliance: [
    "Review required greeting and closing scripts",
    "Practice compliance checklist with role-play scenarios",
    "Shadow a top-performing agent for one call session",
    "Complete compliance refresher training module",
  ],
  customerExperience: [
    "Review best practices for empathy and active listening",
    "Practice acknowledging customer concerns before solutions",
    "Study top-rated calls for customer experience patterns",
    "Role-play difficult customer scenarios with manager",
  ],
  communication: [
    "Practice clear and concise explanations of products/services",
    "Work on reducing filler words and improving pacing",
    "Review recordings and self-evaluate communication style",
    "Complete communication skills workshop",
  ],
  resolution: [
    "Review product knowledge and common issue resolutions",
    "Practice first-call resolution techniques",
    "Study escalation procedures and when to apply them",
    "Build a personal FAQ reference for frequent issues",
  ],
};

export async function checkAndCreateCoachingAlert(
  callId: string,
  score: number,
  employeeId: string | undefined,
  summary: string,
  ragSources?: RagSource[],
  analysis?: CoachingAnalysisInput,
): Promise<void> {
  if (!employeeId) return;

  if (score <= LOW_SCORE_THRESHOLD) {
    // For low scores, generate an AI coaching plan if Bedrock is available
    let actionPlan: Array<{ task: string; completed: boolean }> = [
      { task: "Review call recording and discuss with employee", completed: false },
      { task: "Identify specific areas for improvement", completed: false },
    ];
    let aiNotes = summary;

    if (aiProvider.isAvailable && aiProvider.generateText) {
      try {
        const aiPlan = await generateAICoachingPlan(employeeId, callId, summary, score, ragSources, analysis);
        if (aiPlan) {
          actionPlan = aiPlan.tasks.map(t => ({ task: t, completed: false }));
          aiNotes = aiPlan.notes;
        }
      } catch (err) {
        logger.warn("ai coaching plan generation failed", {
          callId,
          employeeId,
          error: (err as Error).message,
        });
      }
    }

    const sessionData: InsertCoachingSession = {
      title: `Auto-generated: Low score alert (score: ${score.toFixed(1)})`,
      employeeId,
      callId,
      category: "performance",
      notes: aiNotes,
      actionPlan,
      assignedBy: "System (Auto-Alert)",
      status: "pending",
    };

    const created = await storage.createCoachingSession(sessionData);
    logger.info("coaching alert created (low score)", {
      callId,
      employeeId,
      coachingSessionId: created.id,
      score,
    });

    broadcastCallUpdate(callId, "coaching_alert", {
      coachingSessionId: created.id,
      employeeId,
      score,
    });
  } else if (score >= HIGH_SCORE_THRESHOLD) {
    const sessionData: InsertCoachingSession = {
      title: `Auto-generated: Exceptional performance (score: ${score.toFixed(1)})`,
      employeeId,
      callId,
      category: "recognition",
      notes: summary,
      actionPlan: [
        { task: "Recognize employee for excellent performance", completed: false },
        { task: "Share best practices from this call with team", completed: false },
        { task: "Consider this agent as a peer mentor", completed: false },
      ],
      assignedBy: "System (Auto-Alert)",
      status: "pending",
    };

    const created = await storage.createCoachingSession(sessionData);
    logger.info("recognition alert created (high score)", {
      callId,
      employeeId,
      coachingSessionId: created.id,
      score,
    });

    broadcastCallUpdate(callId, "recognition_alert", {
      coachingSessionId: created.id,
      employeeId,
      score,
    });
  }

  // Check for recurring weakness patterns
  await checkRecurringWeaknesses(callId, employeeId);
}

/**
 * Generate an AI-powered coaching plan for a specific low-scoring call.
 * Uses Bedrock to analyze the call summary and produce personalized action items.
 */
async function generateAICoachingPlan(
  employeeId: string,
  callId: string,
  callSummary: string,
  score: number,
  ragSources?: RagSource[],
  analysis?: CoachingAnalysisInput,
): Promise<{ tasks: string[]; notes: string } | null> {
  if (!aiProvider.generateText) return null;

  // Get employee info for context
  let employeeName = "the agent";
  try {
    const emp = await storage.getEmployee(employeeId);
    if (emp) employeeName = emp.name;
  } catch {}

  // A12/F11/F21: previously this re-fetched the analysis from storage.
  // The pipeline already has it in scope and now passes it through —
  // saves a DB round-trip and avoids racing the pipeline's own update.
  let analysisContext = "";
  if (analysis) {
    const feedback = analysis.feedback as { strengths?: string[]; suggestions?: string[] } | undefined;
    const suggestions = feedback?.suggestions || [];
    const strengths = feedback?.strengths || [];
    const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
    const subScores = analysis.subScores as { compliance?: number; customerExperience?: number; communication?: number; resolution?: number } | undefined;
    analysisContext = `
Sub-scores: Compliance ${subScores?.compliance ?? "N/A"}/10, Customer Experience ${subScores?.customerExperience ?? "N/A"}/10, Communication ${subScores?.communication ?? "N/A"}/10, Resolution ${subScores?.resolution ?? "N/A"}/10
Suggestions from AI: ${suggestions.slice(0, 4).map(s => typeof s === "string" ? s : JSON.stringify(s)).join("; ")}
Strengths observed: ${strengths.slice(0, 3).map(s => typeof s === "string" ? s : JSON.stringify(s)).join("; ")}
Flags: ${flags.join(", ") || "none"}`;
  }

  // Reuse RAG sources from the analysis (avoids duplicate API call)
  // Falls back to fetching if sources weren't passed from the pipeline
  let ragCoachingContext = "";
  if (ragSources && ragSources.length > 0) {
    ragCoachingContext = `\nCOMPANY COACHING GUIDELINES:\n${ragSources.slice(0, 2).map(s => `${s.sectionHeader || s.documentName}: ${s.text.slice(0, 400)}`).join("\n\n")}\n`;
  } else if (isRagEnabled()) {
    try {
      const ragResult = await fetchRagContext(
        `Coaching and training guidance for call center agents who scored low on: ${analysisContext.slice(0, 200)}`,
        undefined,
        "rag:coaching",
      );
      if (ragResult) {
        ragCoachingContext = `\nCOMPANY COACHING GUIDELINES:\n${ragResult.context.slice(0, 800)}\n`;
      }
    } catch {
      // Silent failure — coaching continues without RAG context
    }
  }

  const prompt = `You are a call center quality assurance coach for a medical supply company. An agent scored ${score.toFixed(1)}/10 on a recent call. Generate a specific, actionable coaching plan.

AGENT: ${employeeName}
CALL SUMMARY: ${callSummary.slice(0, 500)}
${analysisContext}${ragCoachingContext}

Respond in this exact JSON format only, with no additional text:
{
  "coaching_notes": "A 2-3 sentence coaching summary explaining the key issues and the approach to improvement.",
  "action_items": [
    "Specific, actionable task 1 (include what to do and how)",
    "Specific, actionable task 2",
    "Specific, actionable task 3",
    "Specific, actionable task 4"
  ]
}

Requirements:
- Generate 3-5 action items, each specific and achievable within 1-2 weeks
- Reference the actual issues from this call (not generic advice)
- Include at least one task involving reviewing this specific call recording
- Include at least one task involving practice or role-play
- Keep each action item under 100 characters`;

  try {
    const response = await aiProvider.generateText(prompt);
    const parsed = JSON.parse(response.replace(/```json?\s*/g, "").replace(/```/g, "").trim());
    if (parsed.action_items && Array.isArray(parsed.action_items) && parsed.action_items.length > 0) {
      return {
        tasks: parsed.action_items.slice(0, 6).map((t: unknown) => typeof t === "string" ? t : String(t)),
        notes: typeof parsed.coaching_notes === "string" ? parsed.coaching_notes : callSummary,
      };
    }
  } catch (parseErr) {
    logger.warn("failed to parse ai coaching plan", {
      callId,
      employeeId,
      error: (parseErr as Error).message,
    });
  }

  return null;
}

// F6 (Tier C #11): in-flight dedup for recurring-weakness plan creation.
// Two concurrent pipeline completions for the same agent previously could
// both pass the read-then-insert spam guard (line ~320) and both create a
// duplicate coaching plan. The outer 7-day guard still applies — this set
// only adds a short-window mutex that closes the concurrent-race gap.
// TTL is 5 min to recover from a crash between check and insert.
const recurringWeaknessInFlight = new Map<string, number>();
const RECURRING_WEAKNESS_INFLIGHT_MS = 5 * 60_000;

/**
 * Analyzes the agent's recent calls for recurring weak sub-scores.
 * If 3+ calls have a sub-score below threshold in the same dimension,
 * auto-generates a targeted coaching plan with AI-generated action items.
 */
async function checkRecurringWeaknesses(
  triggerCallId: string,
  employeeId: string,
): Promise<void> {
  // F6: concurrent-race guard. Opportunistic prune of stale entries so the
  // map stays bounded.
  const now = Date.now();
  for (const [id, ts] of recurringWeaknessInFlight) {
    if (now - ts > RECURRING_WEAKNESS_INFLIGHT_MS) recurringWeaknessInFlight.delete(id);
  }
  const existingInFlightTs = recurringWeaknessInFlight.get(employeeId);
  if (existingInFlightTs !== undefined && now - existingInFlightTs <= RECURRING_WEAKNESS_INFLIGHT_MS) {
    // Another concurrent pipeline call is already running the weakness
    // check for this employee. Skip to avoid duplicate plan creation.
    return;
  }
  recurringWeaknessInFlight.set(employeeId, now);

  try {
    // A4/F03: indexed lookup of the agent's last N completed calls instead of
    // a full per-employee scan. LOOKBACK_CALLS is the analysis window; we
    // ask the storage layer for that many rows directly.
    const recentCallsRaw = await storage.getRecentCallsForBadgeEval(employeeId, LOOKBACK_CALLS);
    const recentCalls = recentCallsRaw.filter(c => c.analysis?.subScores);

    if (recentCalls.length < WEAKNESS_CALL_THRESHOLD) return;

    // Count weak scores per dimension
    const weakCounts: Record<string, { count: number; avgScore: number; totalScore: number }> = {};
    for (const dim of Object.keys(SUB_SCORE_LABELS)) {
      weakCounts[dim] = { count: 0, avgScore: 0, totalScore: 0 };
    }

    for (const call of recentCalls) {
      const subScores = call.analysis?.subScores as SubScores | undefined;
      if (!subScores) continue;
      for (const [dim, val] of Object.entries(subScores)) {
        if (typeof val !== "number" || !weakCounts[dim]) continue;
        if (val < WEAKNESS_SCORE_THRESHOLD) {
          weakCounts[dim].count++;
          weakCounts[dim].totalScore += val;
        }
      }
    }

    // Find dimensions with recurring weaknesses
    const weakDimensions = Object.entries(weakCounts)
      .filter(([, data]) => data.count >= WEAKNESS_CALL_THRESHOLD)
      .map(([dim, data]) => ({
        dim,
        label: SUB_SCORE_LABELS[dim],
        avgScore: data.count > 0 ? data.totalScore / data.count : 0,
        count: data.count,
      }));

    if (weakDimensions.length === 0) return;

    // Check if we already created a coaching plan for this pattern recently (within 7 days)
    const existingSessions = await storage.getCoachingSessionsByEmployee(employeeId);
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentCoachingPlans = existingSessions.filter(
      s => s.assignedBy === "System (AI Coaching Plan)" &&
        s.createdAt && s.createdAt > oneWeekAgo
    );
    if (recentCoachingPlans.length > 0) return; // Don't spam

    // Generate coaching plan for weakest dimension(s)
    const primary = weakDimensions.sort((a, b) => a.avgScore - b.avgScore)[0];

    // Collect call summaries for AI context
    const callSummaries = recentCalls
      .filter(c => {
        const subScores = c.analysis?.subScores as SubScores | undefined;
        if (!subScores) return false;
        const val = (subScores as Record<string, number | undefined>)[primary.dim];
        return typeof val === "number" && val < WEAKNESS_SCORE_THRESHOLD;
      })
      .slice(0, 5)
      .map(c => {
        const summary = typeof c.analysis?.summary === "string" ? c.analysis.summary : "";
        return summary.slice(0, 200);
      })
      .filter(Boolean);

    // Try AI-generated plan first, fall back to static tasks
    let actionPlan: Array<{ task: string; completed: false }>;
    let notes: string;

    const aiPlan = await generateRecurringWeaknessAIPlan(
      employeeId, primary, weakDimensions, recentCalls.length, callSummaries
    );

    if (aiPlan) {
      actionPlan = aiPlan.tasks.map(task => ({ task, completed: false as const }));
      notes = aiPlan.notes;
    } else {
      // Fallback to static tasks
      const tasks = COACHING_TASKS[primary.dim] || [];
      actionPlan = [
        ...tasks.map(task => ({ task, completed: false as const })),
        { task: `Follow-up: re-evaluate ${primary.label.toLowerCase()} after 1 week`, completed: false as const },
      ];
      notes = [
        `Pattern detected: ${primary.count} of the last ${recentCalls.length} calls scored below ${WEAKNESS_SCORE_THRESHOLD}/10 in ${primary.label}.`,
        `Average sub-score: ${primary.avgScore.toFixed(1)}/10.`,
        weakDimensions.length > 1
          ? `Also weak in: ${weakDimensions.slice(1).map(d => `${d.label} (${d.avgScore.toFixed(1)})`).join(", ")}.`
          : "",
      ].filter(Boolean).join("\n");
    }

    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]; // 1 week from now

    const sessionData: InsertCoachingSession = {
      title: `AI Coaching Plan: Improve ${primary.label} (avg ${primary.avgScore.toFixed(1)}/10)`,
      employeeId,
      callId: triggerCallId,
      category: "performance",
      notes,
      actionPlan,
      assignedBy: "System (AI Coaching Plan)",
      status: "pending",
      dueDate,
    };

    const created = await storage.createCoachingSession(sessionData);
    logger.info("ai coaching plan created (recurring weakness)", {
      callId: triggerCallId,
      employeeId,
      coachingSessionId: created.id,
      dimension: primary.label,
      avgSubScore: Math.round(primary.avgScore * 10) / 10,
      weakCallCount: primary.count,
    });

    broadcastCallUpdate(triggerCallId, "coaching_plan", {
      coachingSessionId: created.id,
      employeeId,
      dimension: primary.label,
      avgScore: primary.avgScore,
    });
  } catch (error) {
    // Non-critical — don't fail the pipeline
    logger.error("recurring weaknesses check failed", {
      callId: triggerCallId,
      employeeId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // F6: release the in-flight mutex on success OR failure so the NEXT
    // completion for this agent can run the check. TTL-based expiry is a
    // safety net if this cleanup somehow misses.
    recurringWeaknessInFlight.delete(employeeId);
  }
}

/**
 * Generate an AI-powered coaching plan for a recurring weakness pattern.
 * Provides personalized recommendations based on the agent's actual call data.
 */
async function generateRecurringWeaknessAIPlan(
  employeeId: string,
  primary: { dim: string; label: string; avgScore: number; count: number },
  allWeakDimensions: Array<{ dim: string; label: string; avgScore: number; count: number }>,
  totalCallsAnalyzed: number,
  callSummaries: string[],
): Promise<{ tasks: string[]; notes: string } | null> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) return null;

  let employeeName = "the agent";
  try {
    const emp = await storage.getEmployee(employeeId);
    if (emp) employeeName = emp.name;
  } catch {}

  const otherWeaknesses = allWeakDimensions
    .filter(d => d.dim !== primary.dim)
    .map(d => `${d.label}: avg ${d.avgScore.toFixed(1)}/10 (${d.count} weak calls)`)
    .join("\n  ");

  const summaryContext = callSummaries.length > 0
    ? `\nRecent low-scoring call summaries:\n${callSummaries.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
    : "";

  const companyName = process.env.COMPANY_NAME || "UniversalMed Supply";
  const prompt = `You are a call center quality assurance coach for a medical supply company (${companyName}). An agent has a recurring weakness pattern detected across their recent calls. Generate a targeted, multi-week coaching plan.

AGENT: ${employeeName}
PRIMARY WEAKNESS: ${primary.label}
  Average sub-score: ${primary.avgScore.toFixed(1)}/10 across ${primary.count} of the last ${totalCallsAnalyzed} calls
${otherWeaknesses ? `SECONDARY WEAKNESSES:\n  ${otherWeaknesses}` : ""}
${summaryContext}

Respond in this exact JSON format only, with no additional text:
{
  "coaching_summary": "A 3-4 sentence coaching analysis explaining the pattern, likely root cause, and the recommended approach to improvement.",
  "weekly_plan": [
    {
      "week": 1,
      "focus": "Brief focus area description",
      "tasks": ["Specific task 1", "Specific task 2"]
    },
    {
      "week": 2,
      "focus": "Brief focus area description",
      "tasks": ["Specific task 1", "Specific task 2"]
    }
  ]
}

Requirements:
- Generate a 2-3 week plan with 2-3 tasks per week
- Tasks should be progressive (build on each other)
- Week 1 should focus on awareness and review (listen to recordings, identify patterns)
- Week 2+ should focus on practice and application (role-play, shadowing, real calls)
- Reference the specific weakness dimension (${primary.label})
- Each task should be under 100 characters and actionable`;

  try {
    const response = await aiProvider.generateText(prompt);
    const parsed = JSON.parse(response.replace(/```json?\s*/g, "").replace(/```/g, "").trim());

    if (parsed.weekly_plan && Array.isArray(parsed.weekly_plan)) {
      const tasks: string[] = [];
      for (const week of parsed.weekly_plan) {
        if (week.focus) {
          tasks.push(`Week ${week.week}: ${week.focus}`);
        }
        if (Array.isArray(week.tasks)) {
          for (const task of week.tasks) {
            if (typeof task === "string") tasks.push(task);
          }
        }
      }
      if (tasks.length > 0) {
        tasks.push(`Follow-up: re-evaluate ${primary.label.toLowerCase()} after completing plan`);
        return {
          tasks: tasks.slice(0, 12),
          notes: typeof parsed.coaching_summary === "string"
            ? parsed.coaching_summary
            : `Pattern detected: ${primary.count} of ${totalCallsAnalyzed} calls below ${WEAKNESS_SCORE_THRESHOLD}/10 in ${primary.label}.`,
        };
      }
    }
  } catch (parseErr) {
    logger.warn("failed to parse ai recurring weakness plan", {
      employeeId,
      dimension: primary.dim,
      error: (parseErr as Error).message,
    });
  }

  return null;
}
