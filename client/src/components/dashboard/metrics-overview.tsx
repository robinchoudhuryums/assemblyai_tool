import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric-card rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="w-12 h-12 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const metricCards = [
    {
      title: "Total Calls",
      value: metrics?.totalCalls ?? 0,
      change: "+12% from last month",
      changeType: "positive" as const,
      icon: Phone,
      iconBg: "bg-gradient-to-br from-primary/20 to-primary/5",
      iconColor: "text-primary",
      accentBorder: "border-l-4 border-l-primary",
    },
    {
      title: "Avg Sentiment",
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      change: "Avg across calls",
      changeType: "positive" as const,
      icon: Heart,
      iconBg: "bg-gradient-to-br from-green-200 to-green-50 dark:from-green-900/40 dark:to-green-900/10",
      iconColor: "text-green-600",
      accentBorder: "border-l-4 border-l-green-500",
    },
    {
      title: "Transcription Time",
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      change: "-15% faster",
      changeType: "positive" as const,
      icon: Clock,
      iconBg: "bg-gradient-to-br from-blue-200 to-blue-50 dark:from-blue-900/40 dark:to-blue-900/10",
      iconColor: "text-blue-600",
      accentBorder: "border-l-4 border-l-blue-500",
    },
    {
      title: "Team Score",
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      change: "Avg performance",
      changeType: "positive" as const,
      icon: Star,
      iconBg: "bg-gradient-to-br from-purple-200 to-purple-50 dark:from-purple-900/40 dark:to-purple-900/10",
      iconColor: "text-purple-600",
      accentBorder: "border-l-4 border-l-purple-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className={`metric-card rounded-lg p-6 ${metric.accentBorder}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">{metric.title}</p>
                <p className="text-2xl font-bold text-foreground" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {metric.value}
                </p>
                <p className={`text-xs mt-1 flex items-center ${
                  metric.changeType === 'positive' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {metric.changeType === 'positive' ? (
                    <TrendingUp className="w-3 h-3 mr-1" />
                  ) : (
                    <TrendingDown className="w-3 h-3 mr-1" />
                  )}
                  {metric.change}
                </p>
              </div>
              <div className={`w-12 h-12 ${metric.iconBg} rounded-lg flex items-center justify-center`}>
                <Icon className={`${metric.iconColor} w-5 h-5`} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
