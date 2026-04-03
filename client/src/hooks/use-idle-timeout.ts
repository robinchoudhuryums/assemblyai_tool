import { useState, useEffect, useRef, useCallback } from "react";

/** Total idle time before auto-logout (15 minutes — matches server session timeout) */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Warning shown this many ms before timeout (2 minutes) */
const WARNING_BEFORE_MS = 2 * 60 * 1000;

/** How often to update remainingSeconds while warning is shown */
const COUNTDOWN_INTERVAL_MS = 1000;

const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

interface IdleTimeoutResult {
  showWarning: boolean;
  remainingSeconds: number;
}

/**
 * Hook that tracks user activity and triggers a callback after IDLE_TIMEOUT_MS
 * of inactivity. Shows a warning countdown WARNING_BEFORE_MS before logout.
 *
 * Ported from ums-knowledge-reference/frontend/src/hooks/useIdleTimeout.ts.
 */
export function useIdleTimeout(onIdle: () => void, enabled: boolean): IdleTimeoutResult {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number>(0);
  const onIdleRef = useRef(onIdle);

  // Keep callback ref fresh without re-triggering effects
  onIdleRef.current = onIdle;

  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const resetTimers = useCallback(() => {
    clearAllTimers();
    setShowWarning(false);

    const now = Date.now();
    deadlineRef.current = now + IDLE_TIMEOUT_MS;

    // Fire warning 2 minutes before timeout
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(Math.ceil(WARNING_BEFORE_MS / 1000));
      countdownRef.current = setInterval(() => {
        const secsLeft = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
        setRemainingSeconds(secsLeft);
      }, COUNTDOWN_INTERVAL_MS);
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);

    // Fire logout at timeout
    idleTimerRef.current = setTimeout(() => {
      clearAllTimers();
      setShowWarning(false);
      try { onIdleRef.current(); } catch (err) { console.error("Idle timeout callback failed:", err); }
    }, IDLE_TIMEOUT_MS);
  }, [clearAllTimers]);

  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      setShowWarning(false);
      return;
    }

    resetTimers();

    const handler = () => resetTimers();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handler, { passive: true }));

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handler, { passive: true } as EventListenerOptions));
      clearAllTimers();
    };
  }, [enabled, resetTimers, clearAllTimers]);

  return { showWarning, remainingSeconds };
}
