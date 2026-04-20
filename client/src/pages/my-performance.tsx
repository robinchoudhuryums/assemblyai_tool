import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SCORE_EXCELLENT, SCORE_GOOD } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowRight, ArrowUp, ArrowDown, GitDiff, Star, User } from "@phosphor-icons/react";
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
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Your scoring corrections
        </div>
        <div className="mt-5 bg-card border border-border px-5 py-4">
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (!data || data.stats.total === 0) {
    return (
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Your scoring corrections
        </div>
        <div
          className="font-display font-medium text-foreground mt-1 mb-5"
          style={{ fontSize: 24, letterSpacing: "-0.3px" }}
        >
          Teach the AI what you see.
        </div>
        <div className="border border-dashed border-border bg-secondary/40 px-5 py-5 flex items-start gap-3">
          <GitDiff className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            You haven't corrected any AI-generated scores yet. When you edit an analysis
            on the transcript page, your correction is recorded here and injected into
            future Bedrock prompts so the AI learns from your judgement.
          </p>
        </div>
      </div>
    );
  }

  const { stats, corrections } = data;
  const lean =
    stats.downgrades > stats.upgrades * 2
      ? { label: "AI scoring high", cls: "text-[color-mix(in_oklch,var(--amber),var(--ink)_35%)]" }
      : stats.upgrades > stats.downgrades * 2
      ? { label: "AI scoring low", cls: "text-[color-mix(in_oklch,var(--amber),var(--ink)_35%)]" }
      : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Your scoring corrections
          </div>
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 24, letterSpacing: "-0.3px" }}
          >
            {stats.total === 1 ? "One correction" : `${stats.total} corrections`} on file.
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap">
          last {stats.windowDays} days
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="bg-card border border-border px-4 py-3.5">
          <div
            className="font-display font-medium text-foreground tabular-nums"
            style={{ fontSize: 28, letterSpacing: "-0.5px", lineHeight: 1 }}
          >
            {stats.total}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1.5">
            Total
          </div>
        </div>
        <div className="bg-card border border-border px-4 py-3.5">
          <div
            className="font-display font-medium tabular-nums flex items-baseline gap-1 text-[var(--sage)]"
            style={{ fontSize: 28, letterSpacing: "-0.5px", lineHeight: 1 }}
          >
            <ArrowUp className="w-4 h-4" weight="bold" />
            {stats.upgrades}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1.5">
            Upgraded
          </div>
        </div>
        <div className="bg-card border border-border px-4 py-3.5">
          <div
            className="font-display font-medium tabular-nums flex items-baseline gap-1 text-destructive"
            style={{ fontSize: 28, letterSpacing: "-0.5px", lineHeight: 1 }}
          >
            <ArrowDown className="w-4 h-4" weight="bold" />
            {stats.downgrades}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1.5">
            Downgraded
          </div>
        </div>
      </div>

      <div className="mt-4 text-[12px] text-muted-foreground leading-relaxed">
        Average absolute delta:{" "}
        <span className="font-mono tabular-nums text-foreground">{stats.avgDelta.toFixed(1)}</span>{" "}
        points.
        {lean && <span className={`ml-1.5 ${lean.cls}`}>Trend — {lean.label}.</span>}
      </div>

      {corrections.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2.5">
            Recent edits
          </div>
          <div className="flex flex-col">
            {corrections.slice(0, 5).map((c, idx) => {
              const delta = c.correctedScore - c.originalScore;
              const deltaSign = delta > 0 ? "+" : "";
              const deltaColor = delta > 0 ? "text-[var(--sage)]" : "text-destructive";
              return (
                <Link
                  key={c.id}
                  href={`/transcripts/${c.callId}`}
                  className={`grid items-center gap-4 px-4 py-3 bg-card border border-border hover:bg-secondary transition-colors ${
                    idx > 0 ? "border-t-0" : ""
                  }`}
                  style={{ gridTemplateColumns: "auto 1fr auto" }}
                >
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                    {c.originalScore.toFixed(1)} → {c.correctedScore.toFixed(1)}
                  </span>
                  <span className="text-[12px] text-muted-foreground truncate italic">
                    {c.reason ? `"${c.reason}"` : "No note provided"}
                  </span>
                  <span className={`font-mono tabular-nums text-[13px] font-medium ${deltaColor}`}>
                    {deltaSign}
                    {delta.toFixed(1)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
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

            {/* Badges + Week strip — 2-column airy block */}
            {(myData.badges.length > 0 || myData.recentCalls.length > 0) && (
              <div className="grid gap-10 md:gap-12 md:grid-cols-2">
                {myData.badges.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Badges · earned
                    </div>
                    <div
                      className="font-display font-medium text-foreground mt-1 mb-5"
                      style={{ fontSize: 24, letterSpacing: "-0.3px" }}
                    >
                      {badgeHeadline(myData.badges.length)}
                    </div>
                    <div className="flex flex-wrap gap-3.5">
                      {myData.badges.slice(0, 8).map((badge) => (
                        <div
                          key={badge.id}
                          className="bg-card border border-border px-4 py-3.5 min-w-[180px]"
                          title={badge.description}
                        >
                          <div
                            className="font-display text-primary"
                            style={{ fontSize: 24, lineHeight: 1 }}
                          >
                            {BADGE_GLYPH[badge.icon] ?? "★"}
                          </div>
                          <div className="text-[13px] font-medium text-foreground mt-1">
                            {badge.label}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                            {badge.earnedAt
                              ? new Date(badge.earnedAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })
                              : badge.description.slice(0, 40)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {myData.recentCalls.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Your week · daily scores
                    </div>
                    <div
                      className="font-display font-medium text-foreground mt-1 mb-5"
                      style={{ fontSize: 24, letterSpacing: "-0.3px" }}
                    >
                      {weekStripHeadline(myData.recentCalls)}
                    </div>
                    <div className="bg-card border border-border px-5 py-4">
                      <WeekStrip calls={myData.recentCalls} />
                      <div className="mt-4 text-[12px] text-muted-foreground leading-relaxed">
                        {weekStripFootnote(myData.recentCalls)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Recent calls — document-style row list */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Recent calls · your last {Math.min(myData.recentCalls.length, 10)}
              </div>
              <div
                className="font-display font-medium text-foreground mt-1 mb-5"
                style={{ fontSize: 24, letterSpacing: "-0.3px" }}
              >
                {myData.recentCalls.length === 0 ? "Nothing yet." : "Walk the tape."}
              </div>
              {myData.recentCalls.length === 0 ? (
                <div className="bg-card border border-border py-10 text-center text-sm text-muted-foreground">
                  No calls yet. Your analyzed calls will appear here.
                </div>
              ) : (
                <div className="flex flex-col">
                  {myData.recentCalls.slice(0, 10).map((call, idx) => {
                    const score = call.analysis?.performanceScore
                      ? Number(call.analysis.performanceScore)
                      : null;
                    const scoreColor =
                      score == null
                        ? "text-muted-foreground"
                        : score >= SCORE_EXCELLENT
                        ? "text-[var(--sage)]"
                        : score >= SCORE_GOOD
                        ? "text-foreground"
                        : "text-destructive";
                    const summary =
                      typeof call.analysis?.summary === "string"
                        ? call.analysis.summary
                        : "";
                    return (
                      <Link
                        key={call.id}
                        href={`/transcripts/${call.id}`}
                        className={`group grid items-center gap-4 px-4 py-3.5 bg-card border border-border hover:bg-secondary transition-colors ${
                          idx > 0 ? "border-t-0" : ""
                        }`}
                        style={{ gridTemplateColumns: "96px 1fr auto" }}
                        data-testid="recent-call-row"
                      >
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
                          {call.uploadedAt
                            ? new Date(call.uploadedAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] text-foreground truncate">
                            {summary
                              ? summary.slice(0, 120) + (summary.length > 120 ? "…" : "")
                              : "No summary"}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2.5">
                            {call.callCategory && (
                              <span className="uppercase tracking-[0.08em]">
                                {call.callCategory}
                              </span>
                            )}
                            {call.sentiment?.overallSentiment && (
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className="inline-block w-1.5 h-1.5 rounded-full"
                                  style={{
                                    background:
                                      call.sentiment.overallSentiment === "positive"
                                        ? "var(--sage)"
                                        : call.sentiment.overallSentiment === "negative"
                                        ? "var(--destructive)"
                                        : "var(--muted-foreground)",
                                  }}
                                />
                                <span className="uppercase tracking-[0.08em]">
                                  {call.sentiment.overallSentiment}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {score != null && (
                            <span
                              className={`font-display font-medium tabular-nums ${scoreColor}`}
                              style={{ fontSize: 20, letterSpacing: "-0.5px" }}
                            >
                              {score.toFixed(1)}
                            </span>
                          )}
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Coaching sessions with self-service action item toggle */}
            {myData.coaching.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Coaching & feedback
                </div>
                <div
                  className="font-display font-medium text-foreground mt-1 mb-5"
                  style={{ fontSize: 24, letterSpacing: "-0.3px" }}
                >
                  {coachingHeadline(myData.coaching)}
                </div>
                <div className="flex flex-col gap-3">
                  {myData.coaching.slice(0, 5).map((session) => {
                    const statusMeta = coachingStatusMeta(session.status);
                    const actionPlan = Array.isArray(session.actionPlan)
                      ? (session.actionPlan as Array<{ task: string; completed: boolean }>)
                      : [];
                    return (
                      <div
                        key={session.id}
                        className="bg-card border border-border px-5 py-4"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <h4 className="text-[14px] font-medium text-foreground">
                            {session.title}
                          </h4>
                          <span
                            className={`font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border rounded-sm whitespace-nowrap ${statusMeta.cls}`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>
                        {session.notes && (
                          <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
                            {session.notes.slice(0, 220)}
                            {session.notes.length > 220 && "…"}
                          </p>
                        )}
                        {actionPlan.length > 0 && (
                          <div className="space-y-1.5">
                            {actionPlan.map((item, i) => (
                              <button
                                key={i}
                                className="flex items-start gap-2.5 text-[12px] w-full text-left hover:bg-secondary rounded-sm px-1.5 py-1 transition-colors disabled:opacity-60"
                                onClick={() =>
                                  toggleActionItem.mutate({
                                    sessionId: session.id,
                                    index: i,
                                  })
                                }
                                disabled={toggleActionItem.isPending}
                                aria-label={`Toggle "${item.task}" ${
                                  item.completed ? "incomplete" : "complete"
                                }`}
                              >
                                <span
                                  className={`flex-shrink-0 w-[14px] h-[14px] border flex items-center justify-center mt-[1px] ${
                                    item.completed
                                      ? "bg-[var(--sage)] border-[var(--sage)] text-[var(--paper)]"
                                      : "border-border"
                                  }`}
                                  aria-hidden="true"
                                >
                                  {item.completed && (
                                    <span
                                      className="font-mono leading-none"
                                      style={{ fontSize: 10 }}
                                    >
                                      ✓
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={
                                    item.completed
                                      ? "line-through text-muted-foreground"
                                      : "text-foreground"
                                  }
                                >
                                  {item.task}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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
 * Phosphor icon name → unicode glyph for the badge tile. The server sends
 * the short icon name from BADGE_TYPES; mapping to a glyph keeps the tile
 * rendering lightweight (no dynamic icon imports) and visually matches
 * the v3-agent-lens prototype's mono glyphs.
 */
const BADGE_GLYPH: Record<string, string> = {
  star: "★",
  fire: "♦",
  lightning: "⚡",
  rocket: "▲",
  trophy: "◆",
  crown: "♛",
  shield: "⬢",
  heart: "♥",
  "check-circle": "✓",
};

function badgeHeadline(n: number): string {
  if (n === 1) return "One earned.";
  if (n < 5) return `${n} earned.`;
  if (n < 10) return "A handful.";
  return `${n} and counting.`;
}

/**
 * WeekStrip — last-7-days daily score bars, one bar per call. Colored by
 * score tier (red < 7, copper 7–9, sage ≥ 9). Empty days render a muted
 * em-dash placeholder.
 */
function WeekStrip({ calls }: { calls: CallWithDetails[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Array<{ label: string; scores: number[] }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    days.push({ label, scores: [] });
  }

  for (const call of calls) {
    if (!call.uploadedAt) continue;
    const d = new Date(call.uploadedAt);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays < 0 || diffDays > 6) continue;
    const idx = 6 - diffDays;
    const score = call.analysis?.performanceScore ? Number(call.analysis.performanceScore) : NaN;
    if (Number.isFinite(score)) days[idx].scores.push(score);
  }

  const maxBarHeight = 88;
  return (
    <div className="flex items-end gap-5" style={{ height: 120 }}>
      {days.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-2">
          <div className="flex items-end gap-[3px]" style={{ height: maxBarHeight + 2 }}>
            {d.scores.length === 0 ? (
              <div
                className="font-mono text-[10px] text-muted-foreground"
                style={{ paddingBottom: 40 }}
              >
                —
              </div>
            ) : (
              d.scores.map((score, j) => {
                const h = Math.max(4, (score / 10) * maxBarHeight);
                const color =
                  score < 7
                    ? "var(--destructive)"
                    : score >= SCORE_EXCELLENT
                    ? "var(--sage)"
                    : "var(--accent)";
                return (
                  <div
                    key={j}
                    title={`${score.toFixed(1)}`}
                    style={{ width: 8, height: h, background: color }}
                  />
                );
              })
            )}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {d.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function weekStripHeadline(calls: CallWithDetails[]): string {
  const scores = calls
    .map((c) => (c.analysis?.performanceScore ? Number(c.analysis.performanceScore) : NaN))
    .filter((n) => Number.isFinite(n));
  if (scores.length === 0) return "Nothing yet.";
  const low = Math.min(...scores);
  if (low >= SCORE_EXCELLENT) return "Smooth sailing.";
  if (low >= SCORE_GOOD) return "Steady week.";
  return "One to listen back to.";
}

function coachingHeadline(sessions: CoachingSession[]): string {
  const open = sessions.filter((s) => s.status !== "completed").length;
  if (open === 0) return "All caught up.";
  if (open === 1) return "One open thread.";
  return `${open} open threads.`;
}

function coachingStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "completed":
      return {
        label: "Done",
        cls: "border-[color-mix(in_oklch,var(--sage),transparent_50%)] text-[var(--sage)] bg-[var(--sage-soft)]",
      };
    case "in_progress":
      return {
        label: "In progress",
        cls: "border-primary text-primary bg-[color-mix(in_oklch,var(--primary),transparent_88%)]",
      };
    case "open":
      return {
        label: "Open",
        cls: "border-[color-mix(in_oklch,var(--amber),transparent_50%)] text-[color-mix(in_oklch,var(--amber),var(--ink)_35%)] bg-[var(--amber-soft)]",
      };
    default:
      return {
        label: status,
        cls: "border-border text-muted-foreground bg-muted",
      };
  }
}

function weekStripFootnote(calls: CallWithDetails[]): string {
  let lowestCall: CallWithDetails | null = null;
  let lowestScore = Infinity;
  for (const c of calls) {
    const s = c.analysis?.performanceScore ? Number(c.analysis.performanceScore) : NaN;
    if (Number.isFinite(s) && s < lowestScore) {
      lowestScore = s;
      lowestCall = c;
    }
  }
  if (!lowestCall || !Number.isFinite(lowestScore)) {
    return "Individual call scores shown above — hover a bar for the exact number.";
  }
  const when = lowestCall.uploadedAt
    ? new Date(lowestCall.uploadedAt).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const category = lowestCall.callCategory ? ` — ${lowestCall.callCategory}` : "";
  return `Your lowest call this week was a ${lowestScore.toFixed(1)} (${when}${category}). Worth listening back.`;
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
