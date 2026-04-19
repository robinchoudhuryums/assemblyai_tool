/**
 * Transcribing-state orphan reaper.
 *
 * A server restart mid-transcribe loses the in-memory pending promise that
 * `assemblyAIService.waitForTranscript` held open. If AssemblyAI ever
 * delivers the webhook (or the polling loop completes), there's no
 * listener, and the call stays in `status: "transcribing"` forever until
 * operator intervention. The existing batch-inference orphan recovery
 * covers "awaiting_analysis" but not "transcribing" — asymmetric.
 *
 * This module adds a symmetric reaper: on boot and on a periodic interval,
 * scan for calls in `"transcribing"` older than a threshold and mark them
 * `"failed"` with a descriptive label. Runs regardless of batch mode.
 *
 * Threshold rationale: AssemblyAI transcription of a typical call
 * completes in 1-5 minutes. `ASSEMBLYAI_POLL_MAX_MINUTES` defaults to 5,
 * so after that the pipeline should have already failed the call. 30
 * minutes is comfortably beyond any legitimate in-flight transcription
 * and short enough that a user doesn't stare at a stuck call for hours.
 */
import { storage } from "../storage";
import { broadcastCallUpdate } from "./websocket";
import { logger } from "./logger";

const REAPER_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TRANSCRIBING_ORPHAN_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

let reaperInterval: ReturnType<typeof setInterval> | null = null;
let reaperTimeout: ReturnType<typeof setTimeout> | null = null;

export async function recoverStuckTranscriptions(): Promise<void> {
  try {
    // getCallsByStatus intentionally INCLUDES synthetic rows (orphan
    // recovery is the documented exception to INV-34). We want to reap
    // synthetic calls too — the transcribing-forever failure mode is
    // identical.
    const transcribing = await storage.getCallsByStatus("transcribing");
    if (transcribing.length === 0) return;

    let reaped = 0;
    for (const call of transcribing) {
      const uploadedTime = call.uploadedAt ? new Date(call.uploadedAt).getTime() : 0;
      const age = Date.now() - uploadedTime;
      if (age > TRANSCRIBING_ORPHAN_THRESHOLD_MS) {
        try {
          await storage.updateCall(call.id, { status: "failed" });
          broadcastCallUpdate(call.id, "failed", { label: "Orphaned: transcription never completed" });
          reaped++;
        } catch (err) {
          logger.warn("transcribing-reaper: failed to mark call failed", {
            callId: call.id,
            error: (err as Error).message,
          });
        }
      }
    }
    if (reaped > 0) {
      logger.warn("transcribing-reaper: reaped stuck transcriptions", { count: reaped });
    }
  } catch (err) {
    logger.warn("transcribing-reaper: scan failed", { error: (err as Error).message });
  }
}

export function startTranscribingReaper(): () => void {
  // First pass after 2 minutes so we don't fire during boot turbulence.
  // .unref() per INV-30 so the timer doesn't block graceful shutdown.
  reaperTimeout = setTimeout(recoverStuckTranscriptions, 2 * 60 * 1000);
  reaperTimeout.unref();
  reaperInterval = setInterval(recoverStuckTranscriptions, REAPER_CHECK_INTERVAL_MS);
  reaperInterval.unref();
  logger.info("transcribing-reaper started", {
    intervalMs: REAPER_CHECK_INTERVAL_MS,
    thresholdMs: TRANSCRIBING_ORPHAN_THRESHOLD_MS,
  });
  return stopTranscribingReaper;
}

export function stopTranscribingReaper(): void {
  if (reaperTimeout) { clearTimeout(reaperTimeout); reaperTimeout = null; }
  if (reaperInterval) { clearInterval(reaperInterval); reaperInterval = null; }
  logger.info("transcribing-reaper stopped");
}
