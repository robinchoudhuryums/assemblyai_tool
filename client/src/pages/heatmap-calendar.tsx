import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDots, Clock } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@shared/schema";
import { scoreTierColor } from "@/components/analytics/chart-primitives";

interface HeatmapCell {
  dow: number;
  hour: number;
  count: number;
  avgScore: number | null;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
});

/**
 * Warm-paper cell fill. Volume uses copper-with-opacity buckets; score
 * mode delegates to scoreTierColor so the heatmap palette matches the
 * rest of the analytics pages.
 */
function getCellFill(mode: "volume" | "score", count: number, max: number, score: number | null): string {
  if (count === 0) return "var(--paper-2)";
  if (mode === "score") {
    if (score == null) return "var(--paper-2)";
    return scoreTierColor(score);
  }
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 0.75) return "var(--accent)";
  if (ratio >= 0.5) return "color-mix(in oklch, var(--accent), var(--paper) 25%)";
  if (ratio >= 0.25) return "color-mix(in oklch, var(--accent), var(--paper) 50%)";
  return "color-mix(in oklch, var(--accent), var(--paper) 70%)";
}

// ─────────────────────────────────────────────────────────────
// Call Heatmap (installment 13 — warm-paper rewrite).
// Day-of-week × hour-of-day grid. Volume mode uses copper-opacity
// buckets; score mode maps avg score through scoreTierColor so the
// palette stays on-system. Stat tiles + panel shell mirror the
// installment 11 / 12 pattern.
// ─────────────────────────────────────────────────────────────
export default function HeatmapCalendar() {
  const [days, setDays] = useState("90");
  const [employeeId, setEmployeeId] = useState("all");
  const [mode, setMode] = useState<"volume" | "score">("volume");

  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const queryParams = new URLSearchParams({ days });
  if (employeeId !== "all") queryParams.set("employee", employeeId);

  const { data, isLoading } = useQuery<{ cells: HeatmapCell[]; days: number }>({
    queryKey: ["/api/analytics/heatmap", days, employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/heatmap?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch heatmap data");
      return res.json();
    },
  });

  const cells = data?.cells || [];
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  const grid: Record<string, HeatmapCell> = {};
  for (const cell of cells) {
    grid[`${cell.dow}-${cell.hour}`] = cell;
  }

  const PEAK_SEED: HeatmapCell = { dow: 0, hour: 0, count: 0, avgScore: null };
  const peakHour: HeatmapCell = cells.reduce<HeatmapCell>(
    (best, c) => (c.count > best.count ? c : best),
    PEAK_SEED,
  );
  const totalCalls = cells.reduce((sum, c) => sum + c.count, 0);
  const avgCells = cells.filter((c) => c.avgScore != null);
  const overallAvgScore =
    avgCells.length > 0
      ? avgCells.reduce((sum, c) => sum + (c.avgScore || 0), 0) / avgCells.length
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="heatmap-page">
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
          <span className="text-foreground">Heatmap</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <CalendarDots style={{ width: 12, height: 12 }} />
          Analytics
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Call heatmap
        </div>
        <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
          Call volume and performance by day of week and hour of day.
        </p>
      </div>

      {/* Filter row */}
      <div className="px-4 sm:px-7 py-4 border-b border-border bg-background">
        <div className="flex flex-wrap items-end gap-4">
          <FilterBlock label="Window">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
          </FilterBlock>
          <FilterBlock label="Agent">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-56 h-9 text-sm">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {(employees || [])
                  .filter((e) => e.status === "Active")
                  .map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FilterBlock>
          <FilterBlock label="Metric">
            <Select value={mode} onValueChange={(v) => setMode(v as "volume" | "score")}>
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="volume">Call volume</SelectItem>
                <SelectItem value="score">Avg score</SelectItem>
              </SelectContent>
            </Select>
          </FilterBlock>
        </div>
      </div>

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile label="Total calls" value={totalCalls.toLocaleString()} />
          <StatTile
            label="Avg score"
            value={overallAvgScore?.toFixed(1) ?? "—"}
            color={scoreTierColor(overallAvgScore)}
          />
          <StatTile label="Peak day" value={peakHour.count > 0 ? DAY_LABELS[peakHour.dow] : "—"} />
          <StatTile
            label="Peak hour"
            value={peakHour.count > 0 ? HOUR_LABELS[peakHour.hour] : "—"}
          />
        </div>

        {/* Heatmap grid panel */}
        <HeatmapPanel
          kicker={mode === "volume" ? "Volume" : "Score"}
          icon={Clock}
          title={mode === "volume" ? "Call volume by day × hour" : "Average score by day × hour"}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="w-12 py-1" />
                    {HOUR_LABELS.map((label, h) => (
                      <th
                        key={h}
                        className="font-mono uppercase text-muted-foreground text-center px-0.5"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.08em",
                          fontWeight: 500,
                        }}
                      >
                        {h % 3 === 0 ? label : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_LABELS.map((dayLabel, dow) => (
                    <tr key={dow}>
                      <td
                        className="font-mono uppercase text-muted-foreground pr-3 py-0.5"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          fontWeight: 500,
                        }}
                      >
                        {dayLabel}
                      </td>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const cell = grid[`${dow}-${hour}`];
                        const count = cell?.count || 0;
                        const score = cell?.avgScore ?? null;
                        const fill = getCellFill(mode, count, maxCount, score);
                        const tooltip = cell && cell.count > 0
                          ? `${DAY_LABELS[dow]} ${HOUR_LABELS[hour]}: ${cell.count} calls${
                              cell.avgScore != null ? `, avg score ${cell.avgScore.toFixed(1)}` : ""
                            }`
                          : `${DAY_LABELS[dow]} ${HOUR_LABELS[hour]}: no calls`;
                        return (
                          <td key={hour} className="p-0.5">
                            <div
                              className="w-full aspect-square rounded-sm"
                              style={{
                                background: fill,
                                minWidth: 16,
                                minHeight: 16,
                                border: count > 0 ? "1px solid color-mix(in oklch, var(--border), transparent 40%)" : "1px solid transparent",
                              }}
                              title={tooltip}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Legend */}
              <div
                className="flex items-center gap-2 mt-4 font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
              >
                <span>Less</span>
                {mode === "volume" ? (
                  <>
                    <LegendSwatch color="color-mix(in oklch, var(--accent), var(--paper) 70%)" />
                    <LegendSwatch color="color-mix(in oklch, var(--accent), var(--paper) 50%)" />
                    <LegendSwatch color="color-mix(in oklch, var(--accent), var(--paper) 25%)" />
                    <LegendSwatch color="var(--accent)" />
                  </>
                ) : (
                  <>
                    <LegendSwatch color="var(--destructive)" />
                    <LegendSwatch color="var(--accent)" />
                    <LegendSwatch color="var(--foreground)" />
                    <LegendSwatch color="var(--sage)" />
                  </>
                )}
                <span>More</span>
              </div>
            </div>
          )}
        </HeatmapPanel>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (inline)
// ─────────────────────────────────────────────────────────────
function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground mb-1.5"
        style={{ fontSize: 10, letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-1"
        style={{
          fontSize: 26,
          lineHeight: 1,
          color: color || "var(--foreground)",
          letterSpacing: "-0.4px",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LegendSwatch({ color }: { color: string }) {
  return (
    <div
      className="rounded-sm"
      style={{
        width: 16,
        height: 16,
        background: color,
        border: "1px solid color-mix(in oklch, var(--border), transparent 40%)",
      }}
    />
  );
}

function HeatmapPanel({
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
