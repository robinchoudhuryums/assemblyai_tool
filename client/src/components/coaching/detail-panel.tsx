/**
 * Coaching — Detail panel (installment 5, phase 5).
 *
 * Slide-in from the right, 720px wide on desktop / full-width on
 * mobile. Replaces the inline row/card expand from phases 3–4. Mirrors
 * docs/design-bundle/project/coaching-detail.jsx with these scope
 * changes:
 *
 *  - "Try this" (suggestedFix) section dropped; we don't have the
 *    field and the action-plan checklist covers the same intent.
 *  - "Practice" (simulator link + scenarios) section dropped; simulator
 *    is admin-only today and there's no schema field for the link.
 *  - "Evidence of change" wired to GET /api/coaching/:id/outcome
 *    (before/after sub-score comparison, already implemented). Rendered
 *    only when the endpoint returns useful data.
 *  - "Referenced call" card shows a link to /transcripts/:callId when
 *    present — no clip range / sentiment-shift data in our schema.
 *  - Footer: status-transition buttons (Start / Complete / Dismiss /
 *    Reopen) instead of "Move to next stage" because we don't track a
 *    real stage. Maps to the existing PATCH /api/coaching/:id endpoint.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { X } from "@phosphor-icons/react";
import type { CoachingSession } from "@shared/schema";
import { Avatar } from "@/components/dashboard/primitives";
import {
  CompetencyChip,
  DuePill,
  SectionLabel,
  SourceBadge,
  StageChip,
  StageTrack,
  deriveSource,
  deriveStage,
  dueDaysFromIso,
  growthCopyForCategory,
} from "./primitives";

interface CoachingOutcome {
  coachingSessionId: string;
  employeeId: string;
  coachingCreatedAt: string;
  windowSize: number;
  minWindow: number;
  insufficientData: boolean;
  before: {
    callCount: number;
    avgScore: number | null;
    subScores: {
      compliance: number | null;
      customerExperience: number | null;
      communication: number | null;
      resolution: number | null;
    };
  };
  after: {
    callCount: number;
    avgScore: number | null;
    subScores: {
      compliance: number | null;
      customerExperience: number | null;
      communication: number | null;
      resolution: number | null;
    };
  };
  deltas: {
    overall: number | null;
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  };
}

export interface DetailPanelProps {
  session: CoachingSession | null;
  /** Display name for the assignee — GET /api/coaching injects employeeName; pass it through */
  employeeName?: string | null;
  onClose: () => void;
  /** Manager+ can change status; viewers can still check off action items */
  canManage?: boolean;
  togglePending?: boolean;
  onUpdateStatus?: (sessionId: string, status: CoachingSession["status"]) => void;
  onToggleActionItem?: (sessionId: string, index: number) => void;
  /** Submit the manager's effectiveness rating at session close. Manager+ only. */
  onRateEffectiveness?: (
    sessionId: string,
    rating: "helpful" | "neutral" | "not_helpful" | null,
    note: string,
  ) => void;
  ratePending?: boolean;
}

