import { useState, useMemo, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowCounterClockwise, ArrowDown, ArrowUp, ArrowsDownUp, BookmarkSimple, CaretLeft, CaretRight, CheckSquare, DownloadSimple, Eye, FileArrowDown, FileAudio, Pause, Play, ShieldStar, Square, Star, Trash, Trophy, UserCheck, Warning, Waveform, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { CallWithDetails, Employee, PaginatedCalls } from "@shared/schema";

import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/lib/confirm-dialog";
import { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE, SCORE_EXCELLENT, SCORE_GOOD, SCORE_NEEDS_WORK } from "@/lib/constants";
import { useTranslation } from "@/lib/i18n";
import { loadSavedFilters, saveSavedFilter, deleteSavedFilter, type SavedFilter } from "@/lib/saved-filters";
import { Input } from "@/components/ui/input";

type SortField = "date" | "duration" | "score" | "sentiment";
type SortDir = "asc" | "desc";

/**
 * Warm-paper table header cell: mono 10px uppercase, muted-foreground,
 * optional sortable button. Numeric columns right-align both header and
 * cell content.
 */
function HeaderCell({
  label,
  sortField,
  currentSort,
  dir,
  onSort,
  numeric,
}: {
  label: string;
  sortField?: SortField;
  currentSort?: SortField;
  dir?: SortDir;
  onSort?: (f: SortField) => void;
  numeric?: boolean;
}) {
  const sortable = !!sortField && !!onSort;
  const active = sortable && sortField === currentSort;
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
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(sortField!)}
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors uppercase font-mono"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          {label}
          {active && (
            <span aria-hidden="true" style={{ opacity: 0.6 }}>
              {dir === "desc" ? "▼" : "▲"}
            </span>
          )}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export default function CallsTable() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  // Saved filters
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");

  const handleSaveFilter = () => {
    if (!newFilterName.trim()) return;
    const saved = saveSavedFilter({
      name: newFilterName.trim(),
      status: statusFilter,
      sentiment: sentimentFilter,
      employee: employeeFilter,
    });
    setSavedFilters(prev => [...prev, saved]);
    setNewFilterName("");
    setShowSaveDialog(false);
  };

  const handleLoadFilter = (filter: SavedFilter) => {
    setStatusFilter(filter.status);
    setSentimentFilter(filter.sentiment);
    setEmployeeFilter(filter.employee);
  };

  const handleDeleteFilter = (id: string) => {
    deleteSavedFilter(id);
    setSavedFilters(prev => prev.filter(f => f.id !== id));
  };

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirm dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; callId?: string; bulk?: boolean }>({ open: false });

  // Inline audio preview state for the row-level Play button. A single
  // shared HTMLAudioElement is created on first use so multiple rows never
  // play simultaneously. Paused on unmount.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);
  const togglePlay = (callId: string) => {
    if (playingId === callId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => setPlayingId(null));
      audioRef.current.addEventListener("pause", () => {
        // Only clear when the pause wasn't triggered by us swapping src.
        if (audioRef.current?.ended) setPlayingId(null);
      });
    }
    audioRef.current.src = `/api/calls/${callId}/audio`;
    audioRef.current.play()
      .then(() => setPlayingId(callId))
      .catch((err) => {
        setPlayingId(null);
        toast({
          title: "Couldn't play audio",
          description: err?.message || "The audio file may be missing or unavailable.",
          variant: "destructive",
        });
      });
  };

  const handleDownloadAudio = (call: CallWithDetails) => {
    // Temp anchor with `download` attr triggers save-as without navigating
    // away from the page. `?download=true` makes the server set
    // Content-Disposition: attachment so the filename sticks.
    const a = document.createElement("a");
    a.href = `/api/calls/${call.id}/audio?download=true`;
    a.download = call.fileName || `call-${call.id}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Cursor-based pagination state
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allLoadedCalls, setAllLoadedCalls] = useState<CallWithDetails[]>([]);

  const filterParams = useMemo(() => ({
    status: statusFilter === "all" ? "" : statusFilter,
    sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
    employee: employeeFilter === "all" ? "" : employeeFilter,
  }), [statusFilter, sentimentFilter, employeeFilter]);

  const { data: callsResponse, isLoading: isLoadingCalls, isFetching, error: callsError, refetch: refetchCalls } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", { ...filterParams, cursor, mode: "cursor" }],
  });

  // Reset accumulated calls when filters change
  useEffect(() => {
    setCursor(undefined);
    setAllLoadedCalls([]);
  }, [filterParams.status, filterParams.sentiment, filterParams.employee]);

  // Accumulate loaded pages
  useEffect(() => {
    if (callsResponse?.calls) {
      if (!cursor) {
        // First page or filter change — replace
        setAllLoadedCalls(callsResponse.calls);
      } else {
        // Subsequent page — append, deduplicate by id
        setAllLoadedCalls(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newCalls = callsResponse.calls.filter(c => !existingIds.has(c.id));
          return [...prev, ...newCalls];
        });
      }
    }
  }, [callsResponse, cursor]);

  const calls = allLoadedCalls;
  const hasMore = callsResponse?.hasMore ?? false;
  const nextCursor = callsResponse?.nextCursor ?? null;

  const { data: employees, isLoading: isLoadingEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const deleteMutation = useMutation({
    mutationFn: (callId: string) => apiRequest("DELETE", `/api/calls/${callId}`),
    onSuccess: () => {
      toast({
        title: "Call Deleted",
        description: "The call recording has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Could not delete the call.",
        variant: "destructive",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ callId, employeeId }: { callId: string; employeeId: string }) => {
      const res = await apiRequest("PATCH", `/api/calls/${callId}/assign`, { employeeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      toast({ title: "Employee Assigned", description: "Call has been assigned to the selected employee." });
    },
    onError: (error) => {
      toast({ title: "Assignment Failed", description: error.message, variant: "destructive" });
    },
  });

  // Sorted and paginated data
  const sortedCalls = useMemo(() => {
    if (!calls) return [];
    const sorted = [...calls].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime();
          break;
        case "duration":
          cmp = (a.duration || 0) - (b.duration || 0);
          break;
        case "score":
          cmp = parseFloat(a.analysis?.performanceScore || "0") - parseFloat(b.analysis?.performanceScore || "0");
          break;
        case "sentiment": {
          const sentOrder: Record<string, number> = { positive: 3, neutral: 2, negative: 1 };
          cmp = (sentOrder[a.sentiment?.overallSentiment || ""] || 0) - (sentOrder[b.sentiment?.overallSentiment || ""] || 0);
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [calls, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedCalls.length / pageSize));
  const pagedCalls = sortedCalls.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
    setSelectedIds(new Set());
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowsDownUp className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  // Bulk selection helpers
  const allOnPageSelected = pagedCalls.length > 0 && pagedCalls.every(c => selectedIds.has(c.id));
  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pagedCalls.map(c => c.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Auto-refetch when WebSocket notifies of call completion (for re-analysis progress)
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, [queryClient]);

  const processingCount = useMemo(() =>
    (calls || []).filter(c => c.status === "processing").length,
  [calls]);

  const reanalyzeMutation = useMutation({
    mutationFn: async (callIds: string[]) => {
      const res = await apiRequest("POST", "/api/calls/bulk-reanalyze", { callIds });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Re-analysis Started", description: data.message });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
    },
    onError: (error) => {
      toast({ title: "Re-analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleBulkReanalyze = () => {
    if (selectedIds.size === 0) return;
    // Warn if any selected call was quality-gated during the original run —
    // re-analysis re-transcribes the same audio, which will hit the same
    // quality gate (low confidence / empty transcript). The admin should
    // re-upload cleaner audio instead. Allow the run if the user confirms.
    const gatedCalls = calls.filter((c) => {
      if (!selectedIds.has(c.id)) return false;
      const flags = (c.analysis?.flags as unknown[] | undefined) ?? [];
      return flags.some((f) => f === "low_transcript_quality" || f === "empty_transcript");
    });
    if (gatedCalls.length > 0) {
      const proceed = confirm(
        `${gatedCalls.length} of the selected call${gatedCalls.length > 1 ? "s were" : " was"} flagged as low transcript quality. Re-analyzing won't improve the result — the same audio will hit the same quality gate. Re-upload higher-quality audio instead.\n\nContinue anyway?`,
      );
      if (!proceed) return;
    }
    reanalyzeMutation.mutate(Array.from(selectedIds));
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirm({ open: true, bulk: true });
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setDeleteConfirm({ open: false });
    try {
      await Promise.all(ids.map(id => apiRequest("DELETE", `/api/calls/${id}`)));
      toast({ title: "Calls Deleted", description: `${ids.length} call(s) deleted successfully.` });
    } catch {
      toast({ title: "Delete Failed", description: "Some calls could not be deleted.", variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
  };

  const handleBulkAssign = async (employeeId: string) => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    try {
      await Promise.all(ids.map(callId => apiRequest("PATCH", `/api/calls/${callId}/assign`, { employeeId })));
      toast({ title: "Calls Assigned", description: `${ids.length} call(s) assigned.` });
    } catch {
      toast({ title: "Assignment Failed", description: "Some calls could not be assigned.", variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
  };

  const handleDelete = (callId: string) => {
    setDeleteConfirm({ open: true, callId });
  };

  const confirmDelete = () => {
    if (deleteConfirm.callId) {
      deleteMutation.mutate(deleteConfirm.callId);
    }
    setDeleteConfirm({ open: false });
  };

  if (isLoadingCalls || isLoadingEmployees) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (callsError) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="text-center py-8">
          <Warning className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load calls. Please try again.</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">{(callsError as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetchCalls()}>
            <ArrowCounterClockwise className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) {
      return <span className="font-mono text-muted-foreground" style={{ fontSize: 11 }}>—</span>;
    }
    const color =
      sentiment === "positive"
        ? "var(--sage)"
        : sentiment === "negative"
        ? "var(--destructive)"
        : "var(--muted-foreground)";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color }}
        />
        <span className="text-muted-foreground" style={{ fontSize: 11 }}>
          {sentiment}
        </span>
      </span>
    );
  };

  const getStatusBadge = (status?: string) => {
    if (!status) {
      return <span className="font-mono text-muted-foreground" style={{ fontSize: 10 }}>—</span>;
    }
    const meta: Record<string, { label: string; color: string; bg: string }> = {
      completed: { label: "completed", color: "var(--sage)", bg: "var(--sage-soft)" },
      processing: { label: "processing", color: "var(--accent)", bg: "var(--accent-soft)" },
      failed: { label: "failed", color: "var(--destructive)", bg: "var(--warm-red-soft)" },
    };
    const m = meta[status] || { label: status, color: "var(--muted-foreground)", bg: "var(--secondary)" };
    return (
      <span
        className="font-mono uppercase"
        style={{
          background: m.bg,
          color: m.color,
          fontSize: 9,
          letterSpacing: "0.1em",
          padding: "3px 8px",
          borderRadius: 2,
          fontWeight: 500,
        }}
      >
        {m.label}
      </span>
    );
  };

  // Legacy star rendering kept as a no-op stub — the warm-paper table
  // shows the score number + tier color instead. Replacement is sage
  // for >= SCORE_EXCELLENT, foreground for >= SCORE_GOOD, copper for
  // needs-work, destructive for low. See the score cell below.
  const renderStars = (_score: number) => null;

  return (
    <div data-testid="calls-table">
      {processingCount > 0 && (
        <div
          className="font-mono uppercase inline-flex items-center gap-1.5 mb-3 text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          <Waveform className="w-3 h-3 animate-pulse" style={{ color: "var(--accent)" }} />
          {processingCount} processing
        </div>
      )}
      <div className="flex items-center justify-end mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const params = new URLSearchParams();
              if (statusFilter !== "all") params.set("status", statusFilter);
              if (sentimentFilter !== "all") params.set("sentiment", sentimentFilter);
              if (employeeFilter !== "all") params.set("employee", employeeFilter);
              window.open(`/api/export/calls?${params.toString()}`, "_blank");
            }}
            title="Export as CSV"
          >
            <FileArrowDown className="w-4 h-4 mr-1" />
            Export CSV
          </Button>
          <Select value={employeeFilter} onValueChange={handleFilterChange(setEmployeeFilter)}>
            <SelectTrigger className="w-40" data-testid="employee-filter">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees?.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sentimentFilter} onValueChange={handleFilterChange(setSentimentFilter)}>
            <SelectTrigger className="w-40" data-testid="sentiment-filter">
              <SelectValue placeholder="All Sentiment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sentiment</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
          {/* Saved filters */}
          {savedFilters.length > 0 && (
            <Select onValueChange={(id) => {
              const filter = savedFilters.find(f => f.id === id);
              if (filter) handleLoadFilter(filter);
            }}>
              <SelectTrigger className="w-40">
                <BookmarkSimple className="w-3.5 h-3.5 mr-1.5" />
                <SelectValue placeholder="Saved Filters" />
              </SelectTrigger>
              <SelectContent>
                {savedFilters.map(f => (
                  <SelectItem key={f.id} value={f.id}>
                    <div className="flex items-center justify-between w-full gap-2">
                      <span>{f.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showSaveDialog ? (
            <div className="flex items-center gap-1">
              <Input
                className="w-32 h-9 text-xs"
                placeholder="Filter name..."
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveFilter()}
                autoFocus
              />
              <Button size="sm" variant="default" className="h-9 px-2" onClick={handleSaveFilter} disabled={!newFilterName.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => setShowSaveDialog(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setShowSaveDialog(true)} title="Save current filters">
              <BookmarkSimple className="w-3.5 h-3.5 mr-1" />
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div
          className="px-4 py-2 mb-3 flex items-center gap-3 flex-wrap"
          style={{
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
          }}
        >
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Select onValueChange={handleBulkAssign}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              {employees?.filter(e => e.status === "Active").map(emp => (
                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleBulkReanalyze} disabled={reanalyzeMutation.isPending}>
            <Waveform className="w-3 h-3 mr-1" /> Re-analyze
          </Button>
          <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleBulkDelete}>
            <Trash className="w-3 h-3 mr-1" /> Delete Selected
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => setSelectedIds(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      <div className="overflow-x-auto bg-card border border-border">
        <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--secondary)" }}>
              <th
                className="font-mono uppercase text-muted-foreground text-left"
                style={{ fontSize: 10, letterSpacing: "0.12em", padding: "10px 12px", fontWeight: 500, borderBottom: "1px solid var(--border)", width: 32 }}
              >
                <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded" aria-label={allOnPageSelected ? "Deselect all calls" : "Select all calls"}>
                  {allOnPageSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              <HeaderCell label={t("table.date")} sortField="date" currentSort={sortField} dir={sortDir} onSort={toggleSort} />
              <HeaderCell label={t("table.agent")} />
              <HeaderCell label={t("table.duration")} sortField="duration" currentSort={sortField} dir={sortDir} onSort={toggleSort} numeric />
              <HeaderCell label={t("sentiment.title")} sortField="sentiment" currentSort={sortField} dir={sortDir} onSort={toggleSort} />
              <HeaderCell label={t("table.score")} sortField="score" currentSort={sortField} dir={sortDir} onSort={toggleSort} numeric />
              <HeaderCell label={t("transcript.callParty")} />
              <HeaderCell label={t("table.status")} />
              <HeaderCell label={t("table.actions")} />
            </tr>
          </thead>
          <tbody>
            {pagedCalls.map((call) => (
              <tr
                key={call.id}
                className="transition-colors"
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: selectedIds.has(call.id) ? "var(--accent-soft)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!selectedIds.has(call.id)) e.currentTarget.style.background = "var(--secondary)";
                }}
                onMouseLeave={(e) => {
                  if (!selectedIds.has(call.id)) e.currentTarget.style.background = "transparent";
                }}
              >
                <td className="py-3 px-2">
                  <button onClick={() => toggleOne(call.id)} className="text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary rounded" aria-label={selectedIds.has(call.id) ? `Deselect call ${call.fileName || call.id}` : `Select call ${call.fileName || call.id}`}>
                    {selectedIds.has(call.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                  </button>
                </td>
                <td className="py-3 px-2">
                  <div>
                    <p className="font-medium text-foreground">{new Date(call.uploadedAt || "").toLocaleDateString()}</p>
                    <p className="text-xs text-muted-foreground">{new Date(call.uploadedAt || "").toLocaleTimeString()}</p>
                  </div>
                </td>
                <td className="py-3 px-2">
                  {call.employee ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-primary font-semibold text-xs">{call.employee.initials ?? 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{call.employee.name ?? 'Unknown'}</span>
                        <Select onValueChange={(empId) => assignMutation.mutate({ callId: call.id, employeeId: empId })}>
                          <SelectTrigger className="w-7 h-7 p-0 border-0 bg-transparent">
                            <UserCheck className="w-3 h-3 text-muted-foreground" />
                          </SelectTrigger>
                          <SelectContent>
                            {employees?.filter(e => e.status === "Active").map(emp => (
                              <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <Select onValueChange={(empId) => assignMutation.mutate({ callId: call.id, employeeId: empId })}>
                      <SelectTrigger className="w-40 border-dashed text-muted-foreground">
                        <SelectValue placeholder="Assign employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees?.filter(e => e.status === "Active").map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="py-3 px-3 text-muted-foreground font-mono tabular-nums" style={{ textAlign: "right", fontSize: 12 }}>
                  {call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, "0")}` : "—"}
                </td>
                <td className="py-3 px-2">{getSentimentBadge(call.sentiment?.overallSentiment)}</td>
                <td className="py-3 px-3" style={{ textAlign: "right" }}>
                  {call.analysis?.performanceScore && (() => {
                    const score = Number(call.analysis.performanceScore);
                    const color =
                      score >= SCORE_EXCELLENT
                        ? "var(--sage)"
                        : score >= SCORE_GOOD
                        ? "var(--foreground)"
                        : score >= SCORE_NEEDS_WORK
                        ? "var(--accent)"
                        : "var(--destructive)";
                    return (
                      <span
                        className="font-mono tabular-nums font-medium"
                        style={{ color, fontSize: 13 }}
                      >
                        {score.toFixed(1)}
                      </span>
                    );
                  })()}
                </td>
                <td className="py-3 px-2">
                  {call.analysis?.callPartyType ? (
                    <Badge variant="outline" className="text-xs capitalize">
                      {(call.analysis.callPartyType as string).replace(/_/g, " ")}
                    </Badge>
                  ) : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="py-3 px-2">
                  <div className="flex items-center gap-1.5">
                    {getStatusBadge(call.status)}
                    {call.analysis?.flags && Array.isArray(call.analysis.flags) && (call.analysis.flags as string[]).length > 0 && (() => {
                      const flags = call.analysis.flags as string[];
                      const hasExceptional = flags.includes("exceptional_call");
                      const hasBad = flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
                      const hasLowConfidence = flags.includes("low_confidence");
                      return (
                        <>
                          {hasExceptional && (
                            <span title="Exceptional Call">
                              <Trophy className="w-4 h-4 text-emerald-500" />
                            </span>
                          )}
                          {hasBad && (
                            <span title={flags.filter(f => f !== "exceptional_call" && f !== "medicare_call" && f !== "low_confidence").join(", ")}>
                              <Warning className="w-4 h-4 text-red-500" />
                            </span>
                          )}
                          {!hasExceptional && !hasBad && flags.includes("medicare_call") && (
                            <span title="Medicare Call">
                              <Warning className="w-4 h-4 text-blue-500" />
                            </span>
                          )}
                          {hasLowConfidence && (
                            <span title="Low AI Confidence — may need manual review">
                              <ShieldStar className="w-4 h-4 text-yellow-500" />
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </td>
                <td className="py-3 px-2">
                  <div className="flex items-center space-x-2">
                    <Link href={`/transcripts/${call.id}`}>
                      <Button size="sm" variant="ghost" aria-label="View transcript" disabled={call.status !== 'completed'}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={playingId === call.id ? "Pause audio" : "Play audio"}
                      onClick={() => togglePlay(call.id)}
                      disabled={call.status === "processing" || call.status === "failed"}
                    >
                      {playingId === call.id
                        ? <Pause className="w-4 h-4" weight="fill" />
                        : <Play className="w-4 h-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Download audio"
                      onClick={() => handleDownloadAudio(call)}
                      disabled={call.status !== "completed"}
                    >
                      <DownloadSimple className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                      aria-label="Delete call" onClick={() => handleDelete(call.id)} disabled={deleteMutation.isPending}
                    >
                      <Trash className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )) ?? []}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {sortedCalls.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page:</span>
            <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(0); }}>
              <SelectTrigger className="w-16 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-2">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedCalls.length)} of {sortedCalls.length}
              {callsResponse?.pagination?.total != null && callsResponse.pagination.total > sortedCalls.length && (
                <span className="text-muted-foreground/60"> ({callsResponse.pagination.total} total)</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <CaretLeft className="w-4 h-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = totalPages <= 5 ? i : Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
              return (
                <Button
                  key={pageNum}
                  size="sm"
                  variant={page === pageNum ? "default" : "ghost"}
                  className="w-8 h-8 p-0 text-xs"
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum + 1}
                </Button>
              );
            })}
            <Button size="sm" variant="ghost" aria-label="Next page" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <CaretRight className="w-4 h-4" />
            </Button>
            {hasMore && (
              <Button
                size="sm"
                variant="outline"
                className="ml-2 text-xs"
                disabled={isFetching}
                onClick={() => { if (nextCursor) setCursor(nextCursor); }}
              >
                {isFetching ? "Loading..." : "Load More"}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ open })}
        title={deleteConfirm.bulk ? `Delete ${selectedIds.size} call(s)?` : "Delete this call?"}
        description={deleteConfirm.bulk
          ? `This will permanently remove ${selectedIds.size} call recording(s) and all associated data. This action cannot be undone.`
          : "This will permanently remove this call recording and all its data. This action cannot be undone."}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={deleteConfirm.bulk ? confirmBulkDelete : confirmDelete}
      />

      {!calls?.length && (
        <div className="text-center py-16">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mb-4">
            <FileAudio className="w-8 h-8 text-primary/60" />
          </div>
          <h4 className="font-semibold text-foreground mb-1">No call recordings yet</h4>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Upload your first audio file to get started with AI-powered call analysis.
          </p>
          <Link href="/upload"><Button>Upload Your First Call</Button></Link>
        </div>
      )}
    </div>
  );
}
