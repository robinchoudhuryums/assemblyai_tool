import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, TrendingUp, TrendingDown } from "lucide-react";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="metric-card rounded-lg p-6 animate-pulse">
            <div className="h-16 bg-muted rounded"></div>
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
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      title: "Avg Sentiment",
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      change: "Avg across calls",
      changeType: "positive" as const,
      icon: Heart,
      iconBg: "bg-green-100",
      iconColor: "text-green-600",
    },
    {
      title: "Transcription Time",
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      change: "-15% faster",
      changeType: "positive" as const,
      icon: Clock,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
    },
    {
      title: "Team Score",
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      change: "Avg performance",
      changeType: "positive" as const,
      icon: Star,
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className="metric-card rounded-lg p-6">
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
