import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  CaretDown,
  CaretUp,
  CheckCircle,
  Circle,
  ClipboardText,
  Clock,
  Eye,
  User,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { CoachingSession } from "@shared/schema";

interface MyCoachingData {
  employee: { id: string; name: string } | null;
  coaching: CoachingSession[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  dismissed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  compliance: "Compliance",
  customer_experience: "Customer Experience",
  communication: "Communication",
  resolution: "Resolution",
  general: "General",
  performance: "Performance",
  recognition: "Recognition",
};

/**
 * Agent-facing coaching page.
 * Shows the agent's coaching sessions with action items they can check off,
 * organized as a timeline with filtering by status.
 */
export default function MyCoachingPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "completed">("active");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: myData, isLoading } = useQuery<MyCoachingData>({
    queryKey: ["/api/my-performance"],
    queryFn: async () => {
      const res = await fetch("/api/my-performance", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch coaching data");
      return res.json();
    },
  });

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

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sessions = (myData?.coaching || [])
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const filtered = sessions.filter(s => {
    if (filter === "active") return s.status === "pending" || s.status === "in_progress";
    if (filter === "completed") return s.status === "completed";
    return true;
  });

  const activeCount = sessions.filter(s => s.status === "pending" || s.status === "in_progress").length;
  const completedCount = sessions.filter(s => s.status === "completed").length;
  const totalActionItems = sessions.reduce((sum, s) => sum + (s.actionPlan?.length || 0), 0);
  const completedActionItems = sessions.reduce(
    (sum, s) => sum + (s.actionPlan?.filter((a: any) => a.completed).length || 0),
    0
  );

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ClipboardText className="w-6 h-6" />
          My Coaching
        </h2>
        <p className="text-muted-foreground">
          Your coaching sessions, action items, and development timeline
        </p>
      </header>

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : !myData?.employee ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No employee profile linked</p>
              <p className="text-sm mt-1">Ask your manager to link your account to an employee profile to see your coaching data.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Active Sessions</p>
                  <p className="text-2xl font-bold text-blue-600">{activeCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Action Items Done</p>
                  <p className="text-2xl font-bold">{completedActionItems}/{totalActionItems}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Total Sessions</p>
                  <p className="text-2xl font-bold">{sessions.length}</p>
                </CardContent>
              </Card>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2">
              {(["active", "all", "completed"] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                >
                  {f === "active" ? `Active (${activeCount})` : f === "completed" ? `Completed (${completedCount})` : `All (${sessions.length})`}
                </Button>
              ))}
            </div>

            {/* Session timeline */}
            {filtered.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <ClipboardText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>{filter === "active" ? "No active coaching sessions." : filter === "completed" ? "No completed sessions yet." : "No coaching sessions."}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered.map(session => {
                  const isExpanded = expandedIds.has(session.id);
                  const actionPlan = (session.actionPlan || []) as Array<{ task: string; completed: boolean }>;
                  const doneCount = actionPlan.filter(a => a.completed).length;

                  return (
                    <Card key={session.id} className="transition-shadow hover:shadow-md">
                      <CardHeader
                        className="cursor-pointer pb-2"
                        onClick={() => toggle(session.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base flex items-center gap-2">
                              {session.title || "Coaching Session"}
                              {isExpanded ? <CaretUp className="w-4 h-4" /> : <CaretDown className="w-4 h-4" />}
                            </CardTitle>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge className={STATUS_COLORS[session.status] || ""} variant="secondary">
                                {session.status === "in_progress" ? "In Progress" : session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                              </Badge>
                              <Badge variant="outline">
                                {CATEGORY_LABELS[session.category] || session.category}
                              </Badge>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : ""}
                              </span>
                              {session.assignedBy && (
                                <span className="text-xs text-muted-foreground">
                                  by {session.assignedBy}
                                </span>
                              )}
                            </div>
                          </div>
                          {actionPlan.length > 0 && (
                            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap ml-2">
                              {doneCount}/{actionPlan.length} done
                            </span>
                          )}
                        </div>
                      </CardHeader>

                      {isExpanded && (
                        <CardContent className="pt-0 space-y-3">
                          {session.notes && (
                            <div className="bg-muted/50 rounded-lg p-3 text-sm">
                              <p className="text-muted-foreground whitespace-pre-wrap">{session.notes}</p>
                            </div>
                          )}

                          {actionPlan.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-sm font-medium">Action Items</p>
                              {actionPlan.map((item, idx) => (
                                <button
                                  key={idx}
                                  className="flex items-start gap-2 w-full text-left p-2 rounded hover:bg-muted transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleActionItem.mutate({ sessionId: session.id, index: idx });
                                  }}
                                  disabled={toggleActionItem.isPending}
                                >
                                  {item.completed ? (
                                    <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" weight="fill" />
                                  ) : (
                                    <Circle className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  )}
                                  <span className={`text-sm ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                                    {item.task}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {session.callId && (
                            <Link href={`/transcripts/${session.callId}`}>
                              <span className="inline-flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer">
                                <Eye className="w-4 h-4" />
                                View related call
                              </span>
                            </Link>
                          )}

                          {session.dueDate && (
                            <p className="text-xs text-muted-foreground">
                              Due: {new Date(session.dueDate).toLocaleDateString()}
                            </p>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
