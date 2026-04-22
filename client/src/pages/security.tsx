import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  CheckCircle,
  FileX,
  Key,
  Shield,
  Warning,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { toDisplayString } from "@/lib/display-utils";

interface SecuritySummary {
  totalAlerts: number;
  unacknowledgedAlerts: number;
  criticalAlerts: number;
  activeBreach: boolean;
  mfaEnforcementEnabled: boolean;
  recentAlertTypes: Record<string, number>;
}

interface SecurityAlert {
  id: string;
  timestamp: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, unknown>;
  acknowledged: boolean;
}

interface BreachReport {
  id: string;
  reportedAt: string;
  reportedBy: string;
  description: string;
  affectedIndividuals: number;
  dataTypes: string[];
  discoveryDate: string;
  containmentActions: string;
  notificationStatus: "pending" | "notified" | "resolved";
  timeline: Array<{ timestamp: string; action: string; actor: string }>;
}

interface MFAUser {
  username: string;
  enabled: boolean;
  createdAt: string;
}

type SecurityTab = "alerts" | "breaches" | "mfa";

// ─────────────────────────────────────────────────────────────
// Severity tone mapping — warm-paper palette replacing blue/yellow/
// orange/red hardcoded classes. Critical + high → destructive,
// medium → amber, low → neutral paper-2.
// ─────────────────────────────────────────────────────────────
const SEVERITY_META: Record<
  SecurityAlert["severity"],
  { tone: "destructive" | "amber" | "neutral"; label: string }
> = {
  critical: { tone: "destructive", label: "Critical" },
  high: { tone: "destructive", label: "High" },
  medium: { tone: "amber", label: "Medium" },
  low: { tone: "neutral", label: "Low" },
};

