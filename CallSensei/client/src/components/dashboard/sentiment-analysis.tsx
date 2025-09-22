import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { SentimentDistribution } from "@shared/schema";

export default function SentimentAnalysis() {
  const { data: sentimentData, isLoading } = useQuery<SentimentDistribution>({
    queryKey: ["/api/dashboard/sentiment"],
  });

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

  const chartData = [
    { name: "Positive", value: sentimentData?.positive ?? 0, color: "hsl(158, 64%, 52%)" },
    { name: "Neutral", value: sentimentData?.neutral ?? 0, color: "hsl(45, 93%, 58%)" },
    { name: "Negative", value: sentimentData?.negative ?? 0, color: "hsl(0, 84%, 60%)" },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="sentiment-analysis">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Sentiment Analysis</h3>
        <Select defaultValue="7days">
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7days">Last 7 days</SelectItem>
            <SelectItem value="30days">Last 30 days</SelectItem>
            <SelectItem value="90days">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
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
        <div className="text-center p-3 sentiment-positive rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-positive">
            {sentimentData?.positive ?? 0}%
          </p>
          <p className="text-sm font-medium">Positive</p>
        </div>
        <div className="text-center p-3 sentiment-neutral rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-neutral">
            {sentimentData?.neutral ?? 0}%
          </p>
          <p className="text-sm font-medium">Neutral</p>
        </div>
        <div className="text-center p-3 sentiment-negative rounded-lg">
          <p className="text-2xl font-bold" data-testid="sentiment-negative">
            {sentimentData?.negative ?? 0}%
          </p>
          <p className="text-sm font-medium">Negative</p>
        </div>
      </div>
    </div>
  );
}
