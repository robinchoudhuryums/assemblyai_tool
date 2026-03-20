import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

const callUpdateSchema = z.object({
  type: z.literal("call_update"),
  callId: z.string(),
  status: z.string(),
  step: z.number().optional(),
  totalSteps: z.number().optional(),
  label: z.string().optional(),
});

type CallUpdate = z.infer<typeof callUpdateSchema>;

export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;
const JITTER_FACTOR = 0.3; // ±30% jitter

function backoffWithJitter(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const attemptRef = useRef(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const mountedRef = useRef(true);

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

        // Broadcast connection state for other components
        window.dispatchEvent(new CustomEvent("ws:state", { detail: { state: "connected" } }));
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          const parsed = callUpdateSchema.safeParse(raw);
          if (!parsed.success) return; // Ignore malformed messages
          const data = parsed.data;
          if (data.type === "call_update") {
            // Broadcast to other components (e.g., file-upload progress tracking)
            window.dispatchEvent(new CustomEvent("ws:call_update", { detail: data }));

            if (data.status === "completed") {
              toast({
                title: "Call Processing Complete",
                description: data.label || "Your call has been analyzed and is ready to view.",
              });
              // Refresh calls and dashboard data
              queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
            } else if (data.status === "failed") {
              toast({
                title: "Call Processing Failed",
                description: data.label || "There was an error processing your call.",
                variant: "destructive",
              });
              queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
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
        window.dispatchEvent(new CustomEvent("ws:state", { detail: { state: "disconnected" } }));

        if (attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = backoffWithJitter(attemptRef.current);
          attemptRef.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (!mountedRef.current) return;
      // WebSocket not available, retry with backoff
      if (attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = backoffWithJitter(attemptRef.current);
        attemptRef.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    }
  }, [toast, queryClient]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return connectionState;
}
