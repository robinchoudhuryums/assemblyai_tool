import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface CallUpdate {
  type: "call_update";
  callId: string;
  status: string;
  step?: number;
  totalSteps?: number;
  label?: string;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as CallUpdate;
          if (data.type === "call_update") {
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
        // Reconnect after 5 seconds
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available, retry later
      reconnectTimer.current = setTimeout(connect, 10000);
    }
  }, [toast, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
