/**
 * MSW-Node setup for E2E mode. Called from `server/index.ts` at startup
 * when `E2E_MOCKS=true` is in the environment. Zero effect on any other
 * boot path — the whole module is only imported under the env guard.
 *
 * Usage (Playwright):
 *   webServer: {
 *     command: "npm run dev",
 *     env: { E2E_MOCKS: "true", ... },
 *   }
 */
import { setupServer } from "msw/node";
import { mockHandlers } from "./handlers";
import { logger } from "../services/logger";

// MSW's SetupServer type isn't exported consistently across versions;
// infer it from the factory return shape to avoid a type import tax.
type MockServer = ReturnType<typeof setupServer>;
let server: MockServer | null = null;

export function startMockServer(): void {
  if (server) return;  // idempotent
  server = setupServer(...mockHandlers);
  // `bypass` means unmatched requests pass through to real network. In
  // e2e mode this is what we want — only AssemblyAI / Bedrock / S3 are
  // mocked; localhost fetches (WebSocket, etc.) proceed unmocked.
  server.listen({ onUnhandledRequest: "bypass" });
  logger.info("MSW e2e mocks active", { handlers: mockHandlers.length });
}

export function stopMockServer(): void {
  if (!server) return;
  server.close();
  server = null;
}
