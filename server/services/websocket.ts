/**
 * WebSocket service for broadcasting real-time call processing updates to connected clients.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "connected" }));
  });

  console.log("WebSocket server initialized on /ws");
}

export function broadcastCallUpdate(callId: string, status: string, extra?: Record<string, any>) {
  if (!wss) return;
  const message = JSON.stringify({ type: "call_update", callId, status, ...extra });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
