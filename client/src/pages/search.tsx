import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import type { CallWithDetails } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveform } from "lucide-react";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { CallCard } from "@/components/search/call-card";

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading: isLoadingSearch, error: searchError } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length > 2,
  });

  useEffect(() => {
    if (searchError) {
      toast({ title: "Search Failed", description: searchError.message, variant: "destructive" });
    }
  }, [searchError, toast]);

  const { data: allCalls, isLoading: isLoadingCalls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", {
      sentiment: sentimentFilter === "all" ? "" : sentimentFilter,
      status: statusFilter === "all" ? "" : statusFilter
    }],
    enabled: debouncedQuery.length === 0,
  });

  const displayCalls = (debouncedQuery.length > 2 ? searchResults : allCalls) ?? [];
  const isLoading = isLoadingSearch || isLoadingCalls;

  const clearFilters = () => {
    setSearchQuery("");
    setSentimentFilter("all");
    setStatusFilter("all");
    setDebouncedQuery("");
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
            <CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" /> Search & Filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input type="text" placeholder="Search by keywords, transcript content..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10"/>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Employee Filter Removed */}
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
              <Button variant="outline" onClick={clearFilters}>Clear Filters</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Search Results {displayCalls && `(${displayCalls.length} found)`}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64"><AudioWaveform className="w-8 h-8 animate-spin text-primary" /></div>
            ) : !displayCalls?.length ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">{debouncedQuery.length > 0 ? 'No matching calls found' : 'No calls available'}</h3>
                <Link href="/upload"><Button>Upload Call Recording</Button></Link>
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

