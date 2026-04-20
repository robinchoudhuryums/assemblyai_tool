import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthPage from "./auth";

// Mock the modules that AuthPage imports
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Stub queryClient — A12 added a SessionExpiredError export that auth.tsx
// imports for the MFA error.code branch.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {
    code?: string;
    constructor(code?: string, message?: string) {
      super(message || "Session expired");
      this.name = "SessionExpiredError";
      if (code) this.code = code;
    }
  },
}));

// A27 made AuthPage call useConfig() to get COMPANY_NAME from /api/config.
// Stub the hook so we don't need a real QueryClientProvider in the test.
// The hook returns BOTH `companyName` (tenant name, used by AI prompts) AND
// `appName` (product brand, used in UI chrome like the login CardTitle).
// Both must be present or `auth.tsx` will render an empty CardTitle.
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({
    companyName: "UMS (United Medical Supply)",
    appName: "CallAnalyzer",
    scoring: {
      lowScoreThreshold: 4,
      highScoreThreshold: 9,
      streakScoreThreshold: 8,
      excellentThreshold: 8,
      goodThreshold: 6,
      needsWorkThreshold: 4,
    },
  }),
}));

describe("AuthPage", () => {
  const mockOnLogin = vi.fn();

  it("renders the login form with username and password fields", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows the Sign In button", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    // The tab button and the submit button both say "Sign In"
    const signInButtons = screen.getAllByText("Sign In");
    expect(signInButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the Request Access option", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    expect(screen.getByText("Request Access")).toBeInTheDocument();
  });

  it("renders the CallAnalyzer title", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    expect(screen.getByText("CallAnalyzer")).toBeInTheDocument();
  });

  it("shows the sign-in description by default", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    expect(
      screen.getByText("Sign in to access the call analysis dashboard")
    ).toBeInTheDocument();
  });

  it("renders the Permission Levels info card", () => {
    render(<AuthPage onLogin={mockOnLogin} />);

    expect(screen.getByText("Permission Levels")).toBeInTheDocument();
  });
});
