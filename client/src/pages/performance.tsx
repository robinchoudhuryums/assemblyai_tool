import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowsDownUp, TrendUp } from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import type { Employee } from "@shared/schema";
import { LoadingIndicator } from "@/components/ui/loading";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_GRID_STROKE,
  scoreTierColor,
} from "@/components/analytics/chart-primitives";

interface Performer extends Employee {
  avgPerformanceScore: number;
  totalCalls: number;
}

type SortKey = "score" | "calls" | "name";

// ─────────────────────────────────────────────────────────────
// Performance (installment 11 — warm-paper rewrite).
// Company-wide ranking of agents by avg score. Manager+ only.
// Reuses the shared chart primitives from installment 9 for the top-N
// horizontal bar chart; score coloring goes through scoreTierColor()
// so tiers are consistent with Reports / Agent Scorecard / Sentiment.
// ─────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const [deptFilter, setDeptFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: performers, isLoading, isError, error } = useQuery<Performer[]>({
    queryKey: ["/api/performance"],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const departments = useMemo(() => {
    if (!employees) return [];
    const set = new Set<string>();
    for (const emp of employees) {
      if (emp.role) set.add(emp.role);
    }
    return Array.from(set).sort();
  }, [employees]);

  const filteredPerformers = useMemo(() => {
    if (!performers) return [];
    let filtered = [...performers];

    if (deptFilter !== "all") {
      filtered = filtered.filter((p) => p.role === deptFilter);
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "score":
          cmp = (a.avgPerformanceScore || 0) - (b.avgPerformanceScore || 0);
          break;
        case "calls":
          cmp = (a.totalCalls || 0) - (b.totalCalls || 0);
          break;
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return filtered;
  }, [performers, deptFilter, sortBy, sortDir]);

  // Chart data — top 10 by current sort (usually score desc)
  const chartData = useMemo(() => {
    return filteredPerformers.slice(0, 10).map((p) => ({
      name: p.name?.split(" ")[0] || "?",
      fullName: p.name,
      score: p.avgPerformanceScore ? Number(p.avgPerformanceScore.toFixed(1)) : 0,
      calls: p.totalCalls,
    }));
  }, [filteredPerformers]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const overallAvg = useMemo(() => {
    if (!filteredPerformers.length) return null;
    const withScores = filteredPerformers.filter((p) => p.avgPerformanceScore);
    if (withScores.length === 0) return null;
    const sum = withScores.reduce((acc, p) => acc + p.avgPerformanceScore, 0);
    return sum / withScores.length;
  }, [filteredPerformers]);

  const totalCalls = useMemo(
    () => filteredPerformers.reduce((acc, p) => acc + (p.totalCalls || 0), 0),
    [filteredPerformers],
  );

  if (isError) {
    return (
      <div className="min-h-screen bg-background text-foreground" data-testid="performance-page">
        <PerformanceAppBar />
        <PerformancePageHeader total={null} overallAvg={null} />
        <div className="px-7 py-6">
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
            <span>{(error as Error)?.message ?? "Failed to load performance data."}</span>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground" data-testid="performance-page">
        <PerformanceAppBar />
        <PerformancePageHeader total={null} overallAvg={null} />
        <div className="flex items-center justify-center h-64">
          <LoadingIndicator text="Analyzing performance..." />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="performance-page">
      <PerformanceAppBar />
      <PerformancePageHeader total={filteredPerformers.length} overallAvg={overallAvg} />

      {/* Filter row */}
      <div className="px-7 py-4 border-b border-border bg-background">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground mb-1.5"
              style={{ fontSize: 10, letterSpacing: "0.12em" }}
            >
              Department
            </div>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-56 h-9 text-sm">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-right">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Total calls
            </div>
            <div
              className="font-display font-medium tabular-nums text-foreground mt-0.5"
              style={{ fontSize: 22, lineHeight: 1 }}
            >
              {totalCalls.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <main className="px-7 py-6 space-y-6">
        {/* Score overview — top-10 horizontal bars, tier-tinted via scoreTierColor */}
        {chartData.length > 0 && (
          <PerfPanel kicker={`Top ${chartData.length}`} icon={TrendUp} title="Score overview">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  type="number"
                  domain={[0, 10]}
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                  width={64}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                  formatter={(value: number, _name, payload) => [
                    `${value.toFixed(1)}/10`,
                    payload.payload.fullName || "Score",
                  ]}
                />
                <Bar dataKey="score" name="Avg score" radius={[0, 2, 2, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={scoreTierColor(entry.score)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </PerfPanel>
        )}

        {/* Performance table — hairline-separated document rows */}
        <div className="rounded-sm border bg-card overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <PerfTableHeader>Rank</PerfTableHeader>
                <PerfTableHeaderSort
                  active={sortBy === "name"}
                  direction={sortDir}
                  onClick={() => toggleSort("name")}
                >
                  Employee
                </PerfTableHeaderSort>
                <PerfTableHeader>Department</PerfTableHeader>
                <PerfTableHeaderSort
                  active={sortBy === "score"}
                  direction={sortDir}
                  onClick={() => toggleSort("score")}
                >
                  Avg score
                </PerfTableHeaderSort>
                <PerfTableHeaderSort
                  active={sortBy === "calls"}
                  direction={sortDir}
                  onClick={() => toggleSort("calls")}
                >
                  Calls
                </PerfTableHeaderSort>
                <PerfTableHeader>Score bar</PerfTableHeader>
                <PerfTableHeader> </PerfTableHeader>
              </tr>
            </thead>
            <tbody>
              {filteredPerformers.map((employee, index) => {
                const score = employee.avgPerformanceScore ? Number(employee.avgPerformanceScore) : 0;
                const color = scoreTierColor(score || null);
                return (
                  <tr
                    key={employee.id}
                    className="border-b border-border last:border-b-0 hover:bg-background/60 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <span
                        className="font-mono tabular-nums text-muted-foreground"
                        style={{ fontSize: 11, letterSpacing: "0.04em" }}
                      >
                        #{String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="rounded-full flex items-center justify-center shrink-0"
                          style={{
                            width: 28,
                            height: 28,
                            background: "var(--copper-soft)",
                            border: "1px solid color-mix(in oklch, var(--accent), transparent 65%)",
                          }}
                        >
                          <span
                            className="font-display font-medium"
                            style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "-0.2px" }}
                          >
                            {employee.initials || employee.name?.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm text-foreground font-medium">{employee.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{employee.role || "—"}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className="font-display font-medium tabular-nums"
                          style={{ fontSize: 20, color, letterSpacing: "-0.2px" }}
                        >
                          {score ? score.toFixed(1) : "—"}
                        </span>
                        <span
                          className="font-mono text-muted-foreground"
                          style={{ fontSize: 10, letterSpacing: "0.04em" }}
                        >
                          /10
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm tabular-nums text-foreground">
                      {employee.totalCalls.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 w-36">
                      <div
                        className="h-1.5 rounded-sm overflow-hidden"
                        style={{ background: "var(--paper-2)" }}
                      >
                        <div
                          className="h-full rounded-sm transition-all"
                          style={{ width: `${(score / 10) * 100}%`, background: color }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/reports?employee=${employee.id}`}>
                        <Button size="sm" variant="ghost">
                          Profile
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!filteredPerformers.length && (
          <div className="text-center py-14">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              No data
            </div>
            <p className="text-sm text-foreground mt-2">No performance data available yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Process more calls to see performance metrics.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App bar — breadcrumb consistent with Reports / Sentiment / Admin.
// ─────────────────────────────────────────────────────────────
function PerformanceAppBar() {
  return (
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
        <span className="text-foreground">Performance</span>
      </nav>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page header — mono kicker + display-font title + summary meta
// ─────────────────────────────────────────────────────────────
function PerformancePageHeader({
  total,
  overallAvg,
}: {
  total: number | null;
  overallAvg: number | null;
}) {
  return (
    <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.18em" }}
          >
            Analytics
          </div>
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
          >
            Performance
          </div>
          <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 560 }}>
            Review and compare agent performance scores across the company.
          </p>
        </div>
        <div className="flex items-center gap-6 pb-1">
          <HeaderStat label="Agents" value={total != null ? total.toLocaleString() : "—"} />
          <HeaderStat
            label="Overall avg"
            value={overallAvg != null ? overallAvg.toFixed(1) : "—"}
            color={scoreTierColor(overallAvg)}
          />
        </div>
      </div>
    </div>
  );
}

function HeaderStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-right">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-0.5"
        style={{
          fontSize: 22,
          lineHeight: 1,
          color: color || "var(--foreground)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Panel shell (mirrors ScorecardPanel / Sentiment Panel). Inline here;
// will be lifted once the third analytics page needs it.
// ─────────────────────────────────────────────────────────────
function PerfPanel({
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

// ─────────────────────────────────────────────────────────────
// Table header cell — mono uppercase 10px kicker
// ─────────────────────────────────────────────────────────────
function PerfTableHeader({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-4 py-3 font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 500 }}
    >
      {children}
    </th>
  );
}

function PerfTableHeaderSort({
  children,
  active,
  direction,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ArrowsDownUp : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="text-left px-4 py-3">
      <button
        onClick={onClick}
        className="flex items-center gap-1 font-mono uppercase text-muted-foreground hover:text-foreground transition-colors"
        style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 500 }}
      >
        {children}
        <Icon style={{ width: 10, height: 10, opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}
