import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowCounterClockwise, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Employee } from "@shared/schema";

// Define a more robust type for a performer
type TopPerformer = Partial<Employee> & {
  score?: number | null;
  avgPerformanceScore?: number | null;
  totalCalls?: number | null;
};

export default memo(function PerformanceCard() {
  const [, navigate] = useLocation();
  const { data: performers, isLoading, error, refetch } = useQuery<TopPerformer[]>({
    queryKey: ["/api/dashboard/performers"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <Warning className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load performers</p>
        <p className="text-xs text-muted-foreground mb-3">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <ArrowCounterClockwise className="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-muted rounded w-1/2 mb-4"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // A safer way to get the color for initials
  const getInitialsColor = (initials?: string | null) => {
    const colors = [
      'bg-green-100 text-green-600',
      'bg-blue-100 text-blue-600',
      'bg-purple-100 text-purple-600',
      'bg-orange-100 text-orange-600',
    ];
    // Safety check: if initials are missing, return a default color
    if (!initials) {
      return colors[0];
    }
    return colors[initials.charCodeAt(0) % colors.length];
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6 hover-lift" data-testid="performance-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Top Performers</h3>
        <Link href="/performance" className="text-primary hover:text-primary/80 text-sm font-medium" data-testid="view-all-performers">
          View All
        </Link>
      </div>
      
      <div className="space-y-4">
        {/* Add a filter to remove any invalid performer data before rendering */}
        {performers?.filter(p => p && p.id && p.name).map((employee, index) => (
          <div
            key={employee.id}
            className="flex items-center justify-between p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80 transition-colors"
            onClick={() => navigate(`/reports?employee=${employee.id}`)}
            role="link"
          >
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getInitialsColor(employee.initials)}`}>
                <span className="font-semibold text-sm">{employee.initials ?? 'N/A'}</span>
              </div>
              <div>
                <p className="font-medium text-foreground" data-testid={`performer-name-${index}`}>
                  {employee.name ?? 'Unknown Employee'}
                </p>
                <p className="text-sm text-muted-foreground">{employee.role ?? 'No role'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-green-600" data-testid={`performer-score-${index}`}>
                {Number(employee.score ?? employee.avgPerformanceScore ?? 0).toFixed(1) || 'N/A'}
              </p>
              <p className="text-xs text-muted-foreground">Score</p>
            </div>
          </div>
        ))}

        {!performers?.length && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No performance data available yet</p>
          </div>
        )}
      </div>
    </div>
  );
});
