import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/search", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/components/lib/error-boundary", () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/loading", () => ({
  LoadingIndicator: () => <div data-testid="loading">Loading...</div>,
}));

import SearchPage from "./search";
import { useQuery } from "@tanstack/react-query";

describe("SearchPage", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue({
      data: null, isLoading: false, error: null, refetch: vi.fn(),
    } as any);
  });

  it("renders the search input", () => {
    render(<SearchPage />);
    const input = screen.getByPlaceholderText(/search/i);
    expect(input).toBeInTheDocument();
  });

  it("renders filter controls", () => {
    render(<SearchPage />);
    // The page should have filter-related elements (select dropdowns, buttons)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no search performed", () => {
    render(<SearchPage />);
    // Empty state renders when neither search nor browse returns rows.
    // The warm-paper empty state has a distinct testid.
    expect(screen.queryByTestId("search-empty")).toBeInTheDocument();
  });

  it("shows loading state while fetching", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: null, isLoading: true, error: null, refetch: vi.fn(),
    } as any);
    render(<SearchPage />);
    // Component may show skeleton or loading indicator
    expect(screen.getByTestId("loading") || document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders without crashing when query returns data", () => {
    // SearchPage uses multiple useQuery calls (search results + employees list).
    // Return appropriate data for each.
    vi.mocked(useQuery).mockImplementation(((opts: any) => {
      const key = opts?.queryKey?.[0] || "";
      if (key === "/api/employees" || typeof key === "string" && key.includes("employee")) {
        return { data: [], isLoading: false, error: null, refetch: vi.fn() } as any;
      }
      return {
        data: { calls: [], pagination: { total: 0 } },
        isLoading: false, error: null, refetch: vi.fn(),
      } as any;
    }) as any);

    render(<SearchPage />);
    // Should render without throwing
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("updates search input on type", async () => {
    const user = userEvent.setup();
    render(<SearchPage />);

    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, "billing");
    expect(input).toHaveValue("billing");
  });
});
