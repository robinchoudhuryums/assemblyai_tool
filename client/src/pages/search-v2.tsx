import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import type { CallWithDetails } from "@shared/schema";
import { LoadingIndicator } from "@/components/ui/loading";

export default function SearchV2Page() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQuery(searchQuery); }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading } = useQuery<CallWithDetails[]>({
    queryKey: ["/api/search", { q: debouncedQuery }],
    enabled: debouncedQuery.length > 2,
  });

  return (
    <div className="min-h-screen p-6" data-testid="search-v2-page">
      <header className="mb-6">
        <h2 className="text-2xl font-bold">Simple MagnifyingGlass (v2)</h2>
        <p className="text-muted-foreground">A clean page for testing search functionality.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>MagnifyingGlass Transcripts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input type="text" placeholder="MagnifyingGlass by keywords..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10"/>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center h-48"><LoadingIndicator text="Searching..." /></div>
          ) : (
            <div className="space-y-2">
              {searchResults && searchResults.map(call => (
                <div key={call.id} className="p-2 border rounded">
                  <p className="font-semibold">{call.employee?.name ?? 'Unassigned'}</p>
                  <p className="text-sm text-muted-foreground truncate">{call.transcript?.text ?? 'No transcript.'}</p>
                  <Link href={`/transcripts/${call.id}`} className="text-sm text-blue-500">View Details</Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
