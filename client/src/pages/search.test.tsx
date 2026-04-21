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

  // Phase A: search mode toggle
  it("renders the keyword/semantic/hybrid mode toggle", () => {
    render(<SearchPage />);
    expect(screen.getByTestId("mode-keyword")).toBeInTheDocument();
    expect(screen.getByTestId("mode-semantic")).toBeInTheDocument();
    expect(screen.getByTestId("mode-hybrid")).toBeInTheDocument();
  });

  it("starts with keyword mode marked aria-pressed", () => {
    render(<SearchPage />);
    expect(screen.getByTestId("mode-keyword")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-semantic")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to semantic mode on click and toggles aria-pressed", async () => {
    const user = userEvent.setup();
    render(<SearchPage />);
    await user.click(screen.getByTestId("mode-semantic"));
    expect(screen.getByTestId("mode-semantic")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-keyword")).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals the alpha slider only in hybrid mode", async () => {
    const user = userEvent.setup();
    render(<SearchPage />);
    expect(screen.queryByTestId("hybrid-alpha-slider")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("mode-hybrid"));
    expect(screen.getByTestId("hybrid-alpha-slider")).toBeInTheDocument();
  });
});
