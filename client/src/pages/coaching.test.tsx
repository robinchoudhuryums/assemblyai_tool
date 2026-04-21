/**
 * Phase B: coaching page tests.
 *
 * Exercises the new per-employee toggle, sub-score breakdown rendering,
 * and weekly sparkline visibility. Uses the same mock pattern as the
 * other page tests — useQuery is stubbed, wouter/i18n/toast are mocked,
 * and the heavy child components are stubbed out so the test can focus
 * on coaching.tsx's own rendering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/coaching", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  getCsrfToken: () => null,
}));

vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({ companyName: "Acme", appName: "CallAnalyzer" }),
}));

vi.mock("@/components/coaching/page-shell", () => ({
  default: ({ children }: any) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock("@/components/coaching/manager-board", () => ({
  default: () => <div data-testid="manager-board" />,
}));

vi.mock("@/components/coaching/detail-panel", () => ({
  default: () => null,
}));

vi.mock("@/components/coaching/assign-modal", () => ({
  default: () => null,
}));

import CoachingPage from "./coaching";
import { useQuery } from "@tanstack/react-query";

// Helper: mock useQuery per-key with typed fixtures for this page's queries.
function mockQueries(byKey: Record<string, unknown>) {
  vi.mocked(useQuery).mockImplementation(((opts: any) => {
    const key = Array.isArray(opts.queryKey) ? opts.queryKey.join("|") : String(opts.queryKey);
    // Prefix match: any queryKey that starts with a configured prefix wins.
    for (const prefix of Object.keys(byKey)) {
      if (key.startsWith(prefix)) {
        return { data: byKey[prefix], isLoading: false, error: null, refetch: vi.fn() } as any;
      }
    }
    return { data: null, isLoading: false, error: null, refetch: vi.fn() } as any;
  }) as any);
}

describe("CoachingPage (Phase B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing when no data", () => {
    mockQueries({});
    render(<CoachingPage />);
    expect(screen.getByTestId("page-shell")).toBeInTheDocument();
  });

  it("does not render the outcomes summary when no sessions measured", () => {
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 0,
        measured: 0,
        insufficientData: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        avgOverallDelta: null,
      },
    });
    render(<CoachingPage />);
    expect(screen.queryByTestId("coaching-outcomes-summary")).not.toBeInTheDocument();
  });

  it("renders the outcomes summary strip when measured > 0", () => {
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 10,
        measured: 6,
        insufficientData: 4,
        positiveCount: 4,
        neutralCount: 1,
        negativeCount: 1,
        avgOverallDelta: 0.42,
      },
    });
    render(<CoachingPage />);
    expect(screen.getByTestId("coaching-outcomes-summary")).toBeInTheDocument();
    expect(screen.getByText(/avg score delta/i)).toBeInTheDocument();
    expect(screen.getByText(/6 of 10 sessions measured/i)).toBeInTheDocument();
  });

  it("renders sub-score breakdown chips when avgSubDeltas is present", () => {
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 5,
        measured: 5,
        insufficientData: 0,
        positiveCount: 3,
        neutralCount: 1,
        negativeCount: 1,
        avgOverallDelta: 0.3,
        avgSubDeltas: {
          compliance: 0.4,
          customerExperience: -0.1,
          communication: 0.25,
          resolution: 0.0,
        },
      },
    });
    render(<CoachingPage />);
    expect(screen.getByText(/by sub-score/i)).toBeInTheDocument();
    expect(screen.getByText(/compliance/i)).toBeInTheDocument();
    expect(screen.getByText(/cust exp/i)).toBeInTheDocument();
    expect(screen.getByText(/communication/i)).toBeInTheDocument();
    expect(screen.getByText(/resolution/i)).toBeInTheDocument();
  });

  it("renders the weekly sparkline when timeSeries has ≥2 points with deltas", () => {
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 5,
        measured: 5,
        insufficientData: 0,
        positiveCount: 3,
        neutralCount: 1,
        negativeCount: 1,
        avgOverallDelta: 0.3,
        timeSeries: [
          { bucketStart: "2026-03-02", measured: 2, avgOverallDelta: 0.1 },
          { bucketStart: "2026-03-09", measured: 2, avgOverallDelta: 0.4 },
          { bucketStart: "2026-03-16", measured: 1, avgOverallDelta: 0.5 },
        ],
      },
    });
    render(<CoachingPage />);
    expect(screen.getByTestId("outcomes-sparkline")).toBeInTheDocument();
  });

  it("omits the sparkline when fewer than 2 measured weeks", () => {
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 1,
        measured: 1,
        insufficientData: 0,
        positiveCount: 1,
        neutralCount: 0,
        negativeCount: 0,
        avgOverallDelta: 0.5,
        timeSeries: [
          { bucketStart: "2026-03-02", measured: 1, avgOverallDelta: 0.5 },
        ],
      },
    });
    render(<CoachingPage />);
    expect(screen.queryByTestId("outcomes-sparkline")).not.toBeInTheDocument();
  });

  it("renders the By manager / By agent toggle and lets the user switch", async () => {
    const user = userEvent.setup();
    mockQueries({
      "/api/coaching/outcomes-summary|bucket=week": {
        windowDays: 90,
        totalSessions: 3,
        measured: 3,
        insufficientData: 0,
        positiveCount: 2,
        neutralCount: 0,
        negativeCount: 1,
        avgOverallDelta: 0.2,
      },
      "/api/coaching/outcomes-summary|groupBy=manager": {
        windowDays: 90,
        groupBy: "manager",
        overall: { measured: 3, avgOverallDelta: 0.2 },
        groups: [
          {
            key: "jane", label: "jane", totalSessions: 2, measured: 2, insufficientData: 0,
            positiveCount: 2, neutralCount: 0, negativeCount: 0, avgOverallDelta: 0.4,
          },
        ],
      },
      "/api/coaching/outcomes-summary|groupBy=employee": {
        windowDays: 90,
        groupBy: "employee",
        overall: { measured: 3, avgOverallDelta: 0.2 },
        groups: [
          {
            key: "emp-1", label: "Alice Smith", totalSessions: 1, measured: 1, insufficientData: 0,
            positiveCount: 1, neutralCount: 0, negativeCount: 0, avgOverallDelta: 0.6,
          },
        ],
      },
    });
    render(<CoachingPage />);
    expect(screen.getByTestId("outcomes-group-manager")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("outcomes-group-employee")).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByTestId("outcomes-group-employee"));
    expect(screen.getByTestId("outcomes-group-employee")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("outcomes-group-manager")).toHaveAttribute("aria-pressed", "false");
  });
});
