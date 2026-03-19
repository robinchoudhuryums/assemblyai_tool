import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthPage from "./auth";

// Mock the modules that AuthPage imports
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
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
