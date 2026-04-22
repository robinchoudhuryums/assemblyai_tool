/**
 * Tests for the KB embed trigger + drawer. We stub the TanStack Query
 * hook so we can flip the config shape per test without running a real
 * query client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

const useQueryMock = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

// Phosphor icons render as SVG; we stub to keep DOM predictable.
vi.mock("@phosphor-icons/react", () => ({
  Books: () => <span data-testid="ico-books" />,
  X: () => <span data-testid="ico-x" />,
  ChatCircleText: () => <span data-testid="ico-chat" />,
  ArrowCounterClockwise: () => <span data-testid="ico-reset" />,
}));

import { KnowledgeTrigger } from "./KnowledgeTrigger";
import { KnowledgeDrawer } from "./KnowledgeDrawer";

/**
 * jsdom ignores the `origin` field in MessageEvent, so we capture the
 * real registered listener via an addEventListener spy and invoke it
 * directly with a synthetic event object. This exercises the exact
 * handler the component runs in production.
 */
// Grab the real addEventListener once at module load, before any test
// spies on it. Bind to window so subsequent spies don't change `this`.
const realWindowAdd = window.addEventListener.bind(window);

function captureMessageListener(): (ev: {
  origin: string;
  data: unknown;
}) => void {
  let captured: ((ev: Event) => void) | null = null;
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "message") captured = listener as (ev: Event) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realWindowAdd(type, listener, opts as any);
    },
  );
  return (ev) => {
    if (!captured) throw new Error("no message listener captured");
    captured(ev as unknown as Event);
  };
}

beforeEach(() => {
  useQueryMock.mockReset();
});

describe("KnowledgeTrigger", () => {
  it("renders nothing when /api/config kb.enabled is false", () => {
    useQueryMock.mockReturnValue({
      data: { kb: { enabled: false, embedUrl: null } },
    });
    const { container } = render(<KnowledgeTrigger />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when /api/config has no kb field yet (loading state)", () => {
    useQueryMock.mockReturnValue({ data: undefined });
    const { container } = render(<KnowledgeTrigger />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the trigger button when kb is enabled", () => {
    useQueryMock.mockReturnValue({
      data: {
        kb: {
          enabled: true,
          embedUrl: "https://knowledge.umscallanalyzer.com/?embed=1",
        },
      },
    });
    render(<KnowledgeTrigger />);
    expect(screen.getByTestId("kb-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("kb-trigger")).toHaveTextContent("Ask KB");
  });

  it("toggles the drawer open on click", () => {
    useQueryMock.mockReturnValue({
      data: {
        kb: {
          enabled: true,
          embedUrl: "https://knowledge.umscallanalyzer.com/?embed=1",
        },
      },
    });
    render(<KnowledgeTrigger />);
    // Drawer closed initially
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kb-trigger"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Knowledge base chat");
    // Trigger's aria-expanded reflects open state
    expect(screen.getByTestId("kb-trigger")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("KnowledgeDrawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <KnowledgeDrawer
        open={false}
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders an iframe pointed at the embed URL when open", () => {
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    const frame = document.querySelector("iframe");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("src")).toBe(
      "https://knowledge.umscallanalyzer.com/?embed=1",
    );
    expect(frame?.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("fires onClose when the scrim is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KnowledgeDrawer
        open
        onClose={onClose}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    // The scrim is the first aria-hidden div.
    const scrim = container.querySelector('[aria-hidden="true"]');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores postMessage from a non-allowed origin", () => {
    const dispatch = captureMessageListener();
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    dispatch({ origin: "https://evil.example.com", data: { type: "embed:ready" } });
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("hides the loading state when embed:ready arrives from the iframe origin", () => {
    const dispatch = captureMessageListener();
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    act(() => {
      dispatch({
        origin: "https://knowledge.umscallanalyzer.com",
        data: { type: "embed:ready" },
      });
    });
    expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
  });

  it("fires Escape → onClose", () => {
    const onClose = vi.fn();
    render(
      <KnowledgeDrawer
        open
        onClose={onClose}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when RAG posts `embed:close`", () => {
    const dispatch = captureMessageListener();
    const onClose = vi.fn();
    render(
      <KnowledgeDrawer
        open
        onClose={onClose}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    dispatch({
      origin: "https://knowledge.umscallanalyzer.com",
      data: { type: "embed:close" },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens same-origin source URLs in a new tab on `embed:open-source`", () => {
    const dispatch = captureMessageListener();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    dispatch({
      origin: "https://knowledge.umscallanalyzer.com",
      data: {
        type: "embed:open-source",
        url: "https://knowledge.umscallanalyzer.com/api/documents/abc/download",
      },
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://knowledge.umscallanalyzer.com/api/documents/abc/download",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("refuses to open cross-origin URLs in `embed:open-source` (redirect-laundering guard)", () => {
    const dispatch = captureMessageListener();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    dispatch({
      origin: "https://knowledge.umscallanalyzer.com",
      data: {
        type: "embed:open-source",
        url: "https://evil.example.com/attack.pdf",
      },
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("refuses `embed:open-source` with a non-string url", () => {
    const dispatch = captureMessageListener();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <KnowledgeDrawer
        open
        onClose={() => {}}
        embedUrl="https://knowledge.umscallanalyzer.com/?embed=1"
      />,
    );
    dispatch({
      origin: "https://knowledge.umscallanalyzer.com",
      data: { type: "embed:open-source", url: 42 },
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
