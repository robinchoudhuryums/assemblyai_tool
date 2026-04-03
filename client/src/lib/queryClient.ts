import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_STALE_TIME_MS } from "@/lib/constants";

/** Read the CSRF token from the double-submit cookie set by the server. */
export function getCsrfToken(): string | undefined {
  const match = document.cookie.split(";").map(s => s.trim()).find(s => s.startsWith("csrf_token="));
  return match ? match.slice("csrf_token=".length) : undefined;
}

/** Sentinel error so components can distinguish session expiry from real errors. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired. Please log in again.");
    this.name = "SessionExpiredError";
  }
}

/**
 * Prevents multiple simultaneous auth invalidations when several
 * queries fail with 401 at the same time.
 */
let sessionExpired = false;

/** Tracks whether we've ever had an authenticated session in this page load. */
let hadSession = false;

/** Timestamp of last successful login — used to suppress transient 401s during login transition. */
let lastLoginAt = 0;

/** Grace period after login during which transient 401s don't trigger "session expired" toast. */
const LOGIN_GRACE_MS = 5000;

/** Called after successful login to reset the flag. */
export function resetSessionExpired() {
  sessionExpired = false;
  hadSession = true;
  lastLoginAt = Date.now();
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Server-side errors (502/503/504) — app is down or restarting, not a session issue
    if (res.status >= 502 && res.status <= 504) {
      throw new Error("Server is temporarily unavailable. Please try again in a moment.");
    }
    // On 401, clear auth cache so AuthenticatedApp renders login page.
    // No full page reload — just invalidate the auth query.
    if (res.status === 401) {
      // Skip session-expired handling during the grace period after login —
      // queries that fire immediately after login may get transient 401s
      // before the session cookie fully propagates.
      if (lastLoginAt && Date.now() - lastLoginAt < LOGIN_GRACE_MS) {
        throw new SessionExpiredError();
      }
      if (!sessionExpired) {
        sessionExpired = true;
        queryClient.setQueryData(["/api/auth/me"], null);
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        // Only show "Session Expired" toast if user was previously logged in.
        // On fresh page load with no session, just silently show login page.
        if (hadSession) {
          toast({
            title: "Session Expired",
            description: "You've been signed out due to inactivity. Please log in again.",
            variant: "destructive",
          });
        }
      }
      throw new SessionExpiredError();
    }
    let text: string;
    try {
      const body = await res.json();
      text = body.message || res.statusText;
    } catch {
      text = (await res.text().catch(() => "")) || res.statusText;
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  // Double-submit CSRF: echo the server-set cookie value in a custom header
  const csrf = getCsrfToken();
  if (csrf) headers["x-csrf-token"] = csrf;

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

/**
 * Create a queryFn for TanStack Query with configurable 401 handling.
 *
 * IMPORTANT: The default is "returnNull" — background data queries silently return
 * null on 401 instead of triggering session expiry. Only the auth check in
 * AuthenticatedApp should use "throw" (and it uses on401: "returnNull" anyway).
 *
 * This default prevents any single query from killing the user's session.
 * Session expiry is handled exclusively by the /api/auth/me query.
 */
export const getQueryFn: <T>(options?: {
  on401?: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior = "returnNull" } = {}) =>
  async ({ queryKey }) => {
    // The first part of the key is always the base URL
    let url = queryKey[0] as string;
    const params = queryKey.length > 1 ? queryKey[1] : undefined;

    // Check if the second part is for a specific ID or for query parameters
    if (params) {
      if (typeof params === 'object' && params !== null) {
        // It's an object for query parameters (like in your table)
        // Filters out empty string values
        const filteredParams = Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== '')
        );
        const searchParams = new URLSearchParams(filteredParams as Record<string, string>);
        const queryString = searchParams.toString();
        if (queryString) {
          url += `?${queryString}`;
        }
      } else {
        // It's an ID for a specific resource (like in your transcript viewer)
        url += `/${params}`;
      }
    }

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchOnWindowFocus: true,
      staleTime: DEFAULT_STALE_TIME_MS, // Data considered fresh for 1 minute
      retry: (failureCount, error) => {
        // Never retry on session expiry
        if (error instanceof SessionExpiredError) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
