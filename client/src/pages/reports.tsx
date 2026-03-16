import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { Download, BarChart2, Smile, Star, User, Users, TrendingUp, Calendar, ArrowRight, AudioWaveform, ChevronUp, ChevronDown, Sparkles, Phone, AlertTriangle, Award, Play, Pause, Eye, SlidersHorizontal, Shield, MessageCircle, Headphones, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Employee } from "@shared/schema";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ---- Types ----

type ReportType = "overall" | "employee" | "department";
type DatePreset = "last30" | "last90" | "ytd" | "lastYear" | "custom";

interface FilteredReportData {
  metrics: { totalCalls: number; avgSentiment: number; avgPerformanceScore: number };
  sentiment: { positive: number; neutral: number; negative: number };
  performers: Array<{ id: string; name: string; role: string; avgPerformanceScore: number | null; totalCalls: number }>;
  trends: Array<{ month: string; calls: number; avgScore: number | null; positive: number; neutral: number; negative: number }>;
  avgSubScores?: { compliance: number; customerExperience: number; communication: number; resolution: number } | null;
  autoAssignedCount?: number;
}

interface AgentProfileData {
  employee: { id: string; name: string; role: string; status: string };
  totalCalls: number;
  avgPerformanceScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  scoreTrend: Array<{ month: string; avgScore: number; calls: number }>;
  flaggedCalls: Array<{
    id: string;
    fileName?: string;
    uploadedAt?: string;
    score: number | null;
    summary?: string;
    flags: string[];
    sentiment?: string;
    flagType: "good" | "bad";
  }>;
}

// ---- Helpers ----

function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);

  switch (preset) {
    case "last30": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString().slice(0, 10), to };
    }
    case "last90": {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      return { from: d.toISOString().slice(0, 10), to };
    }
    case "ytd":
      return { from: `${now.getFullYear()}-01-01`, to };
    case "lastYear": {
      const y = now.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "custom": {
      const f = customFrom || to;
      const t = customTo || to;
      // Ensure from <= to
      return f > t ? { from: t, to: f } : { from: f, to: t };
    }
  }
}

function formatMonth(m: string) {
  const [year, month] = m.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  last30: "Last 30 Days",
  last90: "Last 90 Days",
  ytd: "Year to Date",
  lastYear: "Last Year",
  custom: "Custom Range",
};

// ---- Component ----

