/**
 * Dashboard — PULSE variant (manager / supervisor).
 *
 * Viz-led layout. Hero score + hero sentiment curve, followed by a
 * 3-column card row (rubric breakdown / exemplar call / needs review)
 * and an agents-today table. Design reference:
 * `docs/design-bundle/project/v2-pulse.jsx`.
 *
 * Data sources:
 *  - `/api/dashboard/metrics` → hero score + rubric sub-scores
 *  - `/api/dashboard/weekly-changes` → AI briefing paragraph + score deltas
 *  - `/api/dashboard/performers` → agents table
 *  - `/api/analytics/heatmap` → hourly volume + avg-score proxy for sentiment curve
 *  - `/api/calls` → flagged + exemplar calls
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { CallWithDetails, DashboardMetrics, PaginatedCalls, Employee } from "@shared/schema";
import {
  Avatar,
  PulseCard,
  RubricRack,
  ScoreDial,
  SentimentCurve,
  type RubricValues,
} from "./primitives";
import {
  deriveHourlyCurve,
  extractExemplar,
  extractFlagged,
  initialsFromName,
  safeAvg,
  type TopPerformer,
  type WeeklyChangesResponse,
  type HeatmapResponse,
} from "./variant-utils";

export default function PulseVariant() {
  const { data: metrics } = useQuery<DashboardMetrics>({ queryKey: ["/api/dashboard/metrics"] });
  const { data: weekly } = useQuery<WeeklyChangesResponse>({ queryKey: ["/api/dashboard/weekly-changes"] });
  const { data: performers } = useQuery<TopPerformer[]>({ queryKey: ["/api/dashboard/performers"] });
  const { data: heatmap } = useQuery<HeatmapResponse>({ queryKey: ["/api/analytics/heatmap"] });
  const { data: callsResponse } = useQuery<PaginatedCalls>({ queryKey: ["/api/calls"] });

  const calls: CallWithDetails[] = callsResponse?.calls ?? [];
  const flagged = useMemo(() => extractFlagged(calls).slice(0, 4), [calls]);
  const exemplar = useMemo(() => extractExemplar(calls), [calls]);
  const curve = useMemo(() => deriveHourlyCurve(heatmap?.cells), [heatmap]);

  const heroScore = metrics?.avgPerformanceScore ?? 0;
  const scoreDelta = weekly?.scoreDelta ?? null;
  const rubric = useMemo<RubricValues>(() => deriveAverageRubric(calls), [calls]);

  return (
    <div className="bg-background text-foreground font-sans min-h-full">
      <div className="px-14 py-10">
        {/* Hero: score + sentiment curve */}
        <div
          className="grid gap-14 items-center pb-10 border-b border-border"
          style={{ gridTemplateColumns: "320px 1fr" }}
        >
          {/* Left: hero score */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Team pulse · 24h
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <div
                className="font-display font-medium tabular-nums text-foreground"
                style={{ fontSize: 96, letterSpacing: "-4px", lineHeight: 0.95 }}
              >
                {heroScore.toFixed(1)}
              </div>
              <div className="font-mono text-[16px] text-muted-foreground">/10</div>
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
              {scoreDelta != null ? (
                <div
                  className="font-mono text-[12px]"
                  style={{ color: scoreDelta >= 0 ? "var(--chart-2)" : "var(--destructive)" }}
                >
                  {scoreDelta >= 0 ? "▲" : "▼"} {Math.abs(scoreDelta).toFixed(1)} vs. last week
                </div>
              ) : (
                <div className="font-mono text-[12px] text-muted-foreground">No prior-week data yet</div>
              )}
            </div>
            {weekly?.narrative && (
              <div className="mt-7 text-[14px] leading-relaxed text-foreground" style={{ maxWidth: 280 }}>
                {weekly.narrative}
              </div>
            )}
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Link href="/reports">
                <button
                  className="font-sans text-[12px] font-medium"
                  style={{
                    background: "var(--ink, var(--foreground))",
                    color: "var(--paper, var(--background))",
                    border: "none",
                    padding: "9px 14px",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  Open reports
                </button>
              </Link>
              <Link href="/coaching">
                <button
                  className="font-sans text-[12px] font-medium"
                  style={{
                    background: "transparent",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    padding: "9px 14px",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  Draft coaching note
                </button>
              </Link>
            </div>
          </div>

          {/* Right: sentiment curve hero */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Live · sentiment curve
                </div>
                <div className="font-display text-[24px] font-medium tracking-[-0.01em] mt-0.5">
                  Today, hour-by-hour
                </div>
              </div>
              <div style={{ display: "flex", gap: 16 }} className="font-mono text-[11px]">
                {curve.peak && (
                  <span style={{ color: "var(--chart-2)" }}>
                    ● +{curve.peak.value.toFixed(2)} peak {String(curve.peak.hour).padStart(2, "0")}:00
                  </span>
                )}
                {curve.trough && (
                  <span style={{ color: "var(--destructive)" }}>
                    ● {curve.trough.value.toFixed(2)} trough {String(curve.trough.hour).padStart(2, "0")}:00
                  </span>
                )}
              </div>
            </div>
            <div className="w-full">
              <SentimentCurve sentiment={curve.sentiment} volume={curve.volume} width={920} height={220} />
            </div>
          </div>
        </div>

        {/* 3-card row */}
        <div className="grid gap-8 mt-8" style={{ gridTemplateColumns: "1.1fr 1fr 1fr" }}>
          <PulseCard title="Rubric breakdown" kicker={`Averaged · ${metrics?.totalCalls ?? 0} calls`}>
            <RubricRack rubric={rubric} />
          </PulseCard>

          <PulseCard title="Exemplar call" kicker="★ Share in coaching">
            {exemplar ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <Avatar initials={initialsFromName(exemplar.employee?.name)} size={40} />
                  <div style={{ flex: 1 }}>
                    <div className="text-[14px] font-medium">{exemplar.employee?.name || "Unassigned"}</div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-0.5">
                      {exemplar.callCategory || "call"}
                    </div>
                  </div>
                  <ScoreDial value={parseFloat(exemplar.analysis?.performanceScore || "0") || 0} size={60} label="" />
                </div>
                {exemplar.analysis?.summary && (
                  <div
                    className="text-[13px] text-foreground leading-relaxed py-3"
                    style={{ borderTop: "1px dashed var(--border)" }}
                  >
                    {truncate(String(exemplar.analysis.summary), 180)}
                  </div>
                )}
                <Link href={`/transcripts/${exemplar.id}`}>
                  <button
                    className="font-mono text-[11px] underline-offset-4 hover:underline mt-2"
                    style={{ color: "var(--accent)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    Open transcript →
                  </button>
                </Link>
              </>
            ) : (
              <div className="text-[13px] text-muted-foreground">No exemplar calls this week.</div>
            )}
          </PulseCard>

          <PulseCard title="Needs review" kicker={`${flagged.length} flagged`}>
            {flagged.length === 0 ? (
              <div className="text-[13px] text-muted-foreground">Nothing flagged right now.</div>
            ) : (
              flagged.map((f, i) => (
                <div
                  key={f.id}
                  style={{
                    padding: "11px 0",
                    borderBottom: i < flagged.length - 1 ? "1px dashed var(--border)" : "none",
                  }}
                >
                  <Link href={`/transcripts/${f.id}`}>
                    <a style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div className="text-[13px] font-medium">{f.employee?.name || "Unassigned"}</div>
                        <div className="font-mono text-[12px]" style={{ color: "var(--destructive)" }}>
                          {Number(f.analysis?.performanceScore || 0).toFixed(1)}
                        </div>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">
                        {truncate(f.analysis?.summary ? String(f.analysis.summary) : "Flagged for review", 80)}
                      </div>
                    </a>
                  </Link>
                </div>
              ))
            )}
          </PulseCard>
        </div>

        {/* Agents table */}
        <div className="mt-8">
          <PulseCard title="Agents · today" kicker={`${performers?.length ?? 0} on shift`} pad={0}>
            <div style={{ padding: "0 24px 20px" }}>
              <div
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1.4fr 1fr 160px 80px",
                  gap: 16,
                  alignItems: "center",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>#</div>
                <div>Agent</div>
                <div>Team</div>
                <div>Score</div>
                <div>Calls</div>
              </div>
              {(performers ?? []).slice(0, 8).map((e, i, arr) => {
                const score = Number(e.avgPerformanceScore ?? e.score ?? 0);
                return (
                  <div
                    key={e.id ?? i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1.4fr 1fr 160px 80px",
                      gap: 16,
                      alignItems: "center",
                      padding: "12px 0",
                      borderBottom: i < arr.length - 1 ? "1px dashed var(--border)" : "none",
                    }}
                  >
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Avatar initials={initialsFromName(e.name)} size={28} />
                      <div className="text-[13px] font-medium truncate">{e.name || "—"}</div>
                    </div>
                    <div className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground truncate">
                      {e.role || "—"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          background: "var(--secondary)",
                          height: 6,
                          flex: 1,
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
                        style={{ width: 32, textAlign: "right" }}
                      >
                        {score.toFixed(1)}
                      </div>
                    </div>
                    <div className="font-mono text-[12px]">{e.totalCalls ?? 0}</div>
                  </div>
                );
              })}
              {(!performers || performers.length === 0) && (
                <div className="text-[13px] text-muted-foreground py-4">No performers yet.</div>
              )}
            </div>
          </PulseCard>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Helpers local to the Pulse variant.
// ───────────────────────────────────────────────────────────
function deriveAverageRubric(calls: CallWithDetails[]): RubricValues {
  const acc = { compliance: [] as number[], customerExperience: [] as number[], communication: [] as number[], resolution: [] as number[] };
  for (const c of calls) {
    const s = c.analysis?.subScores as Record<string, number | string | null | undefined> | undefined;
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
