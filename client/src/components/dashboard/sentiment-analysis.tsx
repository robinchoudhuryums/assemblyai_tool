import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useLocation } from "wouter";
import { ArrowCounterClockwise, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import type { SentimentDistribution } from "@shared/schema";

export default function SentimentAnalysis() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { data: sentimentData, isLoading, error, refetch } = useQuery<SentimentDistribution>({
    queryKey: ["/api/dashboard/sentiment"],
  });

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-destructive/30 p-6 text-center">
        <Warning className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm font-medium text-destructive">Failed to load sentiment data</p>
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
          <div className="h-6 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-72 bg-muted rounded mb-4"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const positive = sentimentData?.positive ?? 0;
  const neutral = sentimentData?.neutral ?? 0;
  const negative = sentimentData?.negative ?? 0;
  const total = positive + neutral + negative;

  const chartData = [
    { name: "Positive", value: positive, color: "hsl(158, 64%, 52%)" },
    { name: "Neutral", value: neutral, color: "hsl(45, 93%, 58%)" },
    { name: "Negative", value: negative, color: "hsl(0, 84%, 60%)" },
  ];

  const pct = (val: number) => total > 0 ? Math.round((val / total) * 100) : 0;

  return (
    <div className="bg-card rounded-lg border border-border p-6 hover-lift" data-testid="sentiment-analysis">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">{t("sentiment.title")}</h3>
      </div>

      <div className="chart-container mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <button
          type="button"
          className="text-center p-3 sentiment-positive rounded-lg cursor-pointer hover:ring-2 hover:ring-green-400 transition-all"
          onClick={() => navigate("/search?sentiment=positive")}
          aria-label={`View positive calls: ${pct(positive)}%`}
        >
          <p className="text-2xl font-bold" data-testid="sentiment-positive">
            {pct(positive)}%
          </p>
          <p className="text-sm font-medium">{t("sentiment.positive")} ({positive})</p>
        </button>
        <button
          type="button"
          className="text-center p-3 sentiment-neutral rounded-lg cursor-pointer hover:ring-2 hover:ring-yellow-400 transition-all"
          onClick={() => navigate("/search?sentiment=neutral")}
          aria-label={`View neutral calls: ${pct(neutral)}%`}
        >
          <p className="text-2xl font-bold" data-testid="sentiment-neutral">
            {pct(neutral)}%
          </p>
          <p className="text-sm font-medium">{t("sentiment.neutral")} ({neutral})</p>
        </button>
        <button
          type="button"
          className="text-center p-3 sentiment-negative rounded-lg cursor-pointer hover:ring-2 hover:ring-red-400 transition-all"
          onClick={() => navigate("/search?sentiment=negative")}
          aria-label={`View negative calls: ${pct(negative)}%`}
        >
          <p className="text-2xl font-bold" data-testid="sentiment-negative">
            {pct(negative)}%
          </p>
          <p className="text-sm font-medium">{t("sentiment.negative")} ({negative})</p>
        </button>
      </div>
    </div>
  );
}
