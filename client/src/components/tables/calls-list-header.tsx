/**
 * Calls list page header (warm-paper installment 6, phase 1).
 *
 * Renders the top-of-page chrome for the Calls list (`/transcripts` list
 * mode): app bar with breadcrumbs + Export CSV + Upload CTAs, summary
 * ticker ("N calls · last 7 days" + AVG / positive / negative / flagged
 * / needs-review / total minutes), and a saved-views pill row.
 *
 * Phase 1 scope is visual — the saved-views pills set a local state that
 * isn't yet wired to the CallsTable below. Phase 2 refactors CallsTable
 * to accept filters as props so the new filter UI can drive it. The
 * summary ticker IS live (computed from the same /api/calls query
 * CallsTable uses; TanStack Query dedupes).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CallWithDetails, PaginatedCalls } from "@shared/schema";
import { SCORE_EXCELLENT, SCORE_GOOD } from "@/lib/constants";

type SavedView = "all" | "needs_review" | "low_score" | "exemplars" | "negative";

const SAVED_VIEWS: Array<{ id: SavedView; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "low_score", label: "Low score" },
  { id: "exemplars", label: "Exemplars" },
  { id: "negative", label: "Negative" },
];

export default function CallsListHeader() {
  const [activeView, setActiveView] = useState<SavedView>("all");

  // Same query key CallsTable uses — TanStack dedupes so this is free.
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls"],
  });

  const calls: CallWithDetails[] = callsResponse?.calls ?? [];
  const summary = useMemo(() => deriveSummary(calls), [calls]);

  return (
    <>
      {/* App bar */}
      <div
        className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Calls</span>
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          disabled
          title="CSV export — coming in a later phase"
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <DownloadSimple style={{ width: 12, height: 12 }} />
          Export CSV
        </button>
        <Link
          href="/upload"
          className="font-mono uppercase inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1.5 text-[var(--paper)] bg-primary border-primary hover:opacity-90 transition-opacity"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <UploadSimple style={{ width: 12, height: 12 }} />
          Upload
        </Link>
      </div>

      {/* Page header + summary ticker */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          All calls · latest
        </div>
        <div className="flex items-baseline gap-5 mt-1 flex-wrap">
          <div
            className="font-display font-medium text-foreground"
            style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
          >
            {summary.count} {summary.count === 1 ? "call" : "calls"}
          </div>
          <div
            className="font-mono text-muted-foreground flex items-center gap-5 flex-wrap"
            style={{ fontSize: 12 }}
          >
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">AVG</span>
              <span
                className="tabular-nums text-foreground font-semibold"
              >
                {summary.avg !== null ? summary.avg.toFixed(1) : "—"}
              </span>
            </span>
            <TickerItem label={`${summary.positive} pos`} />
            <TickerItem label={`${summary.negative} neg`} />
            <span className="text-muted-foreground/40">|</span>
            <TickerItem label={`${summary.flagged} flagged`} />
            <TickerItem
              label={`${summary.needsReview} need review`}
              warn={summary.needsReview > 0}
            />
            <span className="text-muted-foreground/40">|</span>
            <TickerItem label={`${summary.totalMin} min reviewed`} />
          </div>
        </div>
      </div>

      {/* Saved-views pills (visual only in phase 1) */}
      <div
        className="flex items-center gap-2 px-7 py-3 bg-background border-b border-border flex-wrap"
      >
        {SAVED_VIEWS.map((v) => {
          const active = activeView === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setActiveView(v.id)}
              className="font-mono uppercase rounded-sm transition-colors"
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                padding: "6px 10px",
                border: `1px solid ${active ? "var(--foreground)" : "var(--border)"}`,
                background: active ? "var(--foreground)" : "var(--card)",
                color: active ? "var(--background)" : "var(--foreground)",
              }}
              data-testid={`saved-view-${v.id}`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

function TickerItem({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <span
      className="tabular-nums"
      style={{ color: warn ? "var(--destructive)" : "var(--muted-foreground)" }}
    >
      {label}
    </span>
  );
}

interface CallsSummary {
  count: number;
  avg: number | null;
  positive: number;
  negative: number;
  flagged: number;
  needsReview: number;
  totalMin: number;
}

function deriveSummary(calls: CallWithDetails[]): CallsSummary {
  let scoreSum = 0;
  let scoreCount = 0;
  let positive = 0;
  let negative = 0;
  let flagged = 0;
  let needsReview = 0;
  let totalSec = 0;

  for (const c of calls) {
    const score = c.analysis?.performanceScore ? Number(c.analysis.performanceScore) : null;
    if (score !== null && Number.isFinite(score)) {
      scoreSum += score;
      scoreCount++;
      // Needs review = confidence low OR score below SCORE_GOOD — same rule
      // the existing CallsTable surfaces as the "Needs Review" badge.
      if (score < SCORE_GOOD) needsReview++;
    }
    if (c.sentiment?.overallSentiment === "positive") positive++;
    if (c.sentiment?.overallSentiment === "negative") negative++;
    const flags = c.analysis?.flags;
    if (Array.isArray(flags) && flags.length > 0) flagged++;
    if (typeof c.duration === "number") totalSec += c.duration;
  }

  return {
    count: calls.length,
    avg: scoreCount > 0 ? scoreSum / scoreCount : null,
    positive,
    negative,
    flagged,
    needsReview,
    totalMin: Math.round(totalSec / 60),
  };
}

// Re-export SCORE_EXCELLENT so the header can be self-contained if
// future consumers want the "exemplar" tier signal in a tooltip. No
// current caller uses it but keeps parity with the CallsTable imports.
export { SCORE_EXCELLENT };
