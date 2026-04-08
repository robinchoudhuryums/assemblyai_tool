import { Router } from "express";
import {
  LOW_SCORE_THRESHOLD,
  HIGH_SCORE_THRESHOLD,
  STREAK_SCORE_THRESHOLD,
} from "../constants";

/**
 * GET /api/config — public, unauthenticated client config snapshot.
 *
 * Returns build/environment-derived values that the frontend needs to know
 * but historically had to hardcode (scoring tier thresholds, company name).
 * Public on purpose: no PHI, no secrets, just display-time tuning so a
 * single deploy can drive multiple white-labeled tenants.
 */
export function registerConfigRoutes(router: Router) {
  router.get("/api/config", (_req, res) => {
    res.json({
      companyName: process.env.COMPANY_NAME || "UMS (United Medical Supply)",
      scoring: {
        lowScoreThreshold: LOW_SCORE_THRESHOLD,
        highScoreThreshold: HIGH_SCORE_THRESHOLD,
        streakScoreThreshold: STREAK_SCORE_THRESHOLD,
        // Tier breakpoints used by score color/label logic in the UI.
        excellentThreshold: 8,
        goodThreshold: 6,
        needsWorkThreshold: 4,
      },
    });
  });
}
