import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Buildings,
  ChartBarHorizontal,
  ChatCircle,
  ShieldWarning,
  TrendDown,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  Legend,
} from "recharts";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
  CHART_GRID_STROKE,
  SENTIMENT_COLOR,
  scoreTierColor,
} from "@/components/analytics/chart-primitives";

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

// ─────────────────────────────────────────────────────────────
// Company Insights (installment 11 — warm-paper rewrite).
// Manager+ view of company-wide trends, complaint patterns, escalation
// opportunities. Recharts chrome + SENTIMENT_COLOR / scoreTierColor
// sourced from the shared chart-primitives module (installment 9).
// ─────────────────────────────────────────────────────────────
export default function InsightsPage() {
  const { data: insights, isLoading, isError, error } = useQuery<InsightsData>({
    queryKey: ["/api/insights"],
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="px-7 py-6 space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-sm border bg-card p-6"
              style={{ borderColor: "var(--border)" }}
            >
              <Skeleton className="h-32 w-full" />
            </div>
          ))}
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <div className="px-7 py-6">
          <ErrorBanner message={(error as Error)?.message ?? "Failed to load insights data."} />
        </div>
      </PageShell>
    );
  }

  if (!insights || insights.totalAnalyzed === 0) {
    return (
      <PageShell>
        <div className="px-7 py-14 text-center">
          <div
            className="mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{
              width: 56,
              height: 56,
              background: "var(--copper-soft)",
              border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
            }}
          >
            <Buildings style={{ width: 26, height: 26, color: "var(--accent)" }} />
          </div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            No data yet
          </div>
          <p className="text-sm text-foreground mt-2" style={{ maxWidth: 420, margin: "8px auto 0" }}>
            Upload and process calls to see company-wide insights, complaint trends, and process
            improvement opportunities.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell totalAnalyzed={insights.totalAnalyzed}>
      <main className="px-7 py-6 space-y-6">
        {/* Summary tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryTile
            kicker="Avg"
            label="Average performance"
            value={`${insights.summary.avgScore.toFixed(1)}`}
            suffix="/10"
            tone="score"
            scoreValue={insights.summary.avgScore}
          />
          <SummaryTile
            kicker="Sentiment"
            label="Negative call rate"
            value={`${(insights.summary.negativeCallRate * 100).toFixed(1)}%`}
            footnote="of calls have negative sentiment"
            tone="destructive"
          />
          <SummaryTile
            kicker="Escalation"
            label="Escalation rate"
            value={`${(insights.summary.escalationRate * 100).toFixed(1)}%`}
            footnote="of calls scored 4.0 or below"
            tone="amber"
          />
        </div>

        {/* Weekly sentiment trend */}
        {insights.weeklyTrend.length > 1 && (
          <Panel
            kicker="Over time"
            icon={TrendDown}
            title="Customer sentiment"
            description="Weekly breakdown of positive, neutral, and negative calls"
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={insights.weeklyTrend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="insSage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SENTIMENT_COLOR.positive} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={SENTIMENT_COLOR.positive} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="insMuted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SENTIMENT_COLOR.neutral} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={SENTIMENT_COLOR.neutral} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="insRed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SENTIMENT_COLOR.negative} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={SENTIMENT_COLOR.negative} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="week"
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                />
                <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                <Area
                  type="monotone"
                  dataKey="positive"
                  name="Positive"
                  stackId="s"
                  stroke={SENTIMENT_COLOR.positive}
                  fill="url(#insSage)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="neutral"
                  name="Neutral"
                  stackId="s"
                  stroke={SENTIMENT_COLOR.neutral}
                  fill="url(#insMuted)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="negative"
                  name="Negative"
                  stackId="s"
                  stroke={SENTIMENT_COLOR.negative}
                  fill="url(#insRed)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {/* Complaints + topics side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            kicker="Friction"
            icon={Warning}
            title="Top complaint topics"
            description="Most frequent topics in negative-sentiment calls"
            tone="destructive"
          >
            {insights.topComplaints.length > 0 ? (
              <div className="space-y-2.5">
                {insights.topComplaints.slice(0, 10).map((item, i) => {
                  const max = insights.topComplaints[0]?.count || 1;
                  const pct = Math.min((item.count / max) * 100, 100);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="font-mono tabular-nums text-muted-foreground shrink-0"
                        style={{ fontSize: 10, letterSpacing: "0.04em", width: 20 }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="text-sm text-foreground truncate">{item.topic}</span>
                          <span
                            className="font-mono tabular-nums text-muted-foreground shrink-0"
                            style={{ fontSize: 11, letterSpacing: "0.02em" }}
                          >
                            {item.count} {item.count === 1 ? "call" : "calls"}
                          </span>
                        </div>
                        <div
                          className="h-1 rounded-sm overflow-hidden"
                          style={{ background: "var(--paper-2)" }}
                        >
                          <div
                            className="h-full rounded-sm"
                            style={{ width: `${pct}%`, background: "var(--destructive)" }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyRow message="No complaint patterns detected yet" />
            )}
          </Panel>

          <Panel
            kicker="Volume"
            icon={ChartBarHorizontal}
            title="Most common call topics"
            description="Topics discussed most frequently across all calls"
          >
            {insights.topTopics.length > 0 ? (
              <ResponsiveContainer
                width="100%"
                height={Math.max(260, insights.topTopics.slice(0, 8).length * 34)}
              >
                <BarChart
                  data={insights.topTopics.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    type="number"
                    tick={CHART_TICK}
                    stroke="var(--border)"
                    axisLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    dataKey="topic"
                    type="category"
                    tick={CHART_TICK}
                    stroke="var(--border)"
                    axisLine={{ stroke: "var(--border)" }}
                    width={120}
                    interval={0}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                  />
                  <Bar dataKey="count" name="Calls" radius={[0, 2, 2, 0]}>
                    {insights.topTopics.slice(0, 8).map((_, idx) => (
                      <Cell key={idx} fill="var(--accent)" fillOpacity={1 - idx * 0.08} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyRow message="No topics detected yet" />
            )}
          </Panel>
        </div>

        {/* Escalation patterns */}
        {insights.escalationPatterns.length > 0 && (
          <Panel
            kicker="Investigate"
            icon={ShieldWarning}
            title="Recent escalations & low-score calls"
            description="Calls scoring 4.0 or below — potential process improvement opportunities"
            tone="amber"
          >
            <div className="-mx-6 border-t border-border">
              {insights.escalationPatterns.slice(0, 10).map((esc, i) => (
                <Link key={i} href={`/transcripts/${esc.callId}`}>
                  <div className="flex items-start gap-3 px-6 py-3 border-b border-border last:border-b-0 hover:bg-background/60 transition-colors cursor-pointer">
                    <span
                      className="font-display font-medium tabular-nums shrink-0"
                      style={{
                        fontSize: 16,
                        color: scoreTierColor(esc.score),
                        width: 36,
                        letterSpacing: "-0.2px",
                      }}
                    >
                      {esc.score.toFixed(1)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-2" style={{ lineHeight: 1.5 }}>
                        {esc.summary}
                      </p>
                      <p
                        className="font-mono uppercase text-muted-foreground mt-1"
                        style={{ fontSize: 10, letterSpacing: "0.1em" }}
                      >
                        {esc.date ? new Date(esc.date).toLocaleDateString() : "—"}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        )}

        {/* Low confidence calls */}
        {insights.lowConfidenceCalls.length > 0 && (
          <Panel
            kicker="Review needed"
            icon={ChatCircle}
            title="Low confidence analyses"
            description="These calls may need manual review — AI confidence is below 70%"
          >
            <div className="-mx-6 border-t border-border">
              {insights.lowConfidenceCalls.map((call, i) => (
                <Link key={i} href={`/transcripts/${call.callId}`}>
                  <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border last:border-b-0 hover:bg-background/60 transition-colors cursor-pointer">
                    <span
                      className="font-mono tabular-nums shrink-0"
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.02em",
                        padding: "3px 8px",
                        background: "var(--paper-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 2,
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {(call.confidence * 100).toFixed(0)}%
                    </span>
                    <span className="text-sm text-foreground">{call.employee}</span>
                    <span
                      className="font-mono uppercase text-muted-foreground ml-auto"
                      style={{ fontSize: 10, letterSpacing: "0.1em" }}
                    >
                      {call.date ? new Date(call.date).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        )}
      </main>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────
// Page shell — app bar + page header with total-analyzed stat
// ─────────────────────────────────────────────────────────────
function PageShell({
  children,
  totalAnalyzed,
}: {
  children: React.ReactNode;
  totalAnalyzed?: number;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="insights-page">
      <div
        className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border"
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
          <span className="text-foreground">Insights</span>
        </nav>
      </div>

      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.18em" }}
            >
              Analytics
            </div>
            <div
              className="font-display font-medium text-foreground mt-1"
              style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
            >
              Company insights
            </div>
            <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 560 }}>
              Customer-experience trends, complaint patterns, and process-improvement
              opportunities across all analyzed calls.
            </p>
          </div>
          {totalAnalyzed != null && (
            <div className="text-right pb-1">
              <div
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                Analyzed
              </div>
              <div
                className="font-display font-medium tabular-nums text-foreground mt-0.5"
                style={{ fontSize: 26, lineHeight: 1 }}
              >
                {totalAnalyzed.toLocaleString()}
              </div>
              <div
                className="font-mono text-muted-foreground mt-0.5"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                calls
              </div>
            </div>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary tile — mono kicker + small label + display-font value +
// suffix (e.g. "/10") + optional footnote. tone paints the left stripe
// and the number color.
// ─────────────────────────────────────────────────────────────
function SummaryTile({
  kicker,
  label,
  value,
  suffix,
  footnote,
  tone,
  scoreValue,
}: {
  kicker: string;
  label: string;
  value: string;
  suffix?: string;
  footnote?: string;
  tone: "score" | "destructive" | "amber";
  scoreValue?: number;
}) {
  const stripe =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "amber"
      ? "var(--amber)"
      : scoreTierColor(scoreValue ?? null);
  const color =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "amber"
      ? "color-mix(in oklch, var(--amber), var(--ink) 20%)"
      : scoreTierColor(scoreValue ?? null);
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{ borderColor: "var(--border)", borderLeft: `3px solid ${stripe}` }}
    >
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {kicker}
      </div>
      <div
        className="text-sm text-foreground mt-0.5"
        style={{ fontWeight: 500 }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span
          className="font-display font-medium tabular-nums"
          style={{ fontSize: 28, lineHeight: 1, color, letterSpacing: "-0.4px" }}
        >
          {value}
        </span>
        {suffix && (
          <span
            className="font-mono text-muted-foreground"
            style={{ fontSize: 12, letterSpacing: "0.02em" }}
          >
            {suffix}
          </span>
        )}
      </div>
      {footnote && (
        <p
          className="text-muted-foreground mt-1.5"
          style={{ fontSize: 11, lineHeight: 1.5 }}
        >
          {footnote}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Panel shell — mirrors ScorecardPanel / SentimentPanel. Optional
// tone paints a left stripe for alert-flavored sections (complaints,
// escalations). Inline here; promote when a 4th analytics page needs
// the shape.
// ─────────────────────────────────────────────────────────────
function Panel({
  kicker,
  title,
  description,
  icon: IconComp,
  tone,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  icon?: Icon;
  tone?: "destructive" | "amber" | "sage";
  children: React.ReactNode;
}) {
  const stripe =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "amber"
      ? "var(--amber)"
      : tone === "sage"
      ? "var(--sage)"
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
        {description && (
          <p
            className="text-muted-foreground mt-1.5"
            style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 540 }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-sm"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "12px 16px",
        fontSize: 13,
        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
      }}
    >
      <Warning style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p
      className="font-mono uppercase text-muted-foreground text-center py-10"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {message}
    </p>
  );
}
