import { useQuery } from "@tanstack/react-query";
import { ArrowCounterClockwise, Clock, Heart, Phone, Star, Warning } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useTranslation } from "@/lib/i18n";
import type { DashboardMetrics } from "@shared/schema";

export default function MetricsOverview() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { data: metrics, isLoading, error, refetch } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <Warning className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">{t("metrics.failedToLoad")}</p>
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
      title: t("metrics.totalCalls"),
      value: String(totalCalls),
      rawValue: totalCalls,
      decimals: 0,
      suffix: "",
      change: `${totalCalls} ${t("metrics.analyzed")}`,
      icon: Phone,
      iconBg: "bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/40 dark:to-blue-800/20",
      iconColor: "text-blue-500",
      iconGlow: "shadow-[0_0_8px_rgba(59,130,246,0.2)]",
      href: "/transcripts",
    },
    {
      title: t("metrics.avgSentiment"),
      value: `${(metrics?.avgSentiment ?? 0).toFixed(1)}/10`,
      rawValue: metrics?.avgSentiment ?? 0,
      decimals: 1,
      suffix: "/10",
      change: t("metrics.avgAcrossCalls"),
      icon: Heart,
      iconBg: "bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/40 dark:to-emerald-800/20",
      iconColor: "text-emerald-500",
      iconGlow: "shadow-[0_0_8px_rgba(16,185,129,0.2)]",
      href: "/sentiment",
    },
    {
      title: t("metrics.transcriptionTime"),
      value: `${metrics?.avgTranscriptionTime ?? 0}min`,
      rawValue: metrics?.avgTranscriptionTime ?? 0,
      decimals: 0,
      suffix: "min",
      change: t("metrics.avgPerCall"),
      icon: Clock,
      iconBg: "bg-gradient-to-br from-violet-100 to-violet-200 dark:from-violet-900/40 dark:to-violet-800/20",
      iconColor: "text-violet-500",
      iconGlow: "shadow-[0_0_8px_rgba(139,92,246,0.2)]",
      href: "/reports",
    },
    {
      title: t("metrics.teamScore"),
      value: `${(metrics?.avgPerformanceScore ?? 0).toFixed(1)}/10`,
      rawValue: metrics?.avgPerformanceScore ?? 0,
      decimals: 1,
      suffix: "/10",
      change: t("metrics.avgPerformance"),
      icon: Star,
      iconBg: "bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/20",
      iconColor: "text-amber-500",
      iconGlow: "shadow-[0_0_8px_rgba(245,158,11,0.2)]",
      href: "/performance",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="metrics-overview">
      {metricCards.map((metric, idx) => {
        const Icon = metric.icon;
        return (
          <button
            key={metric.title}
            type="button"
            className="metric-card rounded-xl p-6 cursor-pointer card-interactive text-left w-full animate-stagger group"
            style={{ "--stagger": idx } as React.CSSProperties}
            onClick={() => navigate(metric.href)}
            aria-label={`View ${metric.title}: ${metric.value}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">{metric.title}</p>
                <p className="text-2xl font-bold text-foreground mt-1" data-testid={`metric-${metric.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {typeof metric.rawValue === "number" ? (
                    <AnimatedNumber value={metric.rawValue} decimals={metric.decimals ?? 0} suffix={metric.suffix ?? ""} />
                  ) : (
                    metric.value
                  )}
                </p>
                <p className="text-xs mt-1.5 text-muted-foreground">
                  {metric.change}
                </p>
              </div>
              <div className={`w-11 h-11 ${metric.iconBg} ${metric.iconGlow} rounded-lg ring-1 ring-inset ring-black/10 dark:ring-white/10 flex items-center justify-center transition-transform group-hover:scale-110`}>
                <Icon className={`${metric.iconColor} w-5 h-5`} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
