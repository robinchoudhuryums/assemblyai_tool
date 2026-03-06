/**
 * WebSocket service for broadcasting real-time call processing updates to connected clients.
 * HIPAA: Connections are authenticated via session cookie verification.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server, ServerResponse, IncomingMessage } from "http";
import { sessionMiddleware } from "../auth";

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "connected" }));
  });

  // HIPAA: Authenticate WebSocket connections using the session cookie
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== "/ws") return;

    // Create a minimal response object for the session middleware
    const res = { writeHead() {}, end() {} } as unknown as ServerResponse;

    sessionMiddleware(req as any, res as any, () => {
      const session = (req as any).session;
      const passport = session?.passport;

      if (!passport?.user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit("connection", ws, req);
      });
    });
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
