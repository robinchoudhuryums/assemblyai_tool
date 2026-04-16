/**
 * WebSocket service for broadcasting real-time call processing updates to connected clients.
 * HIPAA: Connections are authenticated via session cookie verification.
 * Broadcasts are filtered to only send to authenticated users (not role-filtered for call updates
 * since all authenticated users can view calls).
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server, ServerResponse, IncomingMessage } from "http";
import { sessionMiddleware } from "../auth";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  userRole?: string;
}

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    // Store user info from the authenticated session
    const session = (req as any).session;
    const passport = session?.passport;
    if (passport?.user) {
      ws.userId = passport.user;
    }

    ws.send(JSON.stringify({ type: "connected" }));
  });

  // Periodic heartbeat: ping all clients, terminate dead connections.
  // .unref() per INV-30 so the timer doesn't block graceful shutdown
  // (wss.close also clears it explicitly below).
  const heartbeat = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      const aws = ws as AuthenticatedWebSocket;
      if (aws.isAlive === false) {
        ws.terminate();
        return;
      }
      aws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  wss.on("close", () => clearInterval(heartbeat));

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

  logger.info("WebSocket server initialized on /ws");
}

export function broadcastCallUpdate(callId: string, status: string, extra?: Record<string, any>) {
  if (!wss) return;
  const message = JSON.stringify({ type: "call_update", callId, status, ...extra });
  wss.clients.forEach((client) => {
    const aws = client as AuthenticatedWebSocket;
    // Only send to authenticated, connected clients
    if (client.readyState === WebSocket.OPEN && aws.userId) {
      client.send(message);
    }
  });
}
