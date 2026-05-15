import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, ChatCircle, CheckCircle, Crown, Fire, Heart, Lightning, Minus, Printer, Pulse, Rocket, Shield, Star, TrendUp, Trophy, Warning, type Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/ui/loading";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toDisplayString } from "@/lib/display-utils";
import { scoreTierColor } from "@/components/analytics/chart-primitives";

interface HealthPulseResponse {
  employeeId: string;
  windowDays: number;
  current: { count: number; avgScore: number | null };
  prior: { count: number; avgScore: number | null };
  overallDelta: number | null;
  trend: "trending_up" | "stable" | "trending_down" | "insufficient_data";
  severity: "ok" | "warning" | "critical";
  subScores: Record<string, { current: number | null; prior: number | null; delta: number | null }>;
  thresholds: { warning: number; critical: number; minCalls: number };
}

/** Health pulse — compares current window against prior equal-length window,
 *  surfaces trending-down sub-scores as early warnings. Warm-paper variant:
 *  hairline panel with a tone-borderLeft stripe (sage/amber/destructive) and
 *  mono tabular-nums deltas, instead of the old tinted card. */
function HealthPulseCard({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery<HealthPulseResponse>({
    queryKey: [`/api/analytics/health-pulse/${employeeId}`],
    enabled: !!employeeId,
  });

  if (isLoading) {
    return (
      <ScorecardPanel kicker="Trend" icon={Pulse} title="Health pulse">
        <p
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          Loading…
        </p>
      </ScorecardPanel>
    );
  }
  if (!data) return null;

  if (data.trend === "insufficient_data") {
    return (
      <ScorecardPanel kicker="Trend" icon={Pulse} title="Health pulse">
        <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.55 }}>
          Not enough recent calls to compute a trend. Need at least {data.thresholds.minCalls} calls
          in each of the current and prior {data.windowDays}-day windows.
        </p>
      </ScorecardPanel>
    );
  }

  const stripe =
    data.severity === "critical" ? "var(--destructive)" :
    data.severity === "warning" ? "var(--amber)" :
    data.trend === "trending_up" ? "var(--sage)" :
    "var(--border)";

  const trendText =
    data.trend === "trending_down" ? "Trending down" :
    data.trend === "trending_up" ? "Trending up" :
    "Stable";

  const TrendIcon =
    data.trend === "trending_down" ? ArrowDown :
    data.trend === "trending_up" ? ArrowUp :
    Minus;

  const trendColor =
    data.trend === "trending_down"
      ? (data.severity === "critical" ? "var(--destructive)" : "var(--amber)")
      : data.trend === "trending_up"
      ? "var(--sage)"
      : "var(--muted-foreground)";

  const subScoreLabels: Record<string, string> = {
    compliance: "Compliance",
    customerExperience: "Customer Exp.",
    communication: "Communication",
    resolution: "Resolution",
  };

  return (
    <div
      className="rounded-sm border bg-card"
      style={{ borderColor: "var(--border)", borderLeft: `3px solid ${stripe}` }}
    >
      <div className="px-6 pt-5 pb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            <Pulse style={{ width: 12, height: 12 }} />
            Trend · last {data.windowDays}d vs prior {data.windowDays}d
          </div>
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
          >
            Health pulse
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 font-mono uppercase shrink-0"
          style={{ fontSize: 10, letterSpacing: "0.1em", color: trendColor }}
        >
          <TrendIcon style={{ width: 12, height: 12 }} />
          {trendText}
        </div>
      </div>

      {data.severity === "critical" && (
        <div
          className="mx-6 mb-3 flex items-start gap-2 rounded-sm"
          style={{
            background: "var(--warm-red-soft)",
            border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
            padding: "8px 12px",
            fontSize: 12,
            color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
            lineHeight: 1.5,
          }}
        >
          <Warning style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />
          <span>
            Average score dropped by {Math.abs(data.overallDelta ?? 0).toFixed(1)} points —
            consider scheduling a coaching session.
          </span>
        </div>
      )}

      {/* Current / prior comparison */}
      <div className="grid grid-cols-2 gap-4 px-6 pb-4">
        <WindowStat
          label="Current"
          score={data.current.avgScore}
          count={data.current.count}
        />
        <WindowStat
          label="Prior"
          score={data.prior.avgScore}
          count={data.prior.count}
        />
      </div>

      {/* Per-sub-score movement */}
      <div className="px-6 py-4 border-t border-border">
        <div
          className="font-mono uppercase text-muted-foreground mb-2"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          Sub-score movement
        </div>
        <div className="space-y-2">
          {Object.entries(data.subScores).map(([key, v]) => {
            if (v.delta == null) return null;
            const isDown = v.delta <= -data.thresholds.warning;
            const isUp = v.delta >= data.thresholds.warning;
            const color = isDown
              ? "var(--amber)"
              : isUp
              ? "var(--sage)"
              : "var(--muted-foreground)";
            const DIcon = isDown ? ArrowDown : isUp ? ArrowUp : Minus;
            const sign = v.delta > 0 ? "+" : "";
            return (
              <div
                key={key}
                className="flex items-center justify-between text-sm tabular-nums"
              >
                <span className="text-foreground">{subScoreLabels[key] ?? key}</span>
                <span
                  className="font-mono flex items-center gap-1.5"
                  style={{ color, fontSize: 12 }}
                >
                  <DIcon style={{ width: 11, height: 11 }} />
                  {sign}
                  {v.delta.toFixed(1)}
                  <span
                    className="text-muted-foreground"
                    style={{ fontSize: 11, letterSpacing: "0.02em" }}
                  >
                    ({(v.prior ?? 0).toFixed(1)} → {(v.current ?? 0).toFixed(1)})
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Small labeled stat — used inside HealthPulseCard for current/prior windows. */
function WindowStat({
  label,
  score,
  count,
}: {
  label: string;
  score: number | null;
  count: number;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium text-foreground tabular-nums mt-0.5"
        style={{ fontSize: 22, lineHeight: 1, color: scoreTierColor(score) }}
      >
        {score != null ? score.toFixed(1) : "—"}
      </div>
      <div
        className="font-mono text-muted-foreground tabular-nums mt-1"
        style={{ fontSize: 11, letterSpacing: "0.02em" }}
      >
        {count} {count === 1 ? "call" : "calls"}
      </div>
    </div>
  );
}

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

  // gamStats useQuery MUST stay above the early returns below so React's
  // hook order is stable across renders. Moving it after the `if (isLoading)`
  // / `if (error || !profile)` returns crashes with "Rendered more hooks
  // than during the previous render" on every cold-cache scorecard view —
  // first render exits early with N hooks, second render runs N+1.
  const { data: gamStats } = useQuery<{
    totalPoints: number; currentStreak: number;
    badges: Array<{ id: string; badgeType: string; label: string; description: string; icon: string; earnedAt: string }>;
  }>({
    queryKey: [`/api/gamification/stats/${employeeId}`],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await fetch(`/api/gamification/stats/${employeeId}`, { credentials: "include" });
      if (!res.ok) return { totalPoints: 0, currentStreak: 0, badges: [] };
      return res.json();
    },
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
          <Warning className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Agent Not Found</h3>
          <p className="text-sm text-muted-foreground mb-4">Could not load scorecard for this agent.</p>
          <Link href="/employees"><Button variant="outline">Back to Employees</Button></Link>
        </div>
      </div>
    );
  }

  const BADGE_ICONS: Record<string, typeof Star> = {
    star: Star, fire: Fire, lightning: Lightning, rocket: Rocket, trophy: Trophy, crown: Crown, "trend-up": TrendUp, shield: Shield, heart: Heart, "check-circle": CheckCircle,
  };

  const { employee, totalCalls, avgPerformanceScore, highScore, lowScore, sentimentBreakdown, topStrengths, topSuggestions, commonTopics, scoreTrend, flaggedCalls } = profile;
  const totalSentiment = sentimentBreakdown.positive + sentimentBreakdown.neutral + sentimentBreakdown.negative;
  const pct = (v: number) => totalSentiment > 0 ? Math.round((v / totalSentiment) * 100) : 0;

  const goodFlags = flaggedCalls.filter(f => f.flagType === "good");
  const badFlags = flaggedCalls.filter(f => f.flagType === "bad");

  const initials = employee.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="agent-scorecard-page">
      {/* Warm-paper app bar (hidden on print) */}
      <div
        className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border print:hidden"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <Link href="/employees" className="text-muted-foreground hover:text-foreground transition-colors">
            Employees
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Scorecard</span>
        </nav>
        <div className="flex-1" />
        <Link href="/employees">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        </Link>
        <Button onClick={handlePrint} size="sm">
          <Printer className="w-4 h-4 mr-1.5" /> Print
        </Button>
      </div>

      {/* Printable scorecard */}
      <div ref={printRef} className="px-4 sm:px-7 py-6 max-w-5xl mx-auto space-y-6 print:p-4 print:max-w-none print:space-y-4">
        {/* Agent hero — copper avatar initials + name + role, overall score on the right */}
        <div
          className="rounded-sm border bg-card px-6 py-6 print:p-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-5 min-w-0">
              <div
                className="rounded-full flex items-center justify-center shrink-0 print:w-12 print:h-12"
                style={{
                  width: 64,
                  height: 64,
                  background: "var(--copper-soft)",
                  border: "1px solid color-mix(in oklch, var(--accent), transparent 65%)",
                }}
              >
                <span
                  className="font-display font-medium print:text-base"
                  style={{ fontSize: 22, color: "var(--accent)", letterSpacing: "-0.2px" }}
                >
                  {initials}
                </span>
              </div>
              <div className="min-w-0">
                <div
                  className="font-mono uppercase text-muted-foreground"
                  style={{ fontSize: 10, letterSpacing: "0.16em" }}
                >
                  Agent scorecard
                </div>
                <div
                  className="font-display font-medium text-foreground mt-1 print:text-xl truncate"
                  style={{ fontSize: "clamp(22px, 2.2vw, 28px)", letterSpacing: "-0.4px", lineHeight: 1.15 }}
                >
                  {employee.name}
                </div>
                <div
                  className="font-mono text-muted-foreground mt-1 flex items-center gap-2 flex-wrap"
                  style={{ fontSize: 11, letterSpacing: "0.02em" }}
                >
                  <span>{employee.role || "No department"}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{employee.status || "Active"}</span>
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                Overall score
              </div>
              <div
                className="font-display font-medium tabular-nums mt-0.5 print:text-3xl"
                style={{
                  fontSize: "clamp(40px, 5vw, 52px)",
                  lineHeight: 1,
                  color: scoreTierColor(avgPerformanceScore),
                  letterSpacing: "-1px",
                }}
              >
                {avgPerformanceScore != null ? avgPerformanceScore.toFixed(1) : "—"}
                <span
                  className="font-mono text-muted-foreground ml-1"
                  style={{ fontSize: 14, letterSpacing: "0.02em" }}
                >
                  /10
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Key metrics strip — 4 hairline-bordered tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:gap-2">
          <MetricTile label="Total calls" value={totalCalls.toLocaleString()} tone="neutral" />
          <MetricTile
            label="High score"
            value={highScore != null ? highScore.toFixed(1) : "—"}
            tone="score"
            scoreValue={highScore}
          />
          <MetricTile
            label="Low score"
            value={lowScore != null ? lowScore.toFixed(1) : "—"}
            tone="score"
            scoreValue={lowScore}
          />
          <MetricTile
            label="Positive sentiment"
            value={`${pct(sentimentBreakdown.positive)}%`}
            tone="sage"
          />
        </div>

        {/* Gamification row — points + streak + badges, collapses to nothing when no data */}
        {gamStats && (gamStats.badges.length > 0 || gamStats.totalPoints > 0) && (
          <ScorecardPanel kicker="Earned" icon={Trophy} title="Gamification">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <div
                    className="font-mono uppercase text-muted-foreground"
                    style={{ fontSize: 10, letterSpacing: "0.14em" }}
                  >
                    Points
                  </div>
                  <div
                    className="font-display font-medium tabular-nums text-foreground mt-0.5"
                    style={{ fontSize: 22, lineHeight: 1 }}
                  >
                    {gamStats.totalPoints.toLocaleString()}
                  </div>
                </div>
                {gamStats.currentStreak > 0 && (
                  <div>
                    <div
                      className="font-mono uppercase text-muted-foreground flex items-center gap-1"
                      style={{ fontSize: 10, letterSpacing: "0.14em" }}
                    >
                      <Fire style={{ width: 11, height: 11, color: "var(--accent)" }} weight="fill" />
                      Streak
                    </div>
                    <div
                      className="font-display font-medium tabular-nums mt-0.5"
                      style={{ fontSize: 22, lineHeight: 1, color: "var(--accent)" }}
                    >
                      {gamStats.currentStreak}
                    </div>
                  </div>
                )}
              </div>
              <Link href="/leaderboard" className="print:hidden">
                <Button variant="ghost" size="sm">
                  <Trophy className="w-4 h-4 mr-1.5" /> Leaderboard
                </Button>
              </Link>
            </div>
            {gamStats.badges.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {gamStats.badges.map((b) => {
                  const BadgeIcon = BADGE_ICONS[b.icon] || Star;
                  return (
                    <Tooltip key={b.id}>
                      <TooltipTrigger>
                        <div
                          className="flex items-center gap-1.5 rounded-sm"
                          style={{
                            padding: "5px 10px",
                            background: "var(--copper-soft)",
                            border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
                          }}
                        >
                          <BadgeIcon
                            style={{ width: 13, height: 13, color: "var(--accent)" }}
                            weight="fill"
                          />
                          <span
                            className="font-mono uppercase"
                            style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--accent)" }}
                          >
                            {b.label}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-semibold">{b.label}</p>
                        <p className="text-xs">{b.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Earned {new Date(b.earnedAt).toLocaleDateString()}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </ScorecardPanel>
        )}

        {/* Sentiment breakdown — hairline segmented bar with mono tabular-nums footer */}
        <ScorecardPanel kicker="Mix" title="Sentiment breakdown">
          <div
            className="flex h-2.5 overflow-hidden rounded-sm"
            style={{ background: "var(--paper-2)" }}
            role="meter"
            aria-label={`Positive ${sentimentBreakdown.positive}, neutral ${sentimentBreakdown.neutral}, negative ${sentimentBreakdown.negative}`}
          >
            {sentimentBreakdown.positive > 0 && (
              <div style={{ width: `${pct(sentimentBreakdown.positive)}%`, background: "var(--sage)" }} />
            )}
            {sentimentBreakdown.neutral > 0 && (
              <div style={{ width: `${pct(sentimentBreakdown.neutral)}%`, background: "var(--muted-foreground)" }} />
            )}
            {sentimentBreakdown.negative > 0 && (
              <div style={{ width: `${pct(sentimentBreakdown.negative)}%`, background: "var(--destructive)" }} />
            )}
          </div>
          <div
            className="flex flex-wrap gap-x-6 gap-y-1 mt-3 font-mono tabular-nums text-muted-foreground"
            style={{ fontSize: 11, letterSpacing: "0.02em" }}
          >
            <SentimentStat tone="sage" label="Positive" count={sentimentBreakdown.positive} pct={pct(sentimentBreakdown.positive)} />
            <SentimentStat tone="muted" label="Neutral" count={sentimentBreakdown.neutral} pct={pct(sentimentBreakdown.neutral)} />
            <SentimentStat tone="destructive" label="Negative" count={sentimentBreakdown.negative} pct={pct(sentimentBreakdown.negative)} />
          </div>
        </ScorecardPanel>

        {/* Strengths + areas for improvement side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:gap-3">
          <ScorecardPanel kicker="Strengths" icon={CheckCircle} title="Top strengths" tone="sage">
            {topStrengths.length > 0 ? (
              <ul className="space-y-2">
                {topStrengths.slice(0, 5).map((s, i) => (
                  <InsightRow
                    key={i}
                    glyph="+"
                    tone="sage"
                    text={toDisplayString(s.text)}
                    count={s.count}
                  />
                ))}
              </ul>
            ) : (
              <p
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                No strengths data yet
              </p>
            )}
          </ScorecardPanel>

          <ScorecardPanel
            kicker="Suggestions"
            icon={ChatCircle}
            title="Areas for improvement"
            tone="accent"
          >
            {topSuggestions.length > 0 ? (
              <ul className="space-y-2">
                {topSuggestions.slice(0, 5).map((s, i) => (
                  <InsightRow
                    key={i}
                    glyph="!"
                    tone="accent"
                    text={toDisplayString(s.text)}
                    count={s.count}
                  />
                ))}
              </ul>
            ) : (
              <p
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                No suggestions data yet
              </p>
            )}
          </ScorecardPanel>
        </div>

        {/* Common topics — tag cloud with copper-soft pills */}
        {commonTopics.length > 0 && (
          <ScorecardPanel kicker="Themes" title="Common topics">
            <div className="flex flex-wrap gap-2">
              {commonTopics.slice(0, 10).map((t, i) => (
                <span
                  key={i}
                  className="font-mono inline-flex items-center gap-1.5 rounded-sm"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.02em",
                    padding: "4px 10px",
                    background: "var(--copper-soft)",
                    border: "1px solid color-mix(in oklch, var(--accent), transparent 65%)",
                    color: "var(--accent)",
                  }}
                >
                  {t.text}
                  <span
                    className="tabular-nums"
                    style={{
                      fontSize: 10,
                      color: "color-mix(in oklch, var(--accent), var(--ink) 15%)",
                      opacity: 0.7,
                    }}
                  >
                    · {t.count}
                  </span>
                </span>
              ))}
            </div>
          </ScorecardPanel>
        )}

        {/* Health pulse — early warning on sub-score deltas */}
        {employeeId && <HealthPulseCard employeeId={employeeId} />}

        {/* Score trend — last 12 months as tabular-nums bars using scoreTierColor */}
        {scoreTrend.length > 0 && (
          <ScorecardPanel kicker="Last 12 months" icon={TrendUp} title="Score trend">
            <div className="flex items-end gap-1.5 h-24">
              {scoreTrend.slice(-12).map((point, i) => {
                const height = point.avgScore ? `${(point.avgScore / 10) * 100}%` : "0%";
                const fill = scoreTierColor(point.avgScore);
                return (
                  <div key={i} className="flex-1 flex flex-col items-stretch gap-1 min-w-0">
                    <div
                      className="font-mono tabular-nums text-center text-muted-foreground"
                      style={{ fontSize: 9, letterSpacing: "0.02em", height: 12 }}
                    >
                      {point.avgScore?.toFixed(1) ?? ""}
                    </div>
                    <div
                      className="flex-1 flex flex-col justify-end rounded-sm"
                      style={{ background: "var(--paper-2)" }}
                    >
                      <div
                        className="rounded-sm transition-all"
                        style={{ height, background: fill }}
                      />
                    </div>
                    <div
                      className="font-mono uppercase text-center text-muted-foreground"
                      style={{ fontSize: 9, letterSpacing: "0.08em" }}
                    >
                      {point.month.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScorecardPanel>
        )}

        {/* Flagged calls — exceptional (sage) + flagged (destructive) */}
        {flaggedCalls.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:gap-2">
            {goodFlags.length > 0 && (
              <FlaggedCallsPanel
                tone="sage"
                icon={Trophy}
                title={`Exceptional calls · ${goodFlags.length}`}
                calls={goodFlags.slice(0, 3).map((f) => ({
                  id: f.id,
                  score: f.score,
                  date: f.uploadedAt,
                  secondary: null,
                }))}
              />
            )}
            {badFlags.length > 0 && (
              <FlaggedCallsPanel
                tone="destructive"
                icon={Warning}
                title={`Flagged calls · ${badFlags.length}`}
                calls={badFlags.slice(0, 3).map((f) => ({
                  id: f.id,
                  score: f.score,
                  date: f.uploadedAt,
                  secondary: f.flags.join(", "),
                }))}
              />
            )}
          </div>
        )}

        {/* Print footer */}
        <div
          className="hidden print:block mt-8 pt-4 border-t border-border text-center font-mono uppercase text-muted-foreground"
          style={{ fontSize: 9, letterSpacing: "0.12em" }}
        >
          Generated by CallAnalyzer on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper panel chrome — kicker + display title + optional tone
// left-stripe. Mirrors the Reports / Sentiment / Admin panels. The
// `tone` prop paints the left border for semantic panels (sage for
// strengths, copper/accent for suggestions, amber/destructive for
// alerts). Inline here; promote to a shared primitive once a 3rd
// analytics page uses it.
// ─────────────────────────────────────────────────────────────
function ScorecardPanel({
  kicker,
  title,
  icon: IconComp,
  tone = "default",
  children,
}: {
  kicker: string;
  title: string;
  icon?: Icon;
  tone?: "default" | "sage" | "accent" | "amber" | "destructive";
  children: React.ReactNode;
}) {
  const stripe =
    tone === "sage"
      ? "var(--sage)"
      : tone === "accent"
      ? "var(--accent)"
      : tone === "amber"
      ? "var(--amber)"
      : tone === "destructive"
      ? "var(--destructive)"
      : null;
  return (
    <div
      className="rounded-sm border bg-card"
      style={{
        borderColor: "var(--border)",
        ...(stripe ? { borderLeft: `3px solid ${stripe}` } : {}),
      }}
    >
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {title}
        </div>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Key-metric tile — mono uppercase kicker + display-font value.
// `tone="score"` colors the number via scoreTierColor(); other tones
// (neutral/sage) are flat foreground colors. Used in the key-metrics
// strip below the agent hero.
// ─────────────────────────────────────────────────────────────
function MetricTile({
  label,
  value,
  tone,
  scoreValue,
}: {
  label: string;
  value: string;
  tone: "neutral" | "sage" | "score";
  scoreValue?: number | null;
}) {
  const color =
    tone === "sage"
      ? "var(--sage)"
      : tone === "score"
      ? scoreTierColor(scoreValue)
      : "var(--foreground)";
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4 print:p-2"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-1 print:text-xl"
        style={{ fontSize: 28, lineHeight: 1, color, letterSpacing: "-0.4px" }}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sentiment stat row — colored dot + label + count(pct). Used under
// the Sentiment breakdown segmented bar.
// ─────────────────────────────────────────────────────────────
function SentimentStat({
  tone,
  label,
  count,
  pct,
}: {
  tone: "sage" | "muted" | "destructive";
  label: string;
  count: number;
  pct: number;
}) {
  const color =
    tone === "sage"
      ? "var(--sage)"
      : tone === "destructive"
      ? "var(--destructive)"
      : "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="rounded-full"
        style={{ width: 7, height: 7, background: color }}
      />
      <span className="uppercase" style={{ letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span>
        {count} ({pct}%)
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Insight row — glyph + text + small count pill. Glyph tone is
// sage (strengths) or accent/copper (suggestions). No more shadcn
// Badge — replaced with a mono-uppercase `Nx` counter.
// ─────────────────────────────────────────────────────────────
function InsightRow({
  glyph,
  tone,
  text,
  count,
}: {
  glyph: string;
  tone: "sage" | "accent";
  text: string;
  count: number;
}) {
  const color = tone === "sage" ? "var(--sage)" : "var(--accent)";
  return (
    <li className="flex items-start gap-2 text-sm" style={{ lineHeight: 1.55 }}>
      <span
        className="font-mono shrink-0"
        style={{ color, fontWeight: 600, marginTop: 1 }}
      >
        {glyph}
      </span>
      <span className="text-foreground flex-1">{text}</span>
      <span
        className="font-mono uppercase tabular-nums shrink-0"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          padding: "2px 6px",
          color: "var(--muted-foreground)",
          background: "var(--paper-2)",
          border: "1px solid var(--border)",
          borderRadius: 2,
        }}
      >
        {count}×
      </span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Flagged calls panel — replaces the old bg-emerald-50 / bg-red-50
// tinted blocks with a warm-paper panel + tone stripe, showing
// score + date + optional secondary line per flagged call.
// ─────────────────────────────────────────────────────────────
function FlaggedCallsPanel({
  tone,
  icon: IconComp,
  title,
  calls,
}: {
  tone: "sage" | "destructive";
  icon: Icon;
  title: string;
  calls: Array<{ id: string; score: number | null; date?: string; secondary: string | null }>;
}) {
  const kicker = tone === "sage" ? "Highlights" : "Alerts";
  return (
    <ScorecardPanel kicker={kicker} icon={IconComp} title={title} tone={tone}>
      <ul className="space-y-2">
        {calls.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 text-sm tabular-nums"
            style={{ lineHeight: 1.5 }}
          >
            <span
              className="font-display font-medium shrink-0"
              style={{ fontSize: 15, color: scoreTierColor(c.score), width: 32 }}
            >
              {c.score != null ? c.score.toFixed(1) : "—"}
            </span>
            <span
              className="font-mono uppercase text-muted-foreground shrink-0"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              {c.date ? new Date(c.date).toLocaleDateString() : "—"}
            </span>
            {c.secondary && (
              <span className="text-muted-foreground truncate" style={{ fontSize: 12 }}>
                · {c.secondary}
              </span>
            )}
          </li>
        ))}
      </ul>
    </ScorecardPanel>
  );
}
