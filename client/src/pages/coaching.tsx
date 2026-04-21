import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "@phosphor-icons/react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Employee, CoachingSession as BaseCoachingSession } from "@shared/schema";
import CoachingPageShell from "@/components/coaching/page-shell";
import ManagerBoard from "@/components/coaching/manager-board";
import DetailPanel from "@/components/coaching/detail-panel";
import AssignModal, { type AssignPayload } from "@/components/coaching/assign-modal";

// Extends the strict shared schema with the `employeeName` field that
// GET /api/coaching enriches onto each row server-side (see
// server/routes/coaching.ts).
type CoachingSession = BaseCoachingSession & { employeeName?: string };

export default function CoachingPage() {
  const [showForm, setShowForm] = useState(false);
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // URL params for pre-filling from transcript viewer.
  // UUIDs are validated against /^[0-9a-f-]{36}$/i so a malformed query
  // (?employeeId=<script>) can't make it into the prefilled state and
  // get echoed unsanitized into form fields. Category is whitelisted.
  const urlParams = new URLSearchParams(window.location.search);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ALLOWED_CATEGORIES = new Set([
    "general",
    "compliance",
    "communication",
    "objection-handling",
    "rebuttal",
    "performance",
  ]);
  const rawEmployeeId = urlParams.get("employeeId") || "";
  const rawCallId = urlParams.get("callId") || "";
  const rawCategory = urlParams.get("category") || "general";
  const prefillEmployeeId = UUID_RE.test(rawEmployeeId) ? rawEmployeeId : "";
  const prefillCallId = UUID_RE.test(rawCallId) ? rawCallId : "";
  const prefillCategory = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : "general";

  useEffect(() => {
    if (urlParams.get("newSession") === "true") {
      setShowForm(true);
    }
  }, []);

  // Phase B: which grouping to show in the ranked table. Keyword toggle
  // above the table swaps between manager (who ran the coaching) and
  // employee (who was coached).
  const [groupBy, setGroupBy] = useState<"manager" | "employee">("manager");

  type SubScoreDeltas = {
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  };

  // Summary strip query — now carries sub-score deltas + a weekly
  // time-series for the sparkline. Phase B extends the endpoint, so
  // we ask for bucket=week on this call.
  const { data: outcomesSummary } = useQuery<{
    windowDays: number;
    totalSessions: number;
    measured: number;
    insufficientData: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    avgOverallDelta: number | null;
    avgSubDeltas?: SubScoreDeltas;
    timeSeries?: Array<{ bucketStart: string; measured: number; avgOverallDelta: number | null }>;
  }>({
    queryKey: ["/api/coaching/outcomes-summary", "bucket=week"],
    queryFn: async () => {
      const res = await fetch("/api/coaching/outcomes-summary?bucket=week", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load coaching outcomes");
      return res.json();
    },
  });

  // Grouped breakdown — toggleable between manager and employee. Two
  // separate keys keep cached data for each variant warm so toggling is
  // instant on re-select.
  const { data: outcomesByGroup } = useQuery<{
    windowDays: number;
    groupBy: "manager" | "employee";
    overall: { measured: number; avgOverallDelta: number | null };
    groups: Array<{
      key: string;
      label: string;
      totalSessions: number;
      measured: number;
      insufficientData: number;
      positiveCount: number;
      neutralCount: number;
      negativeCount: number;
      avgOverallDelta: number | null;
      avgSubDeltas?: SubScoreDeltas;
    }>;
  }>({
    queryKey: ["/api/coaching/outcomes-summary", `groupBy=${groupBy}`],
    queryFn: async () => {
      const res = await fetch(`/api/coaching/outcomes-summary?groupBy=${groupBy}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load ${groupBy} breakdown`);
      return res.json();
    },
  });

  const { data: sessions, isLoading, error: sessionsError } = useQuery<CoachingSession[]>({
    queryKey: ["/api/coaching"],
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/coaching/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
      toast({ title: "Session Updated" });
    },
  });

  // Action-item toggle — same endpoint the agent /my-coaching page uses.
  // `requireAuth` at the route level; managers can toggle any session.
  const toggleActionItemMutation = useMutation({
    mutationFn: async ({ id, index }: { id: string; index: number }) => {
      const { getCsrfToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/coaching/${id}/action-item/${index}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(getCsrfToken() ? { "x-csrf-token": getCsrfToken()! } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to toggle action item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
    },
  });

  // Create-new-session mutation — powers the Assign modal. Triggers
  // `coaching.created` webhook on the server side (same endpoint the
  // legacy CoachingForm used, which phase 6 deletes).
  const assignMutation = useMutation({
    mutationFn: async (payload: AssignPayload) => {
      const res = await apiRequest("POST", "/api/coaching", {
        ...payload,
        // Manager must appear as the assigner; server echoes
        // X-User-Name-style identity from the session, but the route
        // accepts an explicit `assignedBy` field too.
        assignedBy: "manager",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
      toast({ title: "Coaching session created" });
      setShowForm(false);
    },
  });

  const openedSession = useMemo(() => {
    if (!openedSessionId) return null;
    return (sessions || []).find((s) => s.id === openedSessionId) ?? null;
  }, [openedSessionId, sessions]);

  const openedSessionEmployeeName = useMemo(() => {
    if (!openedSession) return null;
    // Server enriches employeeName onto each session; fall back to
    // looking it up in the employees list if it's not there.
    if (openedSession.employeeName) return openedSession.employeeName;
    const emp = (employees || []).find((e) => e.id === openedSession.employeeId);
    return emp?.name ?? null;
  }, [openedSession, employees]);

  return (
    <CoachingPageShell active="manager">
      {outcomesSummary && outcomesSummary.measured > 0 && (
        <div
          className="mx-6 md:mx-10 mt-6 border bg-card"
          style={{
            borderRadius: "var(--radius)",
            boxShadow: "inset 3px 0 0 var(--accent)",
            padding: "16px 20px",
          }}
          data-testid="coaching-outcomes-summary"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Program effectiveness · last {outcomesSummary.windowDays} days
            </div>
            <div className="flex items-center gap-1">
              <a
                href="/api/coaching/outcomes-summary/export.csv"
                className="font-mono uppercase border border-border rounded-sm px-2 py-1 text-muted-foreground hover:bg-secondary transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
                data-testid="outcomes-download-csv"
              >
                CSV
              </a>
              <a
                href="/api/coaching/outcomes-summary/export.pdf"
                className="font-mono uppercase border border-border rounded-sm px-2 py-1 text-muted-foreground hover:bg-secondary transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
                data-testid="outcomes-download-pdf"
              >
                PDF
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mt-2">
            <div>
              <span
                className="font-display"
                style={{
                  fontSize: 28,
                  color:
                    outcomesSummary.avgOverallDelta !== null && outcomesSummary.avgOverallDelta > 0
                      ? "var(--sage)"
                      : outcomesSummary.avgOverallDelta !== null && outcomesSummary.avgOverallDelta < 0
                      ? "var(--destructive)"
                      : "var(--foreground)",
                }}
              >
                {outcomesSummary.avgOverallDelta === null
                  ? "—"
                  : `${outcomesSummary.avgOverallDelta > 0 ? "+" : ""}${outcomesSummary.avgOverallDelta.toFixed(2)}`}
              </span>
              <span className="font-mono text-xs text-muted-foreground ml-2">avg score delta</span>
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              <span style={{ color: "var(--sage)" }}>{outcomesSummary.positiveCount} up</span>
              {" · "}
              <span>{outcomesSummary.neutralCount} flat</span>
              {" · "}
              <span style={{ color: "var(--destructive)" }}>{outcomesSummary.negativeCount} down</span>
              {" · "}
              <span>
                {outcomesSummary.measured} of {outcomesSummary.totalSessions} sessions measured
                {outcomesSummary.insufficientData > 0
                  ? ` (${outcomesSummary.insufficientData} insufficient data)`
                  : ""}
              </span>
            </div>
            {/* Weekly sparkline — inline SVG so we don't pull in a chart lib for one viz. */}
            {outcomesSummary.timeSeries && outcomesSummary.timeSeries.length >= 2 && (
              <WeeklyDeltaSparkline series={outcomesSummary.timeSeries} />
            )}
          </div>
          {/* Sub-score deltas: which dimension moved most. Renders only when
              the backend returned values (requires measured > 0 sessions
              with sub-scores). Same color convention as the overall delta. */}
          {outcomesSummary.avgSubDeltas && (
            <div className="mt-3 pt-3 border-t border-border">
              <div
                className="font-mono uppercase text-muted-foreground mb-2"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                By sub-score
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                {(["compliance", "customerExperience", "communication", "resolution"] as const).map((k) => (
                  <SubScoreDeltaChip key={k} label={k === "customerExperience" ? "Cust exp" : k[0].toUpperCase() + k.slice(1)} value={outcomesSummary.avgSubDeltas?.[k] ?? null} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {outcomesByGroup && outcomesByGroup.groups.some((g) => g.measured > 0) && (
        <div
          className="mx-6 md:mx-10 mt-4 border bg-card"
          style={{ borderRadius: "var(--radius)", padding: "16px 20px" }}
          data-testid="coaching-outcomes-by-group"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              {groupBy === "manager" ? "By manager" : "By agent"} · last {outcomesByGroup.windowDays} days
            </div>
            <div className="flex items-center gap-1" data-testid="outcomes-group-toggle">
              {(["manager", "employee"] as const).map((mode) => {
                const active = groupBy === mode;
                const label = mode === "manager" ? "By manager" : "By agent";
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGroupBy(mode)}
                    aria-pressed={active}
                    className="font-mono uppercase border rounded-sm px-2.5 py-1 transition-colors"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background: active ? "var(--copper-soft)" : "transparent",
                      color: active ? "var(--foreground)" : "var(--muted-foreground)",
                      fontWeight: active ? 500 : 400,
                    }}
                    data-testid={`outcomes-group-${mode}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <div
              className="grid grid-cols-[1fr_80px_80px_100px] gap-3 font-mono uppercase text-muted-foreground pb-2 border-b"
              style={{ fontSize: 10, letterSpacing: "0.08em" }}
            >
              <span>{groupBy === "manager" ? "Manager" : "Agent"}</span>
              <span className="text-right">Sessions</span>
              <span className="text-right">Measured</span>
              <span className="text-right">Avg delta</span>
            </div>
            {outcomesByGroup.groups
              .filter((g) => g.totalSessions > 0)
              .slice(0, 10)
              .map((g) => (
                <div
                  key={g.key}
                  className="grid grid-cols-[1fr_80px_80px_100px] gap-3 py-2 text-sm border-b last:border-b-0"
                >
                  <span className="text-foreground truncate" title={g.label}>{g.label}</span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {g.totalSessions}
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted-foreground">
                    {g.measured}
                  </span>
                  <span
                    className="text-right font-mono tabular-nums"
                    style={{
                      color:
                        g.avgOverallDelta === null
                          ? "var(--muted-foreground)"
                          : g.avgOverallDelta > 0
                          ? "var(--sage)"
                          : g.avgOverallDelta < 0
                          ? "var(--destructive)"
                          : "var(--foreground)",
                    }}
                  >
                    {g.avgOverallDelta === null
                      ? "—"
                      : `${g.avgOverallDelta > 0 ? "+" : ""}${g.avgOverallDelta.toFixed(2)}`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="px-6 md:px-10 py-8 text-center text-muted-foreground">
          Loading coaching sessions...
        </div>
      ) : sessionsError ? (
        <div className="px-6 md:px-10 py-12 text-center text-destructive">
          <X className="w-8 h-8 mx-auto mb-2" />
          <p className="font-semibold">Failed to load coaching sessions</p>
          <p className="text-sm text-muted-foreground">{sessionsError.message}</p>
        </div>
      ) : (
        <ManagerBoard
          sessions={sessions || []}
          employees={(employees || []).filter((e) => e.status === "Active")}
          onAssignNew={() => setShowForm(true)}
          onOpenDetail={(id) => setOpenedSessionId(id)}
        />
      )}

      <DetailPanel
        session={openedSession}
        employeeName={openedSessionEmployeeName}
        canManage
        togglePending={updateMutation.isPending || toggleActionItemMutation.isPending}
        onClose={() => setOpenedSessionId(null)}
        onUpdateStatus={(sessionId, status) =>
          updateMutation.mutate({ id: sessionId, updates: { status } })
        }
        onToggleActionItem={(sessionId, index) =>
          toggleActionItemMutation.mutate({ id: sessionId, index })
        }
      />

      <AssignModal
        open={showForm}
        onClose={() => setShowForm(false)}
        employees={(employees || []).filter((e) => e.status === "Active")}
        prefillEmployeeId={prefillEmployeeId || undefined}
        prefillCallId={prefillCallId || undefined}
        prefillCategory={prefillCategory || undefined}
        submitPending={assignMutation.isPending}
        submitError={
          assignMutation.isError
            ? (assignMutation.error as Error)?.message || "Could not create session"
            : null
        }
        onSubmit={(payload) => {
          assignMutation.mutate(payload);
        }}
      />
    </CoachingPageShell>
  );
}

// ──────────────────────────────────────────────────────────────
// Phase B UI helpers — inline so we don't spawn a new primitives
// module for a single consumer. Promote if a second caller appears.
// ──────────────────────────────────────────────────────────────

function SubScoreDeltaChip({ label, value }: { label: string; value: number | null }) {
  const color =
    value === null
      ? "var(--muted-foreground)"
      : value > 0.1
      ? "var(--sage)"
      : value < -0.1
      ? "var(--destructive)"
      : "var(--foreground)";
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.1em" }}
      >
        {label}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{ fontSize: 13, color, fontWeight: 500 }}
      >
        {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}
      </span>
    </div>
  );
}

function WeeklyDeltaSparkline({
  series,
}: {
  series: Array<{ bucketStart: string; measured: number; avgOverallDelta: number | null }>;
}) {
  // Filter to buckets that have a measurable delta. Under-3-calls weeks
  // are pruned by the backend's `measured > 0` guard, which also skips
  // insufficient-data weeks from the series.
  const points = series.filter((p) => p.avgOverallDelta !== null);
  if (points.length < 2) return null;
  const values = points.map((p) => p.avgOverallDelta as number);
  const min = Math.min(...values, -0.5);
  const max = Math.max(...values, 0.5);
  const span = max - min || 1;
  const W = 120;
  const H = 28;
  const pad = 2;
  const coord = (i: number, v: number) => ({
    x: (i / (points.length - 1)) * (W - pad * 2) + pad,
    y: H - pad - ((v - min) / span) * (H - pad * 2),
  });
  const path = points
    .map((p, i) => {
      const { x, y } = coord(i, p.avgOverallDelta as number);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1].avgOverallDelta as number;
  const lineColor = last >= 0 ? "var(--sage)" : "var(--destructive)";
  return (
    <div
      className="flex items-center gap-2"
      title={`Weekly trend: ${points.length} weeks`}
      data-testid="outcomes-sparkline"
    >
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        Trend
      </span>
      <svg width={W} height={H} aria-hidden>
        {/* zero baseline */}
        <line
          x1={pad}
          x2={W - pad}
          y1={coord(0, 0).y}
          y2={coord(0, 0).y}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <path d={path} fill="none" stroke={lineColor} strokeWidth={1.5} />
        {points.map((p, i) => {
          const { x, y } = coord(i, p.avgOverallDelta as number);
          return <circle key={p.bucketStart} cx={x} cy={y} r={1.5} fill={lineColor} />;
        })}
      </svg>
    </div>
  );
}
