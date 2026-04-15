import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookmarkSimple, Calendar, FloppyDisk, Funnel, Heart, MagnifyingGlass, Star, Trash, Users, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Link, useLocation, useSearch } from "wouter";
import type { CallWithDetails, Employee, PaginatedCalls } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { LoadingIndicator } from "@/components/ui/loading";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { CallCard } from "@/components/search/call-card";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { deleteSavedFilter, loadSavedFilters, saveSavedFilter, type SavedFilter } from "@/lib/saved-filters";

export default function SearchPage() {
  const searchParams = useSearch();
  const urlParams = new URLSearchParams(searchParams);

  const [searchQuery, setSearchQuery] = useState(urlParams.get("q") || "");
  const [sentimentFilter, setSentimentFilter] = useState(urlParams.get("sentiment") || "all");
  const [statusFilter, setStatusFilter] = useState(urlParams.get("status") || "all");
  const [employeeFilter, setEmployeeFilter] = useState(urlParams.get("employee") || "all");
  const [dateFrom, setDateFrom] = useState(urlParams.get("from") || "");
  const [dateTo, setDateTo] = useState(urlParams.get("to") || "");
  const [minScore, setMinScore] = useState(urlParams.get("minScore") || "");
  const [maxScore, setMaxScore] = useState(urlParams.get("maxScore") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(urlParams.get("q") || "");
  const [showAdvanced, setShowAdvanced] = useState(
    !!(urlParams.get("sentiment") || urlParams.get("from") || urlParams.get("minScore") || urlParams.get("status") || urlParams.get("employee"))
  );
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync filter state to URL params for bookmarkable/shareable filters
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (sentimentFilter !== "all") params.set("sentiment", sentimentFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (employeeFilter !== "all") params.set("employee", employeeFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (minScore) params.set("minScore", minScore);
    if (maxScore) params.set("maxScore", maxScore);
    const qs = params.toString();
    const newPath = qs ? `/search?${qs}` : "/search";
    window.history.replaceState(null, "", newPath);
  }, [searchQuery, sentimentFilter, statusFilter, employeeFilter, dateFrom, dateTo, minScore, maxScore]);

  // Build search query params with filters
  const searchQueryParams: Record<string, string> = { q: debouncedQuery };
  if (sentimentFilter !== "all") searchQueryParams.sentiment = sentimentFilter;
  if (minScore) searchQueryParams.minScore = minScore;
  if (maxScore) searchQueryParams.maxScore = maxScore;
  if (dateFrom) searchQueryParams.from = dateFrom;
  if (dateTo) searchQueryParams.to = dateTo;

  const { data: searchResults, isLoading: isLoadingSearch, error: searchError } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", searchQueryParams],
    enabled: debouncedQuery.length > 2,
  });

  useEffect(() => {
    if (searchError) {
      toast({ title: "Search Failed", description: searchError.message, variant: "destructive" });
    }
  }, [searchError, toast]);

  const { data: allCallsResponse, isLoading: isLoadingCalls } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", {
      sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
      status: statusFilter === "all" ? "" : statusFilter,
      employee: employeeFilter === "all" ? "" : employeeFilter,
    }],
    enabled: debouncedQuery.length === 0,
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  let displayCalls = (debouncedQuery.length > 2 ? searchResults : allCallsResponse?.calls) ?? [];
  const isLoading = isLoadingSearch || isLoadingCalls;

  // Apply client-side filters when browsing (no search query)
  if (debouncedQuery.length === 0) {
    if (dateFrom) {
      const from = new Date(dateFrom);
      displayCalls = displayCalls.filter(c => new Date(c.uploadedAt || 0) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      displayCalls = displayCalls.filter(c => new Date(c.uploadedAt || 0) <= to);
    }
    if (minScore) {
      const min = parseFloat(minScore);
      if (!isNaN(min)) displayCalls = displayCalls.filter(c => parseFloat(c.analysis?.performanceScore || "0") >= min);
    }
    if (maxScore) {
      const max = parseFloat(maxScore);
      if (!isNaN(max)) displayCalls = displayCalls.filter(c => parseFloat(c.analysis?.performanceScore || "10") <= max);
    }
  }

  const clearFilters = () => {
    setSearchQuery("");
    setSentimentFilter("all");
    setStatusFilter("all");
    setEmployeeFilter("all");
    setDateFrom("");
    setDateTo("");
    setMinScore("");
    setMaxScore("");
    setDebouncedQuery("");
    window.history.replaceState(null, "", "/search");
  };

  const hasActiveFilters = sentimentFilter !== "all" || statusFilter !== "all" || employeeFilter !== "all" || dateFrom || dateTo || minScore || maxScore;

  // ── Saved filter presets (persisted to localStorage via safe-storage) ──
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [savingName, setSavingName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const refreshSavedFilters = () => setSavedFilters(loadSavedFilters());

  const applySavedFilter = (f: SavedFilter) => {
    setSearchQuery(f.searchQuery ?? "");
    setSentimentFilter(f.sentiment || "all");
    setStatusFilter(f.status || "all");
    setEmployeeFilter(f.employee || "all");
    setDateFrom(f.dateFrom ?? "");
    setDateTo(f.dateTo ?? "");
    setMinScore(f.minScore ?? "");
    setMaxScore(f.maxScore ?? "");
    setDebouncedQuery(f.searchQuery ?? "");
    toast({ title: "Filter loaded", description: `Applied "${f.name}"` });
  };

  const handleSavePreset = () => {
    const name = savingName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Enter a name for this filter preset.", variant: "destructive" });
      return;
    }
    saveSavedFilter({
      name,
      status: statusFilter,
      sentiment: sentimentFilter,
      employee: employeeFilter,
      searchQuery: searchQuery || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      minScore: minScore || undefined,
      maxScore: maxScore || undefined,
    });
    refreshSavedFilters();
    setSavingName("");
    setShowSaveInput(false);
    toast({ title: "Filter saved", description: `"${name}" is now in your presets.` });
  };

  const handleDeletePreset = (id: string, name: string) => {
    if (!confirm(`Delete saved filter "${name}"?`)) return;
    deleteSavedFilter(id);
    refreshSavedFilters();
  };

  return (
    <div className="min-h-screen" data-testid="search-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Search Calls</h2>
          <p className="text-muted-foreground">Find specific call recordings using keywords, filters, and criteria</p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><MagnifyingGlass className="w-5 h-5" /> Search & Filter</CardTitle>
              <div className="flex items-center gap-2">
                {(hasActiveFilters || searchQuery) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSaveInput(v => !v)}
                    title="Save the current filter combination as a preset"
                  >
                    <FloppyDisk className="w-4 h-4 mr-1" />
                    Save preset
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>
                  <Funnel className="w-4 h-4 mr-1" />
                  {showAdvanced ? "Hide Filters" : "More Filters"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input type="text" placeholder="Search by keywords, transcript content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10"/>
            </div>

            {/* Saved filter presets — load/delete. The "Save preset" button in the
                header opens the save input below when active filters exist. */}
            {savedFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <BookmarkSimple className="w-3.5 h-3.5" /> Saved:
                </span>
                {savedFilters.map(f => (
                  <div key={f.id} className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/60">
                    <button
                      onClick={() => applySavedFilter(f)}
                      className="px-2 py-1 hover:bg-accent rounded-l-md text-foreground"
                      title={`Load: ${f.name}`}
                    >
                      {f.name}
                    </button>
                    <button
                      onClick={() => handleDeletePreset(f.id, f.name)}
                      className="px-1.5 py-1 hover:bg-destructive/20 rounded-r-md text-muted-foreground hover:text-destructive"
                      title={`Delete: ${f.name}`}
                      aria-label={`Delete saved filter ${f.name}`}
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showSaveInput && (
              <div className="flex items-center gap-2 p-3 rounded-md border border-dashed border-border bg-muted/30">
                <Input
                  type="text"
                  placeholder="e.g. 'My low-score calls this month'"
                  value={savingName}
                  onChange={e => setSavingName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSavePreset(); }}
                  autoFocus
                  maxLength={60}
                />
                <Button size="sm" onClick={handleSavePreset} disabled={!savingName.trim()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowSaveInput(false); setSavingName(""); }}>Cancel</Button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
                <SelectTrigger><Heart className="w-4 h-4 mr-2" /><SelectValue placeholder="All Sentiment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sentiment</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><Funnel className="w-4 h-4 mr-2" /><SelectValue placeholder="All Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger><Users className="w-4 h-4 mr-2" /><SelectValue placeholder="All Employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees?.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={clearFilters} disabled={!searchQuery && !hasActiveFilters}>
                <X className="w-4 h-4 mr-1" /> Clear Filters
              </Button>
            </div>

            {/* Advanced Filters */}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-3 border-t border-border">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    <Calendar className="w-3 h-3 inline mr-1" />From Date
                  </Label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    <Calendar className="w-3 h-3 inline mr-1" />To Date
                  </Label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    <Star className="w-3 h-3 inline mr-1" />Min Score
                  </Label>
                  <Input type="number" min="0" max="10" step="0.5" placeholder="0" value={minScore} onChange={e => setMinScore(e.target.value)} className="h-9" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    <Star className="w-3 h-3 inline mr-1" />Max Score
                  </Label>
                  <Input type="number" min="0" max="10" step="0.5" placeholder="10" value={maxScore} onChange={e => setMaxScore(e.target.value)} className="h-9" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search Results {displayCalls && `(${displayCalls.length} found)`}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64"><LoadingIndicator text="Searching..." /></div>
            ) : !displayCalls?.length ? (
              <div className="text-center py-16">
                <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mb-4">
                  <MagnifyingGlass className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-1">
                  {debouncedQuery.length > 0 ? 'No matching calls found' : 'Search your calls'}
                </h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                  {debouncedQuery.length > 0
                    ? 'Try a different search term or adjust your filters.'
                    : 'Search across transcripts, topics, and call summaries.'}
                </p>
                {!debouncedQuery.length && (
                  <Link href="/upload"><Button variant="outline">Upload Call Recording</Button></Link>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {displayCalls.map((call, index) => (
                  <ErrorBoundary key={call?.id || index}>
                    <CallCard call={call} index={index} />
                  </ErrorBoundary>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
