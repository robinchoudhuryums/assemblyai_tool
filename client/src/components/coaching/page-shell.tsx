/**
 * Shared shell for the Coaching pages (warm-paper installment 5, phase 1).
 *
 * Wraps both `/coaching` (manager view) and `/my-coaching` (agent view)
 * with a unified app bar matching the Transcript Viewer pattern:
 * mono breadcrumbs + role toggle (manager/admin only).
 *
 * Page-level merge into a single role-routed `/coaching` is deferred to
 * phase 6; this phase only adds chrome above the existing page bodies.
 * The `children` wrapper still holds each page's own h2/header — the new
 * app bar reads as orientation, not duplication.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";

interface AuthUser {
  id: string;
  role?: string;
  name?: string;
}

export default function CoachingPageShell({
  active,
  children,
}: {
  active: "manager" | "agent";
  children: ReactNode;
}) {
  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const role = (me?.role || "viewer").toLowerCase();
  const canManage = role === "manager" || role === "admin";

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="coaching-page-shell">
      <CoachingAppBar active={active} canManage={canManage} />
      {children}
    </div>
  );
}

function CoachingAppBar({
  active,
  canManage,
}: {
  active: "manager" | "agent";
  canManage: boolean;
}) {
  const [, navigate] = useLocation();
  return (
    <div
      className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border"
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
        <span className="text-foreground">Coaching</span>
      </nav>

      <div className="flex-1" />

      {canManage && (
        <div
          className="flex items-center bg-card border border-border rounded-sm"
          style={{ padding: 2 }}
          role="tablist"
          aria-label="Coaching view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === "agent"}
            onClick={() => navigate("/my-coaching")}
            className={`font-mono uppercase px-3 py-1.5 ${
              active === "agent"
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground"
            }`}
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="coaching-view-agent"
          >
            My coaching
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={active === "manager"}
            onClick={() => navigate("/coaching")}
            className={`font-mono uppercase px-3 py-1.5 ${
              active === "manager"
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground"
            }`}
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="coaching-view-manager"
          >
            Team coaching
          </button>
        </div>
      )}
    </div>
  );
}
