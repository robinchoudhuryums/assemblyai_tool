import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // On 401, redirect to login by clearing auth state
    if (res.status === 401) {
      window.location.reload();
      throw new Error("Session expired. Please log in again.");
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
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
// Replace your old getQueryFn with this new one
export const getQueryFn: <T>(options?: {
  on401?: "returnNull" | "throw";
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior = "throw" } = {}) =>
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
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: true,
      staleTime: 60000, // Data considered fresh for 1 minute
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});
