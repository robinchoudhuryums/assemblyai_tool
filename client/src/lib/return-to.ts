/**
 * sanitizeReturnTo — SSRF-guarded parser for the `?return_to=<url>` query
 * param on CA's login page. Used by the Option-A SSO "Sign in with
 * CallAnalyzer" button on the RAG side: when RAG redirects the user here
 * for login, it passes `?return_to=<origin-of-rag>` so CA can send the
 * user back after successful auth.
 *
 * Accepted: any `http://` or `https://` URL whose hostname is
 * `umscallanalyzer.com` OR ends with `.umscallanalyzer.com`. Rejected:
 * everything else — open-redirect is the classic companion vuln to any
 * "trust me on the query string" post-login redirect.
 *
 * Returns the sanitized URL string on accept, or `null` on reject. The
 * caller should fall through to the default post-login destination
 * (dashboard) when this returns null.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const ALLOWED_ROOT = "umscallanalyzer.com";
  if (host !== ALLOWED_ROOT && !host.endsWith(`.${ALLOWED_ROOT}`)) {
    return null;
  }
  return url.toString();
}
