/**
 * Coaching Alerts Service
 *
 * Automatically generates coaching sessions when call scores fall below
 * a threshold (low performance) or exceed a high threshold (recognition).
 * Notifies managers in real-time via WebSocket.
 */
import { storage } from "../storage";
import { broadcastCallUpdate } from "./websocket";
import type { InsertCoachingSession } from "@shared/schema";

const LOW_SCORE_THRESHOLD = 4.0;
const HIGH_SCORE_THRESHOLD = 9.0;

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
}
