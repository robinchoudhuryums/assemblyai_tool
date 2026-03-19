import { useQuery } from "@tanstack/react-query";
import { Phone, Heart, Clock, Star, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const [, navigate] = useLocation();
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load metrics</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

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

  const totalCalls = metrics?.totalCalls ?? 0;
  const metricCards = [
    {
      title: "Total Calls",
      value: totalCalls,
      change: `${totalCalls} analyzed`,
      icon: Phone,
      iconBg: "bg-gradient-to-br from-primary/20 to-primary/5",
      iconColor: "text-primary",
      accentBorder: "border-l-4 border-l-primary",
      href: "/transcripts",
    },
    {
      title: "Avg Sentiment",
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      change: "Avg across calls",
      icon: Heart,
      iconBg: "bg-gradient-to-br from-green-200 to-green-50 dark:from-green-900/40 dark:to-green-900/10",
      iconColor: "text-green-600",
      accentBorder: "border-l-4 border-l-green-500",
      href: "/sentiment",
    },
    {
      title: "Transcription Time",
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      change: "Avg per call",
      icon: Clock,
      iconBg: "bg-gradient-to-br from-blue-200 to-blue-50 dark:from-blue-900/40 dark:to-blue-900/10",
      iconColor: "text-blue-600",
      accentBorder: "border-l-4 border-l-blue-500",
      href: "/reports",
    },
    {
      title: "Team Score",
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      change: "Avg performance",
      icon: Star,
      iconBg: "bg-gradient-to-br from-purple-200 to-purple-50 dark:from-purple-900/40 dark:to-purple-900/10",
      iconColor: "text-purple-600",
      accentBorder: "border-l-4 border-l-purple-500",
      href: "/performance",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric) => {
        const Icon = metric.icon;
        return (
          <button
            key={metric.title}
            type="button"
            className={`metric-card rounded-lg p-6 ${metric.accentBorder} cursor-pointer hover:shadow-md transition-shadow text-left w-full`}
            onClick={() => navigate(metric.href)}
            aria-label={`View ${metric.title}: ${metric.value}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">{metric.title}</p>
                <p className="text-2xl font-bold text-foreground" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {metric.value}
                </p>
                <p className="text-xs mt-1 text-muted-foreground">
                  {metric.change}
                </p>
              </div>
              <div className={`w-12 h-12 ${metric.iconBg} rounded-lg flex items-center justify-center`}>
                <Icon className={`${metric.iconColor} w-5 h-5`} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
