/**
 * Coaching primitives (warm-paper installment 5, phase 2).
 *
 * Visual + derivation helpers shared across Agent Inbox / Manager Board /
 * Detail panel / Assign modal. Mirrors the design handoff at
 * docs/design-bundle/project/coaching-primitives.jsx but adapted to our
 * data shape:
 *
 *  - Design has a 5-stage lifecycle (open / plan / practice / evidence /
 *    signed-off). We have 4 statuses (pending / in_progress / completed /
 *    dismissed). `deriveStage()` maps status + actionPlan completion to a
 *    stage so the visual progression works without a schema change.
 *
 *  - Design has 6 competencies (empathy / compliance / discovery /
 *    product / close / pace). We have 7 categories (compliance /
 *    customer_experience / communication / resolution / general /
 *    performance / recognition). `categoryMeta()` maps each category to
 *    a competency-shaped record (icon + hue + label) so the
 *    CompetencyChip can render uniformly.
 *
 *  - Design has a `source` field (ai / theme / cadence / self / manager)
 *    that we don't store. `deriveSource()` heuristically reads
 *    `assignedBy` ("System (AI Coaching Plan)" → "ai"; otherwise
 *    "manager"); future schema work can replace the heuristic.
 *
 *  - Design has `growthCopy` (warm italic framing) that we don't store.
 *    `growthCopyForCategory()` returns a canned per-category sentence so
 *    the Detail panel hero feels intentional rather than empty. Beats a
 *    placeholder that screams "TODO".
 */
import type { ReactNode } from "react";
import type { CoachingSession } from "@shared/schema";

// ─────────────────────────────────────────────────────────────
// Derived types — keep design vocabulary local to this module
// ─────────────────────────────────────────────────────────────

export type Stage = "open" | "plan" | "practice" | "evidence" | "signed-off";

export const STAGES: Array<{ id: Stage; label: string; desc: string }> = [
  { id: "open", label: "Open", desc: "Take a look when you're ready" },
  { id: "plan", label: "Plan", desc: "You've picked your approach" },
  { id: "practice", label: "Practice", desc: "Working through it on calls" },
  { id: "evidence", label: "Evidence", desc: "A live call showing change" },
  { id: "signed-off", label: "Signed off", desc: "Closed loop — nice work" },
];

const STAGE_INDEX: Record<Stage, number> = {
  open: 0,
  plan: 1,
  practice: 2,
  evidence: 3,
  "signed-off": 4,
};

export type SourceKind = "ai" | "manager" | "theme" | "cadence" | "self";

const SOURCE_META: Record<SourceKind, { glyph: string; label: string }> = {
  ai:       { glyph: "◈", label: "AI-detected" },
  manager:  { glyph: "◆", label: "Manager-assigned" },
  theme:    { glyph: "❋", label: "Team theme" },
  cadence:  { glyph: "◔", label: "Scheduled" },
  self:     { glyph: "✿", label: "Self-flagged" },
};

/**
 * Per-category visual metadata for `CompetencyChip` and the design's
 * "competency" concept. Hue values are the OKLCH hue for the icon color
 * so different categories read distinctly in dense lists.
 */
export interface CategoryMeta {
  /** Display label, sentence-case */
  label: string;
  /** Single mono glyph used as the chip icon */
  glyph: string;
  /** OKLCH hue (0–360) for the icon color */
  hue: number;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  compliance:           { label: "Compliance",         glyph: "◇", hue: 30 },
  customer_experience:  { label: "Empathy",            glyph: "◐", hue: 340 },
  communication:        { label: "Communication",      glyph: "◎", hue: 210 },
  resolution:           { label: "Resolution",         glyph: "◈", hue: 55 },
  performance:          { label: "Performance",        glyph: "◑", hue: 270 },
  recognition:          { label: "Recognition",        glyph: "◉", hue: 155 },
  general:              { label: "General",            glyph: "○", hue: 60 },
};

const FALLBACK_CATEGORY_META: CategoryMeta = {
  label: "General",
  glyph: "○",
  hue: 60,
};

/**
 * Canned warm-framing per category. Used when the session has no stored
 * `growthCopy`. Tone: growth-oriented, never punitive. Empty string for
 * "general" so the Detail panel hero hides the line entirely rather
 * than showing a generic platitude.
 */
const GROWTH_COPY: Record<string, string> = {
  compliance: "Small habit, big protection.",
  customer_experience: "Patients feel heard when you name the hard part first.",
  communication: "Clarity is its own kind of empathy.",
  resolution: "Close with clarity — patients leave feeling taken care of.",
  performance: "One change at a time. You'll get there.",
  recognition: "Excellent work — let's name what made it land.",
  general: "",
};

