/**
 * Dashboard — LEDGER variant (admin / ops lead).
 *
 * Dense, newspaper-style ops desk. Masthead + tagline row + 4-stat row
 * with sparklines + AI briefing block + hourly sentiment curve + recent-calls
 * ledger table + rubric + performance leaderboard + right rail with
 * flagged / exemplars. Design reference:
 * `docs/design-bundle/project/v1-ledger.jsx`.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { CallWithDetails, DashboardMetrics, SentimentDistribution, PaginatedCalls } from "@shared/schema";
import {
  Avatar,
  RubricRack,
  SectionHeader,
  SentimentCurve,
  SentimentDot,
  StatBlock,
  type RubricValues,
} from "./primitives";
import {
  deriveHourlyCurve,
  extractExemplar,
  extractFlagged,
  formatClock,
  formatDuration,
  initialsFromName,
  safeAvg,
  type TopPerformer,
  type WeeklyChangesResponse,
  type HeatmapResponse,
} from "./variant-utils";

export default function LedgerVariant() {
  const { data: metrics } = useQuery<DashboardMetrics>({ queryKey: ["/api/dashboard/metrics"] });
  const { data: sentiment } = useQuery<SentimentDistribution>({ queryKey: ["/api/dashboard/sentiment"] });
  const { data: weekly } = useQuery<WeeklyChangesResponse>({ queryKey: ["/api/dashboard/weekly-changes"] });
  const { data: performers } = useQuery<TopPerformer[]>({ queryKey: ["/api/dashboard/performers"] });
  const { data: heatmap } = useQuery<HeatmapResponse>({ queryKey: ["/api/analytics/heatmap"] });
  const { data: callsResponse } = useQuery<PaginatedCalls>({ queryKey: ["/api/calls"] });

  const calls: CallWithDetails[] = callsResponse?.calls ?? [];
  const flagged = useMemo(() => extractFlagged(calls).slice(0, 5), [calls]);
  const exemplarBase = useMemo(() => {
    const out: CallWithDetails[] = [];
    for (const c of calls) {
      const flags = c.analysis?.flags;
      if (Array.isArray(flags) && flags.includes("exceptional_call")) out.push(c);
      if (out.length >= 3) break;
    }
    if (out.length === 0) {
      const fallback = extractExemplar(calls);
      if (fallback) out.push(fallback);
    }
    return out;
  }, [calls]);
  const curve = useMemo(() => deriveHourlyCurve(heatmap?.cells), [heatmap]);
  const recent = useMemo(() => recentCallsView(calls), [calls]);
  const rubric = useMemo<RubricValues>(() => deriveAverageRubric(calls), [calls]);
  const totalSentiment = (sentiment?.positive ?? 0) + (sentiment?.neutral ?? 0) + (sentiment?.negative ?? 0);
  const sentimentNet =
    totalSentiment > 0
      ? Math.round((((sentiment!.positive - sentiment!.negative) / totalSentiment) * 100)) / 100
      : 0;
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );
  const nowClock = useMemo(
    () =>
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [],
  );

  // Sparkline data for the 4 stat blocks (hourly volume / hourly avgScore / etc.).
  // If heatmap data isn't loaded yet, render flat sparklines to preserve layout.
  const volumeSpark = curve.volume.length > 0 ? curve.volume : new Array(12).fill(0);
  const sentimentSpark = curve.sentiment.map((v) => (v == null ? 0 : v));

  const scoreDelta = weekly?.scoreDelta ?? null;
  const flaggedDelta = weekly
    ? weekly.flags.lowScore.current - weekly.flags.lowScore.previous
    : null;

  return (
    <div className="bg-background text-foreground font-sans min-h-full">
      {/* Masthead */}
      <div
        style={{
          borderBottom: "2px solid var(--foreground)",
          padding: "22px 44px 18px",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Daily Call Ledger · Ops Desk
          </div>
          <div
            className="font-display font-medium mt-0.5"
            style={{ fontSize: 44, letterSpacing: "-1.5px", lineHeight: 1 }}
          >
            Operations Desk
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="font-mono text-[11px] text-muted-foreground">
            {todayLabel} · {nowClock}
          </div>
          <div className="font-mono text-[11px] text-foreground mt-0.5">Admin view</div>
        </div>
      </div>

      {/* Tagline row */}
      <div
        className="font-mono text-[11px] text-muted-foreground"
        style={{
          display: "flex",
          gap: 32,
          padding: "10px 44px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <span>
          <span className="text-foreground font-medium">{metrics?.totalCalls ?? 0}</span> calls total
        </span>
        <span>
          Avg duration <span className="text-foreground">{formatDuration(metrics?.avgTranscriptionTime ?? null)}</span>
        </span>
        <span>
          Flagged <span className="text-foreground">{weekly?.flags?.lowScore?.current ?? 0}</span>
        </span>
        <span style={{ marginLeft: "auto" }}>
          Last sync <span className="text-foreground">{nowClock}</span>
        </span>
      </div>

      <div
        style={{
          padding: "28px 44px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: 40,
        }}
      >
        {/* LEFT — main content */}
        <div>
          {/* Four stats across */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 32,
              paddingBottom: 24,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <StatBlock
              label="Calls · 24h"
              value={(metrics?.totalCalls ?? 0).toString()}
              spark={volumeSpark}
              sparkColor="var(--accent)"
            />
            <StatBlock
              label="Team score"
              value={(metrics?.avgPerformanceScore ?? 0).toFixed(1)}
              unit="/10"
              delta={scoreDelta ?? undefined}
              spark={sentimentSpark.map((v) => 5 + v * 5)}
              sparkColor="var(--accent)"
            />
            <StatBlock
              label="Sentiment"
              value={(sentimentNet >= 0 ? "+" : "") + sentimentNet.toFixed(2)}
              delta={weekly?.positiveDelta != null ? Math.round((weekly.positiveDelta / 100) * 100) / 100 : undefined}
              spark={sentimentSpark}
              sparkColor="var(--chart-2)"
            />
            <StatBlock
              label="Flagged"
              value={String(weekly?.flags?.lowScore?.current ?? 0)}
              unit="calls"
              delta={flaggedDelta != null ? -flaggedDelta : undefined}
              spark={sentimentSpark.map((v) => Math.max(0, -v * 10))}
              sparkColor="var(--destructive)"
            />
          </div>

          {/* AI briefing */}
          {weekly?.narrative && (
            <div
              style={{
                padding: "24px 0",
                borderBottom: "1px solid var(--border)",
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                gap: 24,
              }}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground pt-1">
                AI briefing
                <div className="text-[9px] mt-1 text-muted-foreground">Claude · {nowClock}</div>
              </div>
              <div>
                <div
                  className="font-display text-foreground"
                  style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.4, letterSpacing: "-0.01em" }}
                >
                  {weekly.narrative}
                </div>
              </div>
            </div>
          )}

          {/* Sentiment curve */}
          <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
            <SectionHeader kicker="Last 7 days · hourly rollup" title="Sentiment & volume curve" />
            <SentimentCurve sentiment={curve.sentiment} volume={curve.volume} width={820} height={180} />
            <div
              className="font-mono text-[10px] text-muted-foreground"
              style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}
            >
              <span>— sentiment (score→[-1,+1])</span>
              <span>▪ volume (calls/hr across window)</span>
            </div>
          </div>

          {/* Recent calls */}
          <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
            <SectionHeader kicker="Ledger" title="Most recent · 6 calls" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Time", "Agent", "Category", "Sent.", "Score", "Dur", "Flag"].map((h) => (
                    <th
                      key={h}
                      className="font-mono uppercase text-muted-foreground"
                      style={{
                        textAlign: "left",
                        fontWeight: 400,
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        padding: "8px 8px 8px 0",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-[13px] text-muted-foreground" style={{ padding: "16px 0" }}>
                      No recent calls.
                    </td>
                  </tr>
                )}
                {recent.map((c) => {
                  const score = parseFloat(c.analysis?.performanceScore || "0");
                  const scoreColor =
                    score < 7 ? "var(--destructive)" : score >= 9 ? "var(--chart-2)" : "var(--foreground)";
                  const sentimentKind = (c.sentiment?.overallSentiment || "neutral") as
                    | "positive"
                    | "negative"
                    | "neutral";
                  const flags = Array.isArray(c.analysis?.flags) ? (c.analysis!.flags as string[]) : [];
                  return (
                    <tr key={c.id} style={{ borderBottom: "1px dashed var(--border)" }}>
                      <td style={tdMono()}>{formatClock(c.uploadedAt)}</td>
                      <td style={{ ...td(), display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar initials={initialsFromName(c.employee?.name)} size={22} />
                        <Link href={`/transcripts/${c.id}`}>
                          <a style={{ textDecoration: "none", color: "inherit" }}>
                            {c.employee?.name || "Unassigned"}
                          </a>
                        </Link>
                      </td>
                      <td style={td()}>
                        <span
                          className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                          style={{ border: "1px solid var(--border)", padding: "2px 6px" }}
                        >
                          {c.callCategory || "—"}
                        </span>
                      </td>
                      <td style={td()}>
                        <SentimentDot kind={sentimentKind} />
                      </td>
                      <td style={{ ...tdMono(), color: scoreColor }}>{Number.isFinite(score) ? score.toFixed(1) : "—"}</td>
                      <td style={tdMono()}>{formatDuration(c.duration ?? null)}</td>
                      <td style={td()}>
                        {flags.includes("exceptional_call") && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={tagStyle("var(--chart-2)")}>
                            ★ exemplar
                          </span>
                        )}
                        {flags.some((f) => f === "low_score" || f.startsWith("agent_misconduct")) && (
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={tagStyle("var(--destructive)")}>
                            needs review
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rubric + leaderboard */}
          <div
            style={{
              padding: "24px 0",
              display: "grid",
              gridTemplateColumns: "1fr 1.2fr",
              gap: 48,
            }}
          >
            <div>
              <SectionHeader kicker="Team rubric · today" title="Scoring breakdown" />
              <RubricRack rubric={rubric} />
            </div>
            <div>
              <SectionHeader kicker="Agents · today" title="Performance board" />
              <div>
                {(performers ?? []).slice(0, 8).map((e, i, arr) => {
                  const score = Number(e.avgPerformanceScore ?? e.score ?? 0);
                  return (
                    <div
                      key={e.id ?? i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "18px 1fr 90px 56px",
                        gap: 12,
                        alignItems: "center",
                        padding: "10px 0",
                        borderBottom: i < arr.length - 1 ? "1px dashed var(--border)" : "none",
                      }}
                    >
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <Avatar initials={initialsFromName(e.name)} size={24} />
                        <div style={{ minWidth: 0 }}>
                          <div className="text-[13px] font-medium truncate">{e.name || "—"}</div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground truncate">
                            {e.role || "—"}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          background: "var(--secondary)",
                          height: 6,
                          overflow: "hidden",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div
                          className="score-bar-fill"
                          style={{
                            height: "100%",
                            width: `${Math.min(100, Math.max(0, score * 10))}%`,
                            background:
                              score < 7 ? "var(--destructive)" : score >= 9 ? "var(--chart-2)" : "var(--accent)",
                          }}
                        />
                      </div>
                      <div
                        className="font-mono text-[12px] font-medium tabular-nums"
                        style={{ textAlign: "right" }}
                      >
                        {score.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
                {(!performers || performers.length === 0) && (
                  <div className="text-[13px] text-muted-foreground py-3">No performers yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT rail */}
        <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 32 }}>
          <SectionHeader kicker="Attention" title="Flagged calls" />
          {flagged.length === 0 ? (
            <div className="text-[13px] text-muted-foreground pb-4">Nothing flagged right now.</div>
          ) : (
            flagged.map((f) => {
              const score = parseFloat(f.analysis?.performanceScore || "0");
              return (
                <div key={f.id} style={{ padding: "12px 0", borderBottom: "1px dashed var(--border)" }}>
                  <Link href={`/transcripts/${f.id}`}>
                    <a style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <div className="text-[13px] font-medium">{f.employee?.name || "Unassigned"}</div>
                        <div className="font-mono text-[12px] font-medium" style={{ color: "var(--destructive)" }}>
                          {Number.isFinite(score) ? score.toFixed(1) : "—"}
                        </div>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                        {truncate(f.analysis?.summary ? String(f.analysis.summary) : "Flagged for review", 120)}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1.5" style={{ display: "flex", gap: 10 }}>
                        <span>{f.callCategory || "call"}</span>
                        <span>·</span>
                        <span>{formatDuration(f.duration ?? null)}</span>
                        <span>·</span>
                        <span>{formatClock(f.uploadedAt)}</span>
                        <span className="ml-auto" style={{ color: "var(--accent)", marginLeft: "auto" }}>
                          open ↗
                        </span>
                      </div>
                    </a>
                  </Link>
                </div>
              );
            })
          )}

          <div style={{ height: 28 }} />
          <SectionHeader kicker="Exemplars" title="Share in coaching" />
          {exemplarBase.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">No exemplar calls this period.</div>
          ) : (
            exemplarBase.map((f) => {
              const score = parseFloat(f.analysis?.performanceScore || "0");
              return (
                <div key={f.id} style={{ padding: "12px 0", borderBottom: "1px dashed var(--border)" }}>
                  <Link href={`/transcripts/${f.id}`}>
                    <a style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <div className="text-[13px] font-medium">{f.employee?.name || "Unassigned"}</div>
                        <div className="font-mono text-[12px] font-medium" style={{ color: "var(--chart-2)" }}>
                          {Number.isFinite(score) ? score.toFixed(1) : "—"}
                        </div>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                        {truncate(f.analysis?.summary ? String(f.analysis.summary) : "Exemplary handling", 120)}
                      </div>
                    </a>
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Local helpers / style tokens
// ───────────────────────────────────────────────────────────
function td(): React.CSSProperties {
  return { padding: "10px 8px 10px 0", fontSize: 13, color: "var(--foreground)" };
}
function tdMono(): React.CSSProperties {
  return {
    ...td(),
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
    fontSize: 12,
  };
}
function tagStyle(color: string): React.CSSProperties {
  return {
    color,
    borderColor: color,
    border: "1px solid",
    padding: "2px 6px",
    marginRight: 4,
  };
}
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function recentCallsView(calls: CallWithDetails[]): CallWithDetails[] {
  return [...calls]
    .filter((c) => c.status === "completed")
    .sort((a, b) => {
      const at = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const bt = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, 6);
}

function deriveAverageRubric(calls: CallWithDetails[]): RubricValues {
  const acc = {
    compliance: [] as number[],
    customerExperience: [] as number[],
    communication: [] as number[],
    resolution: [] as number[],
  };
  for (const c of calls) {
    const s = c.analysis?.subScores as Record<string, unknown> | undefined;
    if (!s) continue;
    const push = (key: keyof RubricValues, raw: unknown) => {
      const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
      if (Number.isFinite(n)) acc[key].push(n);
    };
    push("compliance", s.compliance);
    push("customerExperience", s.customerExperience);
    push("communication", s.communication);
    push("resolution", s.resolution);
  }
  return {
    compliance: safeAvg(acc.compliance),
    customerExperience: safeAvg(acc.customerExperience),
    communication: safeAvg(acc.communication),
    resolution: safeAvg(acc.resolution),
  };
}
