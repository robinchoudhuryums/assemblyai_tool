import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { z } from "zod";

const callUpdateSchema = z.object({
  type: z.literal("call_update"),
  callId: z.string(),
  status: z.string(),
  step: z.number().optional(),
  totalSteps: z.number().optional(),
  label: z.string().optional(),
});

/**
 * Simulated Call Generator events. Dispatched as ws:simulated_call_update
 * so the regular calls-list cache doesn't invalidate on every tick.
 * Consumer: client/src/pages/simulated-calls.tsx listens for this.
 */
const simulatedCallUpdateSchema = z.object({
  type: z.literal("simulated_call_update"),
  simulatedCallId: z.string(),
  status: z.string(),
  error: z.string().optional(),
  title: z.string().optional(),
});

export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;
const JITTER_FACTOR = 0.3; // ±30% jitter

/**
 * Exported for unit tests so the backoff curve can be exercised without
 * standing up a real WebSocket. Pure function: deterministic except for the
 * single Math.random() call.
 */
export function backoffWithJitter(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const attemptRef = useRef(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const mountedRef = useRef(true);

  // Capture toast / translator / queryClient in refs so the connect/reconnect
  // callbacks can stay stable across renders. Without this, every locale
  // change re-creates `connect`, which re-runs the mount effect, which tears
  // down and re-establishes the WebSocket — pointlessly noisy and racy.
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  const qcRef = useRef<QueryClient>(queryClient);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => { qcRef.current = queryClient; }, [queryClient]);

  // Forward declaration so connect() can call scheduleReconnect() and
  // scheduleReconnect() can call connect() without an init-order trap.
  const connectRef = useRef<() => void>(() => { /* set below */ });

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || attemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;
    if (reconnectTimer.current) return; // Already scheduled
    const delay = backoffWithJitter(attemptRef.current);
    attemptRef.current++;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = undefined;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    // Don't connect if unmounted
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      setConnectionState(attemptRef.current === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        attemptRef.current = 0;
        setConnectionState("connected");
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);

          // Simulated Call Generator updates — separate event so the calls
          // list cache isn't invalidated by synthetic-call status ticks.
          const simParsed = simulatedCallUpdateSchema.safeParse(raw);
          if (simParsed.success) {
            window.dispatchEvent(
              new CustomEvent("ws:simulated_call_update", { detail: simParsed.data }),
            );
            qcRef.current.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
            return;
          }

          const parsed = callUpdateSchema.safeParse(raw);
          if (!parsed.success) return; // Ignore malformed messages
          const data = parsed.data;
          if (data.type === "call_update") {
            // Broadcast to other components (e.g., file-upload progress tracking).
            // CONTRACT: keep `event.detail` shape identical — sidebar / calls-table /
            // file-upload all read .callId, .status, .step, .totalSteps, .label.
            window.dispatchEvent(new CustomEvent("ws:call_update", { detail: data }));

            if (data.status === "completed") {
              toastRef.current({
                title: tRef.current("toast.callComplete"),
                description: data.label || tRef.current("toast.callCompleteDesc"),
              });
              // Refresh calls and dashboard data
              qcRef.current.invalidateQueries({ queryKey: ["/api/calls"] });
              qcRef.current.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
            } else if (data.status === "failed") {
              toastRef.current({
                title: tRef.current("toast.callFailed"),
                description: data.label || tRef.current("toast.callFailedDesc"),
                variant: "destructive",
              });
              qcRef.current.invalidateQueries({ queryKey: ["/api/calls"] });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mountedRef.current) return;

        setConnectionState("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // Schedule reconnect before close — onclose may not fire reliably after error in all browsers
        scheduleReconnect();
        try { ws.close(); } catch { /* already closed */ }
      };
    } catch {
      if (!mountedRef.current) return;
      scheduleReconnect();
    }
  }, [scheduleReconnect]);

  // Keep the ref pointing at the latest connect closure so scheduleReconnect
  // can dispatch through it without depending on connect in its useCallback.
  connectRef.current = connect;

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      attemptRef.current = 0; // Reset reconnect counter so remount starts fresh
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // connect is stable (deps: [scheduleReconnect], which is also stable),
    // so this effect runs exactly once per mount — locale or query-client
    // changes no longer recycle the WebSocket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return connectionState;
}
