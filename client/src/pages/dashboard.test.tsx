import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock all external dependencies
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null, refetch: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => {
      const translations: Record<string, string> = {
        "dashboard.title": "Dashboard",
        "dashboard.subtitle": "Overview of call analytics",
        "sentiment.title": "Sentiment Analysis",
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("recharts", () => ({
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  Legend: () => null,
}));

// Mock child components to isolate dashboard tests
vi.mock("@/components/dashboard/metrics-overview", () => ({
  default: () => <div data-testid="metrics-overview">MetricsOverview</div>,
}));
vi.mock("@/components/dashboard/sentiment-analysis", () => ({
  default: () => <div data-testid="sentiment-analysis">SentimentAnalysis</div>,
}));
vi.mock("@/components/dashboard/performance-card", () => ({
  default: () => <div data-testid="performance-card">PerformanceCard</div>,
}));
vi.mock("@/components/dashboard/weekly-changes", () => ({
  default: () => <div data-testid="weekly-changes">WeeklyChanges</div>,
}));
vi.mock("@/components/upload/file-upload", () => ({
  default: () => <div data-testid="file-upload">FileUpload</div>,
}));
vi.mock("@/components/tables/calls-table", () => ({
  default: () => <div data-testid="calls-table">CallsTable</div>,
}));

import Dashboard from "./dashboard";
import { useQuery } from "@tanstack/react-query";

describe("Dashboard", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue({
      data: null, isLoading: false, error: null, refetch: vi.fn(),
      dataUpdatedAt: 0, errorUpdatedAt: 0, failureCount: 0, failureReason: null,
      fetchStatus: "idle", isError: false, isFetched: true, isFetchedAfterMount: true,
      isFetching: false, isInitialLoading: false, isLoadingError: false, isPaused: false,
      isPending: false, isPlaceholderData: false, isRefetchError: false, isRefetching: false,
      isStale: false, isSuccess: true, status: "success", errorUpdateCount: 0,
      promise: Promise.resolve(null),
    } as any);
    localStorage.clear();
  });

  it("renders the dashboard title", () => {
    render(<Dashboard />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders the data-testid", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
  });

  it("shows empty state when calls loaded but empty", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { calls: [], pagination: { total: 0 } },
      isLoading: false, error: null, refetch: vi.fn(),
    } as any);
    render(<Dashboard />);
    expect(screen.getByText("No calls analyzed yet")).toBeInTheDocument();
  });

  it("renders child widget components", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("metrics-overview")).toBeInTheDocument();
    expect(screen.getByTestId("sentiment-analysis")).toBeInTheDocument();
    expect(screen.getByTestId("performance-card")).toBeInTheDocument();
    expect(screen.getByTestId("file-upload")).toBeInTheDocument();
    expect(screen.getByTestId("calls-table")).toBeInTheDocument();
  });

  it("shows widget config panel when gear icon clicked", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    // Find the settings/gear button (may have different labels)
    const gearButton = screen.getByRole("button", { name: /customize|widget|settings|gear/i });
    await user.click(gearButton);

    // Widget labels should appear in config panel
    expect(screen.getByText("Metrics Overview")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    render(<Dashboard />);
    // Dashboard has navigation links to upload and search
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
  });

  it("shows flagged calls banner when bad calls exist", () => {
    const mockCalls = [
      {
        id: "1", status: "completed", fileName: "test.mp3",
        analysis: { performanceScore: "2.0", flags: ["low_score"] },
        employee: { name: "Agent Smith" },
      },
    ];
    vi.mocked(useQuery).mockReturnValue({
      data: { calls: mockCalls, pagination: { total: 1 } },
      isLoading: false, error: null, refetch: vi.fn(),
    } as any);

    render(<Dashboard />);
    expect(screen.getByText(/Need Attention/)).toBeInTheDocument();
  });
});
