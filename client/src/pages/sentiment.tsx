import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Minus, Smiley, SmileySad, TrendUp, Warning, type Icon } from "@phosphor-icons/react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { PaginatedCalls } from "@shared/schema";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
  CHART_GRID_STROKE,
  SENTIMENT_COLOR,
} from "@/components/analytics/chart-primitives";

interface SentimentData {
  positive: number;
  neutral: number;
  negative: number;
}

// ─────────────────────────────────────────────────────────────
// Sentiment page (installment 9 — warm-paper restyle).
// Uses the shared chart primitives so the typography + tooltip chrome
// stay in lockstep with Reports and the upcoming Performance / Insights
// pages. The recurring panel chrome (kicker + display title + body) is
// inlined here rather than promoted to a primitive — it'll be lifted
// when the second analytics page lands and the actual repetition is
// visible.
// ─────────────────────────────────────────────────────────────
export default function SentimentPage() {
  const { data: sentiment, isLoading, isError, error } = useQuery<SentimentData>({
    queryKey: ["/api/dashboard/sentiment"],
  });

  // CLAUDE.md A14: omit the empty-filter object from the cache key so this
  // query matches the canonical ["/api/calls"] invalidation pattern used by
  // upload-complete webhooks and call mutations.
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls"],
  });
  const calls = callsResponse?.calls;

  // Build weekly trend from calls data
  const weeklyTrend = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const weekMap = new Map<string, { positive: number; neutral: number; negative: number }>();

    for (const call of calls) {
      const date = new Date(call.uploadedAt || 0);
      if (date < ninetyDaysAgo) continue;
      const sent = call.sentiment?.overallSentiment;
      if (!sent) continue;

      // Week key: ISO week start, full YYYY-MM-DD so weeks across year boundaries
      // sort correctly and don't collide.
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      const entry = weekMap.get(key) || { positive: 0, neutral: 0, negative: 0 };
      if (sent === "positive") entry.positive++;
      else if (sent === "neutral") entry.neutral++;
      else if (sent === "negative") entry.negative++;
      weekMap.set(key, entry);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, data]) => ({
        week,
        weekLabel: new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ...data,
      }));
  }, [calls]);

  // Per-employee sentiment breakdown
  const employeeSentiment = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const empMap = new Map<
      string,
      { name: string; positive: number; neutral: number; negative: number; total: number }
    >();

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
      .filter((e) => e.total >= 1)
      .sort((a, b) => b.positive / b.total - a.positive / a.total)
      .slice(0, 10);
  }, [calls]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground" data-testid="sentiment-page">
        <SentimentAppBar />
        <SentimentPageHeader />
        <div className="flex items-center justify-center h-64">
          <p
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Loading sentiment data
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background text-foreground" data-testid="sentiment-page">
        <SentimentAppBar />
        <SentimentPageHeader />
        <div className="px-7 py-6">
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
              <p className="mt-1">{(error as Error)?.message ?? "Failed to load sentiment data."}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const positive = sentiment?.positive ?? 0;
  const neutral = sentiment?.neutral ?? 0;
  const negative = sentiment?.negative ?? 0;
  const total = positive + neutral + negative;
  const pct = (val: number) => (total > 0 ? Math.round((val / total) * 100) : 0);

  const pieData = [
    { name: "Positive", value: positive, color: SENTIMENT_COLOR.positive },
    { name: "Neutral", value: neutral, color: SENTIMENT_COLOR.neutral },
    { name: "Negative", value: negative, color: SENTIMENT_COLOR.negative },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="sentiment-page">
      <SentimentAppBar />
      <SentimentPageHeader />

      <main className="px-7 py-6 space-y-8">
        {/* Summary tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SentimentTile
            kicker="Positive"
            count={positive}
            pct={pct(positive)}
            tone="positive"
            icon={Smiley}
          />
          <SentimentTile
            kicker="Neutral"
            count={neutral}
            pct={pct(neutral)}
            tone="neutral"
            icon={Minus}
          />
          <SentimentTile
            kicker="Negative"
            count={negative}
            pct={pct(negative)}
            tone="negative"
            icon={SmileySad}
          />
        </div>

        {/* Distribution + trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel kicker="Mix" title="Distribution">
            {total > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP} />
                  <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No sentiment data yet" />
            )}
          </Panel>

          <Panel
            kicker="Last 90 days"
            title="Weekly trend"
            icon={TrendUp}
          >
            {weeklyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={weeklyTrend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sentSage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SENTIMENT_COLOR.positive} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={SENTIMENT_COLOR.positive} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sentMuted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SENTIMENT_COLOR.neutral} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SENTIMENT_COLOR.neutral} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sentRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SENTIMENT_COLOR.negative} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SENTIMENT_COLOR.negative} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="weekLabel" tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                  <Area
                    type="monotone"
                    dataKey="positive"
                    name="Positive"
                    stackId="1"
                    stroke={SENTIMENT_COLOR.positive}
                    fill="url(#sentSage)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="neutral"
                    name="Neutral"
                    stackId="1"
                    stroke={SENTIMENT_COLOR.neutral}
                    fill="url(#sentMuted)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="negative"
                    name="Negative"
                    stackId="1"
                    stroke={SENTIMENT_COLOR.negative}
                    fill="url(#sentRed)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="Not enough data for trend yet" />
            )}
          </Panel>
        </div>

        {/* Per-employee breakdown */}
        {employeeSentiment.length > 0 && (
          <Panel kicker="By agent" title="Agent sentiment breakdown">
            <div className="-mx-6 border-t border-border">
              {employeeSentiment.map((emp) => (
                <AgentSentimentRow key={emp.name} emp={emp} />
              ))}
            </div>
            <div
              className="flex flex-wrap gap-x-5 gap-y-2 pt-4 mt-1 border-t border-border font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              <SentimentLegendDot color={SENTIMENT_COLOR.positive} label="Positive" />
              <SentimentLegendDot color={SENTIMENT_COLOR.neutral} label="Neutral" />
              <SentimentLegendDot color={SENTIMENT_COLOR.negative} label="Negative" />
            </div>
          </Panel>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App bar — breadcrumb header consistent with Reports / Admin /
// Employees. Documented in the warm-paper system as "page-level app bar".
// ─────────────────────────────────────────────────────────────
function SentimentAppBar() {
  return (
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
        <span className="text-foreground">Sentiment</span>
      </nav>
    </div>
  );
}

function SentimentPageHeader() {
  return (
    <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
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
        Sentiment
      </div>
      <p
        className="text-muted-foreground mt-2"
        style={{ fontSize: 14, maxWidth: 640 }}
      >
        Overall sentiment distribution and trends across all analyzed calls.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary tile — display-font count + mono uppercase kicker + small
// pct line. Tone drives the icon-tile background (sage/muted/destructive
// soft). Mirrors the Reports MetricCard look with a tighter footprint.
// ─────────────────────────────────────────────────────────────
function SentimentTile({
  kicker,
  count,
  pct,
  tone,
  icon: Icon,
}: {
  kicker: string;
  count: number;
  pct: number;
  tone: "positive" | "neutral" | "negative";
  icon: Icon;
}) {
  const palette = {
    positive: { bg: "var(--sage-soft)", border: "color-mix(in oklch, var(--sage), transparent 60%)", color: "var(--sage)" },
    neutral: { bg: "var(--paper-2)", border: "var(--border)", color: "var(--muted-foreground)" },
    negative: { bg: "var(--warm-red-soft)", border: "color-mix(in oklch, var(--destructive), transparent 60%)", color: "var(--destructive)" },
  }[tone];

  return (
    <div
      className="flex items-center gap-4 rounded-sm border bg-card px-5 py-4"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
        style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
      >
        <Icon style={{ width: 22, height: 22, color: palette.color }} weight="duotone" />
      </div>
      <div className="min-w-0">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {kicker}
        </div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span
            className="font-display font-medium tabular-nums text-foreground"
            style={{ fontSize: 30, lineHeight: 1 }}
          >
            {count}
          </span>
          <span
            className="font-mono tabular-nums"
            style={{ fontSize: 11, color: palette.color, letterSpacing: "0.04em" }}
          >
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Generic warm-paper panel — kicker + display-font title + body.
// Inline implementation; will be promoted to a shared primitive when
// the second analytics page lands and confirms the repetition.
// ─────────────────────────────────────────────────────────────
function Panel({
  kicker,
  title,
  icon: Icon,
  children,
}: {
  kicker: string;
  title: string;
  icon?: Icon;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {Icon && <Icon style={{ width: 12, height: 12 }} />}
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[260px]">
      <p
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {message}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-agent breakdown row — name, segmented bar, total. Uses the
// shared sentiment palette so the row matches the trend chart and the
// summary tiles exactly.
// ─────────────────────────────────────────────────────────────
function AgentSentimentRow({
  emp,
}: {
  emp: { name: string; positive: number; neutral: number; negative: number; total: number };
}) {
  const segments: Array<{ key: keyof typeof SENTIMENT_COLOR; count: number; label: string }> = [
    { key: "positive", count: emp.positive, label: "positive" },
    { key: "neutral", count: emp.neutral, label: "neutral" },
    { key: "negative", count: emp.negative, label: "negative" },
  ];
  const ariaLabel = `${emp.name}: ${emp.positive} positive, ${emp.neutral} neutral, ${emp.negative} negative`;

  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b border-border last:border-b-0">
      <span
        className="text-sm text-foreground truncate shrink-0"
        style={{ width: 160 }}
      >
        {emp.name}
      </span>
      <div
        className="flex-1 flex h-2.5 overflow-hidden rounded-sm"
        style={{ background: "var(--paper-2)" }}
        role="meter"
        aria-label={ariaLabel}
      >
        {segments.map(({ key, count }) =>
          count > 0 ? (
            <div
              key={key}
              style={{
                width: `${(count / emp.total) * 100}%`,
                background: SENTIMENT_COLOR[key],
              }}
              title={`${key}: ${count}`}
            />
          ) : null,
        )}
      </div>
      <span
        className="font-mono tabular-nums text-muted-foreground shrink-0 text-right"
        style={{ fontSize: 11, width: 64, letterSpacing: "0.02em" }}
      >
        {emp.total} {emp.total === 1 ? "call" : "calls"}
      </span>
    </div>
  );
}

function SentimentLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="rounded-full"
        style={{ width: 8, height: 8, background: color }}
      />
      {label}
    </span>
  );
}
