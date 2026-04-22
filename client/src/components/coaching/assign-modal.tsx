/**
 * Coaching — Assign modal (installment 5, phase 5).
 *
 * Centered modal that replaces the shadcn Dialog-wrapped legacy
 * CoachingForm from phase 4. Matches
 * docs/design-bundle/project/coaching-detail.jsx AssignModal:
 *   - top kicker + close
 *   - optional "Attached from transcript" banner when prefillCallId set
 *   - agent select / competency chip row / title / warm framing /
 *     what-we-noticed / (no practice select — deferred)
 *   - footer: Cancel + "Send coaching"
 *
 * Prefill flow (from transcript-viewer "+ New coaching note"):
 *   /coaching?newSession=true&callId=UUID&employeeId=UUID&category=...
 * The parent page validates the UUIDs + whitelist-checks category,
 * then passes the sanitized values in via props.
 */
import { useState, useEffect } from "react";
import { X } from "@phosphor-icons/react";
import type { Employee } from "@shared/schema";
import { COACHING_CATEGORIES } from "@shared/schema";
import { categoryMeta, growthCopyForCategory } from "./primitives";

export interface AssignModalProps {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  /** Pre-selected employee (from transcript "+ New coaching note") */
  prefillEmployeeId?: string;
  /** Pre-attached call reference (from transcript viewer) */
  prefillCallId?: string;
  /** Pre-selected category (from transcript viewer) */
  prefillCategory?: string;
  /** Called on submit with the form payload; parent owns the mutation */
  onSubmit: (payload: AssignPayload) => void;
  submitPending?: boolean;
  submitError?: string | null;
}

export interface AssignPayload {
  employeeId: string;
  category: string;
  title: string;
  notes: string;
  callId?: string;
  actionPlan?: Array<{ task: string; completed: boolean }>;
}

