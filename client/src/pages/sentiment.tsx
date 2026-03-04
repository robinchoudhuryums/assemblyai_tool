import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Smile, Frown, Minus, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { CallWithDetails } from "@shared/schema";

interface SentimentData {
  positive: number;
  neutral: number;
  negative: number;
}

export default function SentimentPage() {
  const { data: sentiment, isLoading } = useQuery<SentimentData>({
    queryKey: ["/api/dashboard/sentiment"],
  });

  const { data: calls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
  });

  // Build weekly trend from calls data
  const weeklyTrend = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Group by week
    const weekMap = new Map<string, { positive: number; neutral: number; negative: number }>();

    for (const call of calls) {
      const date = new Date(call.uploadedAt || 0);
      if (date < ninetyDaysAgo) continue;
      const sent = call.sentiment?.overallSentiment;
      if (!sent) continue;

      // Week key: ISO week start
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().slice(5, 10);
      const entry = weekMap.get(key) || { positive: 0, neutral: 0, negative: 0 };
      if (sent === "positive") entry.positive++;
      else if (sent === "neutral") entry.neutral++;
      else if (sent === "negative") entry.negative++;
      weekMap.set(key, entry);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, data]) => ({ week, ...data }));
  }, [calls]);

  // Per-employee sentiment breakdown
  const employeeSentiment = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const empMap = new Map<string, { name: string; positive: number; neutral: number; negative: number; total: number }>();

    for (const call of calls) {
      if (!call.employee?.name || !call.sentiment?.overallSentiment) continue;
      const name = call.employee.name;
      const entry = empMap.get(name) || { name, positive: 0, neutral: 0, negative: 0, total: 0 };
      entry.total++;
      const sent = call.sentiment.overallSentiment;
      if (sent === "positive") entry.positive++;
      else if (sent === "neutral") entry.neutral++;
      else if (sent === "negative") entry.negative++;
      empMap.set(name, entry);
    }

    return Array.from(empMap.values())
      .filter(e => e.total >= 1)
      .sort((a, b) => (b.positive / b.total) - (a.positive / a.total))
      .slice(0, 10);
  }, [calls]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Loading sentiment data...</p></div>;
  }

  const positive = sentiment?.positive ?? 0;
  const neutral = sentiment?.neutral ?? 0;
  const negative = sentiment?.negative ?? 0;
  const total = positive + neutral + negative;
  const pct = (val: number) => total > 0 ? Math.round((val / total) * 100) : 0;

  const pieData = [
    { name: "Positive", value: positive, color: "#22c55e" },
    { name: "Neutral", value: neutral, color: "#94a3b8" },
    { name: "Negative", value: negative, color: "#ef4444" },
  ];

  return (
    <div className="min-h-screen" data-testid="sentiment-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Sentiment Analysis</h2>
          <p className="text-muted-foreground">Overall sentiment distribution and trends across all analyzed calls.</p>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <Smile className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Positive Calls</p>
              <p className="text-3xl font-bold text-foreground">{positive}</p>
              <p className="text-xs text-green-600 font-medium">{pct(positive)}% of total</p>
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Minus className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Neutral Calls</p>
              <p className="text-3xl font-bold text-foreground">{neutral}</p>
              <p className="text-xs text-gray-500 font-medium">{pct(neutral)}% of total</p>
            </div>
          </div>

          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <Frown className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Negative Calls</p>
              <p className="text-3xl font-bold text-foreground">{negative}</p>
              <p className="text-xs text-red-600 font-medium">{pct(negative)}% of total</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Distribution</h3>
            {total > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px]">
                <p className="text-muted-foreground">No sentiment data yet</p>
              </div>
            )}
          </div>

          {/* Weekly Trend Chart */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Weekly Trend (Last 90 Days)
            </h3>
            {weeklyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={weeklyTrend}>
                  <defs>
                    <linearGradient id="sentGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sentGray" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sentRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Area type="monotone" dataKey="positive" name="Positive" stackId="1" stroke="#22c55e" fill="url(#sentGreen)" />
                  <Area type="monotone" dataKey="neutral" name="Neutral" stackId="1" stroke="#94a3b8" fill="url(#sentGray)" />
                  <Area type="monotone" dataKey="negative" name="Negative" stackId="1" stroke="#ef4444" fill="url(#sentRed)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px]">
                <p className="text-muted-foreground">Not enough data for trend</p>
              </div>
            )}
          </div>
        </div>

        {/* Per-Employee Sentiment Breakdown */}
        {employeeSentiment.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Agent Sentiment Breakdown</h3>
            <div className="space-y-3">
              {employeeSentiment.map((emp) => (
                <div key={emp.name} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-32 truncate">{emp.name}</span>
                  <div className="flex-1 flex h-5 rounded-full overflow-hidden bg-muted">
                    {emp.positive > 0 && (
                      <div
                        className="bg-green-500 h-full flex items-center justify-center"
                        style={{ width: `${(emp.positive / emp.total) * 100}%` }}
                      >
                        {emp.positive > 1 && <span className="text-[9px] text-white font-bold">{emp.positive}</span>}
                      </div>
                    )}
                    {emp.neutral > 0 && (
                      <div
                        className="bg-slate-400 h-full flex items-center justify-center"
                        style={{ width: `${(emp.neutral / emp.total) * 100}%` }}
                      >
                        {emp.neutral > 1 && <span className="text-[9px] text-white font-bold">{emp.neutral}</span>}
                      </div>
                    )}
                    {emp.negative > 0 && (
                      <div
                        className="bg-red-500 h-full flex items-center justify-center"
                        style={{ width: `${(emp.negative / emp.total) * 100}%` }}
                      >
                        {emp.negative > 1 && <span className="text-[9px] text-white font-bold">{emp.negative}</span>}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right">{emp.total} calls</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 pt-3 border-t border-border">
              <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-green-500" /> Positive</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-slate-400" /> Neutral</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-2 h-2 rounded-full bg-red-500" /> Negative</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
