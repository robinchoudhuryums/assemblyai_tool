/**
 * Coaching — Manager Board variant (installment 5, phase 4).
 *
 * Variant B from docs/design-bundle/project/coaching-manager-board.jsx.
 * 5-column Kanban across the lifecycle stages + filter row + "+ Assign
 * new" CTA.
 *
 * Deferred to backend follow-ons (see docs/coaching-backend-followons.md
 * in phase 6):
 *  - Team skills heatmap strip (needs per-agent per-category avg
 *    sub-score endpoint)
 *  - Bulk action bar (Bulk assign / Mark signed off / Reassign —
 *    needs bulk PATCH endpoints)
 *
 * Click-to-expand inline pattern matches AgentInbox: opens notes +
 * action items + status-change buttons so the board is usable end-to-
 * end. Phase 5 replaces inline expand with the slide-in Detail panel.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { CoachingSession, Employee } from "@shared/schema";
import { COACHING_CATEGORIES } from "@shared/schema";
import { Avatar } from "@/components/dashboard/primitives";
import {
  CompetencyChip,
  DuePill,
  SourceBadge,
  STAGES,
  categoryMeta,
  deriveSource,
  deriveStage,
  dueDaysFromIso,
  type Stage,
} from "./primitives";

export interface ManagerBoardProps {
  sessions: CoachingSession[];
  employees: Employee[];
  /** Fires when the "+ Assign new" button is clicked. */
  onAssignNew?: () => void;
  /** Fires when a BoardCard is clicked — opens the slide-in Detail panel. */
  onOpenDetail?: (sessionId: string) => void;
}

