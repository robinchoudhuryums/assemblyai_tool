/**
 * Calls preview rail (warm-paper installment 6, phase 3).
 *
 * 380px right-docked panel that shows details for the call selected in
 * CallsTable. Matches docs/design-bundle/project/Calls.html PreviewRail:
 *   - id + uploaded-at kicker + collapse button
 *   - subject (display font)
 *   - agent avatar + name + team
 *   - 4-stat grid (Score / Duration / Sentiment / Type)
 *   - flag pills
 *   - AI summary
 *   - Open transcript + optional "+ coach" CTAs
 *
 * When no call is selected, shows a minimal empty state. Rail is
 * controlled by the parent — it passes the selected call in via props
 * and owns the open/closed state.
 */
import { Link } from "wouter";
import type { CallWithDetails } from "@shared/schema";
import { Avatar } from "@/components/dashboard/primitives";
import { SCORE_EXCELLENT, SCORE_GOOD, SCORE_NEEDS_WORK } from "@/lib/constants";
import { toDisplayString } from "@/lib/display-utils";

export interface CallsPreviewRailProps {
  call: CallWithDetails | null;
  canCoach?: boolean;
  onClose: () => void;
}

export default function CallsPreviewRail({
  call,
  canCoach,
  onClose,
}: CallsPreviewRailProps) {
  return (
    <aside
      className="flex-shrink-0 border-l border-border bg-background overflow-y-auto"
      style={{ width: 380, padding: "18px 20px" }}
      data-testid="calls-preview-rail"
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className="font-mono uppercase text-muted-foreground flex-1 truncate"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {call
            ? `${shortCallId(call.id)}${call.uploadedAt ? ` · ${formatUploadedAt(call.uploadedAt)}` : ""}`
            : "No call selected"}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse preview"
          className="font-mono text-muted-foreground hover:text-foreground border border-border rounded-sm px-2 py-0.5 transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
          data-testid="preview-rail-close"
        >
          ››
        </button>
      </div>

      {call ? (
        <PreviewBody call={call} canCoach={canCoach ?? false} />
      ) : (
        <div
          className="text-muted-foreground italic mt-6"
          style={{ fontSize: 13, lineHeight: 1.5 }}
        >
          Pick a row to preview its details here.
        </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Body when a call is selected
// ─────────────────────────────────────────────────────────────
function PreviewBody({ call, canCoach }: { call: CallWithDetails; canCoach: boolean }) {
  const subject = composeSubject(call);
  const agentName = call.employee?.name ?? "Unassigned";
  const agentInitials = call.employee?.initials ?? initialsFromName(agentName);
  const agentTeam = call.employee?.role ?? "";
  const scoreNum = call.analysis?.performanceScore
    ? Number(call.analysis.performanceScore)
    : null;
  const sentiment = call.sentiment?.overallSentiment;
  const duration = call.duration;
  const durationStr = duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}` : "—";
  const callKind = call.callCategory ?? "—";
  const flags = Array.isArray(call.analysis?.flags)
    ? (call.analysis.flags as unknown[]).map((f) => toDisplayString(f))
    : [];
  const summary =
    typeof call.analysis?.summary === "string" ? call.analysis.summary : "";

  return (
    <>
      <div
        className="font-display font-medium text-foreground mt-1"
        style={{ fontSize: 20, letterSpacing: "-0.3px", lineHeight: 1.25 }}
      >
        {subject}
      </div>

      <div className="flex items-center gap-2.5 mt-3.5">
        <Avatar initials={agentInitials} size={30} />
        <div className="min-w-0">
          <div className="text-foreground truncate" style={{ fontSize: 13 }}>
            {agentName}
          </div>
          {agentTeam && (
            <div
              className="font-mono text-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {agentTeam}
            </div>
          )}
        </div>
      </div>

      <div
        className="grid gap-3 mt-4 pt-4 border-t border-border"
        style={{ gridTemplateColumns: "1fr 1fr" }}
      >
        <Stat
          label="Score"
          value={scoreNum !== null ? scoreNum.toFixed(1) : "—"}
          color={scoreColor(scoreNum)}
        />
        <Stat label="Duration" value={durationStr} />
        <Stat
          label="Sentiment"
          value={sentiment ?? "—"}
          color={sentimentColor(sentiment)}
        />
        <Stat label="Type" value={callKind} />
      </div>

      {flags.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Flags</SectionLabel>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {flags.map((f) => (
              <FlagPill key={f} flag={f} />
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-4 pt-4 border-t border-border">
          <SectionLabel>AI summary</SectionLabel>
          <p
            className="text-foreground mt-2"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {summary.length > 400 ? `${summary.slice(0, 400)}…` : summary}
          </p>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <Link
          href={`/transcripts/${call.id}`}
          className="flex-1 font-mono uppercase inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-[var(--paper)] bg-primary border border-primary hover:opacity-90 transition-opacity"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          data-testid="preview-open-transcript"
        >
          Open transcript →
        </Link>
        {canCoach && call.employee && (
          <Link
            href={`/coaching?newSession=true&employeeId=${call.employee.id}&callId=${call.id}&category=general`}
            className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-3 py-2 text-foreground hover:bg-secondary transition-colors"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="preview-coach"
          >
            + Coach
          </Link>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Re-expand tab (shown when rail is collapsed)
// ─────────────────────────────────────────────────────────────
export function PreviewRailTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Show preview"
      aria-label="Show preview rail"
      className="fixed bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors font-mono uppercase cursor-pointer"
      style={{
        right: 0,
        top: "50%",
        padding: "18px 6px",
        borderRight: "none",
        borderTopLeftRadius: 3,
        borderBottomLeftRadius: 3,
        fontSize: 10,
        letterSpacing: "0.12em",
        writingMode: "vertical-rl",
        transform: "translateY(-50%) rotate(180deg)",
        zIndex: 10,
      }}
      data-testid="preview-rail-open"
    >
      ‹ preview
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 9, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-0.5"
        style={{ fontSize: 20, letterSpacing: "-0.3px", color: color ?? "var(--foreground)" }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {children}
    </div>
  );
}

function FlagPill({ flag }: { flag: string }) {
  const meta = flagMeta(flag);
  return (
    <span
      className="font-mono uppercase"
      style={{
        fontSize: 9,
        padding: "3px 8px",
        color: meta.color,
        border: `1px solid ${meta.color}`,
        borderRadius: 2,
        letterSpacing: "0.06em",
        opacity: 0.9,
      }}
      title={flag}
    >
      {meta.label}
    </span>
  );
}

function flagMeta(flag: string): { label: string; color: string } {
  if (flag === "exceptional_call") return { label: "Exceptional", color: "var(--sage)" };
  if (flag === "medicare_call") return { label: "Medicare", color: "var(--accent)" };
  if (flag === "low_score") return { label: "Low score", color: "var(--destructive)" };
  if (flag === "low_confidence") return { label: "Low confidence", color: "var(--accent)" };
  if (flag.startsWith("agent_misconduct")) {
    return { label: flag.replace("agent_misconduct:", "Misconduct: "), color: "var(--destructive)" };
  }
  return { label: flag.replace(/_/g, " "), color: "var(--muted-foreground)" };
}

function scoreColor(score: number | null): string | undefined {
  if (score === null) return undefined;
  if (score >= SCORE_EXCELLENT) return "var(--sage)";
  if (score >= SCORE_GOOD) return "var(--foreground)";
  if (score >= SCORE_NEEDS_WORK) return "var(--accent)";
  return "var(--destructive)";
}

function sentimentColor(sentiment: string | undefined): string | undefined {
  if (sentiment === "positive") return "var(--sage)";
  if (sentiment === "negative") return "var(--destructive)";
  return undefined;
}

function composeSubject(call: CallWithDetails): string {
  const summary =
    typeof call.analysis?.summary === "string" ? call.analysis.summary : "";
  if (summary) {
    const first = summary.split(/[.!?]/)[0].trim();
    if (first.length > 0) {
      return first.length > 80 ? `${first.slice(0, 77)}…` : first;
    }
  }
  if (call.fileName) return call.fileName;
  return `Call ${shortCallId(call.id)}`;
}

function shortCallId(id: string): string {
  return id.length > 10 ? id.slice(0, 8).toUpperCase() : id.toUpperCase();
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatUploadedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
