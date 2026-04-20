/**
 * Transcript Viewer side rail (Phase 4 — warm-paper installment 4).
 *
 * Replaces the legacy right-column stack of bg-muted Cards (Call Summary,
 * Key Points, Key Topics, Action Items, AI Feedback) with the Agent
 * Lens / Pulse panel vocabulary: score dial + rubric + AI verdict,
 * AI-chipped summary, coaching highlights, commitments, topics.
 *
 * Editing state is owned by the parent so `useBeforeUnload` in
 * `transcript-viewer.tsx` still gets consistent unsaved-changes
 * detection. This component receives the values + callbacks as props
 * and flips Panel 1 into an inline edit form when `isEditing` is true.
 *
 * ScoreBreakdown + AnnotationsPanel are NOT owned by this file — they
 * stay in `transcript-viewer.tsx` and render directly below the side
 * rail. Manual edit indicator also stays inline in the parent.
 */
import { useEffect, useState } from "react";
import type { CallWithDetails } from "@shared/schema";
import { Clock, FloppyDisk, PencilSimple, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toDisplayString } from "@/lib/display-utils";
import {
  RubricRack,
  ScoreDial,
  type RubricValues,
} from "@/components/dashboard/primitives";

interface SideRailProps {
  call: CallWithDetails;
  /** Jump the audio playhead to the given ms offset */
  onSeek: (ms: number) => void;
  /** Parse an AI-emitted timestamp string ("M:SS" / "MM:SS" / "HH:MM:SS") */
  parseTimestampString: (ts: unknown) => number | null;

  // Editing state — owned by parent for useBeforeUnload
  isEditing: boolean;
  editScore: string;
  editSummary: string;
  editReason: string;
  editError: string | null;
  editPending: boolean;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onChangeEditScore: (v: string) => void;
  onChangeEditSummary: (v: string) => void;
  onChangeEditReason: (v: string) => void;
  onSave: () => void;
}

