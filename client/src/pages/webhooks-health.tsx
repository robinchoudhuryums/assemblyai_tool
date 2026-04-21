/**
 * Webhook delivery health dashboard (Phase C — admin only).
 *
 * Shows per-webhook delivery stats (in-flight, scheduled retries, dead-
 * lettered, 24h deliveries, avg latency) + circuit-breaker state + a
 * dead-letter list with manual-retry buttons. Styled to match the other
 * admin-ops pages (batch-status, system-health) — warm-paper app bar,
 * StatTile metrics, document-row layout.
 *
 * Backend endpoints:
 *   GET  /api/admin/webhooks/stats
 *   GET  /api/admin/webhooks/dead-letter
 *   POST /api/admin/webhooks/dead-letter/:jobId/retry
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowsClockwise,
  CheckCircle,
  Lightning,
  Plugs,
  Timer,
  Warning,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/ui/loading";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type CircuitState = "closed" | "open" | "half-open";

interface WebhookStats {
  webhookId: string;
  url: string;
  active: boolean;
  inFlight: number;
  scheduledRetries: number;
  deadLettered: number;
  delivered24h: number;
  avgLatencyMs: number | null;
  circuit: { state: CircuitState; failureCount: number; lastFailureTime: number };
}

interface StatsResponse {
  webhooks: WebhookStats[];
  backendAvailable: boolean;
}

interface DeadLetterJob {
  id: string;
  webhookId: string;
  event: string;
  bodyPreview: string;
  attempts: number;
  maxAttempts: number;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeadLetterResponse {
  jobs: DeadLetterJob[];
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

export default function WebhooksHealthPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats, isLoading: isLoadingStats, error: statsError, refetch: refetchStats, isFetching } = useQuery<StatsResponse>({
    queryKey: ["/api/admin/webhooks/stats"],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: deadLetter } = useQuery<DeadLetterResponse>({
    queryKey: ["/api/admin/webhooks/dead-letter"],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", `/api/admin/webhooks/dead-letter/${jobId}/retry`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to re-queue delivery");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/webhooks/dead-letter"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/webhooks/stats"] });
      toast({ title: "Re-queued", description: "Delivery will be retried on the next poll cycle." });
    },
    onError: (err) => {
      toast({ title: "Retry failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  if (isLoadingStats) {
    return <LoadingIndicator />;
  }

  const webhooks = stats?.webhooks ?? [];
  const totalInFlight = webhooks.reduce((s, w) => s + w.inFlight, 0);
  const totalScheduled = webhooks.reduce((s, w) => s + w.scheduledRetries, 0);
  const totalDead = webhooks.reduce((s, w) => s + w.deadLettered, 0);
  const totalDelivered24h = webhooks.reduce((s, w) => s + w.delivered24h, 0);
  const anyOpen = webhooks.some((w) => w.circuit.state === "open");

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="webhooks-health-page">
      {/* App bar */}
      <div className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border" style={{ fontSize: 12 }}>
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
            Admin
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Webhook health</span>
        </nav>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => refetchStats()} disabled={isFetching} data-testid="refresh-button">
          <ArrowsClockwise className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          Webhook delivery
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          {anyOpen ? "Circuit open — delivery suspended" : "All circuits closed"}
        </div>
      </div>

      {statsError && (
        <div
          className="mx-7 mt-4 border bg-card"
          style={{ borderRadius: "var(--radius)", padding: "14px 18px", boxShadow: "inset 3px 0 0 var(--destructive)" }}
        >
          <div className="flex items-start gap-2">
            <WarningCircle style={{ width: 18, height: 18, color: "var(--destructive)", flexShrink: 0 }} />
            <div className="text-sm text-foreground">Failed to load stats: {(statsError as Error).message}</div>
          </div>
        </div>
      )}

      {stats && !stats.backendAvailable && (
        <div
          className="mx-7 mt-4 border bg-card"
          style={{ borderRadius: "var(--radius)", padding: "14px 18px", boxShadow: "inset 3px 0 0 var(--amber)" }}
          data-testid="no-backend-banner"
        >
          <div className="flex items-start gap-2">
            <Warning style={{ width: 18, height: 18, color: "var(--amber)", flexShrink: 0 }} />
            <div className="text-sm text-foreground">
              Job queue unavailable — persistent retry and dead-letter data require <code className="font-mono">DATABASE_URL</code>.
              Circuit breaker state below is still accurate for the current process; queue stats are zero.
            </div>
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div className="px-7 pt-5 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          kicker="In flight"
          value={totalInFlight}
          icon={Lightning}
          tone="accent"
        />
        <StatTile
          kicker="Scheduled retries"
          value={totalScheduled}
          icon={Timer}
          tone="neutral"
        />
        <StatTile
          kicker="Dead-lettered"
          value={totalDead}
          icon={XCircle}
          tone={totalDead > 0 ? "destructive" : "neutral"}
        />
        <StatTile
          kicker="Delivered (24h)"
          value={totalDelivered24h}
          icon={CheckCircle}
          tone="sage"
        />
      </div>

      {/* Per-webhook table */}
      <div className="px-7 py-4">
        <div
          className="border bg-card"
          style={{ borderRadius: "var(--radius)", padding: "16px 20px" }}
          data-testid="per-webhook-table"
        >
          <div
            className="font-mono uppercase text-muted-foreground mb-3"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Per-webhook delivery health
          </div>
          {webhooks.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Plugs style={{ width: 32, height: 32, margin: "0 auto", opacity: 0.4 }} />
              <div className="mt-3 font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.14em" }}>
                No webhooks configured
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--secondary)" }}>
                    <Th label="URL" />
                    <Th label="Circuit" />
                    <Th label="In flight" numeric />
                    <Th label="Scheduled" numeric />
                    <Th label="Dead" numeric />
                    <Th label="Delivered 24h" numeric />
                    <Th label="Avg latency" numeric />
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.webhookId} style={{ borderBottom: "1px solid var(--border)" }} data-testid={`webhook-row-${w.webhookId}`}>
                      <td className="py-3 px-3 text-foreground truncate" style={{ maxWidth: 320 }} title={w.url}>
                        <span style={{ opacity: w.active ? 1 : 0.5 }}>{w.url}</span>
                      </td>
                      <td className="py-3 px-3">
                        <CircuitBadge state={w.circuit.state} failures={w.circuit.failureCount} />
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-muted-foreground">{w.inFlight}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-muted-foreground">{w.scheduledRetries}</td>
                      <td
                        className="py-3 px-3 text-right font-mono tabular-nums"
                        style={{ color: w.deadLettered > 0 ? "var(--destructive)" : "var(--muted-foreground)", fontWeight: w.deadLettered > 0 ? 500 : 400 }}
                      >
                        {w.deadLettered}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-muted-foreground">{w.delivered24h}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-muted-foreground">
                        {w.avgLatencyMs === null ? "—" : `${w.avgLatencyMs}ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Dead-letter list */}
      <div className="px-7 pb-10">
        <div
          className="border bg-card"
          style={{ borderRadius: "var(--radius)", padding: "16px 20px" }}
          data-testid="dead-letter-panel"
        >
          <div
            className="font-mono uppercase text-muted-foreground mb-3"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Dead-lettered deliveries · most recent {deadLetter?.jobs.length ?? 0}
          </div>
          {(!deadLetter || deadLetter.jobs.length === 0) ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No dead-lettered webhook deliveries.
            </div>
          ) : (
            <div className="space-y-2">
              {deadLetter.jobs.map((j) => (
                <div
                  key={j.id}
                  className="border border-border p-3 space-y-1.5"
                  style={{ borderRadius: "calc(var(--radius) - 2px)", boxShadow: "inset 2px 0 0 var(--destructive)" }}
                  data-testid={`dead-letter-${j.id}`}
                >
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-mono text-muted-foreground">{j.event}</span>
                    <span className="font-mono text-muted-foreground">·</span>
                    <span className="font-mono text-muted-foreground">
                      {j.attempts}/{j.maxAttempts} attempts
                    </span>
                    <span className="font-mono text-muted-foreground">·</span>
                    <span className="font-mono text-muted-foreground">{formatRelative(j.updatedAt)}</span>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate(j.id)}
                      disabled={retryMutation.isPending && retryMutation.variables === j.id}
                      data-testid={`dead-letter-retry-${j.id}`}
                    >
                      {retryMutation.isPending && retryMutation.variables === j.id ? "Retrying…" : "Retry"}
                    </Button>
                  </div>
                  {j.failedReason && (
                    <div className="text-xs font-mono" style={{ color: "var(--destructive)" }}>
                      {j.failedReason}
                    </div>
                  )}
                  {j.bodyPreview && (
                    <div
                      className="font-mono text-xs text-muted-foreground whitespace-pre-wrap"
                      style={{ background: "var(--secondary)", padding: "6px 8px", borderRadius: "calc(var(--radius) - 2px)" }}
                    >
                      {j.bodyPreview}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Inline UI helpers
// ──────────────────────────────────────────────────────────────

function StatTile({
  kicker, value, icon: Icon, tone,
}: {
  kicker: string; value: number;
  icon: typeof Lightning; tone: "accent" | "sage" | "amber" | "destructive" | "neutral";
}) {
  const toneColor = {
    accent: "var(--accent)", sage: "var(--sage)", amber: "var(--amber)",
    destructive: "var(--destructive)", neutral: "var(--muted-foreground)",
  }[tone];
  return (
    <div
      className="border bg-card"
      style={{ borderRadius: "var(--radius)", padding: "14px 18px", boxShadow: `inset 3px 0 0 ${toneColor}` }}
    >
      <div className="flex items-center gap-2">
        <Icon style={{ width: 16, height: 16, color: toneColor }} />
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {kicker}
        </span>
      </div>
      <div
        className="font-display font-medium text-foreground mt-1 tabular-nums"
        style={{ fontSize: 28, letterSpacing: "-0.3px", lineHeight: 1.1 }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ label, numeric }: { label: string; numeric?: boolean }) {
  return (
    <th
      className="font-mono uppercase text-muted-foreground"
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        padding: "10px 12px",
        fontWeight: 500,
        borderBottom: "1px solid var(--border)",
        textAlign: numeric ? "right" : "left",
      }}
    >
      {label}
    </th>
  );
}

function CircuitBadge({ state, failures }: { state: CircuitState; failures: number }) {
  const cfg = state === "open"
    ? { label: "OPEN", color: "var(--destructive)", bg: "color-mix(in oklch, var(--destructive), transparent 88%)" }
    : state === "half-open"
    ? { label: "HALF", color: "var(--amber)", bg: "color-mix(in oklch, var(--amber), transparent 88%)" }
    : { label: "OK", color: "var(--sage)", bg: "color-mix(in oklch, var(--sage), transparent 88%)" };
  return (
    <span
      className="font-mono uppercase tabular-nums inline-flex items-center gap-1.5"
      style={{
        fontSize: 10,
        letterSpacing: "0.12em",
        color: cfg.color,
        background: cfg.bg,
        padding: "2px 8px",
        borderRadius: "calc(var(--radius) - 2px)",
        fontWeight: 500,
      }}
    >
      {cfg.label}{failures > 0 && state !== "closed" ? ` · ${failures}` : ""}
    </span>
  );
}
