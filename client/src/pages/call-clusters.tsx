import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  Minus,
  Stack,
  TrendDown,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Employee } from "@shared/schema";
import { scoreTierColor, SENTIMENT_COLOR } from "@/components/analytics/chart-primitives";

interface TopicCluster {
  id: string;
  label: string;
  topics: string[];
  callCount: number;
  callIds: string[];
  avgScore: number | null;
  avgSentiment: { positive: number; neutral: number; negative: number };
  trend: "rising" | "stable" | "declining";
  recentCallIds: string[];
}

/**
 * Trend glyph mapping. "Rising" uses destructive (bad trend for
 * complaints); "declining" uses sage (good — complaint volume going
 * down); "stable" uses muted-foreground.
 */
const TREND_META: Record<
  TopicCluster["trend"],
  { icon: Icon; color: string; label: string }
> = {
  rising: { icon: TrendUp, color: "var(--destructive)", label: "Rising" },
  stable: { icon: Minus, color: "var(--muted-foreground)", label: "Stable" },
  declining: { icon: TrendDown, color: "var(--sage)", label: "Declining" },
};

// ─────────────────────────────────────────────────────────────
// Call Clusters (installment 13 — warm-paper rewrite).
// Topic-similarity groups of calls. Rising clusters get a destructive
// left-stripe so trending issues jump visually. Score coloring goes
// through scoreTierColor; sentiment bar uses SENTIMENT_COLOR from
// chart-primitives so the palette stays on-system.
// ─────────────────────────────────────────────────────────────
export default function CallClusters() {
  const [days, setDays] = useState("30");
  const [employeeId, setEmployeeId] = useState("all");

  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const queryParams = new URLSearchParams({ days });
  if (employeeId !== "all") queryParams.set("employee", employeeId);

  const { data, isLoading } = useQuery<{ clusters: TopicCluster[]; days: number }>({
    queryKey: ["/api/analytics/clusters", days, employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/clusters?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clusters");
      return res.json();
    },
  });

  const clusters = data?.clusters || [];
  const risingCount = clusters.filter((c) => c.trend === "rising").length;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="call-clusters-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border"
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
          <span className="text-foreground">Clusters</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
              style={{ fontSize: 10, letterSpacing: "0.18em" }}
            >
              <Stack style={{ width: 12, height: 12 }} />
              Analytics
            </div>
            <div
              className="font-display font-medium text-foreground mt-1"
              style={{
                fontSize: "clamp(24px, 3vw, 30px)",
                letterSpacing: "-0.6px",
                lineHeight: 1.15,
              }}
            >
              Call clusters
            </div>
            <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
              Calls grouped by topic similarity. Surface trending issues before they become
              patterns.
            </p>
          </div>
          {risingCount > 0 && (
            <div
              className="inline-flex items-center gap-1.5 rounded-sm shrink-0"
              style={{
                padding: "6px 12px",
                background: "var(--warm-red-soft)",
                border: "1px solid color-mix(in oklch, var(--destructive), transparent 55%)",
                color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
              }}
            >
              <TrendUp style={{ width: 13, height: 13 }} />
              <span
                className="font-mono uppercase"
                style={{ fontSize: 10, letterSpacing: "0.12em" }}
              >
                {risingCount} rising trend{risingCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filter row */}
      <div className="px-4 sm:px-7 py-4 border-b border-border bg-background">
        <div className="flex flex-wrap items-end gap-4">
          <FilterBlock label="Window">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </FilterBlock>
          <FilterBlock label="Agent">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-56 h-9 text-sm">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {(employees || [])
                  .filter((e) => e.status === "Active")
                  .map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FilterBlock>
        </div>
      </div>

      <main className="px-4 sm:px-7 py-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-sm border bg-card p-5 space-y-3"
                style={{ borderColor: "var(--border)" }}
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : clusters.length === 0 ? (
          <div
            className="rounded-sm border bg-card text-center py-14 px-6"
            style={{ borderColor: "var(--border)" }}
          >
            <Stack
              style={{ width: 36, height: 36, margin: "0 auto", color: "var(--muted-foreground)" }}
            />
            <div
              className="font-mono uppercase text-muted-foreground mt-3"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              No clusters
            </div>
            <p className="text-sm text-foreground mt-2">
              No clusters found for this window. Need at least 2 completed calls with AI analysis.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clusters.map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Cluster tile — topic chips + stat grid + hairline sentiment bar
// ─────────────────────────────────────────────────────────────
function ClusterCard({ cluster }: { cluster: TopicCluster }) {
  const trend = TREND_META[cluster.trend];
  const TrendIcon = trend.icon;

  const total =
    cluster.avgSentiment.positive + cluster.avgSentiment.neutral + cluster.avgSentiment.negative;
  const positivePct = total > 0 ? Math.round((cluster.avgSentiment.positive / total) * 100) : 0;
  const neutralPct = total > 0 ? Math.round((cluster.avgSentiment.neutral / total) * 100) : 0;
  const negativePct = total > 0 ? Math.round((cluster.avgSentiment.negative / total) * 100) : 0;

  const isRising = cluster.trend === "rising";
  const scoreColor = scoreTierColor(cluster.avgScore);

  return (
    <div
      className="rounded-sm border bg-card transition-colors hover:border-foreground/30"
      style={{
        borderColor: "var(--border)",
        ...(isRising ? { borderLeft: "3px solid var(--destructive)" } : {}),
      }}
    >
      {/* Header row: label + trend pill */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div
          className="font-display font-medium text-foreground capitalize min-w-0"
          style={{ fontSize: 15, lineHeight: 1.3, letterSpacing: "-0.1px" }}
        >
          {cluster.label}
        </div>
        <div
          className="inline-flex items-center gap-1 shrink-0 font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.1em", color: trend.color }}
          title={`Trend: ${trend.label}`}
        >
          <TrendIcon style={{ width: 11, height: 11 }} />
          {trend.label}
        </div>
      </div>

      {/* Topic chips */}
      <div className="px-5 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {cluster.topics.map((topic, i) => (
            <span
              key={i}
              className="font-mono rounded-sm"
              style={{
                fontSize: 10,
                letterSpacing: "0.02em",
                padding: "2px 8px",
                background: "var(--paper-2)",
                border: "1px solid var(--border)",
                color: "var(--muted-foreground)",
              }}
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="px-5 py-3 grid grid-cols-2 gap-3 border-t border-border"
        style={{ background: "var(--paper-2)" }}
      >
        <ClusterStat label="Calls" value={cluster.callCount.toString()} />
        <ClusterStat
          label="Avg score"
          value={cluster.avgScore != null ? `${cluster.avgScore.toFixed(1)}/10` : "—"}
          color={scoreColor}
        />
        <ClusterStat label="Recent (7d)" value={cluster.recentCallIds.length.toString()} />
        <ClusterStat
          label="Pos / neg"
          value={`${positivePct}% / ${negativePct}%`}
          color={
            negativePct > positivePct ? SENTIMENT_COLOR.negative : SENTIMENT_COLOR.positive
          }
        />
      </div>

      {/* Sentiment bar */}
      {total > 0 && (
        <div className="px-5 py-3 border-t border-border">
          <div
            className="flex h-1.5 rounded-sm overflow-hidden"
            style={{ background: "var(--paper-2)" }}
            role="meter"
            aria-label={`Positive ${positivePct}%, neutral ${neutralPct}%, negative ${negativePct}%`}
          >
            {positivePct > 0 && (
              <div style={{ width: `${positivePct}%`, background: SENTIMENT_COLOR.positive }} />
            )}
            {neutralPct > 0 && (
              <div style={{ width: `${neutralPct}%`, background: SENTIMENT_COLOR.neutral }} />
            )}
            {negativePct > 0 && (
              <div style={{ width: `${negativePct}%`, background: SENTIMENT_COLOR.negative }} />
            )}
          </div>
        </div>
      )}

      {/* Link row */}
      {cluster.recentCallIds.length > 0 && (
        <div className="px-5 pb-4 pt-2">
          <Link href={`/transcripts/${cluster.recentCallIds[0]}`}>
            <span
              className="font-mono uppercase inline-flex items-center gap-1.5 cursor-pointer"
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--accent)",
              }}
            >
              View latest call
              <ArrowRight style={{ width: 11, height: 11 }} />
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

function ClusterStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 9, letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      <div
        className="font-mono tabular-nums mt-0.5"
        style={{
          fontSize: 13,
          letterSpacing: "0.02em",
          color: color || "var(--foreground)",
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground mb-1.5"
        style={{ fontSize: 10, letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