export default function AssignModal(props: AssignModalProps) {
  const [employeeId, setEmployeeId] = useState(props.prefillEmployeeId || "");
  const [category, setCategory] = useState(props.prefillCategory || "general");
  const [title, setTitle] = useState("");
  const [warmFraming, setWarmFraming] = useState("");
  const [notes, setNotes] = useState("");
  const [attachCall, setAttachCall] = useState(!!props.prefillCallId);

  // Reset form state whenever the modal opens (prefill values picked up
  // at open time; closing drops the local state).
  useEffect(() => {
    if (props.open) {
      setEmployeeId(props.prefillEmployeeId || "");
      setCategory(props.prefillCategory || "general");
      setTitle("");
      // Seed warm-framing with the canned per-category copy so the
      // field starts full but is still editable. Matches the design
      // intent of "help them say it warmly, don't make them start
      // from scratch".
      setWarmFraming(growthCopyForCategory(props.prefillCategory || "general"));
      setNotes("");
      setAttachCall(!!props.prefillCallId);
    }
  }, [props.open, props.prefillEmployeeId, props.prefillCallId, props.prefillCategory]);

  // Escape closes the modal.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  // When the user picks a new category, swap the canned warm-framing —
  // but only if they haven't typed their own yet. Prevents clobbering
  // deliberate edits when they flip to check a different category.
  const handleCategoryChange = (next: string) => {
    const prevCanned = growthCopyForCategory(category);
    if (warmFraming === prevCanned) {
      setWarmFraming(growthCopyForCategory(next));
    }
    setCategory(next);
  };

  const canSubmit = !!employeeId && title.trim().length > 0 && !props.submitPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const combinedNotes = warmFraming.trim()
      ? `${warmFraming.trim()}\n\n${notes.trim()}`
      : notes.trim();
    props.onSubmit({
      employeeId,
      category,
      title: title.trim(),
      notes: combinedNotes,
      callId: attachCall ? props.prefillCallId : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in oklch, var(--ink), transparent 50%)" }}
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New coaching item"
      data-testid="coaching-assign-modal"
    >
      <div
        className="bg-card border border-border overflow-y-auto w-full"
        style={{ maxWidth: 680, maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top */}
        <div className="flex items-center gap-3 px-4 sm:px-7 py-5 border-b border-border">
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            New coaching item
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            <X style={{ width: 12, height: 12 }} /> esc
          </button>
        </div>

        {/* Attached transcript banner */}
        {attachCall && props.prefillCallId && (
          <div
            className="px-4 sm:px-7 py-4 border-b border-border flex items-center gap-3.5"
            style={{ background: "var(--accent-soft)" }}
          >
            <div style={{ fontSize: 20, color: "var(--accent)" }}>⎘</div>
            <div className="flex-1 min-w-0">
              <div
                className="font-mono uppercase mb-0.5"
                style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em" }}
              >
                Attached from transcript
              </div>
              <div
                className="font-mono text-foreground truncate"
                style={{ fontSize: 11 }}
              >
                {props.prefillCallId}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAttachCall(false)}
              className="font-mono uppercase inline-flex items-center border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Detach
            </button>
          </div>
        )}

        {/* Form */}
        <div className="px-4 sm:px-7 py-6 flex flex-col gap-5">
          <FieldRow label="Assign to">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="bg-card border border-border text-foreground font-mono flex-1"
              style={{ padding: "6px 10px", fontSize: 11, borderRadius: 2 }}
              data-testid="assign-employee"
            >
              <option value="">— Select agent —</option>
              {props.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.role ? ` · ${e.role}` : ""}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="Competency">
            <div className="flex flex-wrap gap-1.5 flex-1">
              {COACHING_CATEGORIES.map((c) => {
                const meta = categoryMeta(c.value);
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => handleCategoryChange(c.value)}
                    className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm transition-colors ${
                      active
                        ? "bg-foreground text-background border border-foreground"
                        : "bg-transparent text-foreground border border-border hover:bg-secondary"
                    }`}
                    style={{ padding: "6px 12px", fontSize: 10, letterSpacing: "0.08em" }}
                  >
                    <span style={{ color: active ? "inherit" : `oklch(55% 0.14 ${meta.hue})`, fontSize: 12 }}>
                      {meta.glyph}
                    </span>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </FieldRow>

          <FieldRow label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Acknowledge emotion before process"
              className="bg-card border border-border text-foreground flex-1 font-sans"
              style={{ padding: "7px 10px", fontSize: 14, borderRadius: 2 }}
              data-testid="assign-title"
            />
          </FieldRow>

          <FieldRow
            label="Warm framing"
            sub="How we'll introduce this — aim for growth, not criticism. Pre-filled by category; edit freely."
          >
            <textarea
              value={warmFraming}
              onChange={(e) => setWarmFraming(e.target.value)}
              rows={2}
              className="bg-card border border-border text-foreground italic flex-1 font-sans"
              style={{ padding: "8px 10px", fontSize: 13, borderRadius: 2, lineHeight: 1.5, resize: "vertical" }}
            />
          </FieldRow>

          <FieldRow label="What we noticed">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Concrete, call-anchored observation. The more specific the better."
              className="bg-card border border-border text-foreground flex-1 font-sans"
              style={{ padding: "8px 10px", fontSize: 13, borderRadius: 2, lineHeight: 1.55, resize: "vertical" }}
              data-testid="assign-notes"
            />
          </FieldRow>
        </div>

        {/* Footer */}
        <div
          className="px-4 sm:px-7 py-5 border-t border-border flex items-center gap-2.5 flex-wrap"
          style={{ background: "var(--secondary)" }}
        >
          {props.submitError ? (
            <div className="text-destructive" style={{ fontSize: 12 }}>
              {props.submitError}
            </div>
          ) : (
            <div
              className="font-mono text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.04em" }}
            >
              {employeeId
                ? `Agent will see this in their inbox.`
                : `Select an agent to continue.`}
            </div>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={props.onClose}
            className="font-mono uppercase inline-flex items-center border border-border rounded-sm px-3 py-2 text-foreground hover:bg-secondary transition-colors"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="font-mono uppercase inline-flex items-center rounded-sm px-4 py-2.5 text-[var(--paper)] bg-primary border border-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="assign-submit"
          >
            {props.submitPending ? "Sending…" : "Send coaching →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid gap-4 items-start"
      style={{ gridTemplateColumns: "140px 1fr" }}
    >
      <div style={{ paddingTop: 8 }}>
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          {label}
        </div>
        {sub && (
          <div
            className="text-muted-foreground italic mt-1.5"
            style={{ fontSize: 11, lineHeight: 1.4 }}
          >
            {sub}
          </div>
        )}
      </div>
      <div className="flex">{children}</div>
    </div>
  );
}
