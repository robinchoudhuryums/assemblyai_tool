import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => {
      const t: Record<string, string> = {
        "error.pageNotFound": "404 Page Not Found",
        "error.pageNotFoundDesc": "The page you're looking for doesn't exist.",
      };
      return t[key] || key;
    },
  }),
}));

import NotFound from "./not-found";

describe("NotFound page", () => {
  it("renders the 404 heading", () => {
    render(<NotFound />);
    expect(screen.getByText("404 Page Not Found")).toBeInTheDocument();
  });

  it("renders the description text", () => {
    render(<NotFound />);
    expect(screen.getByText("The page you're looking for doesn't exist.")).toBeInTheDocument();
  });

  it("has role='alert' for accessibility", () => {
    render(<NotFound />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders the warning icon", () => {
    render(<NotFound />);
    // Phosphor icon is marked aria-hidden
    const icon = document.querySelector("svg");
    expect(icon).toBeTruthy();
  });
});