// ─────────────────────────────────────────────────────────────
// Derivation helpers — pure, exported for testability
// ─────────────────────────────────────────────────────────────

/**
 * Map session.status + actionPlan completion to the design's 5-stage
 * lifecycle. The "plan" vs "practice" split is heuristic on completion
 * ratio because we don't have an explicit lifecycle field; cleanly
 * replaceable when one lands.
 *
 * Returns null for `dismissed` so callers can filter it out of active
 * views. The Manager Board may still want to render dismissed items in
 * a separate column later — when we do, return "open" instead and gate
 * by status separately.
 */
export function deriveStage(session: Pick<CoachingSession, "status" | "actionPlan">): Stage | null {
  if (session.status === "dismissed") return null;
  if (session.status === "pending") return "open";
  if (session.status === "completed") return "signed-off";
  // status === "in_progress" — split by action-item progress
  const items = Array.isArray(session.actionPlan) ? session.actionPlan : [];
  if (items.length === 0) return "plan";
  const completed = items.filter((i) => i?.completed).length;
  if (completed === 0) return "plan";
  if (completed >= items.length) return "evidence";
  return "practice";
}

/**
 * Heuristic source detection from `assignedBy`. Coaching alerts service
 * sets this to "System (AI Coaching Plan)" for auto-generated sessions;
 * everything else is treated as a manager assignment.
 */
export function deriveSource(assignedBy: string | undefined | null): SourceKind {
  if (!assignedBy) return "manager";
  const trimmed = assignedBy.trim();
  if (trimmed.toLowerCase().startsWith("system")) return "ai";
  return "manager";
}

export function categoryMeta(category: string | undefined | null): CategoryMeta {
  if (!category) return FALLBACK_CATEGORY_META;
  return CATEGORY_META[category] ?? FALLBACK_CATEGORY_META;
}

export function growthCopyForCategory(category: string | undefined | null): string {
  if (!category) return "";
  return GROWTH_COPY[category] ?? "";
}

/**
 * Days between today and `dueDate`. Returns:
 *  - positive int: days remaining
 *  - 0: due today
 *  - negative int: days overdue
 *  - null: no due date set
 */
export function dueDaysFromIso(dueDate: string | undefined | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

// ─────────────────────────────────────────────────────────────
// Visual primitives
// ─────────────────────────────────────────────────────────────

/**
 * GrowthRing — circular progress around the 5-stage lifecycle.
 * 5 dots at 72° intervals on the perimeter, filled arc to the current
 * stage. Center shows "N/5" tabular-nums. Sage when signed-off, copper
 * otherwise.
 */
export function GrowthRing({ stage, size = 60, strokeW = 4 }: { stage: Stage; size?: number; strokeW?: number }) {
  const idx = STAGE_INDEX[stage];
  const r = size / 2 - strokeW - 2;
  const c = 2 * Math.PI * r;
  const pct = (idx + 1) / STAGES.length;
  const off = c * (1 - pct);
  const signedOff = stage === "signed-off";
  const arcColor = signedOff ? "var(--sage)" : "var(--accent)";
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeW} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeW}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s" }}
        />
        {STAGES.map((s, i) => {
          const angle = (i / STAGES.length) * 2 * Math.PI - Math.PI / 2;
          const dx = size / 2 + r * Math.cos(angle);
          const dy = size / 2 + r * Math.sin(angle);
          const active = i <= idx;
          return (
            <circle
              key={s.id}
              cx={dx}
              cy={dy}
              r={2.5}
              fill={active ? arcColor : "var(--background)"}
              stroke="var(--border)"
              strokeWidth="0.8"
            />
          );
        })}
      </svg>
      <div
        className="font-mono tabular-nums font-semibold"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.22,
          color: signedOff ? "var(--sage)" : "var(--foreground)",
        }}
        aria-label={`Stage ${idx + 1} of ${STAGES.length}`}
      >
        {idx + 1}/{STAGES.length}
      </div>
    </div>
  );
}

/**
 * StageChip — small mono pill encoding the stage. Open: muted; plan /
 * practice / evidence: copper; signed-off: sage with check glyph.
 */
