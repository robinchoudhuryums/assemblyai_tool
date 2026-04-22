import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowsClockwise,
  CheckCircle,
  ClockClockwise,
  CloudArrowUp,
  Lightning,
  Pulse,
  Timer,
  Warning,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/ui/loading";

interface BatchStatusResponse {
  enabled: boolean;
  message?: string;
  currentMode?: "batch" | "immediate";
  schedule?: { start?: string; end?: string; description?: string };
  pendingItems?: number;
  activeJobs?: Array<{
    jobId: string;
    status: string;
    callCount: number;
    createdAt: string;
  }>;
  batchIntervalMinutes?: number;
  costSavings?: string;
  perUploadOverride?: string;
}

function formatRelative(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ─────────────────────────────────────────────────────────────
// Batch Status (installment 14 — warm-paper rewrite).
// Admin-only dashboard for AWS Bedrock batch inference. Auto-refresh
// every 30s; shows current mode + pending items + active jobs.
// ─────────────────────────────────────────────────────────────
export default function BatchStatusPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<BatchStatusResponse>({
    queryKey: ["/api/admin/batch-status"],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingIndicator text="Loading batch status..." />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen bg-background text-foreground"
        data-testid="batch-status-page"
      >
        <BatchAppBar />
        <BatchPageHeader subtitle="AWS Bedrock batch mode for cost-optimized AI analysis." />
        <div className="px-4 sm:px-7 py-6">
          <ErrorBanner message={(error as Error).message || "Unknown error"} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Batch mode not enabled — guidance card only
  if (!data.enabled) {
    return (
      <div
        className="min-h-screen bg-background text-foreground"
        data-testid="batch-status-page"
      >
        <BatchAppBar />
        <BatchPageHeader subtitle="AWS Bedrock batch mode for cost-optimized AI analysis." />
        <main className="px-4 sm:px-7 py-6">
          <div
            className="rounded-sm"
            style={{
              background: "var(--amber-soft)",
              border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
              borderLeft: "3px solid var(--amber)",
              padding: "16px 20px",
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
              <div>
                <div
                  className="font-mono uppercase"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                  }}
                >
                  Disabled
                </div>
                <p
                  className="text-foreground mt-1.5"
                  style={{ fontSize: 14, lineHeight: 1.55 }}
                >
                  {data.message ||
                    "Set BEDROCK_BATCH_MODE=true and BEDROCK_BATCH_ROLE_ARN in the server environment to enable deferred batch analysis (50% cost savings)."}
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeJobs = data.activeJobs ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="batch-status-page">
      {/* App bar with refresh button */}
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
          <span className="text-foreground">Batch status</span>
        </nav>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <ArrowsClockwise
            className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <BatchPageHeader subtitle={`AWS Bedrock batch jobs · ${data.costSavings || "50% cost savings"}`} />

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* Mode + stats tile strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ModeTile data={data} />
          <StatTile
            icon={Timer}
            label="Pending items"
            value={(data.pendingItems ?? 0).toLocaleString()}
            footnote={`queued for next batch cycle (every ${data.batchIntervalMinutes ?? 15} min)`}
          />
          <StatTile
            icon={CheckCircle}
            label="Active jobs"
            value={activeJobs.length.toString()}
            footnote={
              activeJobs.length === 0
                ? "no in-flight batch jobs"
                : "currently processing at AWS Bedrock"
            }
          />
        </div>

        {/* Active jobs table */}
        <BatchPanel kicker="In flight" icon={CloudArrowUp} title="Active batch jobs">
          {activeJobs.length === 0 ? (
            <p
              className="font-mono uppercase text-muted-foreground text-center py-10"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              No in-flight batch jobs · new jobs appear here when the scheduler submits them
            </p>
          ) : (
            <div className="-mx-6 border-t border-border overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <BatchTableHeader>Job ID</BatchTableHeader>
                    <BatchTableHeader>Status</BatchTableHeader>
                    <BatchTableHeader align="right">Calls</BatchTableHeader>
                    <BatchTableHeader align="right">Submitted</BatchTableHeader>
                  </tr>
                </thead>
                <tbody>
                  {activeJobs.map((job) => (
                    <tr
                      key={job.jobId}
                      className="border-b border-border last:border-b-0"
                    >
                      <td
                        className="px-6 py-3 font-mono text-muted-foreground truncate max-w-xs"
                        style={{ fontSize: 11, letterSpacing: "0.02em" }}
                      >
                        {job.jobId}
                      </td>
                      <td className="px-6 py-3">
                        <JobStatusPill status={job.status} />
                      </td>
                      <td
                        className="px-6 py-3 text-right font-mono tabular-nums text-foreground"
                        style={{ fontSize: 12, letterSpacing: "0.02em" }}
                      >
                        {job.callCount}
                      </td>
                      <td
                        className="px-6 py-3 text-right font-mono uppercase text-muted-foreground"
                        style={{ fontSize: 10, letterSpacing: "0.1em" }}
                      >
                        {formatRelative(job.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BatchPanel>

        {/* Notes panel */}
        <div
          className="rounded-sm border bg-card p-6"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="font-mono uppercase text-muted-foreground mb-3"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            How it works
          </div>
          <ul className="space-y-2 text-sm text-foreground" style={{ lineHeight: 1.55 }}>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>
                —
              </span>
              <span>
                Uploaded calls queue for batch submission. Every{" "}
                <span className="font-mono tabular-nums">{data.batchIntervalMinutes ?? 15}</span>{" "}
                minutes the scheduler submits all pending items in a single JSONL file to AWS
                Bedrock. Completion typically within 24 hours.
              </span>
            </li>
            {data.perUploadOverride && (
              <li className="flex gap-2">
                <span className="text-muted-foreground" style={{ marginTop: 2 }}>
                  —
                </span>
                <span>
                  <span className="font-medium">Override:</span> {data.perUploadOverride}
                </span>
              </li>
            )}
            <li
              className="font-mono uppercase text-muted-foreground pl-5"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Auto-refreshes every 30 seconds
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared app bar + header
// ─────────────────────────────────────────────────────────────
function BatchAppBar() {
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
        <span className="text-foreground">Batch status</span>
      </nav>
    </div>
  );
}

function BatchPageHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.18em" }}
      >
        <CloudArrowUp style={{ width: 12, height: 12 }} />
        Operations
      </div>
      <div
        className="font-display font-medium text-foreground mt-1"
        style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
      >
        Batch inference status
      </div>
      <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
        {subtitle}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Mode tile — shows "Batch" (deferred, accent) vs "Immediate"
// (on-demand, sage) with a short schedule description.
// ─────────────────────────────────────────────────────────────
function ModeTile({ data }: { data: BatchStatusResponse }) {
  const isBatch = data.currentMode === "batch";
  const color = isBatch ? "var(--accent)" : "var(--sage)";
  const IconComp = isBatch ? ClockClockwise : Lightning;
  const label = isBatch ? "Batch" : "Immediate";
  const modeLabel = isBatch ? "Deferred" : "On-demand";
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{ borderColor: "var(--border)", borderLeft: `3px solid ${color}` }}
    >
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        <Pulse style={{ width: 11, height: 11 }} />
        Current mode
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <IconComp style={{ width: 22, height: 22, color }} />
        <span
          className="font-display font-medium text-foreground"
          style={{ fontSize: 24, letterSpacing: "-0.4px", lineHeight: 1 }}
        >
          {label}
        </span>
        <span
          className="font-mono uppercase rounded-sm"
          style={{
            fontSize: 9,
            letterSpacing: "0.1em",
            padding: "3px 7px",
            background: isBatch ? "var(--copper-soft)" : "var(--sage-soft)",
            border: `1px solid color-mix(in oklch, ${color}, transparent 55%)`,
            color,
            fontWeight: 500,
          }}
        >
          {modeLabel}
        </span>
      </div>
      <p
        className="text-muted-foreground mt-2"
        style={{ fontSize: 11, lineHeight: 1.5 }}
      >
        {data.schedule?.description || "Schedule not set"}
      </p>
    </div>
  );
}

function StatTile({
  icon: IconComp,
  label,
  value,
  footnote,
}: {
  icon: Icon;
  label: string;
  value: string;
  footnote: string;
}) {
  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        <IconComp style={{ width: 11, height: 11 }} />
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums text-foreground mt-1"
        style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.5px" }}
      >
        {value}
      </div>
      <p className="text-muted-foreground mt-1.5" style={{ fontSize: 11, lineHeight: 1.5 }}>
        {footnote}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Job status pill — maps AWS Bedrock job statuses to warm-paper tones
// ─────────────────────────────────────────────────────────────
function JobStatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone: "sage" | "destructive" | "accent" | "neutral" =
    normalized === "completed"
      ? "sage"
      : normalized === "failed" || normalized === "stopped" || normalized === "expired"
      ? "destructive"
      : normalized === "inprogress" || normalized === "submitted"
      ? "accent"
      : "neutral";
  const palette = {
    sage: {
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "var(--sage)",
    },
    destructive: {
      bg: "var(--warm-red-soft)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
      color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
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
      {status}
    </span>
  );
}

function BatchPanel({
  kicker,
  title,
  icon: IconComp,
  children,
}: {
  kicker: string;
  title: string;
  icon?: Icon;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {title}
        </div>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

function BatchTableHeader({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="font-mono uppercase text-muted-foreground"
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        fontWeight: 500,
        padding: "10px 24px",
        textAlign: align,
      }}
    >
      {children}
    </th>
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