// ─────────────────────────────────────────────────────────────
// Security & Compliance (installment 14 — warm-paper rewrite).
// HIPAA security monitoring: alerts, breach management, MFA status.
// Admin-only. Mirrors the AdminPanel / StatusPill vocabulary from
// the admin.tsx redesign (installment 8).
// ─────────────────────────────────────────────────────────────
export default function SecurityPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SecurityTab>("alerts");

  const { data: summary } = useQuery<SecuritySummary>({
    queryKey: ["/api/admin/security-summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000,
  });

  const { data: alerts = [] } = useQuery<SecurityAlert[]>({
    queryKey: ["/api/admin/security-alerts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000,
  });

  const { data: breaches = [] } = useQuery<BreachReport[]>({
    queryKey: ["/api/admin/breach-reports"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: mfaUsers = [] } = useQuery<MFAUser[]>({
    queryKey: ["/api/auth/mfa/users"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("PATCH", `/api/admin/security-alerts/${alertId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security-summary"] });
    },
  });

  // Breach report form state
  const [showBreachForm, setShowBreachForm] = useState(false);
  const [breachDesc, setBreachDesc] = useState("");
  const [breachAffected, setBreachAffected] = useState("");
  const [breachDiscovery, setBreachDiscovery] = useState("");
  const [breachContainment, setBreachContainment] = useState("");
  const [breachDataTypes, setBreachDataTypes] = useState("");

  const createBreachMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/breach-reports", {
        description: breachDesc,
        affectedIndividuals: parseInt(breachAffected) || 0,
        dataTypes: breachDataTypes.split(",").map((s) => s.trim()).filter(Boolean),
        discoveryDate: breachDiscovery,
        containmentActions: breachContainment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/breach-reports"] });
      setShowBreachForm(false);
      setBreachDesc("");
      setBreachAffected("");
      setBreachDiscovery("");
      setBreachContainment("");
      setBreachDataTypes("");
      toast({
        title: "Breach report filed",
        description: "Incident has been logged to the HIPAA audit trail.",
      });
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to create breach report",
        variant: "destructive",
      }),
  });

  const updateBreachMutation = useMutation({
    mutationFn: async ({ id, status, action }: { id: string; status: string; action: string }) => {
      await apiRequest("PATCH", `/api/admin/breach-reports/${id}`, { status, action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/breach-reports"] });
      toast({ title: "Breach status updated" });
    },
  });

  const openBreachCount = breaches.filter((b) => b.notificationStatus !== "resolved").length;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="security-page">
      {/* App bar */}
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
          <span className="text-foreground">Security</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <Shield style={{ width: 12, height: 12 }} />
          Compliance
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Security & compliance
        </div>
        <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
          HIPAA security monitoring, breach management, and MFA enrollment status.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="px-4 sm:px-7 py-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <SecurityTile
          icon={Bell}
          label="Unacknowledged alerts"
          value={(summary?.unacknowledgedAlerts ?? 0).toString()}
          footnote={`${summary?.totalAlerts ?? 0} total in window`}
          tone={summary?.unacknowledgedAlerts ? "amber" : "neutral"}
        />
        <SecurityTile
          icon={Warning}
          label="Critical alerts"
          value={(summary?.criticalAlerts ?? 0).toString()}
          footnote="requiring immediate review"
          tone={summary?.criticalAlerts ? "destructive" : "neutral"}
        />
        <SecurityTile
          icon={FileX}
          label="Active breaches"
          value={openBreachCount.toString()}
          footnote={summary?.activeBreach ? "active incident reported" : "no open incidents"}
          tone={summary?.activeBreach ? "destructive" : "neutral"}
        />
        <SecurityTile
          icon={Key}
          label="MFA enabled"
          value={mfaUsers.length.toString()}
          footnote={
            summary?.mfaEnforcementEnabled ? "users (enforced)" : "users (voluntary)"
          }
          tone={summary?.mfaEnforcementEnabled ? "sage" : "neutral"}
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 px-4 sm:px-7 py-3 bg-background border-b border-border">
        <SecurityTab
          active={tab === "alerts"}
          onClick={() => setTab("alerts")}
          label="Security alerts"
          badge={summary?.unacknowledgedAlerts || undefined}
        />
        <SecurityTab
          active={tab === "breaches"}
          onClick={() => setTab("breaches")}
          label="Breach reports"
          badge={openBreachCount || undefined}
        />
        <SecurityTab active={tab === "mfa"} onClick={() => setTab("mfa")} label="MFA status" />
      </div>

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* ALERTS TAB */}
        {tab === "alerts" && (
          <>
            {alerts.length === 0 ? (
              <SecurityPanel kicker="Empty">
                <div className="text-center py-14">
                  <CheckCircle
                    style={{ width: 36, height: 36, margin: "0 auto", color: "var(--sage)" }}
                    weight="fill"
                  />
                  <div
                    className="font-mono uppercase text-muted-foreground mt-3"
                    style={{ fontSize: 10, letterSpacing: "0.14em" }}
                  >
                    All clear
                  </div>
                  <p className="text-sm text-foreground mt-2">
                    No security alerts. All systems normal.
                  </p>
                </div>
              </SecurityPanel>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={() => acknowledgeAlertMutation.mutate(alert.id)}
                    disabled={acknowledgeAlertMutation.isPending}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* BREACHES TAB */}
        {tab === "breaches" && (
          <>
            <div>
              <Button
                onClick={() => setShowBreachForm(!showBreachForm)}
                variant={showBreachForm ? "outline" : "default"}
                size="sm"
              >
                {showBreachForm ? (
                  <>
                    <X className="w-4 h-4 mr-1.5" /> Cancel
                  </>
                ) : (
                  <>
                    <FileX className="w-4 h-4 mr-1.5" /> Report new breach
                  </>
                )}
              </Button>
            </div>

            {showBreachForm && (
              <SecurityPanel
                kicker="HIPAA §164.408"
                icon={FileX}
                title="New breach report"
                tone="accent"
              >
                <div className="space-y-4">
                  <div>
                    <SecurityFieldLabel htmlFor="breach-desc">Description</SecurityFieldLabel>
                    <Input
                      id="breach-desc"
                      value={breachDesc}
                      onChange={(e) => setBreachDesc(e.target.value)}
                      placeholder="What happened?"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <SecurityFieldLabel htmlFor="breach-discovery">
                        Discovery date
                      </SecurityFieldLabel>
                      <Input
                        id="breach-discovery"
                        type="date"
                        value={breachDiscovery}
                        onChange={(e) => setBreachDiscovery(e.target.value)}
                      />
                    </div>
                    <div>
                      <SecurityFieldLabel htmlFor="breach-affected">
                        Affected individuals
                      </SecurityFieldLabel>
                      <Input
                        id="breach-affected"
                        type="number"
                        value={breachAffected}
                        onChange={(e) => setBreachAffected(e.target.value)}
                        placeholder="0"
                        className="tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <SecurityFieldLabel htmlFor="breach-data">
                      Data types involved
                    </SecurityFieldLabel>
                    <Input
                      id="breach-data"
                      value={breachDataTypes}
                      onChange={(e) => setBreachDataTypes(e.target.value)}
                      placeholder="PHI, audio recordings, transcripts (comma-separated)"
                    />
                  </div>
                  <div>
                    <SecurityFieldLabel htmlFor="breach-containment">
                      Containment actions taken
                    </SecurityFieldLabel>
                    <Input
                      id="breach-containment"
                      value={breachContainment}
                      onChange={(e) => setBreachContainment(e.target.value)}
                      placeholder="What steps were taken to contain the breach?"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-border">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBreachForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => createBreachMutation.mutate()}
                      disabled={!breachDesc || !breachDiscovery || createBreachMutation.isPending}
                    >
                      {createBreachMutation.isPending ? "Filing…" : "Submit breach report"}
                    </Button>
                  </div>
                </div>
              </SecurityPanel>
            )}

            {breaches.length === 0 ? (
              <SecurityPanel kicker="Archive">
                <p
                  className="font-mono uppercase text-muted-foreground text-center py-10"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  No breach reports on file
                </p>
              </SecurityPanel>
            ) : (
              <div className="space-y-3">
                {breaches.map((breach) => (
                  <BreachRow
                    key={breach.id}
                    breach={breach}
                    onUpdate={(status, action) =>
                      updateBreachMutation.mutate({ id: breach.id, status, action })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* MFA TAB */}
        {tab === "mfa" && (
          <SecurityPanel
            kicker="Enrollment"
            icon={Key}
            title="MFA-enabled users"
            description={
              summary?.mfaEnforcementEnabled
                ? "MFA enforcement is ON — all admin/manager users are required to enroll."
                : "MFA enforcement is OFF. Set REQUIRE_MFA=true to enforce for all admin/manager users."
            }
          >
            {mfaUsers.length === 0 ? (
              <p
                className="font-mono uppercase text-muted-foreground text-center py-10"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                No users have MFA enabled yet
              </p>
            ) : (
              <div className="-mx-6 border-t border-border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <SecurityTableHeader>Username</SecurityTableHeader>
                      <SecurityTableHeader>Status</SecurityTableHeader>
                      <SecurityTableHeader>Enabled since</SecurityTableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {mfaUsers.map((u) => (
                      <tr
                        key={u.username}
                        className="border-b border-border last:border-b-0"
                      >
                        <td
                          className="px-6 py-3 font-mono text-foreground"
                          style={{ fontSize: 13, letterSpacing: "0.02em" }}
                        >
                          {u.username}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 font-mono uppercase"
                            style={{
                              fontSize: 10,
                              letterSpacing: "0.12em",
                              color: "var(--sage)",
                            }}
                          >
                            <CheckCircle style={{ width: 11, height: 11 }} weight="fill" />
                            Active
                          </span>
                        </td>
                        <td
                          className="px-6 py-3 font-mono uppercase text-muted-foreground"
                          style={{ fontSize: 10, letterSpacing: "0.1em" }}
                        >
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SecurityPanel>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Alert row — severity pill + type + timestamp + details + optional
// acknowledge button. Tone stripe matches severity.
// ─────────────────────────────────────────────────────────────
function AlertRow({
  alert,
  onAcknowledge,
  disabled,
}: {
  alert: SecurityAlert;
  onAcknowledge: () => void;
  disabled: boolean;
}) {
  const meta = SEVERITY_META[alert.severity];
  const stripe =
    meta.tone === "destructive"
      ? "var(--destructive)"
      : meta.tone === "amber"
      ? "var(--amber)"
      : "var(--border)";
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{
        borderColor: "var(--border)",
        borderLeft: `3px solid ${stripe}`,
        opacity: alert.acknowledged ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <SecurityPill tone={meta.tone}>{meta.label}</SecurityPill>
          <div className="min-w-0 flex-1">
            <div
              className="font-display font-medium text-foreground"
              style={{ fontSize: 15, letterSpacing: "-0.1px" }}
            >
              {alert.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </div>
            <div
              className="font-mono uppercase text-muted-foreground mt-1"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              {new Date(alert.timestamp).toLocaleString()}
            </div>
            {Object.keys(alert.details).length > 0 && (
              <div
                className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm"
                style={{ lineHeight: 1.5 }}
              >
                {Object.entries(alert.details).map(([k, v]) => (
                  <span key={k} className="text-muted-foreground">
                    {k}:{" "}
                    <span className="font-mono text-foreground" style={{ fontSize: 12 }}>
                      {toDisplayString(v)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {!alert.acknowledged && (
          <Button size="sm" variant="outline" onClick={onAcknowledge} disabled={disabled}>
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Acknowledge
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Breach report row — notification status pill + metadata + timeline
// ─────────────────────────────────────────────────────────────
function BreachRow({
  breach,
  onUpdate,
}: {
  breach: BreachReport;
  onUpdate: (status: string, action: string) => void;
}) {
  const tone =
    breach.notificationStatus === "resolved"
      ? "sage"
      : breach.notificationStatus === "notified"
      ? "accent"
      : "destructive";
  const stripe =
    tone === "sage"
      ? "var(--sage)"
      : tone === "accent"
      ? "var(--accent)"
      : "var(--destructive)";

  return (
    <div
      className="rounded-sm border bg-card px-5 py-4 space-y-3"
      style={{ borderColor: "var(--border)", borderLeft: `3px solid ${stripe}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SecurityPill tone={tone}>
              {breach.notificationStatus.toUpperCase()}
            </SecurityPill>
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Reported by {breach.reportedBy} ·{" "}
              {new Date(breach.reportedAt).toLocaleDateString()}
            </span>
          </div>
          <div
            className="font-display font-medium text-foreground mt-2"
            style={{ fontSize: 15, letterSpacing: "-0.1px", lineHeight: 1.4 }}
          >
            {breach.description}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            <span className="tabular-nums">
              {breach.affectedIndividuals}
            </span>{" "}
            individuals affected · discovered {breach.discoveryDate}
          </div>
          {breach.dataTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {breach.dataTypes.map((dt) => (
                <span
                  key={dt}
                  className="font-mono rounded-sm"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.02em",
                    padding: "2px 8px",
                    background: "var(--paper-2)",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {dt}
                </span>
              ))}
            </div>
          )}
        </div>
        {breach.notificationStatus !== "resolved" && (
          <div className="flex flex-col gap-2 shrink-0">
            {breach.notificationStatus === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate("notified", "Affected individuals notified")}
              >
                Mark notified
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdate("resolved", "Breach resolved and documented")}
            >
              Resolve
            </Button>
          </div>
        )}
      </div>

      {breach.timeline.length > 0 && (
        <div className="pt-3 border-t border-border">
          <div
            className="font-mono uppercase text-muted-foreground mb-2"
            style={{ fontSize: 10, letterSpacing: "0.12em" }}
          >
            Timeline
          </div>
          <ul className="space-y-1.5">
            {breach.timeline.map((entry, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-muted-foreground"
                style={{ lineHeight: 1.5 }}
              >
                <span
                  className="font-mono tabular-nums shrink-0"
                  style={{ fontSize: 11, letterSpacing: "0.02em" }}
                >
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span className="text-muted-foreground/40">—</span>
                <span className="text-foreground">
                  {entry.action}{" "}
                  <span className="text-muted-foreground">({entry.actor})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline helpers (mirrors the Admin/Performance/Insights vocabulary)
// ─────────────────────────────────────────────────────────────
function SecurityTile({
  icon: IconComp,
  label,
  value,
  footnote,
  tone,
}: {
  icon: Icon;
  label: string;
  value: string;
  footnote: string;
  tone: "destructive" | "amber" | "sage" | "neutral";
}) {
  const stripe =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "amber"
      ? "var(--amber)"
      : tone === "sage"
      ? "var(--sage)"
      : "var(--border)";
  const color =
    tone === "destructive"
      ? "var(--destructive)"
      : tone === "amber"
      ? "color-mix(in oklch, var(--amber), var(--ink) 20%)"
      : tone === "sage"
      ? "var(--sage)"
      : "var(--foreground)";
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{
        borderColor: "var(--border)",
        ...(tone !== "neutral" ? { borderLeft: `3px solid ${stripe}` } : {}),
      }}
    >
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        <IconComp style={{ width: 11, height: 11 }} />
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-1"
        style={{ fontSize: 26, lineHeight: 1, color, letterSpacing: "-0.4px" }}
      >
        {value}
      </div>
      <p className="text-muted-foreground mt-1.5" style={{ fontSize: 11, lineHeight: 1.5 }}>
        {footnote}
      </p>
    </div>
  );
}

function SecurityTab({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background border border-foreground"
          : "bg-card border border-border text-foreground hover:bg-secondary"
      }`}
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full tabular-nums"
          style={{
            width: 16,
            height: 16,
            fontSize: 9,
            background: active ? "var(--background)" : "var(--destructive)",
            color: active ? "var(--foreground)" : "var(--paper)",
            marginLeft: 2,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function SecurityPanel({
  kicker,
  title,
  description,
  icon: IconComp,
  tone,
  children,
}: {
  kicker: string;
  title?: string;
  description?: string;
  icon?: Icon;
  tone?: "accent" | "destructive";
  children: React.ReactNode;
}) {
  const borderColor =
    tone === "accent"
      ? "color-mix(in oklch, var(--accent), transparent 60%)"
      : tone === "destructive"
      ? "color-mix(in oklch, var(--destructive), transparent 60%)"
      : "var(--border)";
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        {title && (
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
          >
            {title}
          </div>
        )}
        {description && (
          <p
            className="text-muted-foreground mt-1.5"
            style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 540 }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

function SecurityPill({
  tone,
  children,
}: {
  tone: "destructive" | "amber" | "sage" | "accent" | "neutral";
  children: React.ReactNode;
}) {
  const palette = {
    destructive: {
      bg: "var(--warm-red-soft)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
      color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
    },
    amber: {
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 50%)",
      color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
    },
    sage: {
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "color-mix(in oklch, var(--sage), var(--ink) 25%)",
    },
    accent: {
      bg: "var(--copper-soft)",
      border: "color-mix(in oklch, var(--accent), transparent 55%)",
      color: "var(--accent)",
    },
    neutral: {
      bg: "var(--paper-2)",
      border: "var(--border)",
      color: "var(--muted-foreground)",
    },
  }[tone];
  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-sm shrink-0"
      style={{
        fontSize: 9,
        letterSpacing: "0.1em",
        padding: "3px 8px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

function SecurityFieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono uppercase text-muted-foreground block mb-1.5"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </label>
  );
}

function SecurityTableHeader({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-6 py-3 font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 500 }}
    >
      {children}
    </th>
  );
}
