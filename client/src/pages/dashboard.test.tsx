import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─────────────────────────────────────────────────────────────
// Dashboard was rewritten in design theme installment 2 to route by role:
//   admin   → Ledger variant
//   manager → Pulse  variant
//   viewer  → navigate('/my-performance')
// These tests cover the role branch + loading state. The variant
// internals are mocked; they have their own integration coverage via
// the visual/manual pass on the real page.
// ─────────────────────────────────────────────────────────────

const navigateMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
  useLocation: () => ["/dashboard", navigateMock],
  useSearch: () => "",
}));

vi.mock("@/components/dashboard/ledger-variant", () => ({
  default: () => <div data-testid="ledger-variant">Ledger</div>,
}));
vi.mock("@/components/dashboard/pulse-variant", () => ({
  default: () => <div data-testid="pulse-variant">Pulse</div>,
}));

import Dashboard from "./dashboard";
import { useQuery } from "@tanstack/react-query";

function mockAuth(role: string | null, loading = false) {
  vi.mocked(useQuery).mockReturnValue({
    data: role ? { id: "u1", username: "u", role } : null,
    isLoading: loading,
    error: null,
    refetch: vi.fn(),
  } as any);
}

describe("Dashboard (role-routed)", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.clearAllMocks();
  });

  it("renders a placeholder while the auth query is loading", () => {
    mockAuth(null, true);
    render(<Dashboard />);
    const el = screen.getByTestId("dashboard-page");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-busy", "true");
  });

  it("renders the Ledger variant for admin", () => {
    mockAuth("admin");
    render(<Dashboard />);
    expect(screen.getByTestId("ledger-variant")).toBeInTheDocument();
    expect(screen.queryByTestId("pulse-variant")).not.toBeInTheDocument();
  });

  it("renders the Pulse variant for manager", () => {
    mockAuth("manager");
    render(<Dashboard />);
    expect(screen.getByTestId("pulse-variant")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-variant")).not.toBeInTheDocument();
  });

  it("redirects viewers to /my-performance", () => {
    mockAuth("viewer");
    render(<Dashboard />);
    expect(navigateMock).toHaveBeenCalledWith("/my-performance", { replace: true });
    expect(screen.queryByTestId("ledger-variant")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pulse-variant")).not.toBeInTheDocument();
  });

  it("defaults unrecognized roles to Pulse rather than Ledger", () => {
    mockAuth("support"); // not viewer/manager/admin
    render(<Dashboard />);
    expect(screen.getByTestId("pulse-variant")).toBeInTheDocument();
  });

  it("falls back to viewer redirect when no user is loaded", () => {
    mockAuth(null);
    render(<Dashboard />);
    expect(navigateMock).toHaveBeenCalledWith("/my-performance", { replace: true });
  });
});
