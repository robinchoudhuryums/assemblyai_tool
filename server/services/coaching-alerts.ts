/**
 * Coaching Alerts Service
 *
 * Automatically generates coaching sessions when call scores fall below
 * a threshold (low performance) or exceed a high threshold (recognition).
 * Also detects recurring weakness patterns across multiple calls and
 * generates AI-powered coaching plans with specific action items.
 * Notifies managers in real-time via WebSocket.
 */
import { storage } from "../storage";
import { broadcastCallUpdate } from "./websocket";
import type { InsertCoachingSession, CallWithDetails } from "@shared/schema";

const LOW_SCORE_THRESHOLD = 4.0;
const HIGH_SCORE_THRESHOLD = 9.0;
const WEAKNESS_CALL_THRESHOLD = 3; // 3+ low sub-scores triggers a coaching plan
const WEAKNESS_SCORE_THRESHOLD = 5.0; // sub-score considered weak
const LOOKBACK_CALLS = 10; // analyze last N calls

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
    const sessionData: InsertCoachingSession = {
      title: `Auto-generated: Low score alert (score: ${score.toFixed(1)})`,
      employeeId,
      callId,
      category: "performance",
      notes: summary,
      actionPlan: [
        { task: "Review call recording and discuss with employee", completed: false },
        { task: "Identify specific areas for improvement", completed: false },
      ],
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
 * Analyzes the agent's recent calls for recurring weak sub-scores.
 * If 3+ calls have a sub-score below threshold in the same dimension,
 * auto-generates a targeted coaching plan with specific action items.
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
    const tasks = COACHING_TASKS[primary.dim] || [];

    const actionPlan = [
      ...tasks.map(task => ({ task, completed: false })),
      { task: `Follow-up: re-evaluate ${primary.label.toLowerCase()} after 1 week`, completed: false },
    ];

    const notes = [
      `Pattern detected: ${primary.count} of the last ${recentCalls.length} calls scored below ${WEAKNESS_SCORE_THRESHOLD}/10 in ${primary.label}.`,
      `Average sub-score: ${primary.avgScore.toFixed(1)}/10.`,
      weakDimensions.length > 1
        ? `Also weak in: ${weakDimensions.slice(1).map(d => `${d.label} (${d.avgScore.toFixed(1)})`).join(", ")}.`
        : "",
    ].filter(Boolean).join("\n");

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
