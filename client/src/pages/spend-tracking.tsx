import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Calendar,
  CurrencyDollar,
  Flask,
  Phone,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react";
import { LoadingIndicator } from "@/components/ui/loading";
import { type UsageRecord } from "@shared/schema";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
  CHART_GRID_STROKE,
} from "@/components/analytics/chart-primitives";

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatCostPrecise(cost: number | null | undefined): string {
  // F6: null = pricing missing; render an explicit signal rather than $0.00
  if (cost == null) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

type Period = "current-month" | "last-month" | "ytd" | "all-time";

const PERIOD_TABS: Array<{ value: Period; label: string }> = [
  { value: "current-month", label: "Current month" },
  { value: "last-month", label: "Last month" },
  { value: "ytd", label: "Year to date" },
  { value: "all-time", label: "All time" },
];

function filterByPeriod(records: UsageRecord[], period: Period): UsageRecord[] {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  switch (period) {
    case "current-month":
      return records.filter((r) => new Date(r.timestamp) >= startOfMonth);
    case "last-month":
      return records.filter((r) => {
        const d = new Date(r.timestamp);
        return d >= startOfLastMonth && d <= endOfLastMonth;
      });
    case "ytd":
      return records.filter((r) => new Date(r.timestamp) >= startOfYear);
    case "all-time":
      return records;
  }
}

function computeStats(records: UsageRecord[]) {
  const totalCost = records.reduce((sum, r) => sum + r.totalEstimatedCost, 0);
  const assemblyaiCost = records.reduce(
    (sum, r) => sum + (r.services.assemblyai?.estimatedCost || 0),
    0,
  );
  const bedrockCost = records.reduce(
    (sum, r) =>
      sum + (r.services.bedrock?.estimatedCost || 0) +
      (r.services.bedrockSecondary?.estimatedCost || 0),
    0,
  );
  const callCount = records.filter((r) => r.type === "call").length;
  const abTestCount = records.filter((r) => r.type === "ab-test").length;
  const avgCostPerCall =
    callCount > 0 ? totalCost / Math.max(1, callCount + abTestCount) : 0;

  return { totalCost, assemblyaiCost, bedrockCost, callCount, abTestCount, avgCostPerCall };
}

function getDailyData(records: UsageRecord[]) {
  const dailyMap = new Map<
    string,
    { date: string; cost: number; calls: number; abTests: number }
  >();

  for (const r of records) {
    const date = r.timestamp.split("T")[0];
    const existing = dailyMap.get(date) || { date, cost: 0, calls: 0, abTests: 0 };
    existing.cost += r.totalEstimatedCost;
    if (r.type === "call") existing.calls++;
    else existing.abTests++;
    dailyMap.set(date, existing);
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getUserData(records: UsageRecord[]) {
  const userMap = new Map<string, { user: string; cost: number; count: number }>();
  for (const r of records) {
    const existing = userMap.get(r.user) || { user: r.user, cost: 0, count: 0 };
    existing.cost += r.totalEstimatedCost;
    existing.count++;
    userMap.set(r.user, existing);
  }
  return Array.from(userMap.values()).sort((a, b) => b.cost - a.cost);
}

// ─────────────────────────────────────────────────────────────
// Spend Tracking (installment 15 — warm-paper rewrite).
// Admin-only. Reuses chart-primitives (installment 9) for axes/
// tooltips/legends; service split uses sage (AssemblyAI) + copper
// (Bedrock) instead of the prior hex palette.
// ─────────────────────────────────────────────────────────────
interface CostBudgetSummary {
  monthlyBudget: number | null;
  mtd: { total: number; assemblyai: number; bedrock: number; bedrockSecondary: number };
  trailing30Total: number;
  utilizationPct: number | null;
  projectedMtdEnd: number;
  projectedOverPct: number | null;
  severity: "info" | "warning" | "critical" | "unknown";
  topUsers: { user: string; cost: number }[];
  missingPricingRecords: number;
}

export default function SpendTrackingPage() {
  const [period, setPeriod] = useState<Period>("current-month");
  const { data: records = [], isLoading } = useQuery<UsageRecord[]>({
    queryKey: ["/api/usage"],
    staleTime: 60000,
  });
  const { data: budget } = useQuery<CostBudgetSummary>({
    queryKey: ["/api/admin/cost-budget"],
    staleTime: 60000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="spend-tracking-page">
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
          <span className="text-foreground">Spend tracking</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <CurrencyDollar style={{ width: 12, height: 12 }} />
          Operations
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Spend tracking
        </div>
        <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
          Estimated API costs for AssemblyAI transcription and Bedrock AI analysis. Updated as
          calls process; figures are pre-AWS-billing estimates.
        </p>
      </div>

      {/* Cost budget banner — month-to-date utilization vs configured cap */}
      {budget && <CostBudgetBanner budget={budget} />}

      {/* Period tabs */}
      <div className="flex gap-2 px-4 sm:px-7 py-3 bg-background border-b border-border flex-wrap">
        {PERIOD_TABS.map(({ value, label }) => (
          <PeriodTab
            key={value}
            active={period === value}
            onClick={() => setPeriod(value)}
            label={label}
          />
        ))}
      </div>

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingIndicator text="Loading spend data..." />
          </div>
        ) : (
          <PeriodView records={filterByPeriod(records, period)} period={period} />
        )}

        {/* Recent activity panel */}
        <SpendPanel kicker="Activity" title="Recent activity" description="Last 50 processed calls and A/B tests">
          {records.length === 0 ? (
            <p
              className="font-mono uppercase text-muted-foreground text-center py-10"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              No usage data recorded yet · costs will appear here after calls process
            </p>
          ) : (
            <div className="-mx-6 border-t border-border max-h-[420px] overflow-y-auto">
              {records.slice(0, 50).map((r) => (
                <ActivityRow key={r.id} record={r} />
              ))}
            </div>
          )}
        </SpendPanel>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Cost budget banner: MTD utilization vs configured monthly cap
// ─────────────────────────────────────────────────────────────
function CostBudgetBanner({ budget }: { budget: CostBudgetSummary }) {
  const { monthlyBudget, mtd, utilizationPct, projectedOverPct, severity, missingPricingRecords } = budget;
  if (monthlyBudget === null) {
    return (
      <div
        className="px-4 sm:px-7 py-3 bg-background border-b border-border"
      >
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          MTD spend ${mtd.total.toFixed(2)} · monthly budget unset (set MONTHLY_COST_BUDGET_USD to enable utilization tracking)
          {missingPricingRecords > 0 && (
            <span style={{ color: "var(--amber)" }}> · {missingPricingRecords} record{missingPricingRecords === 1 ? "" : "s"} with missing Bedrock pricing</span>
          )}
        </div>
      </div>
    );
  }
  const tone =
    severity === "critical" ? { bg: "var(--destructive-soft)", fg: "var(--destructive)" } :
    severity === "warning" ? { bg: "var(--amber-soft)", fg: "var(--amber)" } :
    { bg: "var(--sage-soft)", fg: "var(--sage)" };
  return (
    <div
      className="px-4 sm:px-7 py-3 border-b border-border"
      style={{ background: tone.bg }}
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <div
          className="font-display font-medium tabular-nums"
          style={{ fontSize: 22, color: tone.fg, lineHeight: 1 }}
        >
          {utilizationPct?.toFixed(1)}%
        </div>
        <div
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.1em", color: tone.fg }}
        >
          MTD ${mtd.total.toFixed(2)} / ${monthlyBudget.toFixed(2)} budget
          {projectedOverPct !== null && (
            <> · projected month-end {projectedOverPct.toFixed(1)}%</>
          )}
        </div>
      </div>
      <div
        className="font-mono uppercase text-muted-foreground mt-1.5 flex gap-3 flex-wrap"
        style={{ fontSize: 9, letterSpacing: "0.08em" }}
      >
        <span>AAI ${mtd.assemblyai.toFixed(2)}</span>
        <span>Bedrock ${mtd.bedrock.toFixed(2)}</span>
        {mtd.bedrockSecondary > 0 && <span>A/B ${mtd.bedrockSecondary.toFixed(2)}</span>}
        {missingPricingRecords > 0 && (
          <span style={{ color: "var(--amber)" }}>
            {missingPricingRecords} unpriced
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-period body: summary tiles + charts + cost-by-user
// ─────────────────────────────────────────────────────────────
function PeriodView({ records, period }: { records: UsageRecord[]; period: Period }) {
  const stats = computeStats(records);
  const dailyData = getDailyData(records);
  const userData = getUserData(records);

  const serviceSplit = [
    { name: "AssemblyAI", value: stats.assemblyaiCost, color: "var(--sage)" },
    { name: "Bedrock", value: stats.bedrockCost, color: "var(--accent)" },
  ].filter((s) => s.value > 0);

  const periodLabel = {
    "current-month": "this month",
    "last-month": "last month",
    ytd: "year to date",
    "all-time": "all time",
  }[period];

  return (
    <div className="space-y-6">
      {/* Summary tile strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryTile
          icon={CurrencyDollar}
          kicker="Cost"
          label="Total estimated"
          value={formatCost(stats.totalCost)}
          tone="sage"
        />
        <SummaryTile
          icon={Phone}
          kicker="Volume"
          label="Calls processed"
          value={stats.callCount.toLocaleString()}
          footnote={stats.abTestCount > 0 ? `+ ${stats.abTestCount} A/B tests` : undefined}
        />
        <SummaryTile
          icon={TrendUp}
          kicker="Per call"
          label="Avg cost / call"
          value={formatCost(stats.avgCostPerCall)}
        />
        <SummaryTile
          icon={Calendar}
          kicker="Window"
          label="Period"
          value={periodLabel}
          footnote={`${records.length} records`}
          isText
        />
      </div>

      {/* Daily spend + service split */}
      {records.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Daily spend area chart */}
          <div className="lg:col-span-2">
            <SpendPanel kicker="Trend" title="Daily spend">
              {dailyData.length > 1 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart
                    data={dailyData}
                    margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="spendCopper" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="date"
                      tick={CHART_TICK}
                      tickFormatter={(d) => d.slice(5)}
                      stroke="var(--border)"
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tick={CHART_TICK}
                      tickFormatter={(v) => `$${v}`}
                      stroke="var(--border)"
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP}
                      labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                      labelFormatter={(label) =>
                        new Date(label + "T00:00:00").toLocaleDateString()
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      fill="url(#spendCopper)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p
                  className="font-mono uppercase text-muted-foreground text-center py-12"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  Need at least 2 days of data for a chart
                </p>
              )}
            </SpendPanel>
          </div>

          {/* Service split donut */}
          <SpendPanel kicker="Breakdown" title="Cost by service">
            {serviceSplit.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={serviceSplit}
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="var(--card)"
                    strokeWidth={2}
                  >
                    {serviceSplit.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                  />
                  <Legend wrapperStyle={CHART_LEGEND} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p
                className="font-mono uppercase text-muted-foreground text-center py-12"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                No cost data
              </p>
            )}
          </SpendPanel>
        </div>
      )}

      {/* Cost by user — horizontal bar chart */}
      {userData.length > 0 && (
        <SpendPanel kicker="Attribution" title="Cost by user">
          <ResponsiveContainer
            width="100%"
            height={Math.max(180, userData.length * 38)}
          >
            <BarChart
              data={userData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
              <XAxis
                type="number"
                tick={CHART_TICK}
                tickFormatter={(v) => `$${v}`}
                stroke="var(--border)"
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                type="category"
                dataKey="user"
                tick={CHART_TICK}
                stroke="var(--border)"
                axisLine={{ stroke: "var(--border)" }}
                width={120}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Total cost"]}
              />
              <Bar dataKey="cost" fill="var(--accent)" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SpendPanel>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Activity row — Phone (call, accent) or Flask (A/B test, sage) icon
// ─────────────────────────────────────────────────────────────
function ActivityRow({ record: r }: { record: UsageRecord }) {
  const isCall = r.type === "call";
  const Icon = isCall ? Phone : Flask;
  const tone = isCall ? "var(--accent)" : "var(--sage)";
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border last:border-b-0 hover:bg-background/60 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="rounded-full flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            background:
              isCall
                ? "var(--copper-soft)"
                : "var(--sage-soft)",
            border: `1px solid color-mix(in oklch, ${tone}, transparent 55%)`,
          }}
        >
          <Icon style={{ width: 13, height: 13, color: tone }} />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            {isCall ? "Call analysis" : "A/B test"}
            <span
              className="font-mono uppercase text-muted-foreground ml-2"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              by {r.user}
            </span>
          </div>
          <div
            className="font-mono text-muted-foreground tabular-nums mt-0.5"
            style={{ fontSize: 10, letterSpacing: "0.02em" }}
          >
            {r.services.assemblyai && (
              <span>AAI {formatCostPrecise(r.services.assemblyai.estimatedCost)}</span>
            )}
            {r.services.bedrock && (
              <span className="ml-3">
                Bedrock {formatCostPrecise(r.services.bedrock.estimatedCost)}
                {r.services.bedrock.costPricingMissing && (
                  <span
                    className="ml-1 px-1 py-0.5 font-mono uppercase"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.05em",
                      backgroundColor: "var(--amber-soft)",
                      color: "var(--amber)",
                      borderRadius: 2,
                    }}
                    title={`Cost pricing missing for model "${r.services.bedrock.model}". Add it to BEDROCK_PRICING in server/routes/utils.ts.`}
                  >
                    pricing?
                  </span>
                )}
              </span>
            )}
            {r.services.bedrockSecondary && (
              <span className="ml-1">
                + {formatCostPrecise(r.services.bedrockSecondary.estimatedCost)}
                {r.services.bedrockSecondary.costPricingMissing && (
                  <span
                    className="ml-1 px-1 py-0.5 font-mono uppercase"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.05em",
                      backgroundColor: "var(--amber-soft)",
                      color: "var(--amber)",
                      borderRadius: 2,
                    }}
                    title={`Cost pricing missing for model "${r.services.bedrockSecondary.model}".`}
                  >
                    pricing?
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span
          className="font-mono tabular-nums rounded-sm"
          style={{
            fontSize: 11,
            letterSpacing: "0.02em",
            padding: "3px 10px",
            background: "var(--paper-2)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
            fontWeight: 500,
            minWidth: 64,
            textAlign: "center",
            display: "inline-block",
          }}
        >
          {formatCostPrecise(r.totalEstimatedCost)}
        </span>
        <span
          className="font-mono uppercase text-muted-foreground text-right"
          style={{ fontSize: 10, letterSpacing: "0.1em", minWidth: 124 }}
        >
          {new Date(r.timestamp).toLocaleDateString()}{" "}
          {new Date(r.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline helpers (mirror installment-13/14 pattern)
// ─────────────────────────────────────────────────────────────
function PeriodTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono uppercase inline-flex items-center rounded-sm px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background border border-foreground"
          : "bg-card border border-border text-foreground hover:bg-secondary"
      }`}
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      {label}
    </button>
  );
}

function SummaryTile({
  icon: IconComp,
  kicker,
  label,
  value,
  footnote,
  tone,
  isText,
}: {
  icon: Icon;
  kicker: string;
  label: string;
  value: string;
  footnote?: string;
  tone?: "sage";
  isText?: boolean;
}) {
  const valueColor = tone === "sage" ? "var(--sage)" : "var(--foreground)";
  const stripeColor = tone === "sage" ? "var(--sage)" : null;
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{
        borderColor: "var(--border)",
        ...(stripeColor ? { borderLeft: `3px solid ${stripeColor}` } : {}),
      }}
    >
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        <IconComp style={{ width: 11, height: 11 }} />
        {kicker}
      </div>
      <div
        className="text-sm text-muted-foreground mt-0.5"
        style={{ fontWeight: 400 }}
      >
        {label}
      </div>
      <div
        className={`font-display font-medium mt-1 ${isText ? "capitalize" : "tabular-nums"}`}
        style={{
          fontSize: isText ? 18 : 26,
          lineHeight: 1.1,
          color: valueColor,
          letterSpacing: "-0.4px",
        }}
      >
        {value}
      </div>
      {footnote && (
        <p className="text-muted-foreground mt-1.5" style={{ fontSize: 11, lineHeight: 1.5 }}>
          {footnote}
        </p>
      )}
    </div>
  );
}

function SpendPanel({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
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