export default function ReportsPage() {
  // Check for employee param in URL (from sidebar quick-switch)
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialEmployee = urlParams?.get("employee") || "";

  // Report config state
  const [reportType, setReportType] = useState<ReportType>(initialEmployee ? "employee" : "overall");
  const [datePreset, setDatePreset] = useState<DatePreset>("last90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(initialEmployee);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [callPartyFilter, setCallPartyFilter] = useState("all");

  // Comparison state
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDatePreset, setCompareDatePreset] = useState<DatePreset>("lastYear");
  const [compareCustomFrom, setCompareCustomFrom] = useState("");
  const [compareCustomTo, setCompareCustomTo] = useState("");

  // AI summary state
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  // Granular detail toggle
  const [showDetailedScores, setShowDetailedScores] = useState(false);

  const dateRange = getDateRange(datePreset, customFrom, customTo);
  const compareDateRange = getDateRange(compareDatePreset, compareCustomFrom, compareCustomTo);

  // Fetch employees for selectors
  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const departments = useMemo(() => {
    if (!employees) return [];
    const set = new Set<string>();
    for (const emp of employees) {
      if (emp.role) set.add(emp.role);
    }
    return Array.from(set).sort();
  }, [employees]);

  // Build query params for filtered report
  const buildParams = (range: { from: string; to: string }) => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (reportType === "employee" && selectedEmployee) params.set("employeeId", selectedEmployee);
    if (reportType === "department" && selectedDepartment) params.set("department", selectedDepartment);
    if (callPartyFilter !== "all") params.set("callPartyType", callPartyFilter);
    return params.toString();
  };

  // AI summary mutation
  const summaryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reports/agent-summary/${selectedEmployee}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ from: dateRange.from, to: dateRange.to }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to generate summary");
      }
      return res.json();
    },
    onSuccess: (data: { summary: string }) => {
      setAiSummary(data.summary);
    },
  });

  // Primary data
  const primaryQueryKey = ["/api/reports/filtered", buildParams(dateRange)];
  const { data: report, isLoading, error: reportError } = useQuery<FilteredReportData>({
    queryKey: primaryQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reports/filtered?${buildParams(dateRange)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  // Comparison data
  const compareQueryKey = ["/api/reports/filtered", buildParams(compareDateRange), "compare"];
  const { data: compareReport, isLoading: isCompareLoading } = useQuery<FilteredReportData>({
    queryKey: compareQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reports/filtered?${buildParams(compareDateRange)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comparison report");
      return res.json();
    },
    enabled: compareEnabled,
  });

  // Agent profile (only for employee report type)
  const { data: agentProfile } = useQuery<AgentProfileData>({
    queryKey: ["/api/reports/agent-profile", selectedEmployee, dateRange.from, dateRange.to],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const res = await fetch(`/api/reports/agent-profile/${selectedEmployee}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agent profile");
      return res.json();
    },
    enabled: reportType === "employee" && !!selectedEmployee,
  });

  // Download handler
  const handleDownloadReport = () => {
    if (!report) return;
    const lines: string[] = [];
    const typeLabel = reportType === "employee"
      ? `Employee Report: ${employees?.find(e => e.id === selectedEmployee)?.name || selectedEmployee}`
      : reportType === "department"
      ? `Department Report: ${selectedDepartment}`
      : "Overall Report";

    lines.push("CallAnalyzer Performance Report");
    lines.push("===============================");
    lines.push(`Type: ${typeLabel}`);
    lines.push(`Period: ${dateRange.from} to ${dateRange.to} (${PRESET_LABELS[datePreset]})`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("Overall Metrics");
    lines.push("---------------");
    lines.push(`Total Calls Analyzed: ${report.metrics.totalCalls}`);
    lines.push(`Average Sentiment Score: ${report.metrics.avgSentiment.toFixed(2)}`);
    lines.push(`Average Performance Score: ${report.metrics.avgPerformanceScore.toFixed(1)}/10`);
    lines.push("");
    lines.push("Sentiment Breakdown");
    lines.push("-------------------");
    lines.push(`Positive: ${report.sentiment.positive}`);
    lines.push(`Neutral: ${report.sentiment.neutral}`);
    lines.push(`Negative: ${report.sentiment.negative}`);
    lines.push("");
    lines.push("Performers");
    lines.push("----------");
    report.performers.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name} — ${p.avgPerformanceScore != null ? Number(p.avgPerformanceScore).toFixed(1) : "N/A"}/10 (${p.totalCalls} calls)`);
    });

    if (agentProfile && reportType === "employee") {
      lines.push("");
      lines.push("Agent Profile Summary");
      lines.push("---------------------");
      lines.push(`Score Range: ${agentProfile.lowScore?.toFixed(1) ?? "N/A"} - ${agentProfile.highScore?.toFixed(1) ?? "N/A"}`);
      lines.push("");
      lines.push("Top Strengths:");
      agentProfile.topStrengths.forEach(s => lines.push(`  - ${s.text} (x${s.count})`));
      lines.push("");
      lines.push("Top Suggestions:");
      agentProfile.topSuggestions.forEach(s => lines.push(`  - ${s.text} (x${s.count})`));
    }

    if (aiSummary) {
      lines.push("");
      lines.push("AI-Generated Summary");
      lines.push("--------------------");
      lines.push(aiSummary);
    }

    if (compareEnabled && compareReport) {
      lines.push("");
      lines.push(`Comparison Period: ${compareDateRange.from} to ${compareDateRange.to}`);
      lines.push("---------------------------------------------------");
      lines.push(`Total Calls: ${compareReport.metrics.totalCalls}`);
      lines.push(`Avg Performance: ${compareReport.metrics.avgPerformanceScore.toFixed(1)}/10`);
      lines.push(`Avg Sentiment: ${compareReport.metrics.avgSentiment.toFixed(2)}`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${reportType}-${dateRange.from}-to-${dateRange.to}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Delta helper for comparison
  const delta = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return null;
    const diff = current - previous;
    const pct = ((diff / previous) * 100).toFixed(1);
    return { diff, pct, positive: diff > 0 };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Analyzing performance...</p>
      </div>
    );
  }

  if (reportError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-destructive">
        <AlertTriangle className="w-8 h-8 mb-2" />
        <p className="font-semibold">Failed to load report</p>
        <p className="text-sm text-muted-foreground">{reportError.message}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" data-testid="reports-page">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Performance Reports</h2>
          <p className="text-muted-foreground">Filter by time period, employee, or department.</p>
        </div>
        <Button onClick={handleDownloadReport} disabled={!report}>
          <Download className="w-4 h-4 mr-2" />
          Download Report
        </Button>
      </header>

      {/* Filters Bar */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Report Type */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Report Type</Label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="overall"><span className="flex items-center gap-1.5"><BarChart2 className="w-3.5 h-3.5" /> Overall</span></SelectItem>
                <SelectItem value="employee"><span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Individual Employee</span></SelectItem>
                <SelectItem value="department"><span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Department</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Employee selector */}
          {reportType === "employee" && (
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Employee</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees?.filter(e => e.status === "Active").map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Department selector */}
          {reportType === "department" && (
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Call Party Type */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Call Party</Label>
            <Select value={callPartyFilter} onValueChange={setCallPartyFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> All Parties</span></SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="medical_facility">Medical Facility</SelectItem>
                <SelectItem value="medicare">Medicare</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Preset */}
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground">Time Period</Label>
            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="last30">Last 30 Days</SelectItem>
                <SelectItem value="last90">Last 90 Days</SelectItem>
                <SelectItem value="ytd">Year to Date</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom dates */}
          {datePreset === "custom" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-[150px]" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-[150px]" />
              </div>
            </>
          )}

          {/* Compare toggle */}
          <div className="ml-auto">
            <Button
              variant={compareEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setCompareEnabled(!compareEnabled)}
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5" />
              {compareEnabled ? "Comparing" : "Compare Periods"}
            </Button>
          </div>
        </div>

        {/* Comparison row */}
        {compareEnabled && (
          <div className="flex flex-wrap gap-4 items-end mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowRight className="w-4 h-4" />
              Compare to:
            </div>
            <div className="min-w-[160px]">
              <Select value={compareDatePreset} onValueChange={(v) => setCompareDatePreset(v as DatePreset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last30">Last 30 Days</SelectItem>
                  <SelectItem value="last90">Last 90 Days</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="lastYear">Last Year</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {compareDatePreset === "custom" && (
              <>
                <div>
                  <Input type="date" value={compareCustomFrom} onChange={e => setCompareCustomFrom(e.target.value)} className="w-[150px]" />
                </div>
                <div>
                  <Input type="date" value={compareCustomTo} onChange={e => setCompareCustomTo(e.target.value)} className="w-[150px]" />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <main className="p-6 space-y-6">
        {/* Metrics Cards */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            <BarChart2 className="w-5 h-5 mr-2" />
            Metrics — {PRESET_LABELS[datePreset]}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <MetricCard
              label="Total Calls Analyzed"
              value={report?.metrics.totalCalls ?? 0}
              format="int"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.totalCalls : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.totalCalls ?? 0, compareReport?.metrics.totalCalls) : null}
            />
            <MetricCard
              label="Average Sentiment Score"
              value={report?.metrics.avgSentiment ?? 0}
              format="sentiment"
              color="text-blue-500"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.avgSentiment : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.avgSentiment ?? 0, compareReport?.metrics.avgSentiment) : null}
            />
            <MetricCard
              label="Average Performance Score"
              value={report?.metrics.avgPerformanceScore ?? 0}
              format="score"
              color="text-green-500"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.avgPerformanceScore : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.avgPerformanceScore ?? 0, compareReport?.metrics.avgPerformanceScore) : null}
            />
            {compareEnabled && isCompareLoading && (
              <div className="col-span-3 text-center text-sm text-muted-foreground">
                <AudioWaveform className="w-4 h-4 animate-spin inline mr-2" />
                Loading comparison data...
              </div>
            )}
          </div>
        </div>

        {/* Detailed Sub-Scores (toggleable) */}
        {report?.avgSubScores && (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center">
                <SlidersHorizontal className="w-5 h-5 mr-2" />
                Score Breakdown
              </h3>
              <Button
                variant={showDetailedScores ? "default" : "outline"}
                size="sm"
                onClick={() => setShowDetailedScores(!showDetailedScores)}
              >
                {showDetailedScores ? "Hide Details" : "Show Details"}
              </Button>
            </div>
            {showDetailedScores && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <SubScoreCard icon={Shield} label="Compliance" score={report.avgSubScores.compliance} color="text-blue-600" barColor="from-blue-500 to-blue-400" />
                <SubScoreCard icon={Headphones} label="Customer Experience" score={report.avgSubScores.customerExperience} color="text-green-600" barColor="from-green-500 to-emerald-400" />
                <SubScoreCard icon={MessageCircle} label="Communication" score={report.avgSubScores.communication} color="text-purple-600" barColor="from-purple-500 to-violet-400" />
                <SubScoreCard icon={CheckCircle2} label="Resolution" score={report.avgSubScores.resolution} color="text-amber-600" barColor="from-amber-500 to-yellow-400" />
              </div>
            )}
            {!showDetailedScores && (
              <div className="flex gap-6">
                {[
                  { label: "Compliance", value: report.avgSubScores.compliance, color: "text-blue-600" },
                  { label: "Customer Exp.", value: report.avgSubScores.customerExperience, color: "text-green-600" },
                  { label: "Communication", value: report.avgSubScores.communication, color: "text-purple-600" },
                  { label: "Resolution", value: report.avgSubScores.resolution, color: "text-amber-600" },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-lg font-bold ${s.color}`}>{s.value.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trend Chart */}
        {report?.trends && report.trends.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Performance Trend
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={report.trends.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Line type="monotone" dataKey="avgScore" name="Avg Score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="calls" name="Call Volume" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="5 5" yAxisId="right" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Sentiment Trend (stacked bar) */}
        {report?.trends && report.trends.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <Smile className="w-5 h-5 mr-2" />
              Sentiment Trend
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={report.trends.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Bar dataKey="positive" name="Positive" stackId="sentiment" fill="#22c55e" />
                <Bar dataKey="neutral" name="Neutral" stackId="sentiment" fill="#94a3b8" />
                <Bar dataKey="negative" name="Negative" stackId="sentiment" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top Performers & Sentiment Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <Star className="w-5 h-5 mr-2" />
              Top Performers
            </h3>
            {report?.performers && report.performers.length > 0 ? (
              <ul className="space-y-3">
                {report.performers.slice(0, 10).map((p, i) => (
                  <li key={p.id || i} className="flex justify-between items-center">
                    <span className="font-medium">
                      <span className="text-muted-foreground mr-2">{i + 1}.</span>
                      {p.name}
                      <span className="text-xs text-muted-foreground ml-2">({p.totalCalls} calls)</span>
                    </span>
                    <span className="font-bold text-green-500">
                      {p.avgPerformanceScore != null ? Number(p.avgPerformanceScore).toFixed(1) : "N/A"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No data for this period.</p>
            )}
          </div>

          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
              <Smile className="w-5 h-5 mr-2" />
              Sentiment Breakdown
            </h3>
            <ul className="space-y-3">
              {(["positive", "neutral", "negative"] as const).map(key => {
                const colors = { positive: "text-green-600", neutral: "text-gray-600", negative: "text-red-600" };
                const current = report?.sentiment[key] ?? 0;
                const prev = compareEnabled ? compareReport?.sentiment[key] : undefined;
                const d = compareEnabled && prev !== undefined ? delta(current, prev) : null;
                return (
                  <li key={key} className="flex justify-between items-center">
                    <span className={`font-medium capitalize ${colors[key]}`}>{key}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold">{current}</span>
                      {d && (
                        <span className={`text-xs ${d.positive ? "text-green-500" : "text-red-500"}`}>
                          ({d.positive ? "+" : ""}{d.pct}%)
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Agent Profile Section (employee reports only) */}
        {reportType === "employee" && selectedEmployee && agentProfile && (
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-1 flex items-center">
              <User className="w-5 h-5 mr-2" />
              Agent Profile: {agentProfile.employee.name}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Aggregated feedback from {agentProfile.totalCalls} analyzed calls
              {agentProfile.employee.role && ` — ${agentProfile.employee.role}`}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground">Avg Score</p>
                <p className="text-2xl font-bold text-green-500">{agentProfile.avgPerformanceScore?.toFixed(1) ?? "N/A"}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground">Best Score</p>
                <p className="text-2xl font-bold">{agentProfile.highScore?.toFixed(1) ?? "N/A"}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground">Lowest Score</p>
                <p className="text-2xl font-bold">{agentProfile.lowScore?.toFixed(1) ?? "N/A"}</p>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <p className="text-xs text-muted-foreground">Total Calls</p>
                <p className="text-2xl font-bold">{agentProfile.totalCalls}</p>
              </div>
            </div>

            {/* Agent score trend */}
            {agentProfile.scoreTrend.length > 1 && (
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-foreground mb-2">Score Trend Over Time</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={agentProfile.scoreTrend.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Line type="monotone" dataKey="avgScore" name="Avg Score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Strengths */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 text-green-600">Recurring Strengths</h4>
                {agentProfile.topStrengths.length > 0 ? (
                  <ul className="space-y-1.5">
                    {agentProfile.topStrengths.map((s, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-green-500 mt-0.5 shrink-0">+</span>
                        <span className="capitalize">{s.text}</span>
                        {s.count > 1 && <span className="text-xs text-muted-foreground shrink-0">x{s.count}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                )}
              </div>

              {/* Suggestions */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 text-amber-600">Recurring Suggestions</h4>
                {agentProfile.topSuggestions.length > 0 ? (
                  <ul className="space-y-1.5">
                    {agentProfile.topSuggestions.map((s, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                        <span className="capitalize">{s.text}</span>
                        {s.count > 1 && <span className="text-xs text-muted-foreground shrink-0">x{s.count}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                )}
              </div>
            </div>

            {/* Common topics */}
            {agentProfile.commonTopics.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground mb-2">Common Call Topics</h4>
                <div className="flex flex-wrap gap-2">
                  {agentProfile.commonTopics.map((t, i) => (
                    <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary font-medium capitalize">
                      {t.text}
                      {t.count > 1 && <span className="ml-1 text-muted-foreground">({t.count})</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Flagged Calls */}
            {agentProfile.flaggedCalls && agentProfile.flaggedCalls.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground mb-3">Flagged Calls</h4>
                <div className="space-y-2">
                  {agentProfile.flaggedCalls.map(fc => (
                    <FlaggedCallCard key={fc.id} call={fc} />
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> AI Performance Summary
                </h4>
                <Button
                  size="sm"
                  variant={aiSummary ? "outline" : "default"}
                  onClick={() => summaryMutation.mutate()}
                  disabled={summaryMutation.isPending}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  {summaryMutation.isPending ? "Generating..." : aiSummary ? "Regenerate" : "Generate AI Summary"}
                </Button>
              </div>
              {summaryMutation.isError && (
                <p className="text-sm text-red-500 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  {summaryMutation.error?.message || "Failed to generate summary"}
                </p>
              )}
              {aiSummary && (
                <div className="bg-muted/50 rounded-lg p-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {aiSummary}
                </div>
              )}
              {!aiSummary && !summaryMutation.isPending && (
                <p className="text-sm text-muted-foreground">
                  Click "Generate AI Summary" to create a narrative performance review based on aggregated call data.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---- Sub-components ----

function MetricCard({
  label,
  value,
  format,
  color,
  compareValue,
  delta: d,
}: {
  label: string;
  value: number;
  format: "int" | "sentiment" | "score";
  color?: string;
  compareValue?: number;
  delta: { diff: number; pct: string; positive: boolean } | null | undefined;
}) {
  const formatted =
    format === "int" ? String(value)
    : format === "sentiment" ? value.toFixed(2)
    : `${value.toFixed(1)}/10`;

  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold ${color || ""}`}>{formatted}</p>
      {d && (
        <div className={`flex items-center justify-center gap-1 mt-1 text-xs ${d.positive ? "text-green-500" : "text-red-500"}`}>
          {d.positive ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span>{d.positive ? "+" : ""}{d.pct}%</span>
          {compareValue !== undefined && (
            <span className="text-muted-foreground ml-1">
              (was {format === "int" ? compareValue : format === "sentiment" ? compareValue.toFixed(2) : `${compareValue.toFixed(1)}`})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FlaggedCallCard({ call }: {
  call: {
    id: string;
    fileName?: string;
    uploadedAt?: string;
    score: number | null;
    summary?: string;
    flags: string[];
    sentiment?: string;
    flagType: "good" | "bad";
  };
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const isGood = call.flagType === "good";
  const borderClass = isGood ? "border-emerald-200 dark:border-emerald-900" : "border-red-200 dark:border-red-900";
  const bgClass = isGood ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-red-50/50 dark:bg-red-950/20";
  const accentClass = isGood ? "text-emerald-600" : "text-red-600";
  const playerBg = isGood ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-red-100 dark:bg-red-900/40";
  const Icon = isGood ? Award : AlertTriangle;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className={`rounded-lg border p-3 ${borderClass} ${bgClass}`}>
      <audio
        ref={audioRef}
        src={`/api/calls/${call.id}/audio`}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <div className="flex items-start gap-3">
        {/* Play button */}
        <button
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${playerBg} ${accentClass} hover:opacity-80 transition-opacity`}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-3.5 h-3.5 shrink-0 ${accentClass}`} />
            <span className="text-xs font-medium text-muted-foreground">
              {call.uploadedAt ? new Date(call.uploadedAt).toLocaleDateString() : "Unknown date"}
            </span>
            {call.score != null && (
              <span className={`text-xs font-bold ${accentClass}`}>{call.score.toFixed(1)}/10</span>
            )}
            <div className="flex gap-1 ml-auto">
              {call.flags.map((flag, i) => {
                const isExceptional = flag === "exceptional_call";
                const isMisconduct = flag.startsWith("agent_misconduct");
                const isLow = flag === "low_score";
                const isMedicare = flag === "medicare_call";
                const label = isExceptional ? "Exceptional" : isMisconduct ? "Misconduct" : isLow ? "Low Score" : isMedicare ? "Medicare" : flag;
                const color = isExceptional ? "bg-emerald-200 text-emerald-900" : isMisconduct ? "bg-red-200 text-red-900" : isMedicare ? "bg-blue-200 text-blue-900" : "bg-amber-200 text-amber-900";
                return <Badge key={i} className={`${color} text-[10px] px-1.5 py-0`}>{label}</Badge>;
              })}
            </div>
          </div>
          {call.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2">{call.summary}</p>
          )}
          <Link href={`/transcripts/${call.id}`} className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1">
            <Eye className="w-3 h-3" /> View Full Call
          </Link>
        </div>
      </div>
    </div>
  );
}

function SubScoreCard({ icon: Icon, label, score, color, barColor }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  score: number;
  color: string;
  barColor: string;
}) {
  const level = score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Needs Work" : "Critical";
  const levelColor = score >= 8 ? "text-green-600" : score >= 6 ? "text-blue-600" : score >= 4 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="p-4 bg-muted/30 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-2xl font-bold ${color}`}>{score.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">/10</span>
      </div>
      <div className="w-full h-2 bg-muted-foreground/20 rounded-full overflow-hidden mb-1">
        <div className={`h-full rounded-full bg-gradient-to-r ${barColor}`} style={{ width: `${score * 10}%` }} />
      </div>
      <p className={`text-xs ${levelColor}`}>{level}</p>
    </div>
  );
}
