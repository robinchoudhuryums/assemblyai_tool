import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { User } from "@phosphor-icons/react";
import type { CoachingSession } from "@shared/schema";
import CoachingPageShell from "@/components/coaching/page-shell";
import AgentInbox from "@/components/coaching/agent-inbox";
import DetailPanel from "@/components/coaching/detail-panel";

interface MyCoachingData {
  employee: { id: string; name: string } | null;
  coaching: CoachingSession[];
  currentStreak: number;
  weeklyTrend: Array<{ week: string; avgScore: number; count: number }>;
}

interface AuthUser {
  id: string;
  username?: string;
  name?: string;
  role?: string;
}

/**
 * Agent-facing coaching page. Phase 5 installment — click an InboxRow
 * or the Next-action card to open a slide-in DetailPanel (replaces the
 * phase-3 inline expand).
 *
 * Data fetch + mutations stay here so useBeforeUnload-style invariants
 * stay with the page; AgentInbox + DetailPanel are presentational.
 */
export default function MyCoachingPage() {
  const queryClient = useQueryClient();
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);

  const { data: myData, isLoading } = useQuery<MyCoachingData>({
    queryKey: ["/api/my-performance"],
    queryFn: async () => {
      const res = await fetch("/api/my-performance", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch coaching data");
      return res.json();
    },
  });

  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });

  const toggleActionItem = useMutation({
    mutationFn: async ({ sessionId, index }: { sessionId: string; index: number }) => {
      const { getCsrfToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/coaching/${sessionId}/action-item/${index}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/my-performance"] });
    },
  });

  const openedSession =
    openedSessionId && myData?.coaching
      ? myData.coaching.find((s) => s.id === openedSessionId) ?? null
      : null;

  return (
    <CoachingPageShell active="agent">
      {isLoading ? (
        <div className="p-8 space-y-3 max-w-6xl mx-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !myData?.employee ? (
        <div className="p-8 max-w-xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No employee profile linked</p>
              <p className="text-sm mt-1">
                Ask your manager to link your account to an employee profile to see your coaching data.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <AgentInbox
          data={{
            employee: myData.employee,
            coaching: myData.coaching ?? [],
            currentStreak: myData.currentStreak ?? 0,
            weeklyTrend: myData.weeklyTrend ?? [],
          }}
          meName={me?.name}
          onOpenDetail={(id) => setOpenedSessionId(id)}
        />
      )}

      <DetailPanel
        session={openedSession}
        employeeName={myData?.employee?.name}
        canManage={false}
        togglePending={toggleActionItem.isPending}
        onClose={() => setOpenedSessionId(null)}
        onToggleActionItem={(sessionId, index) =>
          toggleActionItem.mutate({ sessionId, index })
        }
      />
    </CoachingPageShell>
  );
}