export default function DetailPanel(props: DetailPanelProps) {
  // Escape key closes the panel.
  useEffect(() => {
    if (!props.session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.session, props.onClose]);

  // Fetch outcome only while the panel is open. The endpoint is
  // manager-only on the server; for viewers the query will 403 and we
  // silently hide the Evidence section.
  const outcomeQuery = useQuery<CoachingOutcome>({
    queryKey: ["/api/coaching", props.session?.id, "outcome"],
    enabled: !!props.session?.id && props.canManage === true,
    retry: false,
  });

  if (!props.session) return null;
  const session = props.session;
  const stage = deriveStage(session) ?? "open";
  const source = deriveSource(session.assignedBy);
  const days = dueDaysFromIso(session.dueDate);
  const growthCopy = growthCopyForCategory(session.category);
  const actionPlan = Array.isArray(session.actionPlan) ? session.actionPlan : [];
  const displayName = props.employeeName ?? "—";
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "·";

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: "color-mix(in oklch, var(--ink), transparent 60%)" }}
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Coaching session detail"
      data-testid="coaching-detail-panel"
    >
      <div
        className="absolute right-0 top-0 bottom-0 bg-background overflow-y-auto flex flex-col"
        style={{
          width: "min(720px, 100vw)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div
          className="flex items-center gap-3 px-4 sm:px-8 py-4 bg-card border-b border-border flex-shrink-0"
        >
          <StageChip stage={stage} />
          <div className="flex-1" />
          {/* Tier 1 mobile: enlarged tap target (min 44×44) so the panel
              closes cleanly on touch devices — the overlay backdrop is
              invisible on mobile because the panel is full-width. */}
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close detail panel"
            className="font-mono uppercase inline-flex items-center justify-center gap-1.5 border border-border rounded-sm text-foreground hover:bg-secondary transition-colors min-w-[44px] min-h-[44px] px-3"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="detail-close"
          >
            <X style={{ width: 14, height: 14 }} />
            <span className="hidden sm:inline">esc</span>
          </button>
        </div>

        {/* Hero */}
        <div className="px-5 sm:px-10 pt-6 sm:pt-8 pb-6 border-b border-border">
          {growthCopy && (
            <div
              className="text-[var(--accent)] italic mb-2.5 max-w-lg"
              style={{ fontSize: 14 }}
            >
              {growthCopy}
            </div>
          )}
          <h1
            className="font-display font-medium text-foreground max-w-xl"
            style={{ fontSize: 30, letterSpacing: "-0.6px", lineHeight: 1.15, margin: "0 0 16px" }}
          >
            {session.title}
          </h1>
          <div className="flex flex-wrap gap-3 items-center">
            <CompetencyChip category={session.category} />
            <SourceBadge source={source} assignedByName={session.assignedBy} />
            <div className="flex-1" />
            <DuePill days={days} />
          </div>
        </div>

        {/* Stage track */}
        <div className="px-5 sm:px-10 py-6 bg-card border-b border-border">
          <StageTrack stage={stage} width={640} />
        </div>

        {/* What we noticed */}
        {(session.notes || session.callId) && (
          <DetailSection num="01" title="What we noticed">
            {session.notes && (
              <p
                className="text-foreground"
                style={{ fontSize: 14, lineHeight: 1.65, margin: 0 }}
              >
                {session.notes}
              </p>
            )}
            {session.callId && (
              <div className="mt-4 bg-card border border-border flex items-center gap-4 px-4 py-3.5">
                <div style={{ fontSize: 20, color: "var(--accent)" }}>▶</div>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-mono uppercase text-muted-foreground mb-0.5"
                    style={{ fontSize: 10, letterSpacing: "0.1em" }}
                  >
                    Referenced call
                  </div>
                  <div
                    className="font-mono truncate text-foreground"
                    style={{ fontSize: 11 }}
                  >
                    {session.callId}
                  </div>
                </div>
                <Link
                  href={`/transcripts/${session.callId}`}
                  className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
                  style={{ fontSize: 10, letterSpacing: "0.1em" }}
                >
                  Open transcript →
                </Link>
              </div>
            )}
          </DetailSection>
        )}

        {/* Action plan */}
        {actionPlan.length > 0 && (
          <DetailSection num={session.notes || session.callId ? "02" : "01"} title="Action plan">
            <div className="flex flex-col gap-1.5">
              {actionPlan.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    props.onToggleActionItem &&
                    props.onToggleActionItem(session.id, i)
                  }
                  disabled={props.togglePending || !props.onToggleActionItem}
                  className="flex items-start gap-2.5 text-left rounded-sm px-1.5 py-1 hover:bg-secondary transition-colors disabled:opacity-60"
                  style={{ fontSize: 13 }}
                  aria-label={`Toggle "${item.task}" ${item.completed ? "incomplete" : "complete"}`}
                >
                  <span
                    className="flex-shrink-0 border flex items-center justify-center"
                    aria-hidden="true"
                    style={{
                      width: 16,
                      height: 16,
                      marginTop: 1,
                      background: item.completed ? "var(--sage)" : "var(--card)",
                      borderColor: item.completed ? "var(--sage)" : "var(--border)",
                      color: "var(--paper)",
                    }}
                  >
                    {item.completed && (
                      <span className="font-mono leading-none" style={{ fontSize: 11 }}>
                        ✓
                      </span>
                    )}
                  </span>
                  <span
                    className={item.completed ? "line-through text-muted-foreground" : "text-foreground"}
                    style={{ lineHeight: 1.55 }}
                  >
                    {item.task}
                  </span>
                </button>
              ))}
            </div>
          </DetailSection>
        )}

        {/* Evidence of change — outcome endpoint (manager-only) */}
        {props.canManage && outcomeQuery.data && !outcomeQuery.data.insufficientData && (
          <EvidenceSection
            outcome={outcomeQuery.data}
            num={computeSectionNum(session, 3)}
          />
        )}

        {/* Manager-supplied effectiveness rating — shown for completed
            sessions so managers can capture the causal judgment that the
            statistical outcome metric can't: "did this actually help?". */}
        {props.canManage && session.status === "completed" && props.onRateEffectiveness && (
          <EffectivenessSection
            sessionId={session.id}
            currentRating={session.effectivenessRating ?? null}
            currentNote={session.effectivenessNote ?? ""}
            onRate={props.onRateEffectiveness}
            pending={props.ratePending ?? false}
            num={computeSectionNum(session, 4)}
          />
        )}

        {/* Footer: avatar + status transitions */}
        <div className="mt-auto px-5 sm:px-10 py-6 border-t border-border bg-card flex items-center gap-3 flex-wrap">
          <Avatar initials={initials} size={32} />
          <div className="flex-1 min-w-0">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Assigned to
            </div>
            <div
              className="font-display font-medium text-foreground truncate"
              style={{ fontSize: 14 }}
            >
              {displayName}
            </div>
          </div>
          {props.canManage && props.onUpdateStatus && (
            <StatusTransitionButtons
              status={session.status}
              pending={props.togglePending}
              onUpdateStatus={(s) => props.onUpdateStatus!(session.id, s)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  num,
  title,
  accent,
  children,
}: {
  num: string;
  title: string;
  accent?: "sage";
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 sm:px-10 py-6 border-b border-border">
      <div className="flex items-baseline gap-3 mb-3.5">
        <div
          className="font-mono text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          {num}
        </div>
        <h3
          className="font-display font-semibold uppercase"
          style={{
            fontSize: 12,
            letterSpacing: "0.14em",
            color: accent === "sage" ? "var(--sage)" : "var(--foreground)",
            margin: 0,
          }}
        >
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function EvidenceSection({ outcome, num }: { outcome: CoachingOutcome; num: string }) {
  const overall = outcome.deltas.overall;
  return (
    <DetailSection num={num} title="Evidence of change" accent="sage">
      <div
        className="border border-border px-4 py-3.5"
        style={{ background: "var(--sage-soft)" }}
      >
        <div className="flex items-start gap-4 flex-wrap">
          {overall !== null && (
            <div
              className="font-display font-medium tabular-nums"
              style={{ fontSize: 28, color: overall >= 0 ? "var(--sage)" : "var(--destructive)", lineHeight: 1 }}
            >
              {overall >= 0 ? "+" : ""}
              {overall.toFixed(1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div
              className="font-display font-medium text-foreground"
              style={{ fontSize: 14 }}
            >
              {outcome.before.callCount} call{outcome.before.callCount === 1 ? "" : "s"} before ·{" "}
              {outcome.after.callCount} call{outcome.after.callCount === 1 ? "" : "s"} after
            </div>
            <div
              className="text-muted-foreground italic mt-0.5"
              style={{ fontSize: 13 }}
            >
              {evidenceBlurb(outcome)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {(
            [
              { key: "compliance", label: "Compliance" },
              { key: "customerExperience", label: "Customer Exp." },
              { key: "communication", label: "Communication" },
              { key: "resolution", label: "Resolution" },
            ] as const
          ).map(({ key, label }) => {
            const delta = outcome.deltas[key];
            return (
              <div key={key}>
                <div
                  className="font-mono uppercase text-muted-foreground"
                  style={{ fontSize: 9, letterSpacing: "0.1em" }}
                >
                  {label}
                </div>
                <div
                  className="font-mono tabular-nums mt-0.5"
                  style={{
                    fontSize: 14,
                    color:
                      delta === null
                        ? "var(--muted-foreground)"
                        : delta >= 0
                        ? "var(--sage)"
                        : "var(--destructive)",
                  }}
                >
                  {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DetailSection>
  );
}

function evidenceBlurb(outcome: CoachingOutcome): string {
  const d = outcome.deltas.overall;
  if (d === null) return "Not enough scored calls yet to compute a delta.";
  if (d >= 0.5) return "Clear improvement since this coaching started.";
  if (d >= 0.1) return "Gentle upward trend.";
  if (d > -0.1) return "Holding steady.";
  if (d > -0.5) return "Slight dip — worth a look.";
  return "Decline since this coaching started.";
}

function computeSectionNum(session: CoachingSession, offset: number): string {
  let n = 0;
  if (session.notes || session.callId) n++;
  const ap = Array.isArray(session.actionPlan) ? session.actionPlan : [];
  if (ap.length > 0) n++;
  return String(n + 1 > offset ? offset : n + 1).padStart(2, "0");
}

function StatusTransitionButtons({
  status,
  pending,
  onUpdateStatus,
}: {
  status: CoachingSession["status"];
  pending?: boolean;
  onUpdateStatus: (s: CoachingSession["status"]) => void;
}) {
  const targets: Array<{ label: string; value: CoachingSession["status"]; primary?: boolean }> = [];
  if (status === "pending") targets.push({ label: "Start", value: "in_progress", primary: true });
  if (status !== "completed" && status !== "dismissed")
    targets.push({ label: "Complete", value: "completed", primary: status === "in_progress" });
  if (status !== "dismissed" && status !== "completed")
    targets.push({ label: "Dismiss", value: "dismissed" });
  if (status === "completed") targets.push({ label: "Reopen", value: "in_progress" });
  if (targets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onUpdateStatus(t.value)}
          disabled={pending}
          className={`font-mono uppercase rounded-sm px-3 py-2 transition-colors disabled:opacity-60 ${
            t.primary
              ? "bg-primary text-[var(--paper)] border border-primary hover:opacity-90"
              : "border border-border text-foreground hover:bg-secondary"
          }`}
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Section rendered only on completed sessions. Manager rates effectiveness
// (helpful / neutral / not_helpful) with an optional free-text note.
// Complements the statistical outcome metric (which only measures
// before/after score delta) with causal judgment.
function EffectivenessSection({
  sessionId,
  currentRating,
  currentNote,
  onRate,
  pending,
  num,
}: {
  sessionId: string;
  currentRating: "helpful" | "neutral" | "not_helpful" | null;
  currentNote: string;
  onRate: (id: string, rating: "helpful" | "neutral" | "not_helpful" | null, note: string) => void;
  pending: boolean;
  num: string;
}) {
  const [note, setNote] = useState(currentNote);
  const [selectedRating, setSelectedRating] = useState<typeof currentRating>(currentRating);
  // Reset local state when the panel switches to a different session.
  useEffect(() => {
    setNote(currentNote);
    setSelectedRating(currentRating);
  }, [sessionId, currentNote, currentRating]);

  const ratingOptions: Array<{
    value: "helpful" | "neutral" | "not_helpful";
    label: string;
    tone: string;
  }> = [
    { value: "helpful", label: "Helpful", tone: "var(--sage)" },
    { value: "neutral", label: "Neutral", tone: "var(--muted-foreground)" },
    { value: "not_helpful", label: "Not helpful", tone: "var(--destructive)" },
  ];

  const hasChanges = selectedRating !== currentRating || note !== currentNote;

  return (
    <DetailSection num={num} title="Effectiveness rating">
      <div className="text-xs text-muted-foreground mb-3" style={{ lineHeight: 1.5 }}>
        Did this coaching session actually help? Your rating complements the
        before/after score delta with a causal judgment.
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ratingOptions.map((opt) => {
          const active = selectedRating === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelectedRating(active ? null : opt.value)}
              disabled={pending}
              className="font-mono uppercase rounded-sm px-3 py-2 transition-colors disabled:opacity-60"
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                backgroundColor: active ? opt.tone : "var(--card)",
                color: active ? "var(--paper)" : "var(--foreground)",
                border: `1px solid ${active ? opt.tone : "var(--border)"}`,
              }}
              data-testid={`effectiveness-${opt.value}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
        placeholder="Optional: what specifically changed, or why not?"
        className="w-full min-h-[70px] rounded-sm border border-input bg-background px-3 py-2 text-sm"
        maxLength={1000}
        disabled={pending}
        data-testid="effectiveness-note"
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={() => onRate(sessionId, selectedRating, note)}
          disabled={pending || !hasChanges}
          className="font-mono uppercase rounded-sm px-3 py-2 bg-primary text-[var(--paper)] border border-primary disabled:opacity-60"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          data-testid="effectiveness-save"
        >
          {pending ? "Saving…" : currentRating === null ? "Submit" : "Update"}
        </button>
      </div>
    </DetailSection>
  );
}