export function StageChip({ stage, size = "md" }: { stage: Stage; size?: "sm" | "md" }) {
  const meta = (() => {
    if (stage === "open") return { bg: "var(--secondary)", fg: "var(--muted-foreground)", label: "open" };
    if (stage === "signed-off") return { bg: "var(--sage-soft)", fg: "var(--sage)", label: "✓ signed off" };
    return { bg: "var(--accent-soft)", fg: "var(--accent)", label: stage };
  })();
  const sizing = size === "sm"
    ? { padding: "2px 7px", fontSize: 9 }
    : { padding: "3px 9px", fontSize: 10 };
  return (
    <span
      className="font-mono uppercase"
      style={{
        background: meta.bg,
        color: meta.fg,
        letterSpacing: "0.1em",
        fontWeight: 500,
        borderRadius: 2,
        ...sizing,
      }}
      data-testid={`stage-chip-${stage}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * SourceBadge — provenance pill (AI-detected / Manager-assigned / etc.).
 */
export function SourceBadge({
  source,
  assignedByName,
  compact,
}: {
  source: SourceKind;
  assignedByName?: string | null;
  compact?: boolean;
}) {
  const meta = SOURCE_META[source];
  return (
    <span
      className="font-mono uppercase text-muted-foreground inline-flex items-center gap-1.5"
      style={{ fontSize: compact ? 9 : 10, letterSpacing: "0.06em" }}
    >
      <span style={{ color: "var(--accent)", fontSize: compact ? 10 : 12 }}>{meta.glyph}</span>
      <span>
        {meta.label}
        {!compact && assignedByName ? ` · ${assignedByName}` : ""}
      </span>
    </span>
  );
}

/**
 * CompetencyChip — bordered pill with category-specific glyph + label.
 * Glyph color uses the category's OKLCH hue at L=55 / C=0.14 for visual
 * distinction across categories without relying on a hardcoded palette
 * table.
 */
export function CompetencyChip({ category, compact }: { category: string; compact?: boolean }) {
  const meta = categoryMeta(category);
  return (
    <span
      className="font-mono uppercase inline-flex items-center gap-1.5 bg-card border border-border text-foreground"
      style={{
        padding: compact ? "2px 7px" : "3px 9px",
        fontSize: compact ? 9 : 10,
        letterSpacing: "0.04em",
        borderRadius: 2,
      }}
    >
      <span style={{ color: `oklch(55% 0.14 ${meta.hue})`, fontSize: 12 }}>{meta.glyph}</span>
      {meta.label}
    </span>
  );
}

/**
 * DuePill — mono date label. Warm-red when overdue, copper when due
 * today / within 2 days, muted otherwise. Returns null when no date.
 */
export function DuePill({ days }: { days: number | null }) {
  if (days === null) return null;
  const overdue = days < 0;
  const urgent = days >= 0 && days <= 2;
  const color = overdue ? "var(--destructive)" : urgent ? "var(--accent)" : "var(--muted-foreground)";
  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
    ? "due today"
    : `due in ${days}d`;
  return (
    <span
      className="font-mono"
      style={{ fontSize: 10, color, letterSpacing: "0.04em" }}
    >
      {label}
    </span>
  );
}

/**
 * StageTrack — horizontal 5-step progress with connecting line + labels.
 * Used in the Detail panel hero strip.
 */
export function StageTrack({ stage, width = 240 }: { stage: Stage; width?: number }) {
  const idx = STAGE_INDEX[stage];
  const signedOff = stage === "signed-off";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width }}>
      {STAGES.map((s, i) => {
        const done = i <= idx;
        const color = signedOff && done ? "var(--sage)" : done ? "var(--accent)" : "var(--border)";
        return (
          <span key={s.id} style={{ display: "contents" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                flex: "0 0 auto",
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: done ? color : "var(--card)",
                  border: `1.5px solid ${color}`,
                }}
                aria-hidden="true"
              />
              <div
                className="font-mono uppercase"
                style={{
                  fontSize: 9,
                  color: done ? "var(--foreground)" : "var(--muted-foreground)",
                  letterSpacing: "0.04em",
                }}
              >
                {s.id === "signed-off" ? "sign off" : s.id}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1.5,
                  background: i < idx ? color : "var(--border)",
                  marginTop: -16,
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * StreakPips — vertical bars representing a consecutive count. Mirrors
 * the "calls in a row" visual from the Agent Inbox right rail.
 */
export function StreakPips({ count }: { count: number }) {
  const visible = Math.min(count, 10);
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 10 + (i % 3) * 3,
            background: "var(--accent)",
            borderRadius: 1,
            opacity: 0.4 + (i / 10) * 0.6,
          }}
        />
      ))}
      {count > 10 && (
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--accent)", marginLeft: 4 }}
        >
          +{count - 10}
        </span>
      )}
    </div>
  );
}

/**
 * SectionLabel — used by Detail panel sub-sections and by the variants
 * for kicker rows. Same shape as the Transcript Viewer side-rail label.
 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground flex items-center gap-2"
      style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 500 }}
    >
      {children}
    </div>
  );
}
