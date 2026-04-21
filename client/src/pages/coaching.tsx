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

  const { data: outcomesSummary } = useQuery<{
    windowDays: number;
    totalSessions: number;
    measured: number;
    insufficientData: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    avgOverallDelta: number | null;
  }>({
    queryKey: ["/api/coaching/outcomes-summary"],
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
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Program effectiveness · last {outcomesSummary.windowDays} days
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
