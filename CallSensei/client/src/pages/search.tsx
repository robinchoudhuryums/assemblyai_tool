import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Calendar, User, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import type { CallWithDetails, Employee } from "@shared/schema";

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search query
  useState(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: searchResults, isLoading } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length > 0,
  });

  const { data: allCalls } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/calls", { 
      employee: employeeFilter === "all" ? "" : employeeFilter, 
      sentiment: sentimentFilter === "all" ? "" : sentimentFilter, 
      status: statusFilter === "all" ? "" : statusFilter 
    }],
    enabled: debouncedQuery.length === 0,
  });

  const displayCalls = debouncedQuery.length > 0 ? searchResults : allCalls;

  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return <Badge variant="secondary">Unknown</Badge>;
    
    const variants: Record<string, any> = {
      positive: "default",
      neutral: "secondary", 
      negative: "destructive",
    };
    
    return (
      <Badge variant={variants[sentiment] || "secondary"} className={`sentiment-${sentiment}`}>
        {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      completed: "bg-green-100 text-green-800",
      processing: "bg-blue-100 text-blue-800", 
      failed: "bg-red-100 text-red-800",
    };
    
    return (
      <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const clearFilters = () => {
    setSearchQuery("");
    setEmployeeFilter("all");
    setSentimentFilter("all");
    setStatusFilter("all");
    setDebouncedQuery("");
  };

  return (
    <div className="min-h-screen" data-testid="search-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Search Calls</h2>
          <p className="text-muted-foreground">Find and analyze specific call recordings using keywords, filters, and criteria</p>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Search and Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Search & Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Main Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                type="text"
                placeholder="Search by employee name, keywords, transcript content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="search-input"
              />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger data-testid="employee-filter">
                  <User className="w-4 h-4 mr-2" />
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

              <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
                <SelectTrigger data-testid="sentiment-filter">
                  <Heart className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Sentiment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sentiment</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="status-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Button 
                variant="outline" 
                onClick={clearFilters}
                data-testid="clear-filters"
              >
                Clear Filters
              </Button>
            </div>

            {/* Active Filters Display */}
            {(searchQuery || employeeFilter || sentimentFilter || statusFilter) && (
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="text-sm text-muted-foreground">Active filters:</span>
                {searchQuery && (
                  <Badge variant="outline">Query: "{searchQuery}"</Badge>
                )}
                {employeeFilter && (
                  <Badge variant="outline">
                    Employee: {employees?.find(e => e.id === employeeFilter)?.name}
                  </Badge>
                )}
                {sentimentFilter && (
                  <Badge variant="outline">Sentiment: {sentimentFilter}</Badge>
                )}
                {statusFilter && (
                  <Badge variant="outline">Status: {statusFilter}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search Results */}
        <Card>
          <CardHeader>
            <CardTitle>
              Search Results {displayCalls && `(${displayCalls.length} found)`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-24 bg-muted rounded-lg"></div>
                  </div>
                ))}
              </div>
            ) : !displayCalls?.length ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {debouncedQuery.length > 0 ? 'No matching calls found' : 'No calls available'}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {debouncedQuery.length > 0 
                    ? 'Try adjusting your search query or filters'
                    : 'Upload some call recordings to get started'
                  }
                </p>
                <Link href="/upload">
                  <Button>Upload Call Recording</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {displayCalls.map((call, index) => (
                  <Card key={call.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                            <span className="text-primary font-semibold text-sm">
                              {call.employee?.initials}
                            </span>
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground" data-testid={`call-employee-${index}`}>
                              {call.employee?.name}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {new Date(call.uploadedAt).toLocaleDateString()} • {formatDuration(call.duration)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {getSentimentBadge(call.sentiment?.overallSentiment)}
                          {getStatusBadge(call.status)}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <h4 className="font-medium text-sm text-foreground mb-2">File Details</h4>
                          <p className="text-sm text-muted-foreground">
                            <strong>File:</strong> {call.fileName}
                          </p>
                          {call.analysis?.performanceScore && (
                            <p className="text-sm text-muted-foreground">
                              <strong>Performance Score:</strong> {call.analysis.performanceScore.toFixed(1)}/10
                            </p>
                          )}
                        </div>

                        {call.analysis?.topics && call.analysis.topics.length > 0 && (
                          <div>
                            <h4 className="font-medium text-sm text-foreground mb-2">Topics</h4>
                            <div className="flex flex-wrap gap-1">
                              {call.analysis.topics.slice(0, 3).map((topic, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {topic}
                                </Badge>
                              ))}
                              {call.analysis.topics.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{call.analysis.topics.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {call.transcript?.text && (
                        <div className="mb-4">
                          <h4 className="font-medium text-sm text-foreground mb-2">Transcript Preview</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {call.transcript.text.length > 200 
                              ? `${call.transcript.text.substring(0, 200)}...`
                              : call.transcript.text
                            }
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                          <span>
                            <Calendar className="w-3 h-3 inline mr-1" />
                            {new Date(call.uploadedAt).toLocaleString()}
                          </span>
                          {call.sentiment?.overallScore && (
                            <span>
                              Sentiment Score: {(call.sentiment.overallScore * 10).toFixed(1)}/10
                            </span>
                          )}
                        </div>
                        <Link href={`/transcripts/${call.id}`}>
                          <Button 
                            variant="outline" 
                            size="sm"
                            disabled={call.status !== 'completed'}
                            data-testid={`view-details-${index}`}
                          >
                            View Details
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search Tips */}
        <Card>
          <CardHeader>
            <CardTitle>Search Tips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-foreground mb-2">Search Capabilities</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Search by employee names</li>
                  <li>• Find calls by transcript content</li>
                  <li>• Search extracted keywords and topics</li>
                  <li>• Filter by file names</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-2">Filter Options</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Filter by employee assignments</li>
                  <li>• Filter by sentiment (positive/neutral/negative)</li>
                  <li>• Filter by processing status</li>
                  <li>• Combine multiple filters for precise results</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
