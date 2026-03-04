import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star, TrendingUp, UserCheck, Calendar, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { Employee, CallWithDetails } from "@shared/schema";
import { AudioWaveform } from "lucide-react";

interface Performer extends Employee {
  avgPerformanceScore: number;
  totalCalls: number;
}

type SortKey = "score" | "calls" | "name";

export default function PerformancePage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: performers, isLoading } = useQuery<Performer[]>({
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

  // Filter and sort performers
  const filteredPerformers = useMemo(() => {
    if (!performers) return [];
    let filtered = [...performers];

    if (deptFilter !== "all") {
      filtered = filtered.filter(p => p.role === deptFilter);
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

  // Chart data: top 10 by score
  const chartData = useMemo(() => {
    return filteredPerformers.slice(0, 10).map(p => ({
      name: p.name?.split(" ")[0] || "?",
      score: p.avgPerformanceScore ? Number(p.avgPerformanceScore.toFixed(1)) : 0,
      calls: p.totalCalls,
    }));
  }, [filteredPerformers]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Analyzing performance...</p>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 8) return "#22c55e";
    if (score >= 6) return "#3b82f6";
    if (score >= 4) return "#eab308";
    return "#ef4444";
  };

  return (
    <div className="min-h-screen" data-testid="performance-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Employee Performance</h2>
            <p className="text-muted-foreground">Review and compare agent performance scores.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Score Distribution Chart */}
        {chartData.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Score Overview — Top {chartData.length}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={60} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Bar dataKey="score" name="Avg Score" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={getScoreColor(entry.score)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Performance Table */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Rank</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                  <button className="flex items-center hover:text-foreground" onClick={() => toggleSort("name")}>
                    Employee <SortIcon field="name" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Department</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                  <button className="flex items-center hover:text-foreground" onClick={() => toggleSort("score")}>
                    Avg Score <SortIcon field="score" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                  <button className="flex items-center hover:text-foreground" onClick={() => toggleSort("calls")}>
                    Calls <SortIcon field="calls" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Score Bar</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPerformers.map((employee, index) => {
                const score = employee.avgPerformanceScore ? Number(employee.avgPerformanceScore) : 0;
                return (
                  <tr key={employee.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-sm font-bold text-primary">#{index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                          <span className="text-primary text-xs font-bold">
                            {employee.initials || employee.name?.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="font-medium text-sm">{employee.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{employee.role || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-current" style={{ color: getScoreColor(score) }} />
                        <span className="font-bold" style={{ color: getScoreColor(score) }}>
                          {score ? score.toFixed(1) : "N/A"}
                        </span>
                        <span className="text-xs text-muted-foreground">/10</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">{employee.totalCalls}</td>
                    <td className="px-4 py-3 w-32">
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{ width: `${(score / 10) * 100}%`, backgroundColor: getScoreColor(score) }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/reports?employee=${employee.id}`}>
                        <Button size="sm" variant="ghost" className="text-xs">Profile</Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!filteredPerformers.length && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No performance data available yet.</p>
            <p className="text-sm text-muted-foreground">Process more calls to see performance metrics.</p>
          </div>
        )}
      </main>
    </div>
  );
}
