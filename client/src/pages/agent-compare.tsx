import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChartBar,
  CheckCircle,
  Clock,
  Heart,
  Shield,
  TrendUp,
  Users,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@shared/schema";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
  CHART_GRID_STROKE,
  SENTIMENT_COLOR,
  scoreTierColor,
} from "@/components/analytics/chart-primitives";

interface AgentComparison {
  id: string;
  name: string;
  subTeam: string | null;
  callCount: number;
  avgScore: number | null;
  avgConfidence: number | null;
  avgDuration: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  avgSubScores: {
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  } | null;
}

// Warm-paper per-agent accent palette — 5 distinct copper/sage/amber/
// destructive/plum-class hues from the OKLCH system so charts tint
// agents consistently while staying within the warm-paper token set.
const AGENT_COLORS = [
  "var(--accent)",
  "var(--sage)",
  "var(--amber)",
  "var(--destructive)",
  "oklch(58% 0.14 295)",
] as const;

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// Agent Compare (installment 12 — warm-paper rewrite).
// Manager+ tool to compare 2-5 agents side-by-side. Reuses the shared
// chart-primitives module for axis/tooltip/legend chrome; per-agent
// accent colors come from the warm-paper palette so radar + sentiment
// charts stay on-system.
// ─────────────────────────────────────────────────────────────
export default function AgentComparePage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const activeEmployees = useMemo(
    () => (employees || []).filter((e) => e.status === "Active"),
    [employees],
  );

  const idsParam = selectedIds.join(",");
  const { data: comparison, isLoading, isError, error } = useQuery<AgentComparison[]>({
    queryKey: ["/api/analytics/compare", idsParam],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/compare?ids=${idsParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to compare agents");
      return res.json();
    },
    enabled: selectedIds.length >= 2,
  });

  const addAgent = (id: string) => {
    if (selectedIds.length >= 5 || selectedIds.includes(id)) return;
    setSelectedIds((prev) => [...prev, id]);
  };

  const removeAgent = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  // Radar chart — sub-scores per agent (0-10 scale)
  const radarData = useMemo(() => {
    if (!comparison) return [];
    const dimensions = [
      { key: "compliance", label: "Compliance" },
      { key: "customerExperience", label: "Customer Exp." },
      { key: "communication", label: "Communication" },
      { key: "resolution", label: "Resolution" },
    ];
    return dimensions.map((dim) => {
      const entry: Record<string, string | number> = { dimension: dim.label };
      for (const agent of comparison) {
        const scores = agent.avgSubScores as Record<string, number | null> | null;
        entry[agent.name] = scores?.[dim.key] ?? 0;
      }
      return entry;
    });
  }, [comparison]);

  // Sentiment bar chart
  const sentimentData = useMemo(() => {
    if (!comparison) return [];
    return comparison.map((a) => ({
      name: a.name.split(" ")[0],
      positive: a.sentimentBreakdown.positive,
      neutral: a.sentimentBreakdown.neutral,
      negative: a.sentimentBreakdown.negative,
    }));
  }, [comparison]);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="agent-compare-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border"
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
          <Link href="/employees" className="text-muted-foreground hover:text-foreground transition-colors">
            Employees
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Compare</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <Users style={{ width: 12, height: 12 }} />
          Analytics
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Agent comparison
        </div>
        <p
          className="text-muted-foreground mt-2"
          style={{ fontSize: 14, maxWidth: 620 }}
        >
          Compare 2–5 agents side-by-side across scoring, sub-scores, and sentiment.
        </p>
      </div>

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* Agent picker */}
        <ComparePanel kicker="Selection" icon={Users} title="Select agents to compare">
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.map((id, i) => {
              const emp = activeEmployees.find((e) => e.id === id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-sm text-sm"
                  style={{
                    padding: "4px 4px 4px 12px",
                    background: "var(--paper-2)",
                    border: "1px solid var(--border)",
                    borderLeft: `3px solid ${AGENT_COLORS[i]}`,
                    color: "var(--foreground)",
                  }}
                >
                  {emp?.name || id}
                  <button
                    type="button"
                    onClick={() => removeAgent(id)}
                    className="rounded-sm p-1 hover:bg-background transition-colors"
                    aria-label={`Remove ${emp?.name}`}
                  >
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                </span>
              );
            })}
            {selectedIds.length < 5 && (
              <Select onValueChange={addAgent}>
                <SelectTrigger className="w-56 h-9 text-sm">
                  <SelectValue
                    placeholder={
                      selectedIds.length === 0 ? "Add first agent…" : "Add another agent…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees
                    .filter((e) => !selectedIds.includes(e.id))
                    .map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {selectedIds.length < 2 && (
            <p
              className="font-mono uppercase text-muted-foreground mt-3"
              style={{ fontSize: 10, letterSpacing: "0.12em" }}
            >
              Select at least 2 agents to compare
            </p>
          )}
        </ComparePanel>

        {isError && (
          <ErrorBanner message={(error as Error)?.message ?? "Failed to load comparison data."} />
        )}

        {isLoading && selectedIds.length >= 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedIds.map((_, i) => (
              <div
                key={i}
                className="rounded-sm border bg-card p-5 space-y-3"
                style={{ borderColor: "var(--border)" }}
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        )}

        {comparison && comparison.length >= 2 && (
          <>
            {/* Summary tiles — top border stripe in agent accent color */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {comparison.map((agent, i) => {
                const color = AGENT_COLORS[i];
                const positivePct =
                  agent.callCount > 0
                    ? Math.round((agent.sentimentBreakdown.positive / agent.callCount) * 100)
                    : 0;
                return (
                  <div
                    key={agent.id}
                    className="rounded-sm border bg-card px-5 py-4"
                    style={{
                      borderColor: "var(--border)",
                      borderTop: `3px solid ${color}`,
                    }}
                  >
                    <div
                      className="font-display font-medium text-foreground truncate"
                      style={{ fontSize: 16, letterSpacing: "-0.2px" }}
                    >
                      {agent.name}
                    </div>
                    {agent.subTeam && (
                      <div
                        className="font-mono uppercase text-muted-foreground mt-0.5"
                        style={{ fontSize: 10, letterSpacing: "0.1em" }}
                      >
                        {agent.subTeam}
                      </div>
                    )}
                    <div className="mt-4 space-y-2">
                      <CompareStatLine
                        icon={TrendUp}
                        label="Avg score"
                        value={agent.avgScore?.toFixed(1) ?? "—"}
                        suffix="/10"
                        valueColor={color}
                      />
                      <CompareStatLine
                        icon={ChartBar}
                        label="Calls"
                        value={agent.callCount.toLocaleString()}
                      />
                      <CompareStatLine
                        icon={Clock}
                        label="Avg duration"
                        value={formatDuration(agent.avgDuration)}
                      />
                      <CompareStatLine
                        icon={Heart}
                        label="Positive %"
                        value={`${positivePct}%`}
                        valueColor={SENTIMENT_COLOR.positive}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Radar — sub-scores */}
            {radarData.length > 0 &&
              radarData.some((d) => Object.values(d).some((v) => typeof v === "number" && v > 0)) && (
                <ComparePanel kicker="Per-rubric" icon={Shield} title="Sub-score comparison">
                  <ResponsiveContainer width="100%" height={360}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                      <PolarGrid stroke={CHART_GRID_STROKE} />
                      <PolarAngleAxis
                        dataKey="dimension"
                        tick={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fill: "var(--muted-foreground)",
                          letterSpacing: "0.05em",
                        }}
                      />
                      <PolarRadiusAxis domain={[0, 10]} tick={CHART_TICK} />
                      {comparison.map((agent, i) => (
                        <Radar
                          key={agent.id}
                          name={agent.name}
                          dataKey={agent.name}
                          stroke={AGENT_COLORS[i]}
                          fill={AGENT_COLORS[i]}
                          fillOpacity={0.14}
                          strokeWidth={1.5}
                        />
                      ))}
                      <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP}
                        labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </ComparePanel>
              )}

            {/* Sentiment stacked bars */}
            {sentimentData.length > 0 && (
              <ComparePanel kicker="Tone" icon={Heart} title="Sentiment comparison">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={sentimentData} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="name"
                      tick={CHART_TICK}
                      stroke="var(--border)"
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tick={CHART_TICK}
                      stroke="var(--border)"
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP}
                      labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                    />
                    <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                    <Bar dataKey="positive" name="Positive" fill={SENTIMENT_COLOR.positive} stackId="sent" />
                    <Bar dataKey="neutral" name="Neutral" fill={SENTIMENT_COLOR.neutral} stackId="sent" />
                    <Bar dataKey="negative" name="Negative" fill={SENTIMENT_COLOR.negative} stackId="sent" />
                  </BarChart>
                </ResponsiveContainer>
              </ComparePanel>
            )}

            {/* Detailed metrics table — best-per-row highlighted in sage */}
            <ComparePanel kicker="Breakdown" title="Detailed metrics">
              <div className="overflow-x-auto -mx-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <CompareTableHeader>Metric</CompareTableHeader>
                      {comparison.map((agent, i) => (
                        <CompareTableHeader key={agent.id} align="center" color={AGENT_COLORS[i]}>
                          {agent.name.split(" ")[0]}
                        </CompareTableHeader>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        {
                          label: "Overall score",
                          key: "avgScore",
                          fmt: (v: number | null) => v?.toFixed(1) ?? "—",
                        },
                        {
                          label: "Compliance",
                          key: "compliance",
                          sub: true,
                          fmt: (v: number | null) => v?.toFixed(1) ?? "—",
                        },
                        {
                          label: "Customer exp.",
                          key: "customerExperience",
                          sub: true,
                          fmt: (v: number | null) => v?.toFixed(1) ?? "—",
                        },
                        {
                          label: "Communication",
                          key: "communication",
                          sub: true,
                          fmt: (v: number | null) => v?.toFixed(1) ?? "—",
                        },
                        {
                          label: "Resolution",
                          key: "resolution",
                          sub: true,
                          fmt: (v: number | null) => v?.toFixed(1) ?? "—",
                        },
                        {
                          label: "Total calls",
                          key: "callCount",
                          fmt: (v: number | null) => String(v ?? 0),
                        },
                        {
                          label: "Avg duration",
                          key: "avgDuration",
                          fmt: (v: number | null) => formatDuration(v),
                        },
                        {
                          label: "AI confidence",
                          key: "avgConfidence",
                          fmt: (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : "—"),
                        },
                      ] as Array<{
                        label: string;
                        key: string;
                        sub?: boolean;
                        fmt: (v: number | null) => string;
                      }>
                    ).map((row) => {
                      const values = comparison.map((a) => {
                        if (row.sub && a.avgSubScores) {
                          return (a.avgSubScores as Record<string, number | null>)[row.key] ?? null;
                        }
                        return (a as unknown as Record<string, number | null>)[row.key] ?? null;
                      });
                      const bestIdx = values.reduce<number>(
                        (maxI, v, i) =>
                          v != null && (values[maxI] == null || v > (values[maxI] ?? 0)) ? i : maxI,
                        0,
                      );
                      return (
                        <tr key={row.key} className="border-b border-border last:border-b-0">
                          <td
                            className="px-6 py-2.5 text-sm text-muted-foreground"
                            style={{ fontWeight: 500 }}
                          >
                            {row.label}
                          </td>
                          {values.map((v, i) => {
                            const isBest = i === bestIdx && v != null;
                            return (
                              <td
                                key={i}
                                className="px-3 py-2.5 text-center font-mono tabular-nums"
                                style={{
                                  fontSize: 13,
                                  color: isBest ? "var(--sage)" : "var(--foreground)",
                                  fontWeight: isBest ? 600 : 400,
                                }}
                              >
                                <span className="inline-flex items-center gap-1">
                                  {isBest && (
                                    <CheckCircle
                                      style={{ width: 11, height: 11, color: "var(--sage)" }}
                                      weight="fill"
                                    />
                                  )}
                                  {row.fmt(v)}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ComparePanel>
          </>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (inline — will promote once a third analytics page repeats)
// ─────────────────────────────────────────────────────────────
function ComparePanel({
  kicker,
  title,
  icon: IconComp,
  children,
}: {
  kicker: string;
  title: string;
  icon?: React.ComponentType<{ style?: React.CSSProperties }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {title}
        </div>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

function CompareStatLine({
  icon: Icon,
  label,
  value,
  suffix,
  valueColor,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string;
  value: string;
  suffix?: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon style={{ width: 11, height: 11 }} />
        {label}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{ color: valueColor || "var(--foreground)", fontSize: 12, letterSpacing: "0.02em" }}
      >
        {value}
        {suffix && (
          <span className="text-muted-foreground ml-0.5" style={{ fontSize: 10 }}>
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}

function CompareTableHeader({
  children,
  align = "left",
  color,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  color?: string;
}) {
  return (
    <th
      className="font-mono uppercase"
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        fontWeight: 500,
        padding: "10px 12px",
        textAlign: align,
        color: color || "var(--muted-foreground)",
      }}
    >
      {children}
    </th>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-sm"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "12px 16px",
        fontSize: 13,
        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
      }}
    >
      <Warning style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}
