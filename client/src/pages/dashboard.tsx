/**
 * Role-routed analytics dashboard.
 *
 * Implements the first-installment handoff from Claude Design
 * (see `docs/design-bundle/project/Call Analytics Dashboard.html`).
 *
 *   admin    → Ledger variant  (newspaper/ops-desk, dense)
 *   manager  → Pulse  variant  (hero score + sentiment curve, card grid)
 *   viewer   → redirected to `/my-performance` (Agent Lens — Phase 2)
 *
 * The widget-configurable layout (dashboard-config.ts) is deprecated;
 * the new variants are curated. Existing localStorage widget settings
 * are ignored but not cleared (kept for one release cycle in case
 * rollback is needed). Deprecated subcomponents still live under
 * `components/dashboard/` and are marked with `@deprecated`; delete
 * in a later sweep once the Agent Lens cut has landed too.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import LedgerVariant from "@/components/dashboard/ledger-variant";
import PulseVariant from "@/components/dashboard/pulse-variant";

interface AuthUser {
  id: string;
  username: string;
  role?: string;
  name?: string;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  // /api/auth/me is already populated by the session-gate in App.tsx; this
  // query is served from cache and doesn't hit the network.
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
  });
  const role = (user?.role || "viewer").toLowerCase();

  // Viewers get routed to their personal dashboard. App-level routing
  // *should* already send them there, but a viewer who lands on
  // /dashboard via a stale bookmark or link shouldn't see an empty ops
  // desk. Effect fires once per mount after the user query resolves.
  useEffect(() => {
    if (isLoading) return;
    if (role === "viewer") navigate("/my-performance", { replace: true });
  }, [isLoading, role, navigate]);

  if (isLoading) {
    return (
      <div
        className="min-h-screen bg-background"
        aria-busy="true"
        aria-live="polite"
        data-testid="dashboard-page"
      />
    );
  }

  // While the redirect is in-flight, render nothing rather than the
  // admin/manager variant.
  if (role === "viewer") {
    return <div data-testid="dashboard-page" className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background" data-testid="dashboard-page">
      {role === "admin" ? <LedgerVariant /> : <PulseVariant />}
    </div>
  );
}
