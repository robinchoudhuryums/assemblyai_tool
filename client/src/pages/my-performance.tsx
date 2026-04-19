import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SCORE_EXCELLENT, SCORE_GOOD } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowRight, ArrowUp, ArrowDown, ClipboardText, GitDiff, Medal, Star, TrendUp, Trophy, User } from "@phosphor-icons/react";
import { Avatar, RubricRack, ScoreDial, StatBlock, type RubricValues } from "@/components/dashboard/primitives";
import type { CallWithDetails, CoachingSession } from "@shared/schema";

interface CorrectionStats {
  total: number;
  upgrades: number;
  downgrades: number;
  avgDelta: number;
  windowDays: number;
}

interface CorrectionEntry {
  id: string;
  callId: string;
  callCategory?: string;
  correctedAt: string;
  originalScore: number;
  correctedScore: number;
  direction: "upgraded" | "downgraded";
  reason: string;
  subScoreChanges?: Record<string, { original: number; corrected: number }>;
}

interface MyCorrectionsResponse {
  stats: CorrectionStats;
  corrections: CorrectionEntry[];
}

function MyCorrectionsCard() {
  const { data, isLoading } = useQuery<MyCorrectionsResponse>({
    queryKey: ["/api/scoring-corrections/mine"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">My scoring corrections</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  if (!data || data.stats.total === 0) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-1.5">
            <GitDiff className="w-4 h-4" /> My scoring corrections
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            You haven't corrected any AI-generated scores yet. When you edit an analysis on the transcript page, your correction is recorded here and injected into future Bedrock prompts so the AI learns from your judgement.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { stats, corrections } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-1.5">
          <GitDiff className="w-4 h-4" /> My scoring corrections
          <span className="text-xs text-muted-foreground font-normal ml-auto">
            last {stats.windowDays} days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-md bg-muted/50">
            <div className="text-xl font-bold text-foreground">{stats.total}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">corrections</div>
          </div>
          <div className="p-2 rounded-md bg-green-50 dark:bg-green-900/20">
            <div className="text-xl font-bold text-green-600 dark:text-green-400 flex items-center justify-center gap-0.5">
              <ArrowUp className="w-4 h-4" />{stats.upgrades}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">upgraded</div>
          </div>
          <div className="p-2 rounded-md bg-red-50 dark:bg-red-900/20">
            <div className="text-xl font-bold text-red-600 dark:text-red-400 flex items-center justify-center gap-0.5">
              <ArrowDown className="w-4 h-4" />{stats.downgrades}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">downgraded</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Avg. absolute delta: <strong className="text-foreground">{stats.avgDelta.toFixed(1)}</strong> points.{" "}
          {stats.downgrades > stats.upgrades * 2 && (
            <span className="text-amber-600 dark:text-amber-400">
              You downgrade the AI more than you upgrade it — the AI may be scoring too high.
            </span>
          )}
          {stats.upgrades > stats.downgrades * 2 && (
            <span className="text-amber-600 dark:text-amber-400">
              You upgrade the AI more than you downgrade — the AI may be scoring too low.
            </span>
          )}
        </div>

        {corrections.length > 0 && (
          <div className="pt-2 border-t border-border">
            <h5 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Recent corrections</h5>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {corrections.slice(0, 5).map(c => {
                const delta = c.correctedScore - c.originalScore;
                const deltaSign = delta > 0 ? "+" : "";
                return (
                  <Link
                    key={c.id}
                    href={`/transcripts/${c.callId}`}
                    className="block p-2 rounded hover:bg-accent text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">
                        {c.originalScore.toFixed(1)} → {c.correctedScore.toFixed(1)}
                      </span>
                      <span className={`font-semibold ${delta > 0 ? "text-green-600" : "text-red-600"}`}>
                        {deltaSign}{delta.toFixed(1)}
                      </span>
                    </div>
                    {c.reason && (
                      <p className="text-muted-foreground truncate mt-0.5">"{c.reason}"</p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

  const greeting = getTimeOfDayGreeting();
  const firstName = (me?.name || "").split(" ")[0] || "there";
  const initials = initialsFromName(me?.name);
  const weekly = myData?.weeklyTrend ?? [];
  const thisWeek = weekly[weekly.length - 1];
  const priorWeek = weekly[weekly.length - 2];
  const scoreDelta = thisWeek && priorWeek ? round1(thisWeek.avgScore - priorWeek.avgScore) : null;
  const callsDelta = thisWeek && priorWeek ? thisWeek.count - priorWeek.count : null;
  const thisWeekCallCount = thisWeek?.count ?? 0;
  const heroStatement = buildHeroStatement({
    callCount: thisWeekCallCount,
    avgScore: myData?.avgScore ?? null,
    positivePct: myData?.positivePct ?? 0,
    streak: myData?.currentStreak ?? 0,
  });
  const exemplar = myData?.recentCalls ? pickExemplar(myData.recentCalls) : null;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Topbar — quiet kicker row */}
      <div className="flex items-center justify-between px-8 md:px-14 py-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {thisWeek ? `Your week · ${formatWeekRange(thisWeek.week)}` : "Your performance"}
          </div>
        </div>
        {me?.name && (
          <div className="flex items-center gap-3">
            <div className="text-sm text-foreground">{me.name}</div>
            <Avatar initials={initials} size={32} />
          </div>
        )}
      </div>

      <div className="px-8 md:px-14 py-10 md:py-14 max-w-6xl mx-auto">
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
            {/* Hero greeting */}
            <div className="mb-10 md:mb-12">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Good {greeting}, {firstName}
              </div>
              <div
                className="font-display font-normal text-foreground mt-2.5 max-w-4xl"
                style={{ fontSize: "clamp(32px, 5vw, 56px)", letterSpacing: "-1.5px", lineHeight: 1.05 }}
              >
                {heroStatement.prefix}
                {heroStatement.highlight && (
                  <span className="text-primary">{heroStatement.highlight}</span>
                )}
                {heroStatement.suffix}
              </div>
            </div>

            {/* BigStat grid — airy 4-column summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10 pb-10 md:pb-12 border-b border-border">
              <StatBlock
                label="Your score"
                value={myData.avgScore != null ? myData.avgScore.toFixed(1) : "—"}
                unit={myData.avgScore != null ? "/ 10" : undefined}
                delta={scoreDelta}
              />
              <StatBlock
                label="Calls this week"
                value={thisWeekCallCount.toString()}
                delta={callsDelta}
              />
              <StatBlock
                label="Positive sentiment"
                value={`${myData.positivePct}%`}
              />
              <StatBlock
                label={myData.currentStreak > 0 ? "Current streak" : "Points earned"}
                value={
                  myData.currentStreak > 0
                    ? myData.currentStreak.toString()
                    : myData.totalPoints.toLocaleString()
                }
                unit={myData.currentStreak > 0 ? "calls ≥ 8" : "pts"}
              />
            </div>

            {/* Exemplar moment — your best recent call */}
            {exemplar && (
              <div className="grid gap-10 md:gap-12 py-10 md:py-12 border-b border-border md:grid-cols-[1fr_300px]">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--sage)] flex items-center gap-2">
                    <Star className="w-3 h-3" weight="fill" />
                    Your exemplar · {exemplar.categoryLabel}
                    {exemplar.durationMinSec && (
                      <span className="text-muted-foreground">· {exemplar.durationMinSec}</span>
                    )}
                  </div>
                  <div
                    className="font-display font-medium text-foreground mt-1.5 max-w-2xl"
                    style={{ fontSize: 30, letterSpacing: "-0.5px", lineHeight: 1.2 }}
                  >
                    Listen back to your best call this week.
                  </div>
                  {exemplar.call.analysis?.summary && typeof exemplar.call.analysis.summary === "string" && (
                    <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-xl">
                      {exemplar.call.analysis.summary.slice(0, 280)}
                      {exemplar.call.analysis.summary.length > 280 && "…"}
                    </p>
                  )}
                  <Link
                    href={`/transcripts/${exemplar.call.id}`}
                    className="inline-flex items-center gap-1.5 mt-5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground border border-border px-3 py-2 hover:bg-secondary transition-colors"
                    data-testid="exemplar-open-transcript"
                  >
                    Open transcript
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>

                <div>
                  <div className="flex justify-center mb-6">
                    <ScoreDial value={exemplar.score} size={180} label="this call" />
                  </div>
                  {exemplar.rubric && (
                    <>
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground text-center mb-3">
                        Rubric
                      </div>
                      <div className="flex justify-center">
                        <RubricRack rubric={exemplar.rubric} compact />
                      </div>
                    </>
                  )}
                  {exemplar.suggestion && (
                    <div className="mt-6 p-4 bg-secondary border border-border">
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
                        One thing to try
                      </div>
                      <div className="text-[13px] leading-relaxed text-foreground">
                        {exemplar.suggestion}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Spacer so existing sections below breathe */}
            <div className="h-10" />

            <div className="space-y-6">

            {/* My scoring corrections — feedback loop visibility */}
            <MyCorrectionsCard />

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
                      const color = week.avgScore >= SCORE_EXCELLENT ? "bg-green-500" : week.avgScore >= SCORE_GOOD ? "bg-primary" : "bg-red-400";
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
                                <span className={`text-sm font-bold ${score >= SCORE_EXCELLENT ? "text-green-600" : score >= SCORE_GOOD ? "text-foreground" : "text-red-500"}`}>
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

            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers (Agent Lens — hero/BigStat support)
// ─────────────────────────────────────────────────────────────

function getTimeOfDayGreeting(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function initialsFromName(name?: string): string {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatWeekRange(weekStartIso: string): string {
  const start = new Date(weekStartIso);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

interface HeroStatement {
  prefix: string;
  highlight?: string;
  suffix: string;
}

interface Exemplar {
  call: CallWithDetails;
  score: number;
  rubric: RubricValues | null;
  suggestion: string | null;
  categoryLabel: string;
  durationMinSec: string | null;
}

/**
 * Pick the best recent call to showcase as this week's exemplar. Returns
 * null when no recent call clears the SCORE_GOOD bar, so the section
 * can be conditionally rendered.
 */
function pickExemplar(calls: CallWithDetails[]): Exemplar | null {
  const scored = calls
    .map((c) => ({ c, s: c.analysis?.performanceScore ? Number(c.analysis.performanceScore) : NaN }))
    .filter((x) => Number.isFinite(x.s) && x.s >= SCORE_GOOD);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.s - a.s);
  const { c: call, s: score } = scored[0];

  const sub = call.analysis?.subScores;
  const rubric: RubricValues | null =
    sub && sub.compliance != null && sub.customerExperience != null && sub.communication != null && sub.resolution != null
      ? {
          compliance: sub.compliance,
          customerExperience: sub.customerExperience,
          communication: sub.communication,
          resolution: sub.resolution,
        }
      : null;

  const suggestions = call.analysis?.feedback?.suggestions ?? [];
  const firstSuggestion = suggestions.find(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );

  const categoryLabel = (call.callCategory || "Call").toString();
  const durationMinSec = call.duration
    ? `${Math.floor(call.duration / 60)}:${String(Math.floor(call.duration % 60)).padStart(2, "0")}`
    : null;

  return {
    call,
    score,
    rubric,
    suggestion: firstSuggestion ?? null,
    categoryLabel: categoryLabel.charAt(0).toUpperCase() + categoryLabel.slice(1),
    durationMinSec,
  };
}

/**
 * Compose a warm, specific hero line from the week's data. Mirrors the
 * Agent Lens prototype: mention call count as a copper-highlighted span,
 * then add a growth-oriented follow-on tailored to the score/sentiment.
 */
function buildHeroStatement(ctx: {
  callCount: number;
  avgScore: number | null;
  positivePct: number;
  streak: number;
}): HeroStatement {
  if (ctx.callCount === 0) {
    return {
      prefix: "No calls yet this week — ",
      suffix: "your work will show up here as soon as you start taking calls.",
    };
  }
  const callWord = ctx.callCount === 1 ? "call" : "calls";
  const prefix = "You handled ";
  const highlight = `${ctx.callCount} ${callWord}`;
  let suffix = " this week.";

  const avg = ctx.avgScore ?? 0;
  if (avg >= SCORE_EXCELLENT && ctx.positivePct >= 60) {
    suffix += " Your patients left on a high note — and there's one small moment to sharpen.";
  } else if (avg >= SCORE_EXCELLENT) {
    suffix += " Strong finish. Here's where to keep going.";
  } else if (avg >= SCORE_GOOD) {
    suffix += ctx.streak >= 3
      ? ` ${ctx.streak} in a row above 8 — let's find the pattern worth keeping.`
      : " Steady work. Here's where to sharpen.";
  } else if (ctx.avgScore != null) {
    suffix += " Let's find the one thing worth working on.";
  } else {
    suffix += " A scorecard will appear once analysis completes.";
  }

  return { prefix, highlight, suffix };
}
