/**
 * Narrow service-to-service client for RAG's SSO-coordination endpoints.
 * Sibling of rag-client.ts (which uses the pre-existing RAG_API_KEY for
 * knowledge-base queries) — this module uses SSO_SHARED_SECRET, the
 * same secret RAG's /sso-verify and /sso-logout accept.
 *
 * The two secrets are distinct on purpose: RAG_API_KEY authenticates CA
 * as a service account for business queries, SSO_SHARED_SECRET
 * authenticates CA as the SSO authority. A compromise of one shouldn't
 * grant the other's capabilities.
 */

import { logger } from "./logger";

const SSO_SEEN_PATH = "/api/auth/sso-seen";
const TIMEOUT_MS = 3000;

export interface SsoSeenResult {
  /** True when we got a successful 200 response (even if empty). False on
   *  timeout, 5xx, 401, config miss, etc. The admin UI uses this to
   *  distinguish "zero users have logged into RAG" (show empty list) from
   *  "RAG is unreachable" (show a diagnostic banner). */
  reachable: boolean;
  seen: Set<string>;
}

/**
 * Fetch the set of CA user IDs (== RAG's ssoSub values) that RAG has
 * ever seen via SSO login. Never throws; reachable=false signals any
 * failure so the admin UI can degrade gracefully.
 */
export async function fetchRagSeenUserIds(): Promise<SsoSeenResult> {
  const base = (process.env.RAG_SERVICE_URL || "").replace(/\/$/, "");
  const secret = process.env.SSO_SHARED_SECRET;
  if (!base) return { reachable: false, seen: new Set() };
  if (!secret || secret.length < 32) return { reachable: false, seen: new Set() };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${SSO_SEEN_PATH}`, {
      method: "GET",
      headers: { "x-service-secret": secret },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("rag-sso-client: non-200 from /sso-seen", { status: res.status });
      return { reachable: false, seen: new Set() };
    }
    const body = (await res.json()) as { seen?: unknown };
    if (!Array.isArray(body?.seen)) return { reachable: false, seen: new Set() };
    const filtered = body.seen.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    return { reachable: true, seen: new Set(filtered) };
  } catch (err) {
    logger.warn("rag-sso-client: /sso-seen call failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { reachable: false, seen: new Set() };
  } finally {
    clearTimeout(timer);
  }
}
