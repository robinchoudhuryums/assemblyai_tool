import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Heart, Calendar, Star, Users, X } from "lucide-react";
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

export default function SearchPage() {
  const searchParams = useSearch();
  const urlParams = new URLSearchParams(searchParams);

  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState(urlParams.get("sentiment") || "all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(
    !!urlParams.get("sentiment") || false
  );
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
  };

  const hasActiveFilters = sentimentFilter !== "all" || statusFilter !== "all" || employeeFilter !== "all" || dateFrom || dateTo || minScore || maxScore;

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
              <CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" /> Search & Filter</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>
                <Filter className="w-4 h-4 mr-1" />
                {showAdvanced ? "Hide Filters" : "More Filters"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input type="text" placeholder="Search by keywords, transcript content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10"/>
            </div>
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
                <SelectTrigger><Filter className="w-4 h-4 mr-2" /><SelectValue placeholder="All Status" /></SelectTrigger>
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
                  <Search className="w-8 h-8 text-primary/60" />
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
