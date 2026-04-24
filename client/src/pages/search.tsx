/**
 * Search page (warm-paper installment 6, phase 4).
 *
 * Consolidates onto the Calls-table visual vocabulary from phase 2:
 * mono uppercase headers, tabular-nums numerics, sentiment dots,
 * tier-colored scores. Replaces the Card-wrapped CallCard grid with
 * an inline results table.
 *
 * Fetch logic preserved: two parallel queries — `/api/search` when
 * debouncedQuery has >2 chars, `/api/calls` in browse mode — with
 * client-side date/score filtering applied in browse mode. URL-param
 * syncing + 8-field saved-preset CRUD unchanged.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { DownloadSimple, MagnifyingGlass, UploadSimple, X } from "@phosphor-icons/react";
import type { CallWithDetails, Employee, PaginatedCalls } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import {
  SEARCH_DEBOUNCE_MS,
  SCORE_EXCELLENT,
  SCORE_GOOD,
  SCORE_NEEDS_WORK,
} from "@/lib/constants";
import {
  deleteSavedFilter,
  loadSavedFilters,
  saveSavedFilter,
  type SavedFilter,
} from "@/lib/saved-filters";

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
  // Search mode: keyword (default — full-text via /api/search), semantic
  // (embedding cosine via /api/search/semantic), or hybrid (both, weighted).
  // Persisted to URL so toggles survive bookmarks/refresh.
  const initialMode = (urlParams.get("mode") as "keyword" | "semantic" | "hybrid" | null) ?? "keyword";
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic" | "hybrid">(
    initialMode === "semantic" || initialMode === "hybrid" ? initialMode : "keyword",
  );
  const initialAlpha = parseFloat(urlParams.get("alpha") || "0.5");
  const [hybridAlpha, setHybridAlpha] = useState<number>(
    Number.isFinite(initialAlpha) ? Math.max(0, Math.min(1, initialAlpha)) : 0.5,
  );
  const [showAdvanced, setShowAdvanced] = useState(
    !!(
      urlParams.get("sentiment") ||
      urlParams.get("from") ||
      urlParams.get("minScore") ||
      urlParams.get("status") ||
      urlParams.get("employee")
    ),
  );
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync filter state to URL params for bookmarkable/shareable filters.
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
    if (searchMode !== "keyword") params.set("mode", searchMode);
    if (searchMode === "hybrid") params.set("alpha", hybridAlpha.toFixed(2));
    const qs = params.toString();
    const newPath = qs ? `/search?${qs}` : "/search";
    window.history.replaceState(null, "", newPath);
  }, [searchQuery, sentimentFilter, statusFilter, employeeFilter, dateFrom, dateTo, minScore, maxScore, searchMode, hybridAlpha]);

  // F-19: All filters that affect results must live in the query key so
  // toggling them invalidates the cache.
  const searchQueryParams: Record<string, string> = { q: debouncedQuery };
  if (sentimentFilter !== "all") searchQueryParams.sentiment = sentimentFilter;
  if (statusFilter !== "all") searchQueryParams.status = statusFilter;
  if (employeeFilter !== "all") searchQueryParams.employee = employeeFilter;
  if (minScore) searchQueryParams.minScore = minScore;
  if (maxScore) searchQueryParams.maxScore = maxScore;
  if (dateFrom) searchQueryParams.from = dateFrom;
  if (dateTo) searchQueryParams.to = dateTo;

  // Keyword path is the existing /api/search route — only enabled in
  // keyword mode. Semantic + hybrid use /api/search/semantic below.
  const { data: searchResults, isLoading: isLoadingSearch, error: searchError } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", searchQueryParams],
    enabled: debouncedQuery.length > 2 && searchMode === "keyword",
  });

  // Semantic/hybrid path — server returns { mode, backend, results, coverage,
  // threshold, alpha? }. Results carry an extra `similarity` (and
  // `keywordScore`/`score` in hybrid mode) we surface as a badge.
  const semanticParams: Record<string, string> = { q: debouncedQuery };
  if (searchMode === "hybrid") {
    semanticParams.mode = "hybrid";
    semanticParams.alpha = hybridAlpha.toFixed(2);
  }
  if (sentimentFilter !== "all") semanticParams.sentiment = sentimentFilter;
  if (employeeFilter !== "all") semanticParams.employeeId = employeeFilter;
  if (dateFrom) semanticParams.from = dateFrom;
  if (dateTo) semanticParams.to = dateTo;

  type SemanticResult = CallWithDetails & { similarity?: number; keywordScore?: number; score?: number };
  type SemanticResponse = {
    mode: "semantic" | "hybrid" | "keyword-fallback";
    backend?: "pgvector" | "in-memory";
    alpha?: number;
    threshold?: number;
    results: SemanticResult[];
    coverage?: { totalAccessible: number; withEmbeddings: number };
  };
  const { data: semanticData, isLoading: isLoadingSemantic, error: semanticError } = useQuery<SemanticResponse>({
    queryKey: ["/api/search/semantic", semanticParams],
    enabled: debouncedQuery.length > 2 && searchMode !== "keyword",
  });

  useEffect(() => {
    if (searchError) {
      toast({
        title: "Search Failed",
        description: searchError.message,
        variant: "destructive",
      });
    }
  }, [searchError, toast]);

  useEffect(() => {
    if (semanticError) {
      toast({
        title: "Semantic search failed",
        description: semanticError.message,
        variant: "destructive",
      });
    }
  }, [semanticError, toast]);

  // CLAUDE.md A14: omit empty-string sentinels from the /api/calls key
  // so this matches the ["/api/calls"] invalidation pattern used by
  // mutations.
  const callsQueryKey: Record<string, string> = {};
  if (sentimentFilter !== "all") callsQueryKey.sentiment = sentimentFilter;
  if (statusFilter !== "all") callsQueryKey.status = statusFilter;
  if (employeeFilter !== "all") callsQueryKey.employee = employeeFilter;
  if (dateFrom) callsQueryKey.from = dateFrom;
  if (dateTo) callsQueryKey.to = dateTo;
  if (minScore) callsQueryKey.minScore = minScore;
  if (maxScore) callsQueryKey.maxScore = maxScore;
  const { data: allCallsResponse, isLoading: isLoadingCalls } = useQuery<PaginatedCalls>({
    queryKey: Object.keys(callsQueryKey).length > 0 ? ["/api/calls", callsQueryKey] : ["/api/calls"],
    enabled: debouncedQuery.length === 0,
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  // Resolve which result set to display:
  //   - keyword search:   /api/search results
  //   - semantic/hybrid:  /api/search/semantic results
  //   - browse (no query): /api/calls list
  // Semantic results carry an extra `similarity` we keep on each row for
  // the badge column. Keyword results are CallWithDetails as before.
  type DisplayCall = CallWithDetails & { similarity?: number; keywordScore?: number; score?: number };
  const semanticActive = debouncedQuery.length > 2 && searchMode !== "keyword";
  let displayCalls: DisplayCall[] = semanticActive
    ? (semanticData?.results ?? [])
    : ((debouncedQuery.length > 2 ? searchResults : allCallsResponse?.calls) ?? []);
  const isLoading = isLoadingSearch || isLoadingCalls || isLoadingSemantic;

  // Browse-mode client-side filtering (F-19).
  if (debouncedQuery.length === 0) {
    if (dateFrom) {
      const from = new Date(dateFrom);
      displayCalls = displayCalls.filter((c) => new Date(c.uploadedAt || 0) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      displayCalls = displayCalls.filter((c) => new Date(c.uploadedAt || 0) <= to);
    }
    if (minScore) {
      const min = parseFloat(minScore);
      if (!isNaN(min)) {
        displayCalls = displayCalls.filter((c) => parseFloat(c.analysis?.performanceScore || "0") >= min);
      }
    }
    if (maxScore) {
      const max = parseFloat(maxScore);
      if (!isNaN(max)) {
        displayCalls = displayCalls.filter((c) => parseFloat(c.analysis?.performanceScore || "10") <= max);
      }
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
    setSearchMode("keyword");
    setHybridAlpha(0.5);
    window.history.replaceState(null, "", "/search");
  };

  const hasActiveFilters =
    sentimentFilter !== "all" ||
    statusFilter !== "all" ||
    employeeFilter !== "all" ||
    !!dateFrom ||
    !!dateTo ||
    !!minScore ||
    !!maxScore;

  // Saved filter presets (persisted to localStorage via safe-storage).
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
      toast({
        title: "Name required",
        description: "Enter a name for this filter preset.",
        variant: "destructive",
      });
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
    <div className="min-h-screen bg-background text-foreground" data-testid="search-page">
      {/* App bar */}
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
          <span className="text-foreground">Search</span>
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          disabled
          title="CSV export — coming in a later phase"
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground disabled:opacity-70 disabled:cursor-not-allowed"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <DownloadSimple style={{ width: 12, height: 12 }} />
          Export CSV
        </button>
        <Link
          href="/upload"
          className="font-mono uppercase inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1.5 text-[var(--paper)] bg-primary border-primary hover:opacity-90 transition-opacity"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <UploadSimple style={{ width: 12, height: 12 }} />
          Upload
        </Link>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          Search calls · {debouncedQuery.length > 0 ? "by query" : "browse all"}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          {isLoading
            ? "…"
            : `${displayCalls.length} ${displayCalls.length === 1 ? "result" : "results"}`}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 sm:px-7 py-4 bg-background border-b border-border flex flex-col gap-3">
        {/* Search mode toggle — only meaningful when there's a query. */}
        <div className="flex items-center gap-2 flex-wrap" data-testid="search-mode-toggle">
          <span
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            Mode
          </span>
          {(["keyword", "semantic", "hybrid"] as const).map((mode) => {
            const active = searchMode === mode;
            const label = mode === "keyword" ? "Keywords" : mode === "semantic" ? "Meaning" : "Hybrid";
            // Tooltip explains what each mode does — closes the "which do I
            // pick?" friction that made users pick the wrong one and get
            // fewer results than they'd have with a different choice.
            const hint =
              mode === "keyword"
                ? "Exact word + phrase match. Best for proper nouns, SKUs, and quoted phrases."
                : mode === "semantic"
                ? "Match by meaning, not wording. Best when you know the concept but not the exact words (e.g. 'customer was upset')."
                : "Blend both — keyword precision with semantic recall. Good default when you're not sure.";
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setSearchMode(mode)}
                aria-pressed={active}
                title={hint}
                className="font-mono uppercase border rounded-sm px-2.5 py-1 transition-colors"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--copper-soft)" : "transparent",
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  fontWeight: active ? 500 : 400,
                }}
                data-testid={`mode-${mode}`}
              >
                {label}
              </button>
            );
          })}
          {searchMode === "hybrid" && (
            <label className="flex items-center gap-2 ml-2">
              <span
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                Mix
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={hybridAlpha}
                onChange={(e) => setHybridAlpha(parseFloat(e.target.value))}
                className="w-32"
                aria-label="Hybrid mix: lower favors keyword, higher favors meaning"
                data-testid="hybrid-alpha-slider"
              />
              <span
                className="font-mono tabular-nums text-muted-foreground"
                style={{ fontSize: 10 }}
              >
                kw {(1 - hybridAlpha).toFixed(2)} · sem {hybridAlpha.toFixed(2)}
              </span>
            </label>
          )}
          {semanticActive && semanticData?.coverage && (
            <span
              className="font-mono text-muted-foreground ml-2"
              style={{ fontSize: 10 }}
              data-testid="semantic-coverage"
            >
              coverage {semanticData.coverage.withEmbeddings}/{semanticData.coverage.totalAccessible}
              {semanticData.coverage.totalAccessible > 0 &&
                semanticData.coverage.withEmbeddings / semanticData.coverage.totalAccessible < 0.5 && (
                  <span style={{ color: "var(--amber)", marginLeft: 6 }}>
                    · low — run npm run backfill-embeddings
                  </span>
                )}
            </span>
          )}
        </div>
        {/* Mode explainer — one-liner that reflects the current pick. Keeps
            the chrome small but closes the "which mode?" friction raised
            during the cycle's strategic review. */}
        <div
          className="text-xs text-muted-foreground"
          data-testid="search-mode-hint"
        >
          {searchMode === "keyword" && (
            <>
              <span className="font-medium">Keywords</span> — exact word match. Try
              {" "}
              <button
                type="button"
                onClick={() => setSearchMode("hybrid")}
                className="underline hover:text-foreground"
              >
                Hybrid
              </button>
              {" "}
              if you're not finding what you expect.
            </>
          )}
          {searchMode === "semantic" && (
            <>
              <span className="font-medium">Meaning</span> — matches the concept, not
              the exact words. Try
              {" "}
              <button
                type="button"
                onClick={() => setSearchMode("hybrid")}
                className="underline hover:text-foreground"
              >
                Hybrid
              </button>
              {" "}
              if you also want proper-noun hits.
            </>
          )}
          {searchMode === "hybrid" && (
            <>
              <span className="font-medium">Hybrid</span> — blends exact-match and
              meaning. Slide the Mix toward kw for proper nouns, toward sem for concepts.
            </>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="relative flex-1 min-w-[260px]">
            <MagnifyingGlass
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              style={{ width: 12, height: 12 }}
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transcript, topic, agent, ID…"
              className="w-full bg-card border border-border rounded-sm pl-7 pr-2.5 py-1.5 font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
              style={{ fontSize: 11 }}
              data-testid="search-input"
            />
          </label>
          <FilterSelect
            value={sentimentFilter}
            onChange={setSentimentFilter}
            options={[
              { value: "all", label: "All sentiment" },
              { value: "positive", label: "Positive" },
              { value: "neutral", label: "Neutral" },
              { value: "negative", label: "Negative" },
            ]}
            testId="sentiment-filter"
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All status" },
              { value: "completed", label: "Completed" },
              { value: "processing", label: "Processing" },
              { value: "failed", label: "Failed" },
            ]}
            testId="status-filter"
          />
          <FilterSelect
            value={employeeFilter}
            onChange={setEmployeeFilter}
            options={[
              { value: "all", label: "All employees" },
              ...(employees ?? []).map((e) => ({ value: e.id, label: e.name })),
            ]}
            testId="employee-filter"
          />
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            {showAdvanced ? "⌃ Less" : "⌄ More"} filters
          </button>
          {(hasActiveFilters || searchQuery) && (
            <>
              <button
                type="button"
                onClick={() => setShowSaveInput((v) => !v)}
                className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
              >
                ⊕ Save preset
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
              >
                <X style={{ width: 12, height: 12 }} /> Clear
              </button>
            </>
          )}
        </div>

        {showSaveInput && (
          <div
            className="flex items-center gap-2 px-3 py-2 border border-dashed border-border"
            style={{ background: "var(--secondary)" }}
          >
            <input
              type="text"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
              }}
              placeholder="e.g. 'My low-score calls this month'"
              maxLength={60}
              autoFocus
              className="flex-1 bg-card border border-border rounded-sm px-2.5 py-1.5 font-mono text-foreground"
              style={{ fontSize: 11 }}
            />
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={!savingName.trim()}
              className="font-mono uppercase rounded-sm px-3 py-1.5 text-[var(--paper)] bg-primary border border-primary hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSaveInput(false);
                setSavingName("");
              }}
              className="font-mono uppercase border border-border rounded-sm px-3 py-1.5 text-foreground hover:bg-secondary transition-colors"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Cancel
            </button>
          </div>
        )}

        {savedFilters.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              Saved:
            </span>
            {savedFilters.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center rounded-sm border border-border"
                style={{ background: "var(--card)" }}
              >
                <button
                  type="button"
                  onClick={() => applySavedFilter(f)}
                  className="font-mono uppercase px-2.5 py-1 text-foreground hover:bg-secondary transition-colors"
                  style={{ fontSize: 10, letterSpacing: "0.08em" }}
                  title={`Load: ${f.name}`}
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePreset(f.id, f.name)}
                  aria-label={`Delete saved filter ${f.name}`}
                  className="border-l border-border px-2 py-1 text-muted-foreground hover:text-destructive transition-colors"
                  style={{ fontSize: 10 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {showAdvanced && (
          <div
            className="grid gap-3 pt-3 border-t border-border"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          >
            <AdvancedField label="From date">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-card border border-border rounded-sm px-2.5 py-1.5 font-mono text-foreground"
                style={{ fontSize: 11 }}
              />
            </AdvancedField>
            <AdvancedField label="To date">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-card border border-border rounded-sm px-2.5 py-1.5 font-mono text-foreground"
                style={{ fontSize: 11 }}
              />
            </AdvancedField>
            <AdvancedField label="Min score">
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                placeholder="0"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="w-full bg-card border border-border rounded-sm px-2.5 py-1.5 font-mono tabular-nums text-foreground"
                style={{ fontSize: 11 }}
              />
            </AdvancedField>
            <AdvancedField label="Max score">
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                placeholder="10"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                className="w-full bg-card border border-border rounded-sm px-2.5 py-1.5 font-mono tabular-nums text-foreground"
                style={{ fontSize: 11 }}
              />
            </AdvancedField>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="px-4 sm:px-7 py-6">
        {isLoading ? (
          <div
            className="py-16 text-center text-muted-foreground"
            data-testid="loading"
          >
            Searching…
          </div>
        ) : displayCalls.length === 0 ? (
          <EmptyState hasQuery={debouncedQuery.length > 0} onClear={clearFilters} />
        ) : (
          <ResultsTable calls={displayCalls} showMatch={semanticActive} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Local UI helpers
// ─────────────────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      className="bg-card border border-border rounded-sm text-foreground font-mono"
      style={{ padding: "6px 10px", fontSize: 11, letterSpacing: "0.04em" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AdvancedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.1em" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ hasQuery, onClear }: { hasQuery: boolean; onClear: () => void }) {
  return (
    <div className="py-16 text-center" data-testid="search-empty">
      <div
        className="font-display text-foreground mb-2"
        style={{ fontSize: 22, letterSpacing: "-0.3px" }}
      >
        {hasQuery ? "Nothing matches those filters." : "Start searching your calls."}
      </div>
      <div className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
        {hasQuery
          ? "Try broadening your query or clearing filters."
          : "Search across transcripts, topics, and call summaries."}
      </div>
      {hasQuery ? (
        <button
          type="button"
          onClick={onClear}
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-3 py-2 text-foreground hover:bg-secondary transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <X style={{ width: 12, height: 12 }} /> Clear filters
        </button>
      ) : (
        <Link
          href="/upload"
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-3 py-2 text-foreground hover:bg-secondary transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          Upload a call →
        </Link>
      )}
    </div>
  );
}

function ResultsTable({
  calls,
  showMatch,
}: {
  calls: Array<CallWithDetails & { similarity?: number; keywordScore?: number; score?: number }>;
  showMatch?: boolean;
}) {
  return (
    <div className="overflow-x-auto bg-card border border-border">
      <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--secondary)" }}>
            <ResultHeader label="Date" />
            <ResultHeader label="Agent" />
            <ResultHeader label="Subject" />
            <ResultHeader label="Sentiment" />
            <ResultHeader label="Score" numeric />
            <ResultHeader label="Duration" numeric />
            {showMatch && <ResultHeader label="Match" numeric />}
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <ResultRow key={call.id} call={call} showMatch={showMatch} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultHeader({ label, numeric }: { label: string; numeric?: boolean }) {
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

function ResultRow({
  call,
  showMatch,
}: {
  call: CallWithDetails & { similarity?: number; keywordScore?: number; score?: number };
  showMatch?: boolean;
}) {
  const [, navigate] = useLocation();
  const score = call.analysis?.performanceScore ? Number(call.analysis.performanceScore) : null;
  const scoreColor =
    score === null
      ? "var(--muted-foreground)"
      : score >= SCORE_EXCELLENT
      ? "var(--sage)"
      : score >= SCORE_GOOD
      ? "var(--foreground)"
      : score >= SCORE_NEEDS_WORK
      ? "var(--accent)"
      : "var(--destructive)";
  const sentiment = call.sentiment?.overallSentiment;
  const sentColor =
    sentiment === "positive"
      ? "var(--sage)"
      : sentiment === "negative"
      ? "var(--destructive)"
      : "var(--muted-foreground)";
  const summaryStr =
    typeof call.analysis?.summary === "string" ? call.analysis.summary : "";
  const subject = summaryStr
    ? summaryStr.split(/[.!?]/)[0].trim().slice(0, 120)
    : call.fileName || `Call ${call.id.slice(0, 8).toUpperCase()}`;
  const durationStr = call.duration
    ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, "0")}`
    : "—";

  return (
    <tr
      className="cursor-pointer transition-colors"
      style={{ borderBottom: "1px solid var(--border)" }}
      onClick={() => navigate(`/transcripts/${call.id}`)}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      data-testid={`search-result-${call.id}`}
    >
      <td
        className="py-3 px-3 font-mono text-muted-foreground tabular-nums"
        style={{ fontSize: 11 }}
      >
        {call.uploadedAt ? new Date(call.uploadedAt).toLocaleDateString() : "—"}
      </td>
      <td className="py-3 px-3" style={{ fontSize: 13 }}>
        {call.employee?.name ?? "—"}
      </td>
      <td className="py-3 px-3 text-foreground" style={{ fontSize: 13 }}>
        {subject}
      </td>
      <td className="py-3 px-3">
        {sentiment ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: sentColor,
              }}
            />
            <span className="text-muted-foreground" style={{ fontSize: 11 }}>
              {sentiment}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground" style={{ fontSize: 11 }}>
            —
          </span>
        )}
      </td>
      <td
        className="py-3 px-3 font-mono tabular-nums"
        style={{
          textAlign: "right",
          color: scoreColor,
          fontSize: 13,
          fontWeight: score !== null ? 500 : 400,
        }}
      >
        {score !== null ? score.toFixed(1) : "—"}
      </td>
      <td
        className="py-3 px-3 font-mono tabular-nums text-muted-foreground"
        style={{ textAlign: "right", fontSize: 12 }}
      >
        {durationStr}
      </td>
      {showMatch && (
        <td
          className="py-3 px-3 font-mono tabular-nums"
          style={{ textAlign: "right", fontSize: 12, color: "var(--accent)" }}
          title={
            call.keywordScore !== undefined
              ? `Combined ${call.score?.toFixed(3) ?? "—"} = sim ${call.similarity?.toFixed(3) ?? "—"} + kw ${call.keywordScore.toFixed(3)}`
              : `Cosine similarity ${call.similarity?.toFixed(3) ?? "—"}`
          }
        >
          {(call.score ?? call.similarity ?? 0).toFixed(2)}
        </td>
      )}
    </tr>
  );
}
