import type { Router } from "express";
import { registerSecurityRoutes } from "./admin-security";
import { registerOperationsRoutes } from "./admin-operations";
import { registerContentRoutes } from "./admin-content";

/**
 * Admin route coordinator — delegates to focused sub-modules:
 * - admin-security.ts: Security alerts, WAF, vulnerability scanning, incident response
 * - admin-operations.ts: Job queue, batch inference, CSV export, scheduled reports
 * - admin-content.ts: Prompt templates, A/B testing, usage tracking, webhooks
 */
export function registerAdminRoutes(
  router: Router,
  uploadMiddleware: any,
  deps: {
    getJobQueue: () => any;
    shouldUseBatchMode: (override?: string) => boolean;
  }
) {
  registerSecurityRoutes(router);
  registerOperationsRoutes(router, deps);
  registerContentRoutes(router, uploadMiddleware);
}
