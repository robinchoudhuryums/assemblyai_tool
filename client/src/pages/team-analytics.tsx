import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CaretDown,
  CaretRight,
  Clock,
  DownloadSimple,
  TrendUp,
  Users,
  Warning,
} from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_GRID_STROKE,
  scoreTierColor,
} from "@/components/analytics/chart-primitives";

interface TeamData {
  team: string;
  employeeCount: number;
  callCount: number;
  avgScore: number | null;
  avgConfidence: number | null;
  completedCalls: number;
  failedCalls: number;
  avgDuration: number | null;
  employees: string[];
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  pseudonym: string | null;
  callCount: number;
  avgScore: number | null;
  avgDuration: number | null;
  lastCallDate: string | null;
}

// ─────────────────────────────────────────────────────────────
// Team Analytics (installment 12 — warm-paper rewrite).
// Manager+ view comparing performance across sub-teams. The backend
// returns avgScore on a 0-100 scale, so tier color uses `score / 10`.
// Chart chrome + tier color come from the shared chart-primitives
// module (installment 9).
// ─────────────────────────────────────────────────────────────
function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function scoreToTierColor(score0to100: number | null): string {
  return scoreTierColor(score0to100 != null ? score0to100 / 10 : null);
}

/** Horizontal progress bar for 0-100 scores — used in team header rows
 *  and member detail rows. */
function ScoreBar({ score, width = 100 }: { score: number | null; width?: number }) {
  if (score == null) {
    return (
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.1em" }}
      >
        —
      </span>
    );
  }
  const color = scoreToTierColor(score);
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="rounded-sm overflow-hidden"
        style={{ width, height: 6, background: "var(--paper-2)" }}
      >
        <div
          className="h-full rounded-sm transition-all"
          style={{ width: `${Math.min(score, 100)}%`, background: color }}
        />
      </div>
      <span
        className="font-mono tabular-nums"
        style={{ fontSize: 11, letterSpacing: "0.02em", color, minWidth: 24 }}
      >
        {Math.round(score)}
      </span>
    </div>
  );
}

function TeamDetail({ teamName }: { teamName: string }) {
  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/analytics/team", teamName],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  if (isLoading) {
    return (
      <p
        className="font-mono uppercase text-muted-foreground px-6 py-6"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        Loading team members…
      </p>
    );
  }
  if (members.length === 0) {
    return (
      <p
        className="font-mono uppercase text-muted-foreground px-6 py-6"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        No active employees in this team
      </p>
    );
  }

  return (
    <div className="border-t border-border" style={{ background: "var(--paper-2)" }}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <TeamMemberHeader>Employee</TeamMemberHeader>
            <TeamMemberHeader align="right">Calls</TeamMemberHeader>
            <TeamMemberHeader align="right">Avg score</TeamMemberHeader>
            <TeamMemberHeader align="right">Avg duration</TeamMemberHeader>
            <TeamMemberHeader align="right">Last call</TeamMemberHeader>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.id}
              className="border-b border-border last:border-b-0"
            >
              <td className="px-6 py-2.5 text-sm text-foreground">
                {m.pseudonym || m.name}
              </td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums text-foreground">
                {m.callCount}
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="inline-flex">
                  <ScoreBar score={m.avgScore} width={80} />
                </div>
              </td>
              <td
                className="px-4 py-2.5 font-mono text-right tabular-nums"
                style={{ fontSize: 11, color: "var(--muted-foreground)" }}
              >
                {formatDuration(m.avgDuration)}
              </td>
              <td
                className="px-6 py-2.5 font-mono uppercase text-right text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
              >
                {m.lastCallDate ? new Date(m.lastCallDate).toLocaleDateString() : "Never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamMemberHeader({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="font-mono uppercase text-muted-foreground"
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        fontWeight: 500,
        padding: "10px 16px",
        textAlign: align,
      }}
    >
      {children}
    </th>
  );
}

