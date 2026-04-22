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
      // `companyName` is consumed by backend AI prompts (coaching alerts,
      // snapshots, transcription word boost) when the server renders text
      // ABOUT the tenant. Clients should NOT display this directly as the
      // app chrome — use the hardcoded "CallAnalyzer" brand in the UI.
      companyName: process.env.COMPANY_NAME || "UniversalMed Supply",
      // `appName` is the product brand shown in UI chrome (login page,
      // sidebar header). Hardcoded — not tenant-tunable.
      appName: "CallAnalyzer",
      scoring: {
        lowScoreThreshold: LOW_SCORE_THRESHOLD,
        highScoreThreshold: HIGH_SCORE_THRESHOLD,
        streakScoreThreshold: STREAK_SCORE_THRESHOLD,
        // Tier breakpoints used by score color/label logic in the UI.
        excellentThreshold: 8,
        goodThreshold: 6,
        needsWorkThreshold: 4,
      },
      // Knowledge-base embed — drives the "Ask KB" drawer on the
      // transcript detail page. Requires RAG_ENABLED + RAG_SERVICE_URL +
      // a shared session cookie (SSO Track 2) so the iframe can
      // authenticate against RAG without a redirect loop.
      kb: {
        enabled:
          process.env.RAG_ENABLED === "true" &&
          !!process.env.RAG_SERVICE_URL &&
          process.env.RAG_SERVICE_URL.startsWith("http"),
        embedUrl:
          process.env.RAG_ENABLED === "true" && process.env.RAG_SERVICE_URL
            ? `${process.env.RAG_SERVICE_URL.replace(/\/$/, "")}/?embed=1`
            : null,
      },
    });
  });
}
