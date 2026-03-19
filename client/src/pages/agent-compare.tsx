import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, BarChart2, X, Plus, TrendingUp, Heart, Clock, Shield, MessageCircle, Headphones, CheckCircle2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@shared/schema";

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

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatDuration(seconds: number | null): string {
  if (!seconds) return "N/A";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AgentComparePage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const activeEmployees = useMemo(() =>
    (employees || []).filter(e => e.status === "Active"),
  [employees]);

  const idsParam = selectedIds.join(",");
  const { data: comparison, isLoading } = useQuery<AgentComparison[]>({
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
    setSelectedIds(prev => [...prev, id]);
  };

  const removeAgent = (id: string) => {
    setSelectedIds(prev => prev.filter(x => x !== id));
  };

  // Build radar chart data from sub-scores
  const radarData = useMemo(() => {
    if (!comparison) return [];
    const dimensions = [
      { key: "compliance", label: "Compliance" },
      { key: "customerExperience", label: "Customer Exp." },
      { key: "communication", label: "Communication" },
      { key: "resolution", label: "Resolution" },
    ];
    return dimensions.map(dim => {
      const entry: Record<string, string | number> = { dimension: dim.label };
      for (const agent of comparison) {
        const scores = agent.avgSubScores as Record<string, number | null> | null;
        entry[agent.name] = scores?.[dim.key] ?? 0;
      }
      return entry;
    });
  }, [comparison]);

  // Build bar chart data for sentiment
  const sentimentData = useMemo(() => {
    if (!comparison) return [];
    return comparison.map(a => ({
      name: a.name.split(" ")[0], // First name for chart labels
      positive: a.sentimentBreakdown.positive,
      neutral: a.sentimentBreakdown.neutral,
      negative: a.sentimentBreakdown.negative,
    }));
  }, [comparison]);

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-6 h-6" />
          Agent Comparison
        </h2>
        <p className="text-muted-foreground">Compare 2-5 agents side-by-side across all performance dimensions</p>
      </header>

      <div className="p-6 space-y-6">
        {/* Agent selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Agents to Compare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.map((id, i) => {
                const emp = activeEmployees.find(e => e.id === id);
                return (
                  <Badge key={id} variant="secondary" className="pl-3 pr-1 py-1.5 text-sm gap-1.5" style={{ borderLeft: `3px solid ${COLORS[i]}` }}>
                    {emp?.name || id}
                    <button onClick={() => removeAgent(id)} className="ml-1 p-0.5 rounded hover:bg-muted" aria-label={`Remove ${emp?.name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                );
              })}
              {selectedIds.length < 5 && (
                <Select onValueChange={addAgent}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder={selectedIds.length === 0 ? "Add first agent..." : "Add another agent..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeEmployees
                      .filter(e => !selectedIds.includes(e.id))
                      .map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {selectedIds.length < 2 && (
              <p className="text-xs text-muted-foreground mt-2">Select at least 2 agents to compare</p>
            )}
          </CardContent>
        </Card>

        {isLoading && selectedIds.length >= 2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedIds.map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6 space-y-3">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-10 w-20" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {comparison && comparison.length >= 2 && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {comparison.map((agent, i) => (
                <Card key={agent.id} style={{ borderTop: `3px solid ${COLORS[i]}` }}>
                  <CardContent className="pt-4">
                    <h3 className="font-semibold text-foreground mb-1 truncate">{agent.name}</h3>
                    {agent.subTeam && <p className="text-xs text-muted-foreground mb-3">{agent.subTeam}</p>}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Avg Score</span>
                        <span className="font-bold" style={{ color: COLORS[i] }}>{agent.avgScore?.toFixed(1) ?? "N/A"}/10</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1"><BarChart2 className="w-3 h-3" /> Calls</span>
                        <span className="font-medium">{agent.callCount}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Avg Duration</span>
                        <span className="font-medium">{formatDuration(agent.avgDuration)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1"><Heart className="w-3 h-3" /> Positive %</span>
                        <span className="font-medium text-green-600">
                          {agent.callCount > 0
                            ? Math.round((agent.sentimentBreakdown.positive / agent.callCount) * 100)
                            : 0}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Radar chart — sub-scores comparison */}
            {radarData.length > 0 && radarData.some(d => Object.values(d).some(v => typeof v === "number" && v > 0)) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Sub-Score Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                      {comparison.map((agent, i) => (
                        <Radar
                          key={agent.id}
                          name={agent.name}
                          dataKey={agent.name}
                          stroke={COLORS[i]}
                          fill={COLORS[i]}
                          fillOpacity={0.15}
                          strokeWidth={2}
                        />
                      ))}
                      <Legend />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Sentiment comparison bar chart */}
            {sentimentData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Heart className="w-4 h-4" />
                    Sentiment Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={sentimentData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      <Bar dataKey="positive" name="Positive" fill="#22c55e" stackId="sent" />
                      <Bar dataKey="neutral" name="Neutral" fill="#94a3b8" stackId="sent" />
                      <Bar dataKey="negative" name="Negative" fill="#ef4444" stackId="sent" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Detailed sub-scores table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detailed Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">Metric</th>
                        {comparison.map((agent, i) => (
                          <th key={agent.id} className="text-center py-2 px-3 font-medium" style={{ color: COLORS[i] }}>
                            {agent.name.split(" ")[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Overall Score", key: "avgScore", fmt: (v: number | null) => v?.toFixed(1) ?? "N/A" },
                        { label: "Compliance", key: "compliance", sub: true, fmt: (v: number | null) => v?.toFixed(1) ?? "N/A" },
                        { label: "Customer Exp.", key: "customerExperience", sub: true, fmt: (v: number | null) => v?.toFixed(1) ?? "N/A" },
                        { label: "Communication", key: "communication", sub: true, fmt: (v: number | null) => v?.toFixed(1) ?? "N/A" },
                        { label: "Resolution", key: "resolution", sub: true, fmt: (v: number | null) => v?.toFixed(1) ?? "N/A" },
                        { label: "Total Calls", key: "callCount", fmt: (v: number | null) => String(v ?? 0) },
                        { label: "Avg Duration", key: "avgDuration", fmt: (v: number | null) => formatDuration(v) },
                        { label: "AI Confidence", key: "avgConfidence", fmt: (v: number | null) => v ? `${(v * 100).toFixed(0)}%` : "N/A" },
                      ].map(row => {
                        const values = comparison.map(a => {
                          if (row.sub && a.avgSubScores) {
                            return (a.avgSubScores as Record<string, number | null>)[row.key] ?? null;
                          }
                          return (a as unknown as Record<string, number | null>)[row.key] ?? null;
                        });
                        const best = values.reduce<number>((maxI, v, i) =>
                          v != null && (values[maxI] == null || v > (values[maxI] ?? 0)) ? i : maxI, 0);

                        return (
                          <tr key={row.key} className="border-b border-border last:border-0">
                            <td className="py-2 px-3 text-muted-foreground">{row.label}</td>
                            {values.map((v, i) => (
                              <td key={i} className={`text-center py-2 px-3 font-medium ${i === best && v != null ? "text-green-600" : ""}`}>
                                {row.fmt(v)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
