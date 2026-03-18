import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Printer, ArrowLeft, Star, TrendingUp, AlertTriangle, Award, MessageCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingIndicator } from "@/components/ui/loading";
import type { Employee } from "@shared/schema";

interface AgentProfileData {
  employee: { id: string; name: string; role: string; status: string };
  totalCalls: number;
  avgPerformanceScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  scoreTrend: Array<{ month: string; avgScore: number; calls: number }>;
  flaggedCalls: Array<{
    id: string;
    fileName?: string;
    uploadedAt?: string;
    score: number | null;
    summary?: string;
    flags: string[];
    sentiment?: string;
    flagType: "good" | "bad";
  }>;
}

export default function AgentScorecard() {
  const [, params] = useRoute("/scorecard/:id");
  const employeeId = params?.id;
  const printRef = useRef<HTMLDivElement>(null);

  const { data: profile, isLoading, error } = useQuery<AgentProfileData>({
    queryKey: [`/api/reports/agent-profile/${employeeId}`],
    enabled: !!employeeId,
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingIndicator text="Loading agent scorecard..." />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-6">
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Agent Not Found</h3>
          <p className="text-sm text-muted-foreground mb-4">Could not load scorecard for this agent.</p>
          <Link href="/employees"><Button variant="outline">Back to Employees</Button></Link>
        </div>
      </div>
    );
  }

  const { employee, totalCalls, avgPerformanceScore, highScore, lowScore, sentimentBreakdown, topStrengths, topSuggestions, commonTopics, scoreTrend, flaggedCalls } = profile;
  const totalSentiment = sentimentBreakdown.positive + sentimentBreakdown.neutral + sentimentBreakdown.negative;
  const pct = (v: number) => totalSentiment > 0 ? Math.round((v / totalSentiment) * 100) : 0;

  const scoreColor = (s: number | null) => {
    if (s == null) return "text-muted-foreground";
    return s >= 8 ? "text-green-600" : s >= 6 ? "text-blue-600" : s >= 4 ? "text-yellow-600" : "text-red-600";
  };

  const goodFlags = flaggedCalls.filter(f => f.flagType === "good");
  const badFlags = flaggedCalls.filter(f => f.flagType === "bad");

  return (
    <div className="min-h-screen">
      {/* Screen-only header */}
      <header className="bg-card border-b border-border px-6 py-4 print:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/employees">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
            </Link>
            <div>
              <h2 className="text-2xl font-bold text-foreground">Agent Scorecard</h2>
              <p className="text-muted-foreground">{employee.name} - Performance Summary</p>
            </div>
          </div>
          <Button onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" /> Print Scorecard
          </Button>
        </div>
      </header>

      {/* Printable scorecard */}
      <div ref={printRef} className="p-6 max-w-4xl mx-auto print:p-4 print:max-w-none">
        {/* Agent Header */}
        <div className="bg-card rounded-lg border border-border p-6 mb-6 print:mb-4 print:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center print:w-12 print:h-12">
                <span className="text-primary font-bold text-xl print:text-base">
                  {employee.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground print:text-xl">{employee.name}</h1>
                <p className="text-muted-foreground">{employee.role} - {employee.status}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Overall Score</p>
              <p className={`text-4xl font-bold ${scoreColor(avgPerformanceScore)} print:text-3xl`}>
                {avgPerformanceScore != null ? avgPerformanceScore.toFixed(1) : "N/A"}
                <span className="text-lg text-muted-foreground">/10</span>
              </p>
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-4 gap-4 mb-6 print:mb-4 print:gap-2">
          <div className="bg-card rounded-lg border border-border p-4 text-center print:p-2">
            <p className="text-2xl font-bold text-foreground print:text-xl">{totalCalls}</p>
            <p className="text-xs text-muted-foreground">Total Calls</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4 text-center print:p-2">
            <p className={`text-2xl font-bold print:text-xl ${scoreColor(highScore)}`}>
              {highScore != null ? highScore.toFixed(1) : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">High Score</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4 text-center print:p-2">
            <p className={`text-2xl font-bold print:text-xl ${scoreColor(lowScore)}`}>
              {lowScore != null ? lowScore.toFixed(1) : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">Low Score</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4 text-center print:p-2">
            <p className="text-2xl font-bold text-green-600 print:text-xl">{pct(sentimentBreakdown.positive)}%</p>
            <p className="text-xs text-muted-foreground">Positive Sentiment</p>
          </div>
        </div>

        {/* Sentiment Breakdown */}
        <div className="bg-card rounded-lg border border-border p-4 mb-6 print:mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Sentiment Breakdown</h3>
          <div className="flex h-4 rounded-full overflow-hidden bg-muted">
            {sentimentBreakdown.positive > 0 && (
              <div className="bg-green-500 transition-all" style={{ width: `${pct(sentimentBreakdown.positive)}%` }} />
            )}
            {sentimentBreakdown.neutral > 0 && (
              <div className="bg-yellow-400 transition-all" style={{ width: `${pct(sentimentBreakdown.neutral)}%` }} />
            )}
            {sentimentBreakdown.negative > 0 && (
              <div className="bg-red-500 transition-all" style={{ width: `${pct(sentimentBreakdown.negative)}%` }} />
            )}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Positive: {sentimentBreakdown.positive} ({pct(sentimentBreakdown.positive)}%)</span>
            <span>Neutral: {sentimentBreakdown.neutral} ({pct(sentimentBreakdown.neutral)}%)</span>
            <span>Negative: {sentimentBreakdown.negative} ({pct(sentimentBreakdown.negative)}%)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6 print:gap-3 print:mb-4">
          {/* Strengths */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> Top Strengths
            </h3>
            {topStrengths.length > 0 ? (
              <ul className="space-y-2">
                {topStrengths.slice(0, 5).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-green-500 mt-0.5 shrink-0">+</span>
                    <span className="text-muted-foreground flex-1">{s.text}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{s.count}x</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No strengths data yet</p>
            )}
          </div>

          {/* Areas for Improvement */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-amber-500" /> Areas for Improvement
            </h3>
            {topSuggestions.length > 0 ? (
              <ul className="space-y-2">
                {topSuggestions.slice(0, 5).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                    <span className="text-muted-foreground flex-1">{s.text}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{s.count}x</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No suggestions data yet</p>
            )}
          </div>
        </div>

        {/* Common Topics */}
        {commonTopics.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4 mb-6 print:mb-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Common Topics</h3>
            <div className="flex flex-wrap gap-2">
              {commonTopics.slice(0, 10).map((t, i) => (
                <Badge key={i} variant="outline" className="bg-primary/5 text-primary">
                  {t.text} ({t.count})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Score Trend */}
        {scoreTrend.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4 mb-6 print:mb-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" /> Score Trend
            </h3>
            <div className="flex items-end gap-1 h-20">
              {scoreTrend.slice(-12).map((point, i) => {
                const height = point.avgScore ? `${(point.avgScore / 10) * 100}%` : "0%";
                const color = point.avgScore >= 8 ? "bg-green-500" : point.avgScore >= 6 ? "bg-blue-500" : point.avgScore >= 4 ? "bg-yellow-500" : "bg-red-500";
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-muted-foreground">{point.avgScore?.toFixed(1)}</span>
                    <div className="w-full bg-muted rounded-sm overflow-hidden" style={{ height: "100%" }}>
                      <div className={`w-full ${color} rounded-sm transition-all`} style={{ height, marginTop: "auto", position: "relative", bottom: 0 }} />
                    </div>
                    <span className="text-[8px] text-muted-foreground">{point.month.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Flagged Calls */}
        {flaggedCalls.length > 0 && (
          <div className="grid grid-cols-2 gap-4 print:gap-2">
            {goodFlags.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900 p-4 print:p-2">
                <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1.5">
                  <Award className="w-4 h-4" /> Exceptional Calls ({goodFlags.length})
                </h3>
                <ul className="space-y-1">
                  {goodFlags.slice(0, 3).map(f => (
                    <li key={f.id} className="text-xs text-muted-foreground">
                      Score: {f.score?.toFixed(1) || "N/A"} - {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {badFlags.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900 p-4 print:p-2">
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Flagged Calls ({badFlags.length})
                </h3>
                <ul className="space-y-1">
                  {badFlags.slice(0, 3).map(f => (
                    <li key={f.id} className="text-xs text-muted-foreground">
                      Score: {f.score?.toFixed(1) || "N/A"} - {f.flags.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Print footer */}
        <div className="hidden print:block mt-8 pt-4 border-t border-border text-center text-xs text-muted-foreground">
          Generated by CallAnalyzer on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
