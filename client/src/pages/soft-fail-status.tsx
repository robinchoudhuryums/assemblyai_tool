/**
 * Soft-fail operator status dashboard (admin-only).
 *
 * Enumerates the silent-degradation conditions listed in CLAUDE.md's
 * Operator State Checklist and shows their live state. Complements
 * /admin/health (runtime signals: queue, breaker, cache) by covering
 * config-time and boot-time gates that don't surface in runtime health —
 * missing AWS creds, absent prompt templates, RAG misconfigured,
 * pgvector unavailable, MFA enforcement without enrolled admins,
 * unlinked viewer accounts.
 *
 * Refreshes on a 30s poll. No SSE/WebSocket because nothing mutates
 * here that isn't covered by other admin surfaces.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Warning, XCircle, Question, ArrowsClockwise } from "@phosphor-icons/react";
import { Link } from "wouter";

type Status = "ok" | "warning" | "error" | "unknown";
type Category = "credentials" | "storage" | "ai" | "auth" | "data" | "runtime";

interface Check {
  id: string;
  label: string;
  category: Category;
  status: Status;
  message: string;
  fixHint?: string;
}

interface SoftFailResponse {
  overall: Status;
  counts: { ok: number; warning: number; error: number; unknown: number };
  checks: Check[];
  generatedAt: string;
}

const CATEGORY_LABELS: Record<Category, string> = {
  credentials: "Credentials & env",
  storage: "Storage",
  ai: "AI & RAG",
  auth: "Auth & MFA",
  data: "Seed data",
  runtime: "Runtime signals",
};

function StatusPill({ status }: { status: Status }) {
  const map = {
    ok: { Icon: CheckCircle, color: "var(--sage)", bg: "var(--sage-soft)", label: "OK" },
    warning: { Icon: Warning, color: "var(--amber)", bg: "var(--amber-soft)", label: "Warn" },
    error: { Icon: XCircle, color: "var(--destructive)", bg: "var(--warm-red-soft)", label: "Error" },
    unknown: { Icon: Question, color: "var(--muted-foreground)", bg: "var(--muted)", label: "Unknown" },
  } as const;
  const { Icon, color, bg, label } = map[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono uppercase rounded-sm px-2 py-0.5"
      style={{
        fontSize: 9,
        letterSpacing: "0.12em",
        color,
        background: bg,
        border: `1px solid color-mix(in oklch, ${color}, transparent 60%)`,
      }}
    >
      <Icon className="w-3 h-3" weight="fill" />
      {label}
    </span>
  );
}

export default function SoftFailStatusPage() {
  const { data, isLoading, isFetching, refetch } = useQuery<SoftFailResponse>({
    queryKey: ["/api/admin/soft-fail-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/soft-fail-status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load operator status");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* App bar */}
      <div className="flex items-center justify-between px-4 sm:px-7 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="font-mono uppercase text-muted-foreground hover:text-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Admin
          </Link>
          <span className="text-muted-foreground" style={{ fontSize: 10 }}>›</span>
          <span
            className="font-mono uppercase text-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Operator status
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="font-mono uppercase border border-border rounded-sm px-3 py-1.5 hover:bg-secondary transition-colors flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          data-testid="soft-fail-refresh"
        >
          <ArrowsClockwise
            className="w-3 h-3"
            style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }}
          />
          Refresh
        </button>
      </div>

      <div className="px-4 sm:px-7 py-10 max-w-5xl mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2"
          >
            Admin · Silent-degradation checks
          </div>
          <h1
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 36, letterSpacing: "-0.5px", lineHeight: 1.1 }}
          >
            Is anything quietly broken?
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">
            Enumerates the config-time and seed-time gates in CLAUDE.md's Operator
            State Checklist. Each item is a condition that could leave the app
            looking healthy while a feature silently fails. Complements
            {" "}
            <Link href="/admin/health" className="underline hover:text-foreground">
              /admin/health
            </Link>
            {" "}which covers runtime signals (job queue, circuit breakers, cache).
          </p>
        </div>

        {/* Summary strip */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {(["ok", "warning", "error", "unknown"] as const).map((s) => {
              const count = data.counts[s];
              const color =
                s === "ok" ? "var(--sage)" :
                s === "warning" ? "var(--amber)" :
                s === "error" ? "var(--destructive)" :
                "var(--muted-foreground)";
              const label = s === "ok" ? "OK" : s === "warning" ? "Warnings" : s === "error" ? "Errors" : "Unknown";
              return (
                <div
                  key={s}
                  className="bg-card border border-border rounded-sm p-4"
                  style={{ borderLeft: `3px solid ${color}` }}
                  data-testid={`soft-fail-summary-${s}`}
                >
                  <div
                    className="font-mono uppercase text-muted-foreground mb-1"
                    style={{ fontSize: 10, letterSpacing: "0.14em" }}
                  >
                    {label}
                  </div>
                  <div
                    className="font-display font-medium tabular-nums"
                    style={{ fontSize: 32, color }}
                  >
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Loading checks…
          </div>
        )}

        {data && data.checks.length > 0 && (() => {
          // Group checks by category, preserving overall order.
          const byCategory: Record<Category, Check[]> = {
            credentials: [], storage: [], ai: [], auth: [], data: [], runtime: [],
          };
          for (const c of data.checks) byCategory[c.category].push(c);

          return (
            <div className="space-y-10">
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => {
                const items = byCategory[cat];
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div
                      className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-3"
                    >
                      {CATEGORY_LABELS[cat]}
                    </div>
                    <div className="bg-card border border-border">
                      {items.map((c, i) => (
                        <div
                          key={c.id}
                          className="px-5 py-4 flex items-start gap-4"
                          style={{
                            borderTop: i > 0 ? "1px solid var(--border)" : "none",
                          }}
                          data-testid={`soft-fail-check-${c.id}`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            <StatusPill status={c.status} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-display font-medium text-foreground" style={{ fontSize: 14 }}>
                              {c.label}
                            </div>
                            <div className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                              {c.message}
                            </div>
                            {c.fixHint && c.status !== "ok" && (
                              <div
                                className="mt-2 text-xs flex items-start gap-1.5"
                                style={{ color: "color-mix(in oklch, var(--foreground), var(--muted) 30%)" }}
                              >
                                <span
                                  className="font-mono uppercase"
                                  style={{ fontSize: 9, letterSpacing: "0.12em", opacity: 0.7 }}
                                >
                                  Fix
                                </span>
                                <span>{c.fixHint}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {data && (
          <div className="text-xs text-muted-foreground mt-10 text-right">
            Generated {new Date(data.generatedAt).toLocaleString()} · auto-refresh every 30s
          </div>
        )}
      </div>
    </div>
  );
}
