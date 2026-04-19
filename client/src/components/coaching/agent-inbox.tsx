/**
 * Coaching — Agent Inbox variant (installment 5, phase 3).
 *
 * Variant A from docs/design-bundle/project/coaching-agent-inbox.jsx.
 * Airy, growth-forward view for viewers/agents (self-service coaching).
 *
 * Layout:
 *  - Hero greeting + "You're growing" display headline
 *  - Next-action card: first non-signed-off item sorted by due date,
 *    with GrowthRing + warm framing + issue text + Open/Practice CTAs
 *  - Active items list: InboxRow per session (click to expand inline
 *    action items — Phase 5 replaces this with the slide-in Detail
 *    panel)
 *  - Signed-off section (when any completed sessions exist)
 *  - Right rail (sticky on lg+): addressed-this-month big number,
 *    streak pips, weekly score sparkline
 *
 * Deferred to backend follow-on:
 *  - Competency Radar (needs per-agent per-category sub-score avg)
 *  - Practice-in-simulator CTA (simulator is admin-only today)
 *  - Slide-in Detail panel (Phase 5 of this cycle)
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { CoachingSession } from "@shared/schema";
import { Sparkline } from "@/components/dashboard/primitives";
import {
  CompetencyChip,
  DuePill,
  GrowthRing,
  SourceBadge,
  StreakPips,
  categoryMeta,
  deriveSource,
  deriveStage,
  dueDaysFromIso,
  growthCopyForCategory,
  type Stage,
} from "./primitives";

export interface AgentInboxData {
  employee: { id: string; name: string } | null;
  coaching: CoachingSession[];
  currentStreak: number;
  weeklyTrend: Array<{ week: string; avgScore: number; count: number }>;
}

interface AgentInboxProps {
  data: AgentInboxData;
  meName?: string | null;
  /** Click a row / next-action → open slide-in DetailPanel (phase 5). */
  onOpenDetail?: (sessionId: string) => void;
}