export default function TeamAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.set("from", dateFrom);
  if (dateTo) queryParams.set("to", dateTo);
  const qs = queryParams.toString();

  const { data: teams = [], isLoading, isError, error } = useQuery<TeamData[]>({
    queryKey: ["/api/analytics/teams", qs],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const chartData = teams
    .filter((t) => t.avgScore !== null)
    .map((t) => ({
      name: t.team,
      score: Math.round(t.avgScore || 0),
      fill: scoreToTierColor(t.avgScore),
    }));

  const handleExport = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    window.open(`/api/export/team-analytics?${params.toString()}`, "_blank");
  };

  const totalCalls = teams.reduce((acc, t) => acc + (t.callCount || 0), 0);
  const totalTeams = teams.length;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="team-analytics-page">
      {/* App bar */}
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
          <span className="text-foreground">Team analytics</span>
        </nav>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}>
          <DownloadSimple className="w-4 h-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      {/* Page header */}
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
              Team analytics
            </div>
            <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 540 }}>
              Compare performance across sub-teams. Expand a team for per-employee detail.
            </p>
          </div>
          <div className="flex items-center gap-6 pb-1">
            <HeaderStat label="Teams" value={totalTeams.toString()} />
            <HeaderStat label="Total calls" value={totalCalls.toLocaleString()} />
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="px-7 py-4 border-b border-border bg-background">
        <div className="flex items-end gap-4">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground mb-1.5"
              style={{ fontSize: 10, letterSpacing: "0.12em" }}
            >
              From
            </div>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-44 h-9"
            />
          </div>
          <div>
            <div
              className="font-mono uppercase text-muted-foreground mb-1.5"
              style={{ fontSize: 10, letterSpacing: "0.12em" }}
            >
              To
            </div>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-44 h-9"
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <main className="px-7 py-6 space-y-6">
        {isError && (
          <ErrorBanner message={(error as Error)?.message ?? "Failed to load team analytics."} />
        )}

        {/* Bar chart */}
        {chartData.length > 0 && (
          <TeamPanel kicker="Cross-team" icon={TrendUp} title="Average performance score by team">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 4, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="name"
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                  height={70}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={CHART_TICK}
                  stroke="var(--border)"
                  axisLine={{ stroke: "var(--border)" }}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                />
                <Bar dataKey="score" name="Avg score" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </TeamPanel>
        )}

        {/* Team rows */}
        {isLoading ? (
          <p
            className="font-mono uppercase text-muted-foreground text-center py-10"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Loading team analytics…
          </p>
        ) : teams.length === 0 && !isError ? (
          <TeamPanel kicker="No data" title="No team analytics yet">
            <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.55 }}>
              No team data available. Assign employees to sub-teams in the Employees page to see
              analytics.
            </p>
          </TeamPanel>
        ) : (
          <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
            {teams.map((team) => {
              const isOpen = expandedTeam === team.team;
              return (
                <div key={team.team} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedTeam(isOpen ? null : team.team)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-background/60 transition-colors text-left"
                  >
                    <div className="shrink-0">
                      {isOpen ? (
                        <CaretDown style={{ width: 14, height: 14, color: "var(--muted-foreground)" }} />
                      ) : (
                        <CaretRight style={{ width: 14, height: 14, color: "var(--muted-foreground)" }} />
                      )}
                    </div>
                    <div
                      className="rounded-full shrink-0"
                      style={{
                        width: 10,
                        height: 10,
                        background: scoreToTierColor(team.avgScore),
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-display font-medium text-foreground truncate"
                        style={{ fontSize: 15, letterSpacing: "-0.1px" }}
                      >
                        {team.team}
                      </div>
                      <div
                        className="font-mono text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap"
                        style={{ fontSize: 11, letterSpacing: "0.02em" }}
                      >
                        <span>
                          {team.employeeCount} {team.employeeCount === 1 ? "employee" : "employees"}
                        </span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-8 shrink-0">
                      <TeamHeaderStat
                        icon={Users}
                        label="Calls"
                        value={team.callCount.toLocaleString()}
                      />
                      <div>
                        <div
                          className="font-mono uppercase text-muted-foreground flex items-center gap-1 mb-1"
                          style={{ fontSize: 9, letterSpacing: "0.12em" }}
                        >
                          <TrendUp style={{ width: 10, height: 10 }} />
                          Avg score
                        </div>
                        <ScoreBar score={team.avgScore} />
                      </div>
                      <TeamHeaderStat
                        icon={Clock}
                        label="Avg duration"
                        value={formatDuration(team.avgDuration)}
                      />
                    </div>
                  </button>
                  {isOpen && <TeamDetail teamName={team.team} />}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums text-foreground mt-0.5"
        style={{ fontSize: 22, lineHeight: 1 }}
      >
        {value}
      </div>
    </div>
  );
}

function TeamHeaderStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1 mb-1"
        style={{ fontSize: 9, letterSpacing: "0.12em" }}
      >
        <Icon style={{ width: 10, height: 10 }} />
        {label}
      </div>
      <div
        className="font-mono tabular-nums text-foreground"
        style={{ fontSize: 12, letterSpacing: "0.02em" }}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Panel shell — same document-card chrome used by Performance /
// Insights (installment 11). Inline; promote when a 4th consumer
// repeats the pattern.
// ─────────────────────────────────────────────────────────────
function TeamPanel({
  kicker,
  title,
  icon: IconComp,
  children,
}: {
  kicker: string;
  title: string;
  icon?: React.ComponentType<{ style?: React.CSSProperties }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
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
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}
