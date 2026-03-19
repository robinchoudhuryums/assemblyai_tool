import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Layers, TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import type { Employee } from "@shared/schema";

interface TopicCluster {
  id: string;
  label: string;
  topics: string[];
  callCount: number;
  callIds: string[];
  avgScore: number | null;
  avgSentiment: { positive: number; neutral: number; negative: number };
  trend: "rising" | "stable" | "declining";
  recentCallIds: string[];
}

const TREND_ICONS = {
  rising: <TrendingUp className="w-4 h-4 text-red-500" />,
  stable: <Minus className="w-4 h-4 text-muted-foreground" />,
  declining: <TrendingDown className="w-4 h-4 text-green-500" />,
};

const TREND_LABELS = {
  rising: "Rising",
  stable: "Stable",
  declining: "Declining",
};

export default function CallClusters() {
  const [days, setDays] = useState("30");
  const [employeeId, setEmployeeId] = useState("all");

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const queryParams = new URLSearchParams({ days });
  if (employeeId !== "all") queryParams.set("employee", employeeId);

  const { data, isLoading } = useQuery<{ clusters: TopicCluster[]; days: number }>({
    queryKey: ["/api/analytics/clusters", days, employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/clusters?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clusters");
      return res.json();
    },
  });

  const clusters = data?.clusters || [];
  const risingCount = clusters.filter(c => c.trend === "rising").length;

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Layers className="w-6 h-6" />
          Call Clusters
        </h2>
        <p className="text-muted-foreground">Calls grouped by topic similarity — surface trending issues</p>
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
          {risingCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {risingCount} rising trend{risingCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6 space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : clusters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No clusters found. Need at least 2 completed calls with AI analysis.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clusters.map((cluster, i) => {
              const total = cluster.avgSentiment.positive + cluster.avgSentiment.neutral + cluster.avgSentiment.negative;
              const positivePct = total > 0 ? Math.round((cluster.avgSentiment.positive / total) * 100) : 0;
              const negativePct = total > 0 ? Math.round((cluster.avgSentiment.negative / total) * 100) : 0;

              return (
                <Card key={cluster.id} className={`card-interactive animate-stagger ${cluster.trend === "rising" ? "border-red-300 dark:border-red-800" : ""}`} style={{ "--stagger": i } as React.CSSProperties}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-semibold capitalize leading-tight">
                        {cluster.label}
                      </CardTitle>
                      <div className="flex items-center gap-1 text-xs shrink-0" title={`Trend: ${TREND_LABELS[cluster.trend]}`}>
                        {TREND_ICONS[cluster.trend]}
                        <span className="text-muted-foreground">{TREND_LABELS[cluster.trend]}</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Topic tags */}
                    <div className="flex flex-wrap gap-1">
                      {cluster.topics.map((topic, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                          {topic}
                        </Badge>
                      ))}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Calls</span>
                        <p className="font-semibold">{cluster.callCount}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Score</span>
                        <p className={`font-semibold ${cluster.avgScore != null && cluster.avgScore < 5 ? "text-red-500" : cluster.avgScore != null && cluster.avgScore >= 8 ? "text-green-500" : ""}`}>
                          {cluster.avgScore?.toFixed(1) ?? "N/A"}/10
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Recent (7d)</span>
                        <p className="font-semibold">{cluster.recentCallIds.length}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Sentiment</span>
                        <div className="flex gap-1 items-center">
                          <span className="text-green-500 font-semibold">{positivePct}%</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-red-500 font-semibold">{negativePct}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Sentiment bar */}
                    {total > 0 && (
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                        <div className="bg-green-500" style={{ width: `${positivePct}%` }} />
                        <div className="bg-gray-400" style={{ width: `${100 - positivePct - negativePct}%` }} />
                        <div className="bg-red-500" style={{ width: `${negativePct}%` }} />
                      </div>
                    )}

                    {/* Link to browse calls */}
                    {cluster.recentCallIds.length > 0 && (
                      <Link href={`/transcripts/${cluster.recentCallIds[0]}`}>
                        <span className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">
                          View latest call <ArrowRight className="w-3 h-3" />
                        </span>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
