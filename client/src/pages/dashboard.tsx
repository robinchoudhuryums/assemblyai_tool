import { useMemo } from "react";
import { Search, Plus, AlertTriangle, Award, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import SentimentAnalysis from "@/components/dashboard/sentiment-analysis";
import PerformanceCard from "@/components/dashboard/performance-card";
import FileUpload from "@/components/upload/file-upload";
import CallsTable from "@/components/tables/calls-table";
import type { CallWithDetails, PaginatedCalls } from "@shared/schema";

export default function Dashboard() {
  const [, navigate] = useLocation();

  // Fetch recent calls to extract flagged ones for the dashboard alert panel
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
  });
  const calls = callsResponse?.calls;

  const flaggedCalls = (calls || []).filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.length > 0 && flags.some(f =>
      f === "low_score" || f.startsWith("agent_misconduct") || f === "exceptional_call"
    );
  });

  const badCalls = flaggedCalls.filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
  });
  const goodCalls = flaggedCalls.filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.includes("exceptional_call");
  });

  // Compute daily trend data from calls for the last 30 days
  const trendData = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dayMap = new Map<string, { calls: number; positive: number; neutral: number; negative: number; totalScore: number; scored: number }>();

    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(5, 10); // MM-DD
      dayMap.set(key, { calls: 0, positive: 0, neutral: 0, negative: 0, totalScore: 0, scored: 0 });
    }

    for (const call of calls) {
      const date = new Date(call.uploadedAt || 0);
      if (date < thirtyDaysAgo) continue;
      const key = date.toISOString().slice(5, 10);
      const entry = dayMap.get(key);
      if (!entry) continue;
      entry.calls++;
      const sent = call.sentiment?.overallSentiment;
      if (sent === "positive") entry.positive++;
      else if (sent === "negative") entry.negative++;
      else if (sent === "neutral") entry.neutral++;
      if (call.analysis?.performanceScore) {
        entry.totalScore += parseFloat(call.analysis.performanceScore);
        entry.scored++;
      }
    }

    return Array.from(dayMap.entries()).map(([day, data]) => ({
      day,
      calls: data.calls,
      positive: data.positive,
      neutral: data.neutral,
      negative: data.negative,
      avgScore: data.scored > 0 ? Math.round((data.totalScore / data.scored) * 10) / 10 : null,
    }));
  }, [calls]);

  return (
    <div className="min-h-screen" data-testid="dashboard-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call Analysis Dashboard</h2>
            <p className="text-muted-foreground">Monitor performance and sentiment across all customer interactions</p>
          </div>
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              className="w-64 justify-start text-muted-foreground"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <Search className="w-4 h-4 mr-2" />
              Search calls...
            </Button>
            <Link href="/upload">
              <Button data-testid="upload-call-button">
                <Plus className="w-4 h-4 mr-2" />
                Upload Call
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Flagged Calls Alert Banner */}
        {flaggedCalls.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {badCalls.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3 className="font-semibold text-red-700 dark:text-red-400">
                    {badCalls.length} Call{badCalls.length > 1 ? "s" : ""} Need Attention
                  </h3>
                </div>
                <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-2">
                  Calls flagged for low scores or agent misconduct.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {badCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-red-200 text-red-900 text-xs cursor-pointer hover:bg-red-300">
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {badCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{badCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
            {goodCalls.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {goodCalls.length} Exceptional Call{goodCalls.length > 1 ? "s" : ""}
                  </h3>
                </div>
                <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mb-2">
                  Calls where agents went above and beyond.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {goodCalls.slice(0, 5).map(c => (
                    <Link key={c.id} href={`/transcripts/${c.id}`}>
                      <Badge className="bg-emerald-200 text-emerald-900 text-xs cursor-pointer hover:bg-emerald-300">
                        <Award className="w-3 h-3 mr-1" />
                        {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                      </Badge>
                    </Link>
                  ))}
                  {goodCalls.length > 5 && (
                    <Link href="/reports">
                      <Badge variant="outline" className="text-xs cursor-pointer">+{goodCalls.length - 5} more</Badge>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metrics Overview */}
        <MetricsOverview />

        {/* Sentiment & Call Volume Trend (Last 30 Days) */}
        {trendData.length > 0 && trendData.some(d => d.calls > 0) && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Sentiment &amp; Volume — Last 30 Days
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Legend />
                <Area type="monotone" dataKey="positive" name="Positive" stackId="sentiment" stroke="#22c55e" fill="url(#greenGrad)" />
                <Area type="monotone" dataKey="neutral" name="Neutral" stackId="sentiment" stroke="#94a3b8" fill="url(#grayGrad)" />
                <Area type="monotone" dataKey="negative" name="Negative" stackId="sentiment" stroke="#ef4444" fill="url(#redGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* File Upload Section */}
        <FileUpload />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Analysis */}
          <SentimentAnalysis />

          {/* Top Performers */}
          <PerformanceCard />
        </div>

        {/* Recent Calls Table */}
        <CallsTable />
      </div>
    </div>
  );
}
