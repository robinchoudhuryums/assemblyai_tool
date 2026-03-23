import { useMemo, useState, useCallback } from "react";
import { ArrowCounterClockwise, CaretDown, CaretUp, Eye, EyeSlash, GearSix, MagnifyingGlass, Plus, TrendUp, Trophy, Warning } from "@phosphor-icons/react";
import { useTranslation } from "@/lib/i18n";
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
import { loadWidgetConfig, saveWidgetConfig, moveWidget, toggleWidget, DEFAULT_WIDGETS, type WidgetConfig } from "@/lib/dashboard-config";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadWidgetConfig);
  const [showConfig, setShowConfig] = useState(false);

  const updateWidgets = useCallback((updater: (prev: WidgetConfig[]) => WidgetConfig[]) => {
    setWidgets(prev => {
      const next = updater(prev);
      saveWidgetConfig(next);
      return next;
    });
  }, []);

  const isVisible = useCallback((id: string) => widgets.find(w => w.id === id)?.visible ?? true, [widgets]);

  // Fetch recent calls to extract flagged ones for the dashboard alert panel
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
  });
  const calls = callsResponse?.calls;

  // Single pass over calls to classify flagged calls
  const { flaggedCalls, badCalls, goodCalls } = useMemo(() => {
    const flagged: CallWithDetails[] = [];
    const bad: CallWithDetails[] = [];
    const good: CallWithDetails[] = [];
    for (const c of calls || []) {
      const flags = c.analysis?.flags;
      if (!Array.isArray(flags) || flags.length === 0) continue;
      const isBad = flags.some(f => typeof f === "string" && (f === "low_score" || f.startsWith("agent_misconduct")));
      const isGood = flags.includes("exceptional_call");
      if (isBad || isGood) {
        flagged.push(c);
        if (isBad) bad.push(c);
        if (isGood) good.push(c);
      }
    }
    return { flaggedCalls: flagged, badCalls: bad, goodCalls: good };
  }, [calls]);

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
            <h2 className="text-2xl font-bold text-foreground">{t("dashboard.title")}</h2>
            <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              className="w-64 justify-start text-muted-foreground"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <MagnifyingGlass className="w-4 h-4 mr-2" />
              {t("dashboard.searchCalls")}
            </Button>
            <Link href="/upload">
              <Button data-testid="upload-call-button">
                <Plus className="w-4 h-4 mr-2" />
                {t("dashboard.uploadCall")}
              </Button>
            </Link>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)} aria-label="Customize dashboard">
            <GearSix className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Widget configuration panel */}
      {showConfig && (
        <div className="bg-card border-b border-border px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">Customize Dashboard</h3>
            <Button
              variant="ghost" size="sm" className="text-xs h-7"
              onClick={() => updateWidgets(() => DEFAULT_WIDGETS)}
            >
              <ArrowCounterClockwise className="w-3 h-3 mr-1" /> Reset
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {widgets.map((w, i) => (
              <div key={w.id} className="flex items-center gap-1 bg-muted rounded-md px-2 py-1">
                <button
                  onClick={() => updateWidgets(prev => toggleWidget(prev, w.id))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={w.visible ? `Hide ${w.label}` : `Show ${w.label}`}
                >
                  {w.visible ? <Eye className="w-3 h-3" /> : <EyeSlash className="w-3 h-3" />}
                </button>
                <span className={`text-xs ${w.visible ? "text-foreground" : "text-muted-foreground line-through"}`}>{w.label}</span>
                <button
                  onClick={() => updateWidgets(prev => moveWidget(prev, w.id, "up"))}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${w.label} up`}
                >
                  <CaretUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => updateWidgets(prev => moveWidget(prev, w.id, "down"))}
                  disabled={i === widgets.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${w.label} down`}
                >
                  <CaretDown className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Flagged Calls Alert Banner */}
        {isVisible("alerts") && flaggedCalls.length > 0 && (
          <div className="space-y-4">
            {badCalls.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(239,68,68,0.25)]">
                    <Warning className="w-5 h-5 text-red-500" weight="fill" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-red-600 dark:text-red-400 text-base">
                      {badCalls.length} Call{badCalls.length > 1 ? "s" : ""} Need Attention
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Calls flagged for low scores or agent misconduct.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {badCalls.slice(0, 5).map(c => (
                        <Link key={c.id} href={`/transcripts/${c.id}`}>
                          <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                            {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                          </Badge>
                        </Link>
                      ))}
                      {badCalls.length > 5 && (
                        <Link href="/reports">
                          <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted">+{badCalls.length - 5} more</Badge>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {goodCalls.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.25)]">
                    <Trophy className="w-5 h-5 text-emerald-500" weight="fill" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-emerald-600 dark:text-emerald-400 text-base">
                      {goodCalls.length} Exceptional Call{goodCalls.length > 1 ? "s" : ""}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Calls where agents went above and beyond.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {goodCalls.slice(0, 5).map(c => (
                        <Link key={c.id} href={`/transcripts/${c.id}`}>
                          <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                            {c.employee?.name || "Unassigned"} — {Number(c.analysis?.performanceScore || 0).toFixed(1)}
                          </Badge>
                        </Link>
                      ))}
                      {goodCalls.length > 5 && (
                        <Link href="/reports">
                          <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted">+{goodCalls.length - 5} more</Badge>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metrics Overview */}
        {isVisible("metrics") && <MetricsOverview />}

        {/* Sentiment & Call Volume Trend (Last 30 Days) */}
        {isVisible("trend") && trendData.length > 0 && trendData.some(d => d.calls > 0) && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <TrendUp className="w-5 h-5 mr-2" />
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
        {isVisible("upload") && <FileUpload />}

        {(isVisible("sentiment") || isVisible("performers")) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {isVisible("sentiment") && <SentimentAnalysis />}
            {isVisible("performers") && <PerformanceCard />}
          </div>
        )}

        {/* Recent Calls Table */}
        {isVisible("calls") && <CallsTable />}
      </div>
    </div>
  );
}
