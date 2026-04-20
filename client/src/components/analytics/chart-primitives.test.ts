import { describe, it, expect } from "vitest";
import {
  scoreTierColor,
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
  CHART_GRID_STROKE,
  SENTIMENT_COLOR,
} from "./chart-primitives";

// ─────────────────────────────────────────────────────────────
// Lifted from inline definitions in pages/reports.tsx (installment 9).
// scoreTierColor previously had no test coverage — its tier breakpoints
// are load-bearing for the warm-paper score color across CallsTable,
// CallsPreviewRail, Reports MetricCard, and (soon) the analytics pages.
// Locking the breakpoints here keeps drift visible.
// ─────────────────────────────────────────────────────────────
describe("scoreTierColor", () => {
  it("returns muted-foreground for null", () => {
    expect(scoreTierColor(null)).toBe("var(--muted-foreground)");
  });

  it("returns muted-foreground for undefined", () => {
    expect(scoreTierColor(undefined)).toBe("var(--muted-foreground)");
  });

  it("returns sage at the EXCELLENT breakpoint (8.0)", () => {
    expect(scoreTierColor(8)).toBe("var(--sage)");
    expect(scoreTierColor(8.5)).toBe("var(--sage)");
    expect(scoreTierColor(10)).toBe("var(--sage)");
  });

  it("returns foreground at the GOOD breakpoint (6.0) up to but not including EXCELLENT", () => {
    expect(scoreTierColor(6)).toBe("var(--foreground)");
    expect(scoreTierColor(7.9)).toBe("var(--foreground)");
  });

  it("returns accent (copper) at the NEEDS_WORK breakpoint (4.0) up to but not including GOOD", () => {
    expect(scoreTierColor(4)).toBe("var(--accent)");
    expect(scoreTierColor(5.9)).toBe("var(--accent)");
  });

  it("returns destructive below the NEEDS_WORK breakpoint", () => {
    expect(scoreTierColor(3.9)).toBe("var(--destructive)");
    expect(scoreTierColor(0)).toBe("var(--destructive)");
  });
});

describe("chart styling constants", () => {
  it("CHART_TICK uses mono font with 10px size", () => {
    expect(CHART_TICK).toMatchObject({
      fontSize: 10,
      fontFamily: "var(--font-mono)",
      fill: "var(--muted-foreground)",
    });
  });

  it("CHART_TOOLTIP renders on the paper-card surface with hairline border", () => {
    expect(CHART_TOOLTIP.background).toBe("var(--card)");
    expect(CHART_TOOLTIP.border).toBe("1px solid var(--border)");
    expect(CHART_TOOLTIP.borderRadius).toBe(2);
  });

  it("CHART_LEGEND uses mono uppercase typography", () => {
    expect(CHART_LEGEND.fontFamily).toBe("var(--font-mono)");
    expect(CHART_LEGEND.textTransform).toBe("uppercase");
  });

  it("CHART_GRID_STROKE matches the hairline border token", () => {
    expect(CHART_GRID_STROKE).toBe("var(--border)");
  });

  it("SENTIMENT_COLOR maps tones to warm-paper palette tokens", () => {
    expect(SENTIMENT_COLOR.positive).toBe("var(--sage)");
    expect(SENTIMENT_COLOR.neutral).toBe("var(--muted-foreground)");
    expect(SENTIMENT_COLOR.negative).toBe("var(--destructive)");
  });
});
