import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, CaretDown, CaretUp, CheckCircle, ClipboardText, Clock, Eye, Plus, User, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import { apiRequest } from "@/lib/queryClient";
import type { Employee } from "@shared/schema";
import { COACHING_CATEGORIES } from "@shared/schema";

interface CoachingSession {
  id: string;
  employeeId: string;
  employeeName?: string;
  callId?: string;
  assignedBy: string;
  category: string;
  title: string;
  notes?: string;
  actionPlan?: Array<{ task: string; completed: boolean }>;
  status: "pending" | "in_progress" | "completed" | "dismissed";
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
}

interface CoachingOutcome {
  coachingSessionId: string;
  employeeId: string;
  coachingCreatedAt: string;
  windowSize: number;
  minWindow: number;
  insufficientData: boolean;
  before: {
    callCount: number;
    avgScore: number | null;
    subScores: {
      compliance: number | null;
      customerExperience: number | null;
      communication: number | null;
      resolution: number | null;
    };
  };
  after: {
    callCount: number;
    avgScore: number | null;
    subScores: {
      compliance: number | null;
      customerExperience: number | null;
      communication: number | null;
      resolution: number | null;
    };
  };
  deltas: {
    overall: number | null;
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  };
}

function OutcomeWidget({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const { data, isLoading, error } = useQuery<CoachingOutcome>({
    queryKey: ["/api/coaching", sessionId, "outcome"],
    enabled,
  });

  if (!enabled) return null;
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading outcome...</p>;
  if (error || !data) return null;

  const formatDelta = (d: number | null): { text: string; cls: string } => {
    if (d === null) return { text: "—", cls: "text-muted-foreground" };
    const sign = d > 0 ? "+" : "";
    const cls = d > 0.1 ? "text-green-600 dark:text-green-400" : d < -0.1 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
    return { text: `${sign}${d.toFixed(2)}`, cls };
  };

  const fmtScore = (s: number | null) => s === null ? "—" : s.toFixed(2);
  const overallD = formatDelta(data.deltas.overall);

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Coaching Outcome <span className="text-muted-foreground/70">(last {data.before.callCount} vs next {data.after.callCount} calls, window size {data.windowSize})</span>
      </p>
      {data.insufficientData ? (
        <p className="text-xs text-muted-foreground">
          Insufficient data to measure outcome — need at least {data.minWindow} calls in each window.
        </p>
      ) : (
        <div className="grid grid-cols-5 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground mb-0.5">Overall</div>
            <div className="font-medium">{fmtScore(data.before.avgScore)} → {fmtScore(data.after.avgScore)}</div>
            <div className={`text-xs font-semibold ${overallD.cls}`}>{overallD.text}</div>
          </div>
          {(["compliance", "customerExperience", "communication", "resolution"] as const).map(key => {
            const d = formatDelta(data.deltas[key]);
            const label = key === "customerExperience" ? "CX" : key.charAt(0).toUpperCase() + key.slice(1);
            return (
              <div key={key}>
                <div className="text-muted-foreground mb-0.5">{label}</div>
                <div className="font-medium">{fmtScore(data.before.subScores[key])} → {fmtScore(data.after.subScores[key])}</div>
                <div className={`text-xs font-semibold ${d.cls}`}>{d.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CoachingPage() {
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const filtered = useMemo(() => (sessions || []).filter(s => {
    if (statusFilter === "active" && (s.status === "completed" || s.status === "dismissed")) return false;
    if (statusFilter === "completed" && s.status !== "completed") return false;
    if (employeeFilter !== "all" && s.employeeId !== employeeFilter) return false;
    return true;
  }), [sessions, statusFilter, employeeFilter]);

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  };

  const categoryLabel = (cat: string) => COACHING_CATEGORIES.find(c => c.value === cat)?.label || cat;

  return (
    <div className="min-h-screen" data-testid="coaching-page">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardText className="w-6 h-6" /> Coaching & Action Plans
          </h2>
          <p className="text-muted-foreground">Assign coaching sessions from flagged calls and track agent improvement.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-2" />
          New Session
        </Button>
      </header>

      {showForm && (
        <div className="bg-card border-b border-border px-6 py-4">
          <CoachingForm
            employees={employees || []}
            onClose={() => setShowForm(false)}
            prefillEmployeeId={prefillEmployeeId}
            prefillCallId={prefillCallId}
            prefillCategory={prefillCategory}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border-b border-border px-6 py-3 flex gap-3 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Employees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Employees</SelectItem>
            {employees?.filter(e => e.status === "Active").map(emp => (
              <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <main className="p-6 space-y-3">
        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">Loading coaching sessions...</div>
        )}

        {sessionsError && (
          <div className="text-center py-12 text-destructive">
            <X className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">Failed to load coaching sessions</p>
            <p className="text-sm text-muted-foreground">{sessionsError.message}</p>
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16">
            <ClipboardText className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h4 className="font-semibold text-foreground mb-1">No coaching sessions</h4>
            <p className="text-sm text-muted-foreground mb-4">Create coaching sessions from flagged calls or add them manually.</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Create First Session
            </Button>
          </div>
        )}

        {filtered.map(session => {
          const isExpanded = expandedId === session.id;
          const completedTasks = (session.actionPlan || []).filter(t => t.completed).length;
          const totalTasks = (session.actionPlan || []).length;
          const isOverdue = session.dueDate && new Date(session.dueDate) < new Date() && session.status !== "completed";

          return (
            <div key={session.id} className={`bg-card rounded-lg border ${isOverdue ? "border-red-300 dark:border-red-800" : "border-border"} overflow-hidden`}>
              <div
                className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : session.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-foreground truncate">{session.title}</h4>
                    <Badge className={`text-xs ${statusColors[session.status]}`}>
                      {session.status.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{categoryLabel(session.category)}</Badge>
                    {isOverdue && <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 text-xs">Overdue</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" /> {session.employeeName || "Unknown"}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : "—"}</span>
                    {session.dueDate && <span>Due: {new Date(session.dueDate).toLocaleDateString()}</span>}
                    {totalTasks > 0 && <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {completedTasks}/{totalTasks} tasks</span>}
                    <span>Assigned by: {session.assignedBy}</span>
                  </div>
                </div>
                {totalTasks > 0 && (
                  <div className="w-20">
                    <div className="w-full h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400" style={{ width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}
                {isExpanded ? <CaretUp className="w-4 h-4 text-muted-foreground" /> : <CaretDown className="w-4 h-4 text-muted-foreground" />}
              </div>

              {isExpanded && (
                <div className="px-5 pb-4 pt-0 border-t border-border space-y-3">
                  {session.notes && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm text-foreground">{session.notes}</p>
                    </div>
                  )}

                  {session.callId && (
                    <Link href={`/transcripts/${session.callId}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" /> View Referenced Call
                    </Link>
                  )}

                  <OutcomeWidget sessionId={session.id} enabled={isExpanded} />

                  {totalTasks > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Action Plan</p>
                      <div className="space-y-1.5">
                        {session.actionPlan!.map((task, i) => (
                          <label key={i} className="flex items-center gap-2 text-sm cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={task.completed}
                              onChange={() => {
                                const newPlan = [...session.actionPlan!];
                                newPlan[i] = { ...newPlan[i], completed: !newPlan[i].completed };
                                updateMutation.mutate({ id: session.id, updates: { actionPlan: newPlan } });
                              }}
                              className="rounded"
                            />
                            <span className={task.completed ? "line-through text-muted-foreground" : "text-foreground"}>{task.task}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    {session.status === "pending" && (
                      <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: session.id, updates: { status: "in_progress" } })}>
                        <Clock className="w-3 h-3 mr-1" /> Start
                      </Button>
                    )}
                    {(session.status === "pending" || session.status === "in_progress") && (
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: session.id, updates: { status: "completed" } })}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Complete
                      </Button>
                    )}
                    {session.status !== "dismissed" && session.status !== "completed" && (
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => updateMutation.mutate({ id: session.id, updates: { status: "dismissed" } })}>
                        <X className="w-3 h-3 mr-1" /> Dismiss
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}

function CoachingForm({ employees, onClose, prefillEmployeeId, prefillCallId, prefillCategory }: {
  employees: Employee[];
  onClose: () => void;
  prefillEmployeeId?: string;
  prefillCallId?: string;
  prefillCategory?: string;
}) {
  const [employeeId, setEmployeeId] = useState(prefillEmployeeId || "");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(prefillCategory || "general");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [callId, setCallId] = useState(prefillCallId || "");
  const [tasks, setTasks] = useState<string[]>([""]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Warn before navigating away with unsaved form data
  useBeforeUnload(title.trim().length > 0 || notes.trim().length > 0);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/coaching", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching"] });
      toast({ title: "Coaching Session Created" });
      onClose();
    },
    onError: (error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!employeeId || !title.trim()) return;
    const actionPlan = tasks.filter(t => t.trim()).map(t => ({ task: t.trim(), completed: false }));
    createMutation.mutate({
      employeeId,
      title: title.trim(),
      category,
      notes: notes.trim() || undefined,
      dueDate: dueDate || undefined,
      callId: callId.trim() || undefined,
      actionPlan: actionPlan.length > 0 ? actionPlan : undefined,
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div>
        <Label className="text-xs">Employee *</Label>
        <Select value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger>
            <SelectValue placeholder="Select employee" />
          </SelectTrigger>
          <SelectContent>
            {employees.filter(e => e.status === "Active").map(emp => (
              <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COACHING_CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Improve compliance on outbound calls" />
      </div>
      <div>
        <Label className="text-xs">Due Date</Label>
        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Referenced Call ID (optional)</Label>
        <Input value={callId} onChange={e => setCallId(e.target.value)} placeholder="Paste call ID from a flagged call" />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Notes</Label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Context or instructions for this coaching session..."
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs">Action Plan Tasks</Label>
        <div className="space-y-1.5">
          {tasks.map((task, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={task}
                onChange={e => {
                  const newTasks = [...tasks];
                  newTasks[i] = e.target.value;
                  setTasks(newTasks);
                }}
                placeholder={`Task ${i + 1}`}
                className="flex-1"
              />
              {tasks.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setTasks([...tasks, ""])}>
            <Plus className="w-3 h-3 mr-1" /> Add Task
          </Button>
        </div>
      </div>
      <div className="md:col-span-2 flex gap-2">
        <Button onClick={handleSubmit} disabled={!employeeId || !title.trim() || createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create Session"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
