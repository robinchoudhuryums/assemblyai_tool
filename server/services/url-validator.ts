/**
 * URL validation for SSRF (Server-Side Request Forgery) prevention.
 *
 * Used by webhook registration, webhook delivery, and any feature that
 * makes HTTP requests to user-supplied URLs.
 *
 * Protection layers:
 *   1. Protocol enforcement (https only in production)
 *   2. Hostname blocklist (localhost, metadata endpoints, .local, .internal)
 *   3. Private/reserved IP range blocking (RFC 1918, RFC 6598, link-local, loopback)
 *   4. DNS resolution check (blocks DNS rebinding — resolves hostname and validates the IP)
 */
import { lookup } from "dns/promises";
import { logger } from "./logger";

// --- Blocked hostnames ---
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
  // AWS metadata
  "169.254.169.254",
  "169.254.169.250",
  // GCP metadata
  "metadata.google.internal",
  "metadata.goog",
  // Azure metadata
  "169.254.169.254",
  // Alibaba Cloud metadata
  "100.100.100.200",
]);

// --- Blocked hostname suffixes ---
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".example"];

// --- Private/reserved IP ranges ---
function isPrivateOrReservedIP(ip: string): boolean {
  // IPv4 checks
  if (/^127\./.test(ip)) return true;                              // Loopback (127.0.0.0/8)
  if (/^10\./.test(ip)) return true;                               // RFC 1918 (10.0.0.0/8)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;         // RFC 1918 (172.16.0.0/12)
  if (/^192\.168\./.test(ip)) return true;                         // RFC 1918 (192.168.0.0/16)
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip)) return true; // RFC 6598 shared (100.64.0.0/10)
  if (/^169\.254\./.test(ip)) return true;                         // Link-local (169.254.0.0/16)
  if (/^0\./.test(ip)) return true;                                // "This" network (0.0.0.0/8)
  if (/^192\.0\.0\./.test(ip)) return true;                        // IETF protocol assignments (192.0.0.0/24)
  if (/^198\.51\.100\./.test(ip)) return true;                     // Documentation (TEST-NET-2)
  if (/^203\.0\.113\./.test(ip)) return true;                      // Documentation (TEST-NET-3)
  if (/^(22[4-9]|23\d|24\d|25[0-5])\./.test(ip)) return true;    // Multicast + reserved (224.0.0.0/4+)

  // IPv6 checks
  if (ip === "::1" || ip === "::") return true;                    // Loopback + unspecified
  if (/^fe80:/i.test(ip)) return true;                             // Link-local (fe80::/10)
  if (/^fc00:/i.test(ip) || /^fd/i.test(ip)) return true;         // Unique local (fc00::/7)
  // IPv6-mapped IPv4: ::ffff:x.x.x.x or ::ffff:XXXX:XXXX (hex form)
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateOrReservedIP(v4mapped[1]);
  // Hex form: ::ffff:7f00:1 → convert to dotted decimal
  const v4hex = ip.match(/^\[?::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/i);
  if (v4hex) {
    const hi = parseInt(v4hex[1], 16), lo = parseInt(v4hex[2], 16);
    return isPrivateOrReservedIP(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  /** Resolved IP address (if DNS lookup succeeded) */
  resolvedIp?: string;
}

/**
 * Validate a URL for SSRF safety. Call this before making any request to a user-supplied URL.
 *
 * @param url - The URL string to validate
 * @param options.requireHttps - Require HTTPS protocol (default: true in production)
 * @param options.skipDnsCheck - Skip DNS resolution check (for unit tests or non-critical paths)
 */
export async function validateUrlForSSRF(
  url: string,
  options: { requireHttps?: boolean; skipDnsCheck?: boolean } = {},
): Promise<UrlValidationResult> {
  const requireHttps = options.requireHttps ?? (process.env.NODE_ENV === "production");

  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // 2. Protocol check
  if (requireHttps && parsed.protocol !== "https:") {
    return { valid: false, error: "Webhook URL must use HTTPS in production" };
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return { valid: false, error: "URL must use http:// or https://" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "URL targets a blocked host (localhost, metadata endpoint, or reserved address)" };
  }

  // 4. Blocked suffixes
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { valid: false, error: `URL hostname cannot end with ${suffix}` };
    }
  }

  // 5. Direct IP check (if hostname is already an IP)
  if (isPrivateOrReservedIP(hostname)) {
    return { valid: false, error: "URL targets a private or reserved IP range" };
  }

  // 6. DNS resolution check (prevents DNS rebinding attacks)
  if (!options.skipDnsCheck) {
    try {
      const result = await lookup(hostname, { all: true });
      for (const entry of result) {
        if (isPrivateOrReservedIP(entry.address)) {
          return {
            valid: false,
            error: `URL hostname resolves to private/reserved IP ${entry.address}`,
            resolvedIp: entry.address,
          };
        }
      }
      return { valid: true, resolvedIp: result[0]?.address };
    } catch (err) {
      // F3: a transient resolver failure (DNS server hiccup, ENOTFOUND
      // racing a fresh DNS record propagation) used to reject the URL,
      // which blackholed webhook config creation during DNS outages and
      // produced a fan-out of "URL hostname could not be resolved" errors
      // with no admin signal. Now we warn-and-allow: the prior layers
      // (blocklist + private/reserved IP) have already validated the
      // hostname/IP shape, and the actual fetch will fail at delivery time
      // if the host truly doesn't resolve. The webhook circuit breaker and
      // durable-retry queue handle the delivery-side failure gracefully.
      logger.warn("url-validator: DNS lookup failed, allowing URL (fetch-time will catch unresolvable hosts)", {
        hostname,
        error: (err as Error).message,
      });
      return { valid: true };
    }
  }

  return { valid: true };
}

/**
 * Synchronous URL validation (no DNS check). Use for quick pre-flight validation.
 * Always follow up with the full async validateUrlForSSRF before making a request.
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) return false;
    for (const suffix of BLOCKED_SUFFIXES) {
      if (hostname.endsWith(suffix)) return false;
    }
    if (isPrivateOrReservedIP(hostname)) return false;
    if (!["https:", "http:"].includes(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}