export default function ManagerBoard({
  sessions,
  employees,
  onAssignNew,
  onOpenDetail,
}: ManagerBoardProps) {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const employeeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.name);
    return map;
  }, [employees]);

  // Apply filters, then bucket by derived stage.
  const { filtered, byStage } = useMemo(() => {
    const f = sessions.filter((s) => {
      if (agentFilter !== "all" && s.employeeId !== agentFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      return true;
    });
    const buckets: Record<Stage, Array<{ session: CoachingSession; stage: Stage }>> = {
      open: [],
      plan: [],
      practice: [],
      evidence: [],
      "signed-off": [],
    };
    for (const session of f) {
      const stage = deriveStage(session);
      if (stage === null) continue; // dismissed
      buckets[stage].push({ session, stage });
    }
    return { filtered: f, byStage: buckets };
  }, [sessions, agentFilter, categoryFilter]);

  const inFlight = filtered.filter((s) => s.status !== "dismissed").length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-10 mx-auto" style={{ maxWidth: 1800 }} data-testid="manager-board">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-6">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground mb-2"
            style={{ fontSize: 10, letterSpacing: "0.12em" }}
          >
            Your team · {employees.length} agent{employees.length === 1 ? "" : "s"}
          </div>
          <h1
            className="font-display font-medium text-foreground"
            style={{ fontSize: "clamp(24px, 3vw, 32px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
          >
            {inFlight} coaching {inFlight === 1 ? "item" : "items"} in flight
          </h1>
        </div>
        <div className="flex flex-wrap gap-2.5 items-center">
          <FilterSelect
            value={agentFilter}
            onChange={setAgentFilter}
            placeholder="All agents"
            options={[
              { value: "all", label: "All agents" },
              ...employees.map((e) => ({ value: e.id, label: e.name })),
            ]}
            data-testid="agent-filter"
          />
          <FilterSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            placeholder="All competencies"
            options={[
              { value: "all", label: "All competencies" },
              ...COACHING_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
            ]}
            data-testid="competency-filter"
          />
          {onAssignNew && (
            <button
              type="button"
              onClick={onAssignNew}
              className="font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-[var(--paper)] bg-primary border border-primary hover:opacity-90 transition-opacity"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
              data-testid="assign-new"
            >
              + Assign new
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}
      >
        {STAGES.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            items={byStage[stage.id]}
            employeeName={employeeName}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stage column
// ─────────────────────────────────────────────────────────────
function StageColumn({
  stage,
  items,
  employeeName,
  onOpenDetail,
}: {
  stage: (typeof STAGES)[number];
  items: Array<{ session: CoachingSession; stage: Stage }>;
  employeeName: Map<string, string>;
  onOpenDetail?: ManagerBoardProps["onOpenDetail"];
}) {
  return (
    <div
      className="bg-secondary border border-border"
      style={{ padding: 12, minHeight: 400, borderRadius: 2 }}
      data-testid={`stage-column-${stage.id}`}
    >
      <div className="flex items-baseline justify-between mb-3" style={{ padding: "0 4px" }}>
        <div>
          <div
            className="font-display font-semibold text-foreground uppercase"
            style={{ fontSize: 12, letterSpacing: "0.14em" }}
          >
            {stage.label}
          </div>
          <div
            className="text-muted-foreground italic mt-0.5"
            style={{ fontSize: 11 }}
          >
            {stage.desc}
          </div>
        </div>
        <div
          className="font-mono tabular-nums text-muted-foreground"
          style={{ fontSize: 12 }}
        >
          {items.length}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div
            className="text-muted-foreground italic text-center"
            style={{ fontSize: 11, padding: "12px 4px" }}
          >
            —
          </div>
        ) : (
          items.map((it) => (
            <BoardCard
              key={it.session.id}
              session={it.session}
              stage={it.stage}
              agentName={employeeName.get(it.session.employeeId) ?? "—"}
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Board card — click opens the slide-in Detail panel.
// ─────────────────────────────────────────────────────────────
function BoardCard({
  session,
  stage,
  agentName,
  onOpenDetail,
}: {
  session: CoachingSession;
  stage: Stage;
  agentName: string;
  onOpenDetail?: ManagerBoardProps["onOpenDetail"];
}) {
  const comp = categoryMeta(session.category);
  const source = deriveSource(session.assignedBy);
  const days = dueDaysFromIso(session.dueDate);
  const actionPlan = Array.isArray(session.actionPlan) ? session.actionPlan : [];
  const completedCount = actionPlan.filter((a) => a.completed).length;
  const initials =
    agentName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "·";

  return (
    <button
      type="button"
      onClick={() => onOpenDetail && onOpenDetail(session.id)}
      disabled={!onOpenDetail}
      className="bg-card border border-border text-left hover:bg-secondary/40 transition-colors disabled:cursor-default disabled:hover:bg-card"
      style={{
        borderLeft: `3px solid oklch(55% 0.14 ${comp.hue})`,
        padding: "10px 12px",
      }}
      data-testid={`board-card-${session.id}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Avatar initials={initials} size={20} />
        <span
          className="font-mono text-foreground truncate"
          style={{ fontSize: 10, letterSpacing: "0.02em" }}
        >
          {agentName}
        </span>
        <div className="flex-1" />
        <DuePill days={days} />
      </div>
      <div
        className="font-display font-medium text-foreground mb-2"
        style={{ fontSize: 13, lineHeight: 1.3 }}
      >
        {session.title}
      </div>
      <div className="flex items-center gap-2">
        <CompetencyChip category={session.category} compact />
        <div className="flex-1" />
        <SourceBadge source={source} compact />
      </div>
      {actionPlan.length > 0 && stage !== "open" && (
        <div className="mt-2.5 flex items-center gap-2">
          <div
            className="flex-1 overflow-hidden bg-secondary"
            style={{ height: 3, borderRadius: 2 }}
          >
            <div
              style={{
                width: `${(completedCount / actionPlan.length) * 100}%`,
                height: "100%",
                background: "var(--accent)",
              }}
            />
          </div>
          <div
            className="font-mono tabular-nums text-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {completedCount}/{actionPlan.length}
          </div>
        </div>
      )}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  "data-testid"?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={dataTestId}
      className="bg-card border border-border text-foreground font-mono"
      style={{
        padding: "6px 10px",
        fontSize: 11,
        borderRadius: 2,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
