import { useQuery } from "@tanstack/react-query";
import { Download, BarChart2, Smile, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioWaveform } from "lucide-react";

// Define a type for our combined report data
interface ReportData {
  metrics: {
    totalCalls: number;
    avgSentiment: number;
    avgPerformanceScore: number;
  };
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  performers: Array<{
    name: string;
    avgPerformanceScore: number;
  }>;
}

export default function ReportsPage() {
  const { data: report, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/reports/summary"],
  });

  const handleDownloadReport = () => {
    if (!report) return;

    const lines: string[] = [];
    lines.push('CallAnalyzer Performance Report');
    lines.push('===============================');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('Overall Metrics');
    lines.push('---------------');
    lines.push(`Total Calls Analyzed: ${report.metrics.totalCalls}`);
    lines.push(`Average Sentiment Score: ${report.metrics.avgSentiment.toFixed(2)}`);
    lines.push(`Average Performance Score: ${report.metrics.avgPerformanceScore.toFixed(1)}/10`);
    lines.push('');
    lines.push('Sentiment Breakdown');
    lines.push('-------------------');
    lines.push(`Positive: ${report.sentiment.positive}`);
    lines.push(`Neutral: ${report.sentiment.neutral}`);
    lines.push(`Negative: ${report.sentiment.negative}`);
    lines.push('');
    lines.push('Top Performers');
    lines.push('--------------');
    report.performers.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name} — ${p.avgPerformanceScore ? Number(p.avgPerformanceScore).toFixed(1) : 'N/A'}/10`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

if (isLoading) {
  return (
    <div className="flex items-center justify-center h-64">
      <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
      <p className="ml-2 text-muted-foreground">Analyzing performance...</p>
    </div>
  );
}

  return (
    <div className="min-h-screen" data-testid="reports-page">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Performance Reports</h2>
          <p className="text-muted-foreground">A summary of call center performance and key metrics.</p>
        </div>
        <Button onClick={handleDownloadReport} disabled={!report}>
          <Download className="w-4 h-4 mr-2" />
          Download Report
        </Button>
      </header>

      <main className="p-6 space-y-6">
        {/* Overall Metrics */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            <BarChart2 className="w-5 h-5 mr-2" />
            Overall Metrics
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-sm text-muted-foreground">Total Calls Analyzed</p>
              <p className="text-3xl font-bold">{report?.metrics.totalCalls ?? 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Average Sentiment Score</p>
              <p className="text-3xl font-bold text-blue-500">{(report?.metrics.avgSentiment ?? 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Average Performance Score</p>
              <p className="text-3xl font-bold text-green-500">{(report?.metrics.avgPerformanceScore ?? 0).toFixed(1)}/10</p>
            </div>
          </div>
        </div>

        {/* Top Performers & Sentiment Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <Star className="w-5 h-5 mr-2" />
              Top 5 Performers
            </h3>
            <ul className="space-y-3">
              {report?.performers.map((p, i) => (
              <li key={i} className="flex justify-between items-center">
                <span className="font-medium">{p.name}</span>
                
                {/* This check prevents the crash if the score is missing */}
                <span className="font-bold text-green-500">
                  {p.avgPerformanceScore ? Number(p.avgPerformanceScore).toFixed(1) : 'N/A'}
                </span>
              </li>
              ))}
            </ul>
          </div>

          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <Smile className="w-5 h-5 mr-2" />
              Sentiment Breakdown
            </h3>
            <ul className="space-y-3">
              <li className="flex justify-between items-center">
                <span className="font-medium text-green-600">Positive</span>
                <span className="font-bold">{report?.sentiment.positive ?? 0}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="font-medium text-gray-600">Neutral</span>
                <span className="font-bold">{report?.sentiment.neutral ?? 0}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="font-medium text-red-600">Negative</span>
                <span className="font-bold">{report?.sentiment.negative ?? 0}</span>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
