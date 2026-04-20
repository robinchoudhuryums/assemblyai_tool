import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  CheckCircle,
  Crown,
  Fire,
  Heart,
  Lightning,
  Medal,
  Rocket,
  Shield,
  Star,
  TrendUp,
  Trophy,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { LoadingIndicator } from "@/components/ui/loading";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scoreTierColor } from "@/components/analytics/chart-primitives";

interface BadgeData {
  id: string;
  badgeType: string;
  earnedAt: string;
  label: string;
  description: string;
  icon: string;
}

interface LeaderboardEntry {
  employeeId: string;
  employeeName: string;
  subTeam?: string;
  totalCalls: number;
  avgScore: number;
  totalPoints: number;
  currentStreak: number;
  badges: BadgeData[];
  rank: number;
}

const BADGE_ICONS: Record<string, Icon> = {
  star: Star,
  fire: Fire,
  lightning: Lightning,
  rocket: Rocket,
  trophy: Trophy,
  crown: Crown,
  "trend-up": TrendUp,
  shield: Shield,
  heart: Heart,
  "check-circle": CheckCircle,
};

// ─────────────────────────────────────────────────────────────
// Leaderboard (installment 13 — warm-paper rewrite).
// Agent rankings by performance score + points + streak. Reuses the
// shared scoreTierColor() for the Avg column so tier color matches
// Reports / Agent Scorecard / Performance.
// ─────────────────────────────────────────────────────────────
export default function Leaderboard() {
  const [period, setPeriod] = useState<"week" | "month" | "all">("all");

  const { data, isLoading, error } = useQuery<{ leaderboard: LeaderboardEntry[]; period: string }>({
    queryKey: ["/api/gamification/leaderboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/leaderboard?period=${period}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      return res.json();
    },
  });

  const leaderboard = data?.leaderboard || [];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="leaderboard-page">
      <LeaderboardAppBar />
      <LeaderboardPageHeader />

      {/* Period tabs — warm-paper mono uppercase */}
      <div className="flex gap-2 px-7 py-3 bg-background border-b border-border">
        {(
          [
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "all", label: "All time" },
          ] as const
        ).map(({ value, label }) => (
          <PeriodTab
            key={value}
            active={period === value}
            onClick={() => setPeriod(value)}
            label={label}
          />
        ))}
      </div>

      <main className="px-7 py-6 space-y-6 max-w-6xl mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingIndicator text="Loading leaderboard..." />
          </div>
        ) : error ? (
          <ErrorBanner message={(error as Error)?.message ?? "Failed to load leaderboard."} />
        ) : leaderboard.length === 0 ? (
          <LeaderboardPanel kicker="Empty">
            <div className="text-center py-14">
              <Trophy
                style={{ width: 40, height: 40, margin: "0 auto", color: "var(--muted-foreground)" }}
              />
              <div
                className="font-mono uppercase text-muted-foreground mt-4"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                No data
              </div>
              <p className="text-sm text-foreground mt-2">
                No rankings for this period yet.
              </p>
            </div>
          </LeaderboardPanel>
        ) : (
          <>
            {/* Podium — top 3, with #1 in the middle of a 3-col grid */}
            {leaderboard.length >= 3 && (
              <div className="grid grid-cols-3 gap-4">
                {[1, 0, 2].map((idx) => {
                  const entry = leaderboard[idx];
                  if (!entry) return null;
                  return <PodiumCard key={entry.employeeId} entry={entry} highlighted={idx === 0} />;
                })}
              </div>
            )}

            {/* Full rankings table */}
            <LeaderboardPanel kicker="Full rankings" icon={Trophy} title="Agent ranking">
              <div className="-mx-6 border-t border-border">
                {/* Header row */}
                <div
                  className="grid gap-3 px-6 py-3 border-b border-border font-mono uppercase text-muted-foreground"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    gridTemplateColumns: "40px 1fr 80px 60px 56px 72px 72px",
                  }}
                >
                  <div>#</div>
                  <div>Agent</div>
                  <div className="text-right">Points</div>
                  <div className="text-right">Avg</div>
                  <div className="text-right">Calls</div>
                  <div className="text-right">Streak</div>
                  <div className="text-right">Badges</div>
                </div>
                {leaderboard.map((entry) => (
                  <RankRow key={entry.employeeId} entry={entry} />
                ))}
              </div>
            </LeaderboardPanel>
          </>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App bar + page header
