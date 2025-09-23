import { useQuery } from "@tanstack/react-query";
import { Star, TrendingUp, UserCheck } from "lucide-react";
import type { Employee } from "@shared/schema";

// Define a type for our performance data for clarity
interface Performer extends Employee {
  avgPerformanceScore: number;
  totalCalls: number;
}

export default function PerformancePage() {
  // Use the useQuery hook to fetch data from our new API endpoint
  const { data: performers, isLoading } = useQuery<Performer[]>({
    queryKey: ["/api/performance"],
  });

  if (isLoading) {
    return <div>Loading performance data...</div>;
  }

  return (
    <div className="min-h-screen" data-testid="performance-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Employee Performance</h2>
          <p className="text-muted-foreground">Review top performers based on call analysis scores.</p>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {performers?.map((employee, index) => (
            <div key={employee.id} className="bg-card rounded-lg border border-border p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                    <UserCheck className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{employee.name}</h3>
                    <p className="text-sm text-muted-foreground">{employee.role}</p>
                  </div>
                </div>
                <div className="text-2xl font-bold text-primary">#{index + 1}</div>
              </div>
              <div className="mt-4 flex justify-between items-center">
                <div className="flex flex-col items-center">
                  <span className="text-xs text-muted-foreground">Avg. Score</span>
                  <span className="text-xl font-bold text-green-500 flex items-center">
                    <Star className="w-4 h-4 mr-1 fill-current" />
                    {/* This check prevents the crash if the score is missing */}
                    {employee.avgPerformanceScore ? employee.avgPerformanceScore.toFixed(1) : 'N/A'}/10
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-xs text-muted-foreground">Total Calls</span>
                  <span className="text-xl font-bold">{employee.totalCalls}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {!performers?.length && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No performance data available yet.</p>
            <p className="text-sm text-muted-foreground">Process more calls to see performance metrics.</p>
          </div>
        )}
      </main>
    </div>
  );
}
