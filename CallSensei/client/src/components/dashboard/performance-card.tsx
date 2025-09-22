import { useQuery } from "@tanstack/react-query";
import type { Employee } from "@shared/schema";

type TopPerformer = Employee & { score: number };

export default function PerformanceCard() {
  const { data: performers, isLoading } = useQuery<TopPerformer[]>({
    queryKey: ["/api/dashboard/performers"],
  });

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

  const getInitialsColor = (initials: string) => {
    const colors = [
      'bg-green-100 text-green-600',
      'bg-blue-100 text-blue-600',
      'bg-purple-100 text-purple-600',
      'bg-orange-100 text-orange-600',
    ];
    return colors[initials.charCodeAt(0) % colors.length];
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="performance-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Top Performers</h3>
        <button className="text-primary hover:text-primary/80 text-sm font-medium" data-testid="view-all-performers">
          View All
        </button>
      </div>
      
      <div className="space-y-4">
        {performers?.map((employee, index) => (
          <div key={employee.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getInitialsColor(employee.initials)}`}>
                <span className="font-semibold text-sm">{employee.initials}</span>
              </div>
              <div>
                <p className="font-medium text-foreground" data-testid={`performer-name-${index}`}>
                  {employee.name}
                </p>
                <p className="text-sm text-muted-foreground">{employee.role}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-green-600" data-testid={`performer-score-${index}`}>
                {employee.score}
              </p>
              <p className="text-xs text-muted-foreground">Score</p>
            </div>
          </div>
        )) ?? []}

        {!performers?.length && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No performance data available yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