// ─────────────────────────────────────────────────────────────
function LeaderboardAppBar() {
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
        <span className="text-foreground">Leaderboard</span>
      </nav>
    </div>
  );
}

function LeaderboardPageHeader() {
  return (
    <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.18em" }}
      >
        <Trophy style={{ width: 12, height: 12, color: "var(--accent)" }} weight="duotone" />
        Gamification
      </div>
      <div
        className="font-display font-medium text-foreground mt-1"
        style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
      >
        Leaderboard
      </div>
      <p
        className="text-muted-foreground mt-2"
        style={{ fontSize: 14, maxWidth: 620 }}
      >
        Agent rankings based on performance scores, consistency, and achievements.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Period tab — mono uppercase pill toggle (matches AdminTab pattern)
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

// ─────────────────────────────────────────────────────────────
// Podium card — top-3 celebratory tile. #1 gets copper-soft bg +
// copper border. #2/#3 get paper-card with muted/bronze medal glyphs.
// ─────────────────────────────────────────────────────────────
function PodiumCard({
  entry,
  highlighted,
}: {
  entry: LeaderboardEntry;
  highlighted: boolean;
}) {
  return (
    <div
      className="rounded-sm border bg-card text-center px-5 py-6"
      style={{
        borderColor: highlighted ? "var(--accent)" : "var(--border)",
        background: highlighted ? "var(--copper-soft)" : "var(--card)",
        ...(highlighted ? { gridRow: "span 2" } : {}),
      }}
    >
      <div className="flex justify-center mb-3">
        <RankGlyph rank={entry.rank} />
      </div>
      <Link href={`/scorecard/${entry.employeeId}`}>
        <div
          className="font-display font-medium text-foreground hover:underline cursor-pointer"
          style={{
            fontSize: highlighted ? 18 : 15,
            letterSpacing: "-0.2px",
            lineHeight: 1.2,
          }}
        >
          {entry.employeeName}
        </div>
      </Link>
      {entry.subTeam && (
        <div
          className="font-mono uppercase text-muted-foreground mt-1"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          {entry.subTeam}
        </div>
      )}
      <div
        className="font-display font-medium tabular-nums text-foreground mt-3"
        style={{
          fontSize: highlighted ? 34 : 24,
          lineHeight: 1,
          letterSpacing: "-0.5px",
          color: highlighted ? "var(--accent)" : "var(--foreground)",
        }}
      >
        {entry.totalPoints.toLocaleString()}
      </div>
      <div
        className="font-mono uppercase text-muted-foreground mt-1"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        Points
      </div>

      <div
        className="flex items-center justify-center gap-3 mt-4 font-mono tabular-nums"
        style={{ fontSize: 11, letterSpacing: "0.02em", color: "var(--muted-foreground)" }}
      >
        <span style={{ color: scoreTierColor(entry.avgScore) }}>{entry.avgScore.toFixed(1)} avg</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{entry.totalCalls} calls</span>
        <StreakChip streak={entry.currentStreak} />
      </div>

      {entry.badges.length > 0 && (
        <div className="flex justify-center gap-1.5 mt-4 flex-wrap">
          {entry.badges.slice(0, 5).map((b) => {
            const IconComp = BADGE_ICONS[b.icon] || Star;
            return (
              <Tooltip key={b.id}>
                <TooltipTrigger>
                  <div
                    className="rounded-full flex items-center justify-center"
                    style={{
                      width: 28,
                      height: 28,
                      background: "var(--copper-soft)",
                      border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
                    }}
                  >
                    <IconComp
                      style={{ width: 14, height: 14, color: "var(--accent)" }}
                      weight="fill"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">{b.label}</p>
                  <p className="text-xs text-muted-foreground">{b.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
          {entry.badges.length > 5 && (
            <div
              className="rounded-full flex items-center justify-center font-mono"
              style={{
                width: 28,
                height: 28,
                background: "var(--paper-2)",
                border: "1px solid var(--border)",
                fontSize: 10,
                color: "var(--muted-foreground)",
              }}
            >
              +{entry.badges.length - 5}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Rank glyph — crown for #1, gold/silver/bronze medals for top 3,
// mono tabular number for rest
// ─────────────────────────────────────────────────────────────
function RankGlyph({ rank }: { rank: number }) {
  if (rank === 1) {
    return <Crown style={{ width: 28, height: 28, color: "var(--amber)" }} weight="fill" />;
  }
  if (rank === 2) {
    return (
      <Medal
        style={{ width: 26, height: 26, color: "var(--muted-foreground)" }}
        weight="fill"
      />
    );
  }
  if (rank === 3) {
    return (
      <Medal style={{ width: 26, height: 26, color: "var(--accent)" }} weight="fill" />
    );
  }
  return (
    <span
      className="font-mono uppercase tabular-nums text-muted-foreground"
      style={{ fontSize: 13, letterSpacing: "0.04em" }}
    >
      #{rank}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Streak indicator — Fire glyph + mono tabular-nums count
// ─────────────────────────────────────────────────────────────
function StreakChip({ streak }: { streak: number }) {
  if (streak === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
      <Fire style={{ width: 11, height: 11 }} weight="fill" />
      <span className="font-mono tabular-nums">{streak}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Full-rankings document row
// ─────────────────────────────────────────────────────────────
function RankRow({ entry }: { entry: LeaderboardEntry }) {
  const scoreColor = scoreTierColor(entry.avgScore);
  return (
    <div
      className="grid gap-3 px-6 py-3 border-b border-border last:border-b-0 hover:bg-background/60 transition-colors items-center"
      style={{ gridTemplateColumns: "40px 1fr 80px 60px 56px 72px 72px" }}
    >
      <div className="flex justify-center">
        <RankGlyph rank={entry.rank} />
      </div>
      <div className="min-w-0">
        <Link href={`/scorecard/${entry.employeeId}`}>
          <span className="text-sm text-foreground hover:underline cursor-pointer">
            {entry.employeeName}
          </span>
        </Link>
        {entry.subTeam && (
          <span
            className="font-mono uppercase text-muted-foreground ml-2"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            {entry.subTeam}
          </span>
        )}
      </div>
      <div
        className="text-right font-display font-medium tabular-nums text-foreground"
        style={{ fontSize: 14, letterSpacing: "-0.1px" }}
      >
        {entry.totalPoints.toLocaleString()}
      </div>
      <div
        className="text-right font-mono tabular-nums"
        style={{ fontSize: 12, color: scoreColor, letterSpacing: "0.02em" }}
      >
        {entry.avgScore.toFixed(1)}
      </div>
      <div
        className="text-right font-mono tabular-nums text-foreground"
        style={{ fontSize: 12, letterSpacing: "0.02em" }}
      >
        {entry.totalCalls}
      </div>
      <div className="text-right">
        <StreakChip streak={entry.currentStreak} />
      </div>
      <div className="text-right flex items-center justify-end gap-1">
        {entry.badges.slice(0, 3).map((b) => {
          const IconComp = BADGE_ICONS[b.icon] || Star;
          return (
            <Tooltip key={b.id}>
              <TooltipTrigger>
                <IconComp
                  style={{ width: 14, height: 14, color: "var(--muted-foreground)" }}
                />
              </TooltipTrigger>
              <TooltipContent>{b.label}</TooltipContent>
            </Tooltip>
          );
        })}
        {entry.badges.length > 3 && (
          <span
            className="font-mono text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.04em" }}
          >
            +{entry.badges.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Document-card panel (mirrors installment-12 panels)
// ─────────────────────────────────────────────────────────────
function LeaderboardPanel({
  kicker,
  title,
  icon: IconComp,
  children,
}: {
  kicker: string;
  title?: string;
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
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        {title && (
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
          >
            {title}
          </div>
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
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}