export default function AgentInbox({
  data,
  meName,
  onOpenDetail,
}: AgentInboxProps) {
  const firstName = (meName || data.employee?.name || "").split(" ")[0] || "there";
  const greeting = getTimeOfDayGreeting();

  // Partition: active (stage != signed-off, status != dismissed) vs signed-off
  const { active, signedOff } = useMemo(() => {
    const act: Array<{ session: CoachingSession; stage: Stage }> = [];
    const done: Array<{ session: CoachingSession; stage: Stage }> = [];
    for (const s of data.coaching) {
      const stage = deriveStage(s);
      if (stage === null) continue; // dismissed
      if (stage === "signed-off") done.push({ session: s, stage });
      else act.push({ session: s, stage });
    }
    // Sort active by due date ascending (overdue first, undated last)
    act.sort((a, b) => {
      const ad = dueDaysFromIso(a.session.dueDate);
      const bd = dueDaysFromIso(b.session.dueDate);
      const aVal = ad === null ? 9999 : ad;
      const bVal = bd === null ? 9999 : bd;
      return aVal - bVal;
    });
    return { active: act, signedOff: done };
  }, [data.coaching]);

  const nextAction = active[0];

  // "Addressed this month" — sessions completed in the last 30 days
  const addressedThisMonth = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    return data.coaching.filter(
      (s) => s.status === "completed" && s.completedAt && new Date(s.completedAt).getTime() >= cutoff,
    ).length;
  }, [data.coaching]);

  return (
    <div
      className="mx-auto grid gap-8 lg:gap-10 px-6 md:px-10 py-8 md:py-10"
      style={{
        maxWidth: 1280,
        gridTemplateColumns: "minmax(0, 1fr) 320px",
      }}
      data-testid="agent-inbox"
    >
      <div className="min-w-0">
        {/* Hero greeting */}
        <div className="mb-8 md:mb-10">
          <div
            className="font-mono uppercase text-muted-foreground mb-2"
            style={{ fontSize: 10, letterSpacing: "0.12em" }}
          >
            Good {greeting}, {firstName}
          </div>
          <h1
            className="font-display font-normal text-foreground max-w-3xl"
            style={{ fontSize: "clamp(28px, 4vw, 36px)", letterSpacing: "-0.8px", lineHeight: 1.15 }}
          >
            {heroHeadline(active.length, data.currentStreak)}
          </h1>
        </div>

        {nextAction && (
          <NextActionCard
            session={nextAction.session}
            stage={nextAction.stage}
            onOpen={onOpenDetail}
          />
        )}

        <section className="mb-10">
          <div
            className="flex items-baseline justify-between mb-3.5"
          >
            <h2
              className="font-display font-medium text-foreground uppercase"
              style={{ fontSize: 13, letterSpacing: "0.14em" }}
            >
              Active · {active.length}
            </h2>
          </div>
          {active.length === 0 ? (
            <div
              className="bg-card border border-dashed border-border py-8 text-center text-sm text-muted-foreground"
            >
              Nothing on your plate right now. Nice.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {active.map(({ session, stage }) => (
                <InboxRow
                  key={session.id}
                  session={session}
                  stage={stage}
                  onOpen={onOpenDetail}
                />
              ))}
            </div>
          )}
        </section>

        {signedOff.length > 0 && (
          <section>
            <h3
              className="font-display font-medium text-muted-foreground uppercase mb-3.5"
              style={{ fontSize: 13, letterSpacing: "0.14em" }}
            >
              Signed off · {signedOff.length}
            </h3>
            <div className="flex flex-col gap-2.5">
              {signedOff.map(({ session, stage }) => (
                <InboxRow
                  key={session.id}
                  session={session}
                  stage={stage}
                  subdued
                  onOpen={onOpenDetail}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Right rail (sticky on lg+) */}
      <aside className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
        <GrowthPanel
          addressedThisMonth={addressedThisMonth}
          streak={data.currentStreak}
          weeklyTrend={data.weeklyTrend}
        />
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Next-action card — click opens the slide-in Detail panel.
// ─────────────────────────────────────────────────────────────
function NextActionCard({
  session,
  stage,
  onOpen,
}: {
  session: CoachingSession;
  stage: Stage;
  onOpen?: (sessionId: string) => void;
}) {
  const source = deriveSource(session.assignedBy);
  const days = dueDaysFromIso(session.dueDate);
  const growthCopy = growthCopyForCategory(session.category);
  return (
    <div
      className="bg-card border border-border mb-8"
      style={{ borderLeft: "3px solid var(--accent)", padding: "24px 28px" }}
    >
      <div className="flex justify-between items-start gap-6 mb-3.5">
        <div className="min-w-0">
          <div
            className="font-mono uppercase mb-2.5"
            style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.14em" }}
          >
            ↗ Next up
          </div>
          <h2
            className="font-display font-medium text-foreground"
            style={{ fontSize: 22, letterSpacing: "-0.3px", margin: "0 0 6px" }}
          >
            {session.title}
          </h2>
          {growthCopy && (
            <div
              className="text-muted-foreground italic max-w-lg"
              style={{ fontSize: 13 }}
            >
              {growthCopy}
            </div>
          )}
        </div>
        <GrowthRing stage={stage} size={80} />
      </div>

      <div className="flex flex-wrap gap-2.5 items-center mb-4">
        <CompetencyChip category={session.category} />
        <SourceBadge source={source} assignedByName={session.assignedBy} />
        <div className="flex-1" />
        <DuePill days={days} />
      </div>

      {session.notes && (
        <div
          className="pt-3.5 pb-3.5 border-t border-border mb-3.5 text-foreground"
          style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 640 }}
        >
          {session.notes}
        </div>
      )}

      <div className="flex gap-2.5 flex-wrap">
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(session.id)}
            className="font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-4 py-2.5 text-[var(--paper)] bg-primary border border-primary hover:opacity-90 transition-opacity"
            style={{ fontSize: 11, letterSpacing: "0.1em" }}
            data-testid="next-action-open"
          >
            Open item →
          </button>
        )}
        {session.callId && (
          <Link
            href={`/transcripts/${session.callId}`}
            className="font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-4 py-2.5 border border-border text-foreground hover:bg-secondary transition-colors"
            style={{ fontSize: 11, letterSpacing: "0.1em" }}
          >
            Open call →
          </Link>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inbox row — click to expand action items inline
// (Phase 5 replaces inline expansion with a slide-in Detail panel.)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Inbox row — click opens the slide-in Detail panel.
// ─────────────────────────────────────────────────────────────
function InboxRow({
  session,
  stage,
  subdued,
  onOpen,
}: {
  session: CoachingSession;
  stage: Stage;
  subdued?: boolean;
  onOpen?: (sessionId: string) => void;
}) {
  const source = deriveSource(session.assignedBy);
  const days = dueDaysFromIso(session.dueDate);
  return (
    <button
      type="button"
      onClick={() => onOpen && onOpen(session.id)}
      disabled={!onOpen}
      className="grid gap-4 items-center text-left bg-card border border-border hover:bg-secondary transition-colors disabled:cursor-default disabled:hover:bg-card"
      style={{
        gridTemplateColumns: "44px minmax(0, 1fr) auto",
        padding: "14px 18px",
        opacity: subdued ? 0.7 : 1,
      }}
      data-testid={`inbox-row-${session.id}`}
    >
      <GrowthRing stage={stage} size={44} strokeW={3} />
      <div className="min-w-0">
        <div
          className="font-display font-medium text-foreground truncate mb-1"
          style={{ fontSize: 15, letterSpacing: "-0.1px" }}
        >
          {session.title}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <CompetencyChip category={session.category} compact />
          <SourceBadge source={source} compact />
          {days !== null && (
            <>
              <span className="font-mono text-muted-foreground" style={{ fontSize: 10 }}>·</span>
              <DuePill days={days} />
            </>
          )}
        </div>
      </div>
      <span
        className="font-mono text-muted-foreground"
        style={{ fontSize: 16 }}
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}


// ─────────────────────────────────────────────────────────────
// Growth panel (right rail)
// ─────────────────────────────────────────────────────────────
function GrowthPanel({
  addressedThisMonth,
  streak,
  weeklyTrend,
}: {
  addressedThisMonth: number;
  streak: number;
  weeklyTrend: AgentInboxData["weeklyTrend"];
}) {
  const latestScore = weeklyTrend.length > 0 ? weeklyTrend[weeklyTrend.length - 1].avgScore : null;
  const firstScore = weeklyTrend.length > 0 ? weeklyTrend[0].avgScore : null;
  const delta = latestScore !== null && firstScore !== null ? latestScore - firstScore : null;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <Kicker>This month</Kicker>
        <div className="flex items-baseline gap-2 mt-1.5">
          <div
            className="font-display font-medium tabular-nums text-primary"
            style={{ fontSize: 56, letterSpacing: "-2px", lineHeight: 1 }}
          >
            {addressedThisMonth}
          </div>
          <div className="font-mono text-muted-foreground" style={{ fontSize: 11 }}>
            item{addressedThisMonth === 1 ? "" : "s"}
          </div>
        </div>
        <div
          className="text-muted-foreground italic mt-1"
          style={{ fontSize: 13 }}
        >
          {addressedInsight(addressedThisMonth)}
        </div>
      </Panel>

      <Panel>
        <Kicker>Streak · calls ≥ 8</Kicker>
        <div className="flex items-baseline gap-2 mt-2 mb-2">
          <div
            className="font-display font-medium tabular-nums text-foreground"
            style={{ fontSize: 32, letterSpacing: "-1px", lineHeight: 1 }}
          >
            {streak}
          </div>
          <div className="font-mono text-muted-foreground" style={{ fontSize: 11 }}>
            in a row
          </div>
        </div>
        <StreakPips count={streak} />
      </Panel>

      {weeklyTrend.length >= 2 && latestScore !== null && (
        <Panel>
          <Kicker>Your rubric — last {weeklyTrend.length} weeks</Kicker>
          <div className="flex items-baseline gap-1.5 mt-2 mb-2">
            <div
              className="font-display font-medium tabular-nums text-foreground"
              style={{ fontSize: 28, letterSpacing: "-1px", lineHeight: 1 }}
            >
              {latestScore.toFixed(1)}
            </div>
            {delta !== null && (
              <div
                className="font-mono tabular-nums"
                style={{ fontSize: 11, color: delta >= 0 ? "var(--sage)" : "var(--destructive)" }}
              >
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
              </div>
            )}
          </div>
          <div style={{ color: "var(--accent)" }}>
            <Sparkline
              data={weeklyTrend.map((w) => w.avgScore)}
              width={240}
              height={40}
              stroke="currentColor"
            />
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Local primitives
// ─────────────────────────────────────────────────────────────
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border" style={{ padding: "18px 22px" }}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getTimeOfDayGreeting(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function heroHeadline(activeCount: number, streak: number): React.ReactNode {
  if (activeCount === 0 && streak === 0) return "All caught up. Enjoy the quiet.";
  const itemLabel = `${activeCount} open item${activeCount === 1 ? "" : "s"}`;
  const streakLabel =
    streak >= 3 ? `${streak}-call streak.` : null;
  return (
    <>
      You're growing.{" "}
      <span className="text-muted-foreground">
        {itemLabel}
        {streakLabel ? ` · ${streakLabel}` : "."}
      </span>
    </>
  );
}

function addressedInsight(n: number): string {
  if (n === 0) return "Nothing closed out yet this month.";
  if (n < 3) return "Small steps — every one counts.";
  if (n < 6) return "Real momentum.";
  return "Best month yet.";
}
