import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowsClockwise,
  Brain,
  ChartLine,
  CheckCircle,
  Cloud,
  Database,
  Heartbeat,
  LinkBreak,
  ShieldCheck,
  Warning,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";

interface SubsystemHealth {
  auditLog: { droppedEntries: number; pendingEntries: number; healthy: boolean };
  jobQueue: {
    pending: number;
    running: number;
    completedToday: number;
    failedToday: number;
    backend: string;
  };
  bedrockAI: { circuitState: string; healthy: boolean };
  ragKnowledgeBase: {
    enabled: boolean;
    cache?: { hits: number; misses: number; hitRate: string; entries: number; maxEntries: number };
  };
  batchInference: { enabled: boolean };
  scoringQuality: {
    total: number;
    upgrades: number;
    downgrades: number;
    avgDelta: number;
    alerts: Array<{ type: string; severity: string; message: string; timestamp: string }>;
  };
  calibration: { lastSnapshot: string | null; driftDetected: boolean };
  telephony8x8: { enabled: boolean };
  onboarding?: {
    chronicallyUnlinkedLast7d: number | null;
    healthy: boolean;
  };
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  issues: string[];
  subsystems: SubsystemHealth;
}

// ─────────────────────────────────────────────────────────────
// System Health (installment 14 — warm-paper rewrite).
// Admin-only operational dashboard. Auto-refreshes every 30s.
// ─────────────────────────────────────────────────────────────
export default function SystemHealthPage() {
  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ["/api/admin/health-deep"],
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="system-health-page">
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
          <span className="text-foreground">System health</span>
        </nav>
      </div>

      {/* Page header with overall status pill */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
              style={{ fontSize: 10, letterSpacing: "0.18em" }}
            >
              <Heartbeat style={{ width: 12, height: 12 }} />
              Operations
            </div>
            <div
              className="font-display font-medium text-foreground mt-1"
              style={{
                fontSize: "clamp(24px, 3vw, 30px)",
                letterSpacing: "-0.6px",
                lineHeight: 1.15,
              }}
            >
              System health
            </div>
            <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
              Operational status across all subsystems. Auto-refreshes every 30 seconds.
            </p>
          </div>
          {data && (
            <div className="pb-1">
              <StatusPill status={data.status} large />
            </div>
          )}
        </div>
      </div>

      <main className="px-7 py-6 space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-sm border bg-card p-5"
                style={{ borderColor: "var(--border)" }}
              >
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorBanner message="Failed to load system health data." />
        ) : data ? (
          <>
            {/* Issues banner */}
            {data.issues.length > 0 && (
              <div
                className="rounded-sm"
                style={{
                  background: "var(--amber-soft)",
                  border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                  borderLeft: "3px solid var(--amber)",
                  padding: "14px 18px",
                }}
              >
                <div className="flex items-start gap-3">
                  <Warning
                    style={{
                      width: 16,
                      height: 16,
                      marginTop: 2,
                      flexShrink: 0,
                      color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="font-mono uppercase"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                      }}
                    >
                      Active issues · {data.issues.length}
                    </div>
                    <ul className="mt-2 space-y-1" style={{ fontSize: 13, lineHeight: 1.5 }}>
                      {data.issues.map((issue, i) => (
                        <li key={i} className="text-foreground flex gap-2">
                          <span className="text-muted-foreground" style={{ marginTop: 0 }}>
                            —
                          </span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Subsystem grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Audit log */}
              <SubsystemCard
                icon={ShieldCheck}
                title="Audit log"
                statusPill={<StatusPill status={data.subsystems.auditLog.healthy} />}
              >
                <MetricRow label="Pending entries" value={data.subsystems.auditLog.pendingEntries} />
                <MetricRow
                  label="Dropped entries"
                  value={data.subsystems.auditLog.droppedEntries}
                  alert={data.subsystems.auditLog.droppedEntries > 0}
                />
              </SubsystemCard>

              {/* Job queue */}
              <SubsystemCard
                icon={Database}
                title="Job queue"
                statusPill={<BackendPill backend={data.subsystems.jobQueue.backend} />}
              >
                <MetricRow label="Pending" value={data.subsystems.jobQueue.pending} />
                <MetricRow label="Running" value={data.subsystems.jobQueue.running} />
                <MetricRow
                  label="Completed today"
                  value={data.subsystems.jobQueue.completedToday}
                  success
                />
                <MetricRow
                  label="Failed today"
                  value={data.subsystems.jobQueue.failedToday}
                  alert={data.subsystems.jobQueue.failedToday > 0}
                />
              </SubsystemCard>

              {/* Bedrock AI */}
              <SubsystemCard
                icon={Brain}
                title="Bedrock AI"
                statusPill={<StatusPill status={data.subsystems.bedrockAI.healthy} />}
              >
                <MetricRow
                  label="Circuit breaker"
                  value={data.subsystems.bedrockAI.circuitState}
                  isText
                  alert={data.subsystems.bedrockAI.circuitState !== "closed"}
                  success={data.subsystems.bedrockAI.circuitState === "closed"}
                />
              </SubsystemCard>

              {/* RAG KB */}
              <SubsystemCard icon={Cloud} title="RAG knowledge base">
                {data.subsystems.ragKnowledgeBase.enabled && data.subsystems.ragKnowledgeBase.cache ? (
                  <>
                    <MetricRow
                      label="Hit rate"
                      value={data.subsystems.ragKnowledgeBase.cache.hitRate}
                      isText
                    />
                    <MetricRow
                      label="Cache entries"
                      value={`${data.subsystems.ragKnowledgeBase.cache.entries}/${data.subsystems.ragKnowledgeBase.cache.maxEntries}`}
                      isText
                    />
                  </>
                ) : (
                  <p
                    className="font-mono uppercase text-muted-foreground"
                    style={{ fontSize: 10, letterSpacing: "0.12em" }}
                  >
                    Disabled
                  </p>
                )}
              </SubsystemCard>

              {/* Scoring quality */}
              <SubsystemCard
                icon={ChartLine}
                title="Scoring quality"
                statusPill={
                  data.subsystems.scoringQuality.alerts.length > 0 ? (
                    <InlinePill tone="destructive">
                      {data.subsystems.scoringQuality.alerts.length} alert(s)
                    </InlinePill>
                  ) : null
                }
              >
                <MetricRow
                  label="Total corrections"
                  value={data.subsystems.scoringQuality.total}
                />
                <MetricRow
                  label="Upgrades / downgrades"
                  value={`${data.subsystems.scoringQuality.upgrades} / ${data.subsystems.scoringQuality.downgrades}`}
                  isText
                />
                <MetricRow
                  label="Avg delta"
                  value={data.subsystems.scoringQuality.avgDelta}
                />
                {data.subsystems.scoringQuality.alerts.map((alert, i) => (
                  <div
                    key={i}
                    className="mt-2 rounded-sm"
                    style={{
                      padding: "8px 10px",
                      background:
                        alert.severity === "critical"
                          ? "var(--warm-red-soft)"
                          : "var(--amber-soft)",
                      border: `1px solid ${
                        alert.severity === "critical"
                          ? "color-mix(in oklch, var(--destructive), transparent 60%)"
                          : "color-mix(in oklch, var(--amber), transparent 55%)"
                      }`,
                      fontSize: 11,
                      lineHeight: 1.5,
                      color:
                        alert.severity === "critical"
                          ? "color-mix(in oklch, var(--destructive), var(--ink) 20%)"
                          : "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                    }}
                  >
                    {alert.message}
                  </div>
                ))}
              </SubsystemCard>

              {/* Calibration */}
              <SubsystemCard icon={ArrowsClockwise} title="Calibration">
                <MetricRow
                  label="Last snapshot"
                  value={
                    data.subsystems.calibration.lastSnapshot
                      ? new Date(data.subsystems.calibration.lastSnapshot).toLocaleDateString()
                      : "Never"
                  }
                  isText
                />
                <MetricRow
                  label="Drift detected"
                  value={data.subsystems.calibration.driftDetected ? "Yes" : "No"}
                  isText
                  alert={data.subsystems.calibration.driftDetected}
                  success={!data.subsystems.calibration.driftDetected}
                />
              </SubsystemCard>

              {/* Phase E follow-on: chronic-unlinked signal. Fires the
                  `user_employee_link_unresolved` audit event once per
                  user per UTC day at login; card counts distinct users
                  over the last 7 days. Shows "—" when DB unavailable. */}
              <SubsystemCard
                icon={LinkBreak}
                title="Onboarding"
                statusPill={
                  <StatusPill
                    status={data.subsystems.onboarding?.healthy ?? true}
                  />
                }
              >
                <MetricRow
                  label="Chronically unlinked (7d)"
                  value={
                    data.subsystems.onboarding?.chronicallyUnlinkedLast7d ?? "—"
                  }
                  alert={
                    (data.subsystems.onboarding?.chronicallyUnlinkedLast7d ?? 0) >= 3
                  }
                  success={data.subsystems.onboarding?.chronicallyUnlinkedLast7d === 0}
                />
                <MetricRow
                  label="Resolve via"
                  value="/admin Users · Onboarding banner"
                  isText
                />
              </SubsystemCard>
            </div>

            <p
              className="font-mono uppercase text-muted-foreground text-right"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Last updated {new Date(data.timestamp).toLocaleTimeString()} · auto-refresh every 30s
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline helpers
// ─────────────────────────────────────────────────────────────
function StatusPill({
  status,
  large = false,
}: {
  status: HealthResponse["status"] | boolean;
  large?: boolean;
}) {
  const resolved =
    typeof status === "boolean" ? (status ? "healthy" : "degraded") : status;
  const meta = {
    healthy: {
      icon: CheckCircle,
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "var(--sage)",
      label: "Healthy",
    },
    degraded: {
      icon: Warning,
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 50%)",
      color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
      label: "Degraded",
    },
    unhealthy: {
      icon: XCircle,
      bg: "var(--warm-red-soft)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
      color: "var(--destructive)",
      label: "Unhealthy",
    },
  }[resolved];
  const IconComp = meta.icon;
  return (
    <span
      className="font-mono uppercase inline-flex items-center gap-1.5 rounded-sm"
      style={{
        fontSize: large ? 11 : 9,
        letterSpacing: "0.12em",
        padding: large ? "6px 12px" : "3px 8px",
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        color: meta.color,
        fontWeight: 500,
      }}
    >
      <IconComp
        style={{ width: large ? 13 : 10, height: large ? 13 : 10 }}
        weight="fill"
      />
      {meta.label}
    </span>
  );
}

function BackendPill({ backend }: { backend: string }) {
  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-sm"
      style={{
        fontSize: 9,
        letterSpacing: "0.1em",
        padding: "3px 8px",
        background: "var(--paper-2)",
        border: "1px solid var(--border)",
        color: "var(--muted-foreground)",
        fontWeight: 500,
      }}
    >
      {backend}
    </span>
  );
}

function InlinePill({
  tone,
  children,
}: {
  tone: "destructive" | "amber" | "sage";
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
      color: "var(--sage)",
    },
  }[tone];
  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-sm"
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

function SubsystemCard({
  icon: IconComp,
  title,
  statusPill,
  children,
}: {
  icon: Icon;
  title: string;
  statusPill?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          <IconComp style={{ width: 12, height: 12 }} />
          {title}
        </div>
        {statusPill}
      </div>
      <div className="px-5 py-3 space-y-1.5">{children}</div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  alert,
  success,
  isText,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
  success?: boolean;
  isText?: boolean;
}) {
  const color = alert
    ? "var(--destructive)"
    : success
    ? "var(--sage)"
    : "var(--foreground)";
  return (
    <div className="flex items-center justify-between text-sm" style={{ lineHeight: 1.5 }}>
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${isText ? "capitalize" : ""}`}
        style={{
          fontSize: 12,
          letterSpacing: "0.02em",
          color,
          fontWeight: alert || success ? 500 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-sm"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "12px 16px",
        fontSize: 13,
        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
      }}
    >
      <XCircle style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}
