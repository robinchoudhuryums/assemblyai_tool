import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowRight, ClipboardText, Fire, Heart, Medal, Phone, Star, TrendUp, Trophy, User } from "@phosphor-icons/react";
import { ScoreRing } from "@/components/ui/animated-number";
import type { CallWithDetails, CoachingSession } from "@shared/schema";

interface BadgeData {
  id: string;
  badgeType: string;
  label: string;
  description: string;
  icon: string;
  earnedAt?: string;
}

interface WeeklyTrend {
  week: string;
  avgScore: number;
  count: number;
}

interface MyPerformanceData {
  employee: { id: string; name: string } | null;
  recentCalls: CallWithDetails[];
  coaching: CoachingSession[];
  avgScore: number | null;
  callCount: number;
  positivePct: number;
  badges: BadgeData[];
  currentStreak: number;
  totalPoints: number;
  weeklyTrend: WeeklyTrend[];
}

/**
 * Agent self-service portal.
 * Viewers see their own performance scores, badges, trends, and coaching sessions.
 * Requires the user to be linked to an employee record.
 */
export default function MyPerformancePage() {
  const queryClient = useQueryClient();

  const { data: me } = useQuery<{ id: string; username: string; name: string; role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: myData, isLoading } = useQuery<MyPerformanceData>({
    queryKey: ["/api/my-performance"],
    queryFn: async () => {
      const res = await fetch("/api/my-performance", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch performance data");
      return res.json();
    },
  });

  const toggleActionItem = useMutation({
    mutationFn: async ({ sessionId, index }: { sessionId: string; index: number }) => {
      const { getCsrfToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/coaching/${sessionId}/action-item/${index}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(getCsrfToken() ? { "x-csrf-token": getCsrfToken()! } : {}) },
      });
      if (!res.ok) throw new Error("Failed to toggle action item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-performance"] });
    },
  });

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <User className="w-6 h-6" />
          My Performance
        </h2>
        <p className="text-muted-foreground">
          {me?.name ? `Welcome, ${me.name}` : "Your personal performance dashboard"}
        </p>
      </header>

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : !myData?.employee ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No employee profile linked</p>
              <p className="text-sm mt-1">Ask your manager to link your account to an employee profile to see your performance data.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="animate-stagger" style={{ "--stagger": 0 } as React.CSSProperties}>
                <CardContent className="pt-4 flex items-center gap-4">
                  {myData.avgScore != null ? (
                    <ScoreRing score={myData.avgScore} size={56} strokeWidth={4} />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm">N/A</div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Score</p>
                    <p className="text-lg font-bold">{myData.avgScore?.toFixed(1) ?? "N/A"}/10</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="animate-stagger" style={{ "--stagger": 1 } as React.CSSProperties}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> Total Calls</p>
                  <p className="text-2xl font-bold">{myData.callCount}</p>
                </CardContent>
              </Card>
              <Card className="animate-stagger" style={{ "--stagger": 2 } as React.CSSProperties}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Heart className="w-3 h-3" /> Positive</p>
                  <p className="text-2xl font-bold text-green-600">{myData.positivePct}%</p>
                </CardContent>
              </Card>
              <Card className="animate-stagger" style={{ "--stagger": 3 } as React.CSSProperties}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Fire className="w-3 h-3" /> Streak</p>
                  <p className="text-2xl font-bold text-orange-500">{myData.currentStreak}</p>
                </CardContent>
              </Card>
              <Card className="animate-stagger" style={{ "--stagger": 4 } as React.CSSProperties}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Star className="w-3 h-3" /> Points</p>
                  <p className="text-2xl font-bold text-primary">{myData.totalPoints.toLocaleString()}</p>
                </CardContent>
              </Card>
            </div>

            {/* Badges */}
            {myData.badges.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Medal className="w-4 h-4" />
                    My Badges ({myData.badges.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {myData.badges.map(badge => (
                      <div
                        key={badge.id}
                        className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-full px-3 py-1.5"
                        title={badge.description}
                      >
                        <Trophy className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">{badge.label}</span>
                        {badge.earnedAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(badge.earnedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Weekly Trend */}
            {myData.weeklyTrend.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendUp className="w-4 h-4" />
                    Weekly Score Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2 h-32">
                    {myData.weeklyTrend.map((week, i) => {
                      const height = Math.max(10, (week.avgScore / 10) * 100);
                      const color = week.avgScore >= 8 ? "bg-green-500" : week.avgScore >= 5 ? "bg-primary" : "bg-red-400";
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs font-medium">{week.avgScore}</span>
                          <div
                            className={`w-full rounded-t ${color} transition-all`}
                            style={{ height: `${height}%` }}
                            title={`${week.count} call(s)`}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(week.week).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent calls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendUp className="w-4 h-4" />
                  Recent Calls
                </CardTitle>
              </CardHeader>
              <CardContent>
                {myData.recentCalls.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No calls yet.</p>
                ) : (
                  <div className="space-y-2">
                    {myData.recentCalls.slice(0, 10).map(call => {
                      const score = call.analysis?.performanceScore ? Number(call.analysis.performanceScore) : null;
                      return (
                        <Link key={call.id} href={`/transcripts/${call.id}`}>
                          <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors">
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-20">
                                {new Date(call.uploadedAt || "").toLocaleDateString()}
                              </span>
                              <span className="text-sm truncate max-w-xs">
                                {call.analysis?.summary
                                  ? (typeof call.analysis.summary === "string" ? call.analysis.summary : "").slice(0, 60) + "..."
                                  : "No summary"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {call.sentiment?.overallSentiment && (
                                <Badge variant="outline" className={`text-xs ${
                                  call.sentiment.overallSentiment === "positive" ? "border-green-300 text-green-600" :
                                  call.sentiment.overallSentiment === "negative" ? "border-red-300 text-red-600" : ""
                                }`}>
                                  {call.sentiment.overallSentiment}
                                </Badge>
                              )}
                              {score != null && (
                                <span className={`text-sm font-bold ${score >= 8 ? "text-green-600" : score >= 5 ? "text-foreground" : "text-red-500"}`}>
                                  {score.toFixed(1)}
                                </span>
                              )}
                              <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Coaching sessions with self-service action item toggle */}
            {myData.coaching.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardText className="w-4 h-4" />
                    Coaching & Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {myData.coaching.slice(0, 5).map(session => {
                      const statusColor = session.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                        session.status === "in_progress" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
                      return (
                        <div key={session.id} className="border border-border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="text-sm font-medium">{session.title}</h4>
                            <Badge className={`text-xs ${statusColor}`}>{session.status}</Badge>
                          </div>
                          {session.notes && <p className="text-xs text-muted-foreground mb-2">{session.notes.slice(0, 150)}</p>}
                          {session.actionPlan && Array.isArray(session.actionPlan) && (
                            <div className="space-y-1">
                              {(session.actionPlan as Array<{ task: string; completed: boolean }>).map((item, i) => (
                                <button
                                  key={i}
                                  className="flex items-center gap-2 text-xs w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                                  onClick={() => toggleActionItem.mutate({ sessionId: session.id, index: i })}
                                  disabled={toggleActionItem.isPending}
                                  aria-label={`Toggle "${item.task}" ${item.completed ? "incomplete" : "complete"}`}
                                >
                                  <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                                    item.completed ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/30"
                                  }`}>
                                    {item.completed && "✓"}
                                  </span>
                                  <span className={item.completed ? "line-through text-muted-foreground" : ""}>{item.task}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
