import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Clock } from "lucide-react";
import type { Employee } from "@shared/schema";

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

function getColor(value: number, max: number, mode: "volume" | "score"): string {
  if (value === 0) return "bg-muted";
  if (mode === "score") {
    // Score 0-10 scale, green for high, red for low
    const ratio = Math.min(value / 10, 1);
    if (ratio >= 0.8) return "bg-green-500";
    if (ratio >= 0.6) return "bg-green-400";
    if (ratio >= 0.4) return "bg-yellow-400";
    if (ratio >= 0.2) return "bg-orange-400";
    return "bg-red-400";
  }
  // Volume — intensity scale
  const ratio = max > 0 ? value / max : 0;
  if (ratio >= 0.75) return "bg-primary";
  if (ratio >= 0.5) return "bg-primary/75";
  if (ratio >= 0.25) return "bg-primary/50";
  return "bg-primary/25";
}

export default function HeatmapCalendar() {
  const [days, setDays] = useState("90");
  const [employeeId, setEmployeeId] = useState("all");
  const [mode, setMode] = useState<"volume" | "score">("volume");

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

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
  const maxCount = Math.max(1, ...cells.map(c => c.count));

  // Build grid lookup
  const grid: Record<string, HeatmapCell> = {};
  for (const cell of cells) {
    grid[`${cell.dow}-${cell.hour}`] = cell;
  }

  // Find peak hours
  const peakHour = cells.reduce((best, c) => c.count > best.count ? c : best, { dow: 0, hour: 0, count: 0, avgScore: null });
  const totalCalls = cells.reduce((sum, c) => sum + c.count, 0);
  const avgCells = cells.filter(c => c.avgScore != null);
  const overallAvgScore = avgCells.length > 0
    ? avgCells.reduce((sum, c) => sum + (c.avgScore || 0), 0) / avgCells.length
    : null;

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarDays className="w-6 h-6" />
          Call Heatmap
        </h2>
        <p className="text-muted-foreground">Call volume and performance by day of week and hour</p>
      </header>

      <div className="p-6 space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-32 h-8 text-xs">
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
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(employees || []).filter(e => e.status === "Active").map(emp => (
                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={mode} onValueChange={v => setMode(v as "volume" | "score")}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="volume">Call Volume</SelectItem>
              <SelectItem value="score">Avg Score</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="animate-stagger" style={{ "--stagger": 0 } as React.CSSProperties}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total Calls</p>
              <p className="text-2xl font-bold">{totalCalls}</p>
            </CardContent>
          </Card>
          <Card className="animate-stagger" style={{ "--stagger": 1 } as React.CSSProperties}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Avg Score</p>
              <p className="text-2xl font-bold">{overallAvgScore?.toFixed(1) ?? "N/A"}</p>
            </CardContent>
          </Card>
          <Card className="animate-stagger" style={{ "--stagger": 2 } as React.CSSProperties}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Peak Day</p>
              <p className="text-2xl font-bold">{peakHour.count > 0 ? DAY_LABELS[peakHour.dow] : "—"}</p>
            </CardContent>
          </Card>
          <Card className="animate-stagger" style={{ "--stagger": 3 } as React.CSSProperties}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Peak Hour</p>
              <p className="text-2xl font-bold">{peakHour.count > 0 ? HOUR_LABELS[peakHour.hour] : "—"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Heatmap grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {mode === "volume" ? "Call Volume" : "Average Score"} by Day & Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      <th className="text-xs text-muted-foreground text-left py-1 px-1 w-12" />
                      {HOUR_LABELS.map((label, h) => (
                        <th key={h} className="text-[10px] text-muted-foreground text-center px-0.5 font-normal">
                          {h % 3 === 0 ? label : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAY_LABELS.map((dayLabel, dow) => (
                      <tr key={dow}>
                        <td className="text-xs text-muted-foreground font-medium py-0.5 pr-2">{dayLabel}</td>
                        {Array.from({ length: 24 }, (_, hour) => {
                          const cell = grid[`${dow}-${hour}`];
                          const value = mode === "volume"
                            ? (cell?.count || 0)
                            : (cell?.avgScore || 0);
                          const colorClass = cell && cell.count > 0
                            ? getColor(value, maxCount, mode)
                            : "bg-muted";
                          const tooltip = cell && cell.count > 0
                            ? `${DAY_LABELS[dow]} ${HOUR_LABELS[hour]}: ${cell.count} calls${cell.avgScore != null ? `, avg score: ${cell.avgScore.toFixed(1)}` : ""}`
                            : `${DAY_LABELS[dow]} ${HOUR_LABELS[hour]}: no calls`;
                          return (
                            <td key={hour} className="p-0.5">
                              <div
                                className={`w-full aspect-square rounded-sm ${colorClass} min-w-[16px] min-h-[16px] heatmap-cell`}
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
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <span>Less</span>
                  {mode === "volume" ? (
                    <>
                      <div className="w-4 h-4 rounded-sm bg-primary/25" />
                      <div className="w-4 h-4 rounded-sm bg-primary/50" />
                      <div className="w-4 h-4 rounded-sm bg-primary/75" />
                      <div className="w-4 h-4 rounded-sm bg-primary" />
                    </>
                  ) : (
                    <>
                      <div className="w-4 h-4 rounded-sm bg-red-400" />
                      <div className="w-4 h-4 rounded-sm bg-orange-400" />
                      <div className="w-4 h-4 rounded-sm bg-yellow-400" />
                      <div className="w-4 h-4 rounded-sm bg-green-400" />
                      <div className="w-4 h-4 rounded-sm bg-green-500" />
                    </>
                  )}
                  <span>More</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
