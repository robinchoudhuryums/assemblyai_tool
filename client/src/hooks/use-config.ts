import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_COMPANY_NAME,
  LOW_SCORE_THRESHOLD,
  HIGH_SCORE_THRESHOLD,
  STREAK_SCORE_THRESHOLD,
  SCORE_EXCELLENT,
  SCORE_GOOD,
  SCORE_NEEDS_WORK,
} from "@/lib/constants";

/**
 * Shape returned by GET /api/config — see server/routes/config.ts.
 *
 * Public, unauthenticated config snapshot. The frontend caches this query
 * forever (staleTime: Infinity) so any consumer can read tier thresholds
 * and the company name without re-fetching.
 */
export interface AppConfig {
  companyName: string;
  scoring: {
    lowScoreThreshold: number;
    highScoreThreshold: number;
    streakScoreThreshold: number;
    excellentThreshold: number;
    goodThreshold: number;
    needsWorkThreshold: number;
  };
}

const FALLBACK_CONFIG: AppConfig = {
  companyName: DEFAULT_COMPANY_NAME,
  scoring: {
    lowScoreThreshold: LOW_SCORE_THRESHOLD,
    highScoreThreshold: HIGH_SCORE_THRESHOLD,
    streakScoreThreshold: STREAK_SCORE_THRESHOLD,
    excellentThreshold: SCORE_EXCELLENT,
    goodThreshold: SCORE_GOOD,
    needsWorkThreshold: SCORE_NEEDS_WORK,
  },
};

/**
 * Fetch the public app config. Falls back to client-side constants while
 * the request is in flight or if the request fails.
 */
export function useConfig(): AppConfig {
  const { data } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
    staleTime: Infinity,
  });
  return data || FALLBACK_CONFIG;
}
