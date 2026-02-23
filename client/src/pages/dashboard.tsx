import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import SentimentAnalysis from "@/components/dashboard/sentiment-analysis";
import PerformanceCard from "@/components/dashboard/performance-card";
import FileUpload from "@/components/upload/file-upload";
import CallsTable from "@/components/tables/calls-table";

export default function Dashboard() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen" data-testid="dashboard-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call Analysis Dashboard</h2>
            <p className="text-muted-foreground">Monitor performance and sentiment across all customer interactions</p>
          </div>
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              className="w-64 justify-start text-muted-foreground"
              onClick={() => navigate("/search")}
              data-testid="search-input"
            >
              <Search className="w-4 h-4 mr-2" />
              Search calls...
            </Button>
            <Link href="/upload">
              <Button data-testid="upload-call-button">
                <Plus className="w-4 h-4 mr-2" />
                Upload Call
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Metrics Overview */}
        <MetricsOverview />

        {/* File Upload Section */}
        <FileUpload />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Analysis */}
          <SentimentAnalysis />

          {/* Top Performers */}
          <PerformanceCard />
        </div>

        {/* Recent Calls Table */}
        <CallsTable />

        {/* Performance Analytics Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Sentiment Trends</h3>
            <div className="chart-container">
              <div className="text-center">
                <p className="text-muted-foreground">Sentiment Timeline Chart</p>
                <p className="text-xs text-muted-foreground mt-1">Charts will be implemented with actual data</p>
              </div>
            </div>
          </div>
          
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Performance Metrics</h3>
            <div className="chart-container">
              <div className="text-center">
                <p className="text-muted-foreground">Employee Performance Chart</p>
                <p className="text-xs text-muted-foreground mt-1">Charts will be implemented with actual data</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Feedback Section */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">AI-Generated Feedback & Improvement Suggestions</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-medium text-foreground">Improvement Opportunities</h4>
              <div className="text-center py-8 bg-muted rounded-lg">
                <p className="text-muted-foreground">AI feedback will appear here after call analysis</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-medium text-foreground">Success Patterns</h4>
              <div className="text-center py-8 bg-muted rounded-lg">
                <p className="text-muted-foreground">Success patterns will appear here after call analysis</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