export default function SideRail(props: SideRailProps) {
  const { call } = props;
  // Agent ↔ manager view toggle, driven by ViewerHeader's role toggle
  // via window events. Defaults to "agent" for viewers (ViewerHeader
  // never emits "manager" for that role, so they stay here).
  const [roleView, setRoleView] = useState<"agent" | "manager">("agent");
  useEffect(() => {
    const onRoleChange = (e: Event) => {
      const detail = (e as CustomEvent<{ role?: "agent" | "manager" }>).detail;
      if (detail?.role === "agent" || detail?.role === "manager") {
        setRoleView(detail.role);
      }
    };
    window.addEventListener("transcript:role-change", onRoleChange);
    return () => window.removeEventListener("transcript:role-change", onRoleChange);
  }, []);

  const score = call.analysis?.performanceScore
    ? Number(call.analysis.performanceScore)
    : null;
  const rubric = extractRubric(call);
  const verdict = composeVerdict(score);
  const subtitle = composeVerdictSubtitle(call);

  return (
    <aside className="flex flex-col gap-3" data-testid="side-rail">
      {/* Panel 1 — Score + rubric + AI verdict (with inline edit flip) */}
      <Panel>
        <div className="flex items-center gap-4">
          {score != null ? (
            <ScoreDial
              value={props.isEditing ? safeNum(props.editScore, score) : score}
              size={96}
              label="Score"
            />
          ) : (
            <div
              className="rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground"
              style={{ width: 96, height: 96, fontSize: 11 }}
            >
              Not scored
            </div>
          )}
          <div className="flex-1 min-w-0">
            <SectionLabel>AI verdict</SectionLabel>
            <div
              className="font-display font-medium text-foreground mt-1"
              style={{ fontSize: 18, letterSpacing: "-0.3px", lineHeight: 1.2 }}
            >
              {verdict}
            </div>
            {subtitle && (
              <div
                className="font-mono text-muted-foreground mt-0.5"
                style={{ fontSize: 11, letterSpacing: "0.06em" }}
              >
                {subtitle}
              </div>
            )}
          </div>
          {!props.isEditing && call.analysis && (
            <button
              type="button"
              onClick={props.onStartEditing}
              aria-label="Edit score and summary"
              className="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-secondary transition-colors"
              data-testid="side-rail-edit"
            >
              <PencilSimple style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>

        {props.isEditing ? (
          <div
            className="mt-4 pt-4 border-t border-border space-y-3"
            data-testid="side-rail-edit-form"
          >
            <div>
              <Label className="text-xs">Performance Score (0–10)</Label>
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={props.editScore}
                onChange={(e) => props.onChangeEditScore(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Summary</Label>
              <textarea
                value={props.editSummary}
                onChange={(e) => props.onChangeEditSummary(e.target.value)}
                className="w-full min-h-[80px] rounded-sm border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-destructive">Reason for edit *</Label>
              <Input
                value={props.editReason}
                onChange={(e) => props.onChangeEditReason(e.target.value)}
                placeholder="Why is this edit needed?"
                className="h-8 text-sm"
              />
            </div>
            {props.editError && (
              <p className="text-xs text-destructive">{props.editError}</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={props.onSave}
                disabled={!props.editReason.trim() || props.editPending}
                className="h-7 text-xs"
              >
                <FloppyDisk className="w-3 h-3 mr-1" />
                {props.editPending ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={props.onCancelEditing}
                className="h-7 text-xs"
              >
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          rubric && (
            <div className="mt-5 pt-4 border-t border-border">
              <SectionLabel>Rubric</SectionLabel>
              <div className="mt-3 flex justify-center">
                <RubricRack rubric={rubric} compact />
              </div>
            </div>
          )
        )}

        {!props.isEditing && call.analysis?.detectedAgentName && (
          <div
            className="mt-4 pt-3 border-t border-border text-muted-foreground"
            style={{ fontSize: 11 }}
          >
            <strong className="text-foreground">Detected agent:</strong>{" "}
            {toDisplayString(call.analysis.detectedAgentName)}
          </div>
        )}
      </Panel>

      {/* Panel 2 — AI summary */}
      {call.analysis?.summary && !props.isEditing && (
        <Panel>
          <SectionLabel>
            Call summary <AIChip />
          </SectionLabel>
          <div
            className="text-foreground mt-2.5"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {toDisplayString(call.analysis.summary)}
          </div>
        </Panel>
      )}

      {/* Panel 3 — Coaching highlights (agent) / QA flags (manager) */}
      <CoachingPanel {...props} roleView={roleView} />

      {/* Panel 4 — Commitments & follow-ups */}
      {call.analysis?.actionItems &&
        Array.isArray(call.analysis.actionItems) &&
        call.analysis.actionItems.length > 0 && (
          <Panel>
            <SectionLabel>Commitments &amp; follow-ups</SectionLabel>
            <div className="mt-2">
              {(call.analysis.actionItems as unknown[]).map((item, i) => (
                <div
                  key={i}
                  className="flex gap-2.5 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                >
                  <span
                    className="flex-shrink-0 border border-border"
                    style={{
                      width: 14,
                      height: 14,
                      marginTop: 3,
                      background: "var(--card)",
                    }}
                    aria-hidden="true"
                  />
                  <div
                    className="flex-1 text-foreground"
                    style={{ fontSize: 12.5, lineHeight: 1.5 }}
                  >
                    {toDisplayString(item)}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

      {/* Panel 5 — Topics detected */}
      {call.analysis?.topics &&
        Array.isArray(call.analysis.topics) &&
        call.analysis.topics.length > 0 && (
          <Panel>
            <SectionLabel>Topics detected</SectionLabel>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {(call.analysis.topics as unknown[]).map((t, i) => (
                <span
                  key={i}
                  className="font-mono bg-secondary border border-border text-foreground"
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    letterSpacing: "0.05em",
                  }}
                >
                  {toDisplayString(t)}
                </span>
              ))}
            </div>
          </Panel>
        )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Coaching panel — combines feedback.strengths + feedback.suggestions
// with jump-to-timestamp buttons when the AI emitted one.
// ─────────────────────────────────────────────────────────────
function CoachingPanel({
  call,
  onSeek,
  parseTimestampString,
  roleView,
}: SideRailProps & { roleView: "agent" | "manager" }) {
  const feedback = call.analysis?.feedback;
  if (
    !feedback ||
    typeof feedback !== "object" ||
    Array.isArray(feedback)
  ) {
    return null;
  }
  const f = feedback as { strengths?: unknown[]; suggestions?: unknown[] };
  const strengths = Array.isArray(f.strengths) ? f.strengths : [];
  const suggestions = Array.isArray(f.suggestions) ? f.suggestions : [];
  if (strengths.length === 0 && suggestions.length === 0) return null;

  return (
    <Panel>
      <SectionLabel>
        {roleView === "manager" ? "QA flags" : "Coaching highlights"}
      </SectionLabel>
      <div className="mt-3 flex flex-col gap-2">
        {strengths.map((item, i) => (
          <Highlight
            key={`s-${i}`}
            kind="good"
            item={item}
            onSeek={onSeek}
            parseTimestampString={parseTimestampString}
          />
        ))}
        {suggestions.map((item, i) => (
          <Highlight
            key={`o-${i}`}
            kind="missed"
            item={item}
            onSeek={onSeek}
            parseTimestampString={parseTimestampString}
          />
        ))}
      </div>
    </Panel>
  );
}

function Highlight({
  kind,
  item,
  onSeek,
  parseTimestampString,
}: {
  kind: "good" | "missed";
  item: unknown;
  onSeek: (ms: number) => void;
  parseTimestampString: (ts: unknown) => number | null;
}) {
  const text = toDisplayString(item);
  const ts =
    typeof item === "object" && item !== null
      ? ((item as Record<string, unknown>).timestamp as string | null | undefined)
      : null;
  const parsedMs = ts ? parseTimestampString(ts) : null;
  const color = kind === "good" ? "var(--sage)" : "var(--warm-red)";
  const kindLabel = kind === "good" ? "Strength" : "Opportunity";
  const isInteractive = parsedMs != null;

  const content = (
    <div
      className="flex gap-2.5 px-3 py-2.5 text-left"
      style={{
        background: "var(--secondary)",
        border: "1px solid var(--border)",
        borderLeftWidth: 3,
        borderLeftColor: color,
      }}
    >
      <div style={{ color, marginTop: 1, flexShrink: 0 }}>
        <CoachIcon kind={kind} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              color,
              fontWeight: 600,
            }}
          >
            {kindLabel}
          </span>
          {parsedMs != null && (
            <span
              className="font-mono tabular-nums text-muted-foreground inline-flex items-center gap-1"
              style={{ fontSize: 10 }}
            >
              <Clock style={{ width: 10, height: 10 }} />
              {ts}
            </span>
          )}
        </div>
        <div
          className="text-foreground mt-1"
          style={{ fontSize: 12, lineHeight: 1.5 }}
        >
          {text}
        </div>
      </div>
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={() => onSeek(parsedMs!)}
        className="cursor-pointer hover:opacity-90 transition-opacity"
        data-testid={`coaching-highlight-${kind}`}
      >
        {content}
      </button>
    );
  }
  return <div data-testid={`coaching-highlight-${kind}`}>{content}</div>;
}

function CoachIcon({ kind }: { kind: "good" | "missed" }) {
  if (kind === "good") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M3.5 7 L6 9.5 L10.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line
        x1="7"
        y1="4"
        x2="7"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10" r="0.8" fill="currentColor" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Presentational primitives
// ─────────────────────────────────────────────────────────────
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-card border border-border"
      style={{ padding: "16px 18px" }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground flex items-center gap-2"
      style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 500 }}
    >
      {children}
    </div>
  );
}

function AIChip() {
  return (
    <span
      className="font-mono rounded-sm"
      style={{
        fontSize: 9,
        padding: "1px 5px",
        background: "var(--accent-soft)",
        color: "var(--accent)",
        letterSpacing: "0.1em",
      }}
    >
      AI
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function extractRubric(call: CallWithDetails): RubricValues | null {
  const sub = call.analysis?.subScores;
  if (!sub) return null;
  if (
    typeof sub.compliance === "number" &&
    typeof sub.customerExperience === "number" &&
    typeof sub.communication === "number" &&
    typeof sub.resolution === "number"
  ) {
    return {
      compliance: sub.compliance,
      customerExperience: sub.customerExperience,
      communication: sub.communication,
      resolution: sub.resolution,
    };
  }
  return null;
}

function composeVerdict(score: number | null): string {
  if (score == null) return "Awaiting analysis";
  if (score >= 9) return "Exemplar";
  if (score >= 7.5) return "Strong call";
  if (score >= 6) return "Solid";
  if (score >= 4) return "Mixed";
  return "Needs review";
}

function composeVerdictSubtitle(call: CallWithDetails): string | null {
  const f = call.analysis?.feedback;
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const ff = f as { strengths?: unknown[]; suggestions?: unknown[] };
  const sc = Array.isArray(ff.strengths) ? ff.strengths.length : 0;
  const oc = Array.isArray(ff.suggestions) ? ff.suggestions.length : 0;
  if (sc === 0 && oc === 0) return null;
  const parts: string[] = [];
  if (sc > 0) parts.push(`${sc} strength${sc === 1 ? "" : "s"}`);
  if (oc > 0) parts.push(`${oc} to try`);
  return parts.join(" · ");
}

function safeNum(s: string, fallback: number): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
