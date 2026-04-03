import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => {
      const t: Record<string, string> = {
        "call.unknown": "Unknown",
        "call.unassigned": "Unassigned",
        "call.na": "N/A",
        "call.viewDetails": "View Details",
        "status.processing": "Processing...",
      };
      return t[key] || key;
    },
  }),
}));

import { CallCard } from "./call-card";

const baseCall = {
  id: "test-id-123",
  fileName: "test-call.mp3",
  status: "completed" as const,
  uploadedAt: "2026-04-01T12:00:00Z",
  duration: 185,
  employee: { id: "emp-1", name: "Jane Doe", initials: "JD", role: "Agent", status: "Active" as const },
  transcript: { id: "t-1", callId: "test-id-123", text: "Hello, how can I help you today? I need to order supplies." },
  sentiment: { id: "s-1", callId: "test-id-123", overallSentiment: "positive", overallScore: 0.8 },
  analysis: { id: "a-1", callId: "test-id-123", performanceScore: "8.5", flags: [] },
};

describe("CallCard", () => {
  it("renders the employee name", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("renders employee initials", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("shows Unassigned when no employee", () => {
    const noEmployee = { ...baseCall, employee: undefined };
    render(<CallCard call={noEmployee as any} index={0} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("formats duration correctly", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    // 185 seconds = 3m 5s
    expect(screen.getByText(/3m 5s/)).toBeInTheDocument();
  });

  it("renders sentiment badge", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    expect(screen.getByText("Positive")).toBeInTheDocument();
  });

  it("renders status badge for completed calls", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders transcript preview text", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    expect(screen.getByText(/Hello, how can I help/)).toBeInTheDocument();
  });

  it("renders View Details link for completed calls", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/transcripts/test-id-123");
  });

  it("shows processing state for in-progress calls", () => {
    const processing = { ...baseCall, status: "processing" };
    render(<CallCard call={processing as any} index={0} />);
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("shows processing state for awaiting_analysis calls", () => {
    const awaiting = { ...baseCall, status: "awaiting_analysis" };
    render(<CallCard call={awaiting as any} index={0} />);
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("renders date from uploadedAt", () => {
    render(<CallCard call={baseCall as any} index={0} />);
    // The date should be rendered in some format
    expect(screen.getByText(/4\/1\/2026|Apr.*2026|2026/)).toBeInTheDocument();
  });
});
