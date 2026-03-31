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
import type { InsertCoachingSession, CallWithDetails } from "@shared/schema";
import { LOW_SCORE_THRESHOLD, HIGH_SCORE_THRESHOLD, WEAKNESS_CALL_THRESHOLD, WEAKNESS_SCORE_THRESHOLD, LOOKBACK_CALLS } from "../constants";

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
        const aiPlan = await generateAICoachingPlan(employeeId, callId, summary, score);
        if (aiPlan) {
          actionPlan = aiPlan.tasks.map(t => ({ task: t, completed: false }));
          aiNotes = aiPlan.notes;
        }
      } catch (err) {
        console.warn(`[${callId}] AI coaching plan generation failed (using defaults):`, (err as Error).message);
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
    console.log(`[${callId}] Coaching alert created for low score (${score.toFixed(1)}): session ${created.id}`);

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
    console.log(`[${callId}] Recognition alert created for high score (${score.toFixed(1)}): session ${created.id}`);

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
): Promise<{ tasks: string[]; notes: string } | null> {
  if (!aiProvider.generateText) return null;

  // Get employee info for context
  let employeeName = "the agent";
  try {
    const emp = await storage.getEmployee(employeeId);
    if (emp) employeeName = emp.name;
  } catch {}

  // Get the call analysis for more detail
  let analysisContext = "";
  try {
    const analysis = await storage.getCallAnalysis(callId);
    if (analysis) {
      const feedback = analysis.feedback as { strengths?: string[]; suggestions?: string[] } | undefined;
      const suggestions = feedback?.suggestions || [];
      const strengths = feedback?.strengths || [];
      const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
      analysisContext = `
Sub-scores: Compliance ${(analysis.subScores as any)?.compliance ?? "N/A"}/10, Customer Experience ${(analysis.subScores as any)?.customerExperience ?? "N/A"}/10, Communication ${(analysis.subScores as any)?.communication ?? "N/A"}/10, Resolution ${(analysis.subScores as any)?.resolution ?? "N/A"}/10
Suggestions from AI: ${suggestions.slice(0, 4).map(s => typeof s === "string" ? s : JSON.stringify(s)).join("; ")}
Strengths observed: ${strengths.slice(0, 3).map(s => typeof s === "string" ? s : JSON.stringify(s)).join("; ")}
Flags: ${flags.join(", ") || "none"}`;
    }
  } catch {}

  const prompt = `You are a call center quality assurance coach for a medical supply company. An agent scored ${score.toFixed(1)}/10 on a recent call. Generate a specific, actionable coaching plan.

AGENT: ${employeeName}
CALL SUMMARY: ${callSummary.slice(0, 500)}
${analysisContext}

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
    console.warn(`[${callId}] Failed to parse AI coaching plan:`, (parseErr as Error).message);
  }

  return null;
}

/**
 * Analyzes the agent's recent calls for recurring weak sub-scores.
 * If 3+ calls have a sub-score below threshold in the same dimension,
 * auto-generates a targeted coaching plan with AI-generated action items.
 */
async function checkRecurringWeaknesses(
  triggerCallId: string,
  employeeId: string,
): Promise<void> {
  try {
    const allCalls = await storage.getCallsWithDetails({ employee: employeeId });
    const recentCalls = allCalls
      .filter(c => c.status === "completed" && c.analysis?.subScores)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
      .slice(0, LOOKBACK_CALLS);

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
    console.log(`[${triggerCallId}] AI coaching plan created for ${primary.label} weakness: session ${created.id}`);

    broadcastCallUpdate(triggerCallId, "coaching_plan", {
      coachingSessionId: created.id,
      employeeId,
      dimension: primary.label,
      avgScore: primary.avgScore,
    });
  } catch (error) {
    // Non-critical — don't fail the pipeline
    console.error("Error checking recurring weaknesses:", error instanceof Error ? error.message : error);
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

  const prompt = `You are a call center quality assurance coach for a medical supply company (UMS). An agent has a recurring weakness pattern detected across their recent calls. Generate a targeted, multi-week coaching plan.

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
    console.warn(`[COACHING] Failed to parse AI recurring weakness plan:`, (parseErr as Error).message);
  }

  return null;
}
