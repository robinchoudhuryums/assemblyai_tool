import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

// Mock i18n
vi.mock("@/lib/i18n", () => ({
  getSavedLocale: () => "en",
  getTranslation: (_locale: string, key: string) => {
    const t: Record<string, string> = {
      "error.somethingWentWrong": "Something went wrong",
      "error.unexpectedError": "An unexpected error occurred",
      "error.tryAgain": "Try Again",
      "error.goToDashboard": "Go to Dashboard",
      "error.retriesFailed": "Multiple retries failed",
    };
    return t[key] || key;
  },
}));

// Suppress console.error for expected errors in tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});

afterEach(() => {
  console.error = originalError;
});

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error("Test error");
  return <div>Recovered content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Safe content")).toBeInTheDocument();
  });

  it("shows error UI when child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("has role='alert' on error state", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows Try Again button", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("shows Go to Dashboard button", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Go to Dashboard")).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("retry resets the error state", () => {
    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) throw new Error("Conditional error");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the error condition before retrying
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("shows retries failed message after max retries", () => {
    // Click Try Again 3 times (MAX_RETRIES = 3)
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    for (let i = 0; i < 3; i++) {
      const retryBtn = screen.queryByText("Try Again");
      if (retryBtn) fireEvent.click(retryBtn);
    }

    expect(screen.getByText("Multiple retries failed")).toBeInTheDocument();
    expect(screen.queryByText("Try Again")).not.toBeInTheDocument();
  });
});
