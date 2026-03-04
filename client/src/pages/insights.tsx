import { useQuery } from "@tanstack/react-query";
import { Building2, TrendingDown, AlertTriangle, BarChart3, MessageCircle, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from "recharts";

interface InsightsData {
  totalAnalyzed: number;
  topTopics: Array<{ topic: string; count: number }>;
  topComplaints: Array<{ topic: string; count: number }>;
  escalationPatterns: Array<{ summary: string; callId: string; date: string; score: number }>;
  weeklyTrend: Array<{ week: string; positive: number; neutral: number; negative: number; total: number }>;
  lowConfidenceCalls: Array<{ callId: string; date: string; confidence: number; employee: string }>;
  summary: {
    avgScore: number;
    negativeCallRate: number;
    escalationRate: number;
  };
}

export default function InsightsPage() {
  const { data: insights, isLoading } = useQuery<InsightsData>({
    queryKey: ["/api/insights"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="bg-card border-b border-border px-6 py-4">
          <h2 className="text-2xl font-bold text-foreground">Company Insights</h2>
          <p className="text-muted-foreground">Loading...</p>
        </header>
        <div className="p-6 space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!insights || insights.totalAnalyzed === 0) {
    return (
      <div className="min-h-screen">
        <header className="bg-card border-b border-border px-6 py-4">
          <h2 className="text-2xl font-bold text-foreground">Company Insights</h2>
          <p className="text-muted-foreground">Trends and patterns across all calls</p>
        </header>
        <div className="p-6">
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-primary/60" />
            </div>
            <h4 className="font-semibold text-foreground mb-1">No data yet</h4>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Upload and process calls to see company-wide insights, complaint trends, and process improvement opportunities.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" data-testid="insights-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Company Insights</h2>
          <p className="text-muted-foreground">
            Customer experience trends, complaint patterns, and process improvement opportunities across {insights.totalAnalyzed} analyzed calls
          </p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Average Performance</p>
              <p className="text-3xl font-bold text-foreground">{insights.summary.avgScore.toFixed(1)}/10</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Negative Call Rate</p>
              <p className="text-3xl font-bold text-foreground">{(insights.summary.negativeCallRate * 100).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">of calls have negative sentiment</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Escalation Rate</p>
              <p className="text-3xl font-bold text-foreground">{(insights.summary.escalationRate * 100).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">of calls scored 4.0 or below</p>
            </CardContent>
          </Card>
        </div>

        {/* Weekly Sentiment Trend */}
        {insights.weeklyTrend.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-muted-foreground" />
                Customer Sentiment Over Time
              </CardTitle>
              <CardDescription>Weekly breakdown of positive, neutral, and negative calls</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={insights.weeklyTrend}>
                  <defs>
                    <linearGradient id="insGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="insGray" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="insRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Legend />
                  <Area type="monotone" dataKey="positive" name="Positive" stackId="s" stroke="#22c55e" fill="url(#insGreen)" />
                  <Area type="monotone" dataKey="neutral" name="Neutral" stackId="s" stroke="#94a3b8" fill="url(#insGray)" />
                  <Area type="monotone" dataKey="negative" name="Negative" stackId="s" stroke="#ef4444" fill="url(#insRed)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Complaint Topics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Top Complaint Topics
              </CardTitle>
              <CardDescription>Most frequent topics in negative-sentiment calls</CardDescription>
            </CardHeader>
            <CardContent>
              {insights.topComplaints.length > 0 ? (
                <div className="space-y-2">
                  {insights.topComplaints.slice(0, 10).map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-medium">{item.topic}</span>
                          <span className="text-xs text-muted-foreground">{item.count} call{item.count > 1 ? "s" : ""}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400"
                            style={{ width: `${Math.min((item.count / (insights.topComplaints[0]?.count || 1)) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No complaint patterns detected yet</p>
              )}
            </CardContent>
          </Card>

          {/* Most Common Topics Overall */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-500" />
                Most Common Call Topics
              </CardTitle>
              <CardDescription>Topics discussed most frequently across all calls</CardDescription>
            </CardHeader>
            <CardContent>
              {insights.topTopics.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={insights.topTopics.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis dataKey="topic" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Bar dataKey="count" name="Calls" radius={[0, 4, 4, 0]}>
                      {insights.topTopics.slice(0, 8).map((_, idx) => (
                        <Cell key={idx} fill={`hsl(${210 + idx * 15}, 60%, ${50 + idx * 3}%)`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No topics detected yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Escalation Patterns */}
        {insights.escalationPatterns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                Recent Escalations & Low-Score Calls
              </CardTitle>
              <CardDescription>
                Calls scoring 4.0 or below — potential process improvement opportunities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {insights.escalationPatterns.slice(0, 10).map((esc, i) => (
                  <Link key={i} href={`/transcripts/${esc.callId}`}>
                    <div className="flex items-start gap-3 p-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                        {esc.score.toFixed(1)}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground line-clamp-2">{esc.summary}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {esc.date ? new Date(esc.date).toLocaleDateString() : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Low Confidence Calls */}
        {insights.lowConfidenceCalls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-yellow-500" />
                Low Confidence Analyses
              </CardTitle>
              <CardDescription>
                These calls may need manual review — AI confidence is below 70%
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {insights.lowConfidenceCalls.map((call, i) => (
                  <Link key={i} href={`/transcripts/${call.callId}`}>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                      <Badge variant="outline" className="shrink-0">
                        {(call.confidence * 100).toFixed(0)}%
                      </Badge>
                      <span className="text-sm text-foreground">{call.employee}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {call.date ? new Date(call.date).toLocaleDateString() : ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
