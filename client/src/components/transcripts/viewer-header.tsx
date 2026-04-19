/**
 * Transcript Viewer header (Phase 1 — warm-paper installment 4).
 *
 * Renders the two top strips of the redesigned Call Transcript Viewer:
 *   1. App bar  — breadcrumbs · inline search · role toggle · Export ·
 *                  manager-only "+ New coaching note"
 *   2. Call header — mono kicker (call id · uploaded-at) · display subject
 *                    (AI summary truncated / fallback) · meta grid
 *                    (Agent · Type · Duration · Uploaded) · tag pills
 *
 * The search box, role toggle, Export button, and coaching-note button
 * are rendered purely for layout in this phase; they become interactive
 * in phases 2, 3, and 5. The existing `<TranscriptViewer>` body below
 * still has its own working chrome during the transition.
 *
 * Data contract: reuses the `["/api/calls", callId]` query key that
 * `TranscriptViewer` already populates — TanStack Query de-dupes so this
 * doesn't cause a second network call.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  DownloadSimple,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { Avatar } from "@/components/dashboard/primitives";
import type { CallWithDetails } from "@shared/schema";

interface Tag {
  id: string;
  tag: string;
}

interface AuthUser {
  id: string;
  role?: string;
  name?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  inbound: "Customer",
  outbound: "Outbound",
  internal: "Internal",
  vendor: "Vendor",
};

function shortCallId(id: string): string {
  return id.length > 10 ? id.slice(0, 8).toUpperCase() : id.toUpperCase();
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatUploadedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function composeSubject(call: CallWithDetails | undefined): string {
  if (!call) return "Loading transcript…";
  const summary =
    typeof call.analysis?.summary === "string" ? call.analysis.summary : "";
  if (summary) {
    // First sentence, capped at 100 chars.
    const first = summary.split(/[.!?]/)[0].trim();
    if (first.length > 0) {
      return first.length > 100 ? first.slice(0, 97) + "…" : first;
    }
  }
  const categoryLabel = call.callCategory
    ? CATEGORY_LABELS[call.callCategory] ?? call.callCategory
    : "Call";
  return `${categoryLabel} call · ${shortCallId(call.id)}`;
}

export default function ViewerHeader({ callId }: { callId: string }) {
  const { data: call } = useQuery<CallWithDetails>({
    queryKey: ["/api/calls", callId],
  });
  const { data: tags } = useQuery<Tag[]>({
    queryKey: ["/api/calls", callId, "tags"],
  });
  const { data: me } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
  });

  const role = (me?.role || "viewer").toLowerCase();
  const canManage = role === "manager" || role === "admin";
  const [roleView, setRoleView] = useState<"agent" | "manager">(
    canManage ? "manager" : "agent",
  );

  const agentInitials = call?.employee?.name
    ? call.employee.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase()
    : "·";
  const categoryLabel = call?.callCategory
    ? CATEGORY_LABELS[call.callCategory] ?? call.callCategory
    : null;
  const durationStr = formatDuration(call?.duration);
  const uploadedStr = formatUploadedAt(call?.uploadedAt);

  return (
    <>
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
          <Link href="/transcripts" className="text-muted-foreground hover:text-foreground transition-colors">
            Transcripts
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">{shortCallId(callId)}</span>
        </nav>

        <div className="flex-1" />

        {/* Inline search — visual only in phase 1; wired in phase 2 */}
        <label className="relative">
          <MagnifyingGlass
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            style={{ width: 12, height: 12 }}
          />
          <input
            type="search"
            placeholder="Search transcript…"
            disabled
            className="bg-secondary border border-border rounded-sm pl-7 pr-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-70 disabled:cursor-not-allowed"
            style={{ width: 180 }}
            aria-label="Search transcript (wired in phase 2)"
          />
        </label>

        {/* Role toggle — visible for managers/admins; viewers are locked to Agent view */}
        {canManage && (
          <div
            className="flex items-center bg-card border border-border rounded-sm"
            style={{ padding: 2 }}
            role="tablist"
            aria-label="Viewer role"
          >
            <button
              type="button"
              role="tab"
              aria-selected={roleView === "agent"}
              onClick={() => setRoleView("agent")}
              className={`font-mono uppercase px-3 py-1.5 ${
                roleView === "agent"
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground"
              }`}
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
              data-testid="role-toggle-agent"
            >
              Agent view
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={roleView === "manager"}
              onClick={() => setRoleView("manager")}
              className={`font-mono uppercase px-3 py-1.5 ${
                roleView === "manager"
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground"
              }`}
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
              data-testid="role-toggle-manager"
            >
              Manager view
            </button>
          </div>
        )}

        {/* Export — visual only; existing TranscriptViewer still exports below */}
        <button
          type="button"
          disabled
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          aria-label="Export transcript (wired in phase 5)"
        >
          <DownloadSimple style={{ width: 12, height: 12 }} />
          Export
        </button>

        {canManage && roleView === "manager" && (
          <button
            type="button"
            disabled
            className="font-mono uppercase inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1.5 text-[var(--paper)] bg-primary border-primary hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            aria-label="New coaching note (wired in phase 5)"
          >
            <Plus style={{ width: 12, height: 12 }} />
            New coaching note
          </button>
        )}
      </div>

      {/* Call header */}
      <div
        className="grid gap-5 items-end px-7 py-5 bg-background border-b border-border"
        style={{ gridTemplateColumns: "1fr auto" }}
      >
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.18em" }}
          >
            Call transcript · {shortCallId(callId)}
            {uploadedStr && <> · {uploadedStr}</>}
          </div>
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 28, letterSpacing: "-0.6px", lineHeight: 1.15 }}
            data-testid="viewer-subject"
          >
            {composeSubject(call)}
          </div>

          {/* Meta grid */}
          <div className="flex flex-wrap gap-x-6 gap-y-3 mt-3" style={{ fontSize: 12 }}>
            {call?.employee?.name && (
              <MetaField
                label="Agent"
                value={
                  <span className="inline-flex items-center gap-2">
                    <Avatar initials={agentInitials} size={18} />
                    <span className="text-foreground">{call.employee.name}</span>
                    {call.employee.role && (
                      <span
                        className="font-mono text-muted-foreground"
                        style={{ fontSize: 10 }}
                      >
                        · {call.employee.role}
                      </span>
                    )}
                  </span>
                }
              />
            )}
            {categoryLabel && <MetaField label="Type" value={categoryLabel} />}
            {durationStr && <MetaField label="Duration" value={durationStr} />}
            {call?.status && call.status !== "completed" && (
              <MetaField label="Status" value={call.status} />
            )}
          </div>

          {/* Tag pills */}
          {tags && tags.length > 0 && (
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="font-mono bg-secondary border border-border text-foreground"
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    letterSpacing: "0.05em",
                  }}
                >
                  {t.tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MetaField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 9, letterSpacing: "0.14em" }}
      >
        {label}
      </span>
      <span className="text-foreground" style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}
