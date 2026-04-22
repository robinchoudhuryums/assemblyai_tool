import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRight, Calendar, ChartBar, ChatCircle, CheckCircle, DownloadSimple, Headphones, Phone, Shield, Sliders, Smiley, Sparkle, Star, TrendUp, User, Users, Warning } from "@phosphor-icons/react";
import { LoadingIndicator, LoadingDots, ShimmerCard } from "@/components/ui/loading";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Employee } from "@shared/schema";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { toDisplayString } from "@/lib/display-utils";
import {
  type ReportType, type DatePreset, type FilteredReportData, type AgentProfileData,
  getDateRange, formatMonth, PRESET_LABELS,
  MetricCard, FlaggedCallCard, SubScoreCard,
} from "@/components/reports/report-components";
import {
  scoreTierColor,
  CHART_TICK,
  CHART_TOOLTIP,
  CHART_LEGEND,
} from "@/components/analytics/chart-primitives";

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
      const { getCsrfToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/reports/agent-summary/${selectedEmployee}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getCsrfToken() ? { "x-csrf-token": getCsrfToken()! } : {}) },
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
  const { data: compareReport, isLoading: isCompareLoading, error: compareError } = useQuery<FilteredReportData>({
    queryKey: compareQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/reports/filtered?${buildParams(compareDateRange)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comparison report");
      return res.json();
    },
    enabled: compareEnabled,
  });

  // Agent profile (only for employee report type)
  const { data: agentProfile, error: agentProfileError } = useQuery<AgentProfileData>({
    queryKey: ["/api/reports/agent-profile", selectedEmployee, dateRange.from, dateRange.to],
    queryFn: async () => {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
      const res = await fetch(`/api/reports/agent-profile/${selectedEmployee}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agent profile");
      return res.json();
    },
    enabled: reportType === "employee" && !!selectedEmployee,
  });

  // Server-side CSV export. Retired the prior client-built CSV + TXT
  // downloads + export-beacon pattern (the browser-assembled files never
  // made it cleanly into the audit log when the beacon failed). The
  // server endpoints emit `event: "export_report"` HIPAA audit entries
  // synchronously as part of request handling.
  const handleDownloadCSV = () => {
    if (!report) return;
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    if (reportType === "employee" && selectedEmployee) {
      window.open(`/api/reports/agent-profile/${selectedEmployee}/export.csv?${params}`, "_blank");
    } else {
      if (reportType === "department" && selectedDepartment) {
        params.set("role", selectedDepartment);
      }
      window.open(`/api/reports/filtered/export.csv?${params}`, "_blank");
    }
  };

  // Server-side PDF export (Phase D). Same shape as CSV; separate handler
  // only because the endpoint paths differ by file extension.
  const handleDownloadPDF = () => {
    if (!report) return;
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to });
    if (reportType === "employee" && selectedEmployee) {
      window.open(`/api/reports/agent-profile/${selectedEmployee}/export.pdf?${params}`, "_blank");
    } else {
      if (reportType === "department" && selectedDepartment) {
        params.set("role", selectedDepartment);
      }
      window.open(`/api/reports/filtered/export.pdf?${params}`, "_blank");
    }
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
      <div className="min-h-screen animate-fade-in-up">
        <header className="bg-card border-b border-border px-6 py-4">
          <ShimmerCard className="h-8 w-56" />
          <ShimmerCard className="h-4 w-80 mt-2" />
        </header>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-6">
                <ShimmerCard className="h-4 w-24 mb-3" />
                <ShimmerCard className="h-8 w-16" />
              </div>
            ))}
          </div>
          <div className="bg-card rounded-lg border border-border p-6">
            <ShimmerCard className="h-5 w-40 mb-4" />
            <ShimmerCard className="h-64" />
          </div>
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator text="Loading report..." />
          </div>
        </div>
      </div>
    );
  }

  if (reportError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-destructive">
        <Warning className="w-8 h-8 mb-2" />
        <p className="font-semibold">Failed to load report</p>
        <p className="text-sm text-muted-foreground">{reportError.message}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="reports-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Reports</span>
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleDownloadCSV}
          disabled={!report}
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          data-testid="download-csv"
        >
          <DownloadSimple style={{ width: 12, height: 12 }} />
          CSV
        </button>
        <button
          type="button"
          onClick={handleDownloadPDF}
          disabled={!report}
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
          data-testid="download-pdf"
        >
          <DownloadSimple style={{ width: 12, height: 12 }} />
          PDF
        </button>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          Performance reports · {PRESET_LABELS[datePreset]}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          {reportType === "employee" && selectedEmployee
            ? (employees?.find((e) => e.id === selectedEmployee)?.name ?? "Employee")
            : reportType === "department" && selectedDepartment
            ? `${selectedDepartment}`
            : "Overall performance"}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-background border-b border-border px-4 sm:px-7 py-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Report Type */}
          <div className="min-w-[160px]">
            <FilterLabel>Report Type</FilterLabel>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="overall"><span className="flex items-center gap-1.5"><ChartBar className="w-3.5 h-3.5" /> Overall</span></SelectItem>
                <SelectItem value="employee"><span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Individual Employee</span></SelectItem>
                <SelectItem value="department"><span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Department</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Employee selector */}
          {reportType === "employee" && (
            <div className="min-w-[200px]">
              <FilterLabel>Employee</FilterLabel>
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
              <FilterLabel>Department</FilterLabel>
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
            <FilterLabel>Call Party</FilterLabel>
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
            <FilterLabel>Time Period</FilterLabel>
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
                <FilterLabel>From</FilterLabel>
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-[150px]" />
              </div>
              <div>
                <FilterLabel>To</FilterLabel>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-[150px]" />
              </div>
            </>
          )}

          {/* Compare toggle */}
          <button
            type="button"
            onClick={() => setCompareEnabled(!compareEnabled)}
            className={`ml-auto font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-2 transition-colors ${
              compareEnabled
                ? "bg-foreground text-background border border-foreground"
                : "bg-card border border-border text-foreground hover:bg-secondary"
            }`}
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="compare-toggle"
          >
            <Calendar style={{ width: 12, height: 12 }} />
            {compareEnabled ? "Comparing" : "Compare periods"}
          </button>
        </div>

        {/* Comparison row */}
        {compareEnabled && (
          <div className="flex flex-wrap gap-4 items-end mt-3 pt-3 border-t border-border">
            <div
              className="flex items-center gap-2 font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              <ArrowRight style={{ width: 12, height: 12 }} />
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

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* Metrics Cards */}
        <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
          <SectionHeader icon={ChartBar} label={`Metrics · ${PRESET_LABELS[datePreset]}`} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            <MetricCard
              label="Total calls analyzed"
              value={report?.metrics.totalCalls ?? 0}
              format="int"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.totalCalls : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.totalCalls ?? 0, compareReport?.metrics.totalCalls) : null}
            />
            <MetricCard
              label="Average sentiment"
              value={report?.metrics.avgSentiment ?? 0}
              format="sentiment"
              color="var(--accent)"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.avgSentiment : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.avgSentiment ?? 0, compareReport?.metrics.avgSentiment) : null}
            />
            <MetricCard
              label="Average performance"
              value={report?.metrics.avgPerformanceScore ?? 0}
              format="score"
              color="var(--sage)"
              compareValue={compareEnabled && !isCompareLoading ? compareReport?.metrics.avgPerformanceScore : undefined}
              delta={compareEnabled && !isCompareLoading ? delta(report?.metrics.avgPerformanceScore ?? 0, compareReport?.metrics.avgPerformanceScore) : null}
            />
            {compareEnabled && isCompareLoading && (
              <div className="col-span-3 text-center text-sm text-muted-foreground">
                <LoadingDots /> Loading comparison data...
              </div>
            )}
          </div>
        </section>

        {/* Detailed Sub-Scores (toggleable) */}
        {report?.avgSubScores && (
          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <div className="flex items-center justify-between">
              <SectionHeader icon={Sliders} label="Score breakdown" />
              <button
                type="button"
                onClick={() => setShowDetailedScores(!showDetailedScores)}
                className={`font-mono uppercase rounded-sm px-3 py-1.5 transition-colors ${
                  showDetailedScores
                    ? "bg-foreground text-background border border-foreground"
                    : "bg-card border border-border text-foreground hover:bg-secondary"
                }`}
                style={{ fontSize: 10, letterSpacing: "0.1em" }}
              >
                {showDetailedScores ? "Hide details" : "Show details"}
              </button>
            </div>
            {showDetailedScores && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                <SubScoreCard icon={Shield} label="Compliance" score={report.avgSubScores.compliance} color="text-[var(--accent)]" barColor="" />
                <SubScoreCard icon={Headphones} label="Customer exp." score={report.avgSubScores.customerExperience} color="text-[var(--sage)]" barColor="" />
                <SubScoreCard icon={ChatCircle} label="Communication" score={report.avgSubScores.communication} color="text-[var(--chart-4)]" barColor="" />
                <SubScoreCard icon={CheckCircle} label="Resolution" score={report.avgSubScores.resolution} color="text-[var(--chart-3)]" barColor="" />
              </div>
            )}
            {!showDetailedScores && (
              <div className="flex flex-wrap gap-8 mt-4">
                {[
                  { label: "Compliance", value: report.avgSubScores.compliance },
                  { label: "Customer Exp.", value: report.avgSubScores.customerExperience },
                  { label: "Communication", value: report.avgSubScores.communication },
                  { label: "Resolution", value: report.avgSubScores.resolution },
                ].map((s) => {
                  const tier =
                    s.value >= 8
                      ? "var(--sage)"
                      : s.value >= 6
                      ? "var(--foreground)"
                      : s.value >= 4
                      ? "var(--accent)"
                      : "var(--destructive)";
                  return (
                    <div key={s.label}>
                      <div
                        className="font-mono uppercase text-muted-foreground"
                        style={{ fontSize: 10, letterSpacing: "0.12em" }}
                      >
                        {s.label}
                      </div>
                      <div
                        className="font-display font-medium tabular-nums mt-1"
                        style={{ fontSize: 22, color: tier, letterSpacing: "-0.4px" }}
                      >
                        {s.value.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Performance trend (line chart) */}
        {report?.trends && report.trends.length > 0 && (
          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <SectionHeader icon={TrendUp} label="Performance trend" />
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={report.trends.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                  <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" />
                  <XAxis dataKey="monthLabel" tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <YAxis domain={[0, 10]} tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Legend wrapperStyle={CHART_LEGEND} />
                  <Line type="monotone" dataKey="avgScore" name="Avg score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="calls" name="Call volume" stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="4 3" yAxisId="right" dot={false} />
                  <YAxis yAxisId="right" orientation="right" tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Sentiment trend (stacked bar) */}
        {report?.trends && report.trends.length > 0 && (
          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <SectionHeader icon={Smiley} label="Sentiment trend" />
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={report.trends.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                  <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" />
                  <XAxis dataKey="monthLabel" tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                  <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Legend wrapperStyle={CHART_LEGEND} />
                  <Bar dataKey="positive" name="Positive" stackId="sentiment" fill="var(--sage)" />
                  <Bar dataKey="neutral" name="Neutral" stackId="sentiment" fill="var(--muted-foreground)" />
                  <Bar dataKey="negative" name="Negative" stackId="sentiment" fill="var(--destructive)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Top Performers & Sentiment Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <SectionHeader icon={Star} label="Top performers" />
            {report?.performers && report.performers.length > 0 ? (
              <ul className="flex flex-col mt-4">
                {report.performers.slice(0, 10).map((p, i) => {
                  const score = p.avgPerformanceScore != null ? Number(p.avgPerformanceScore) : null;
                  const scoreColor =
                    score === null
                      ? "var(--muted-foreground)"
                      : score >= 8
                      ? "var(--sage)"
                      : score >= 6
                      ? "var(--foreground)"
                      : "var(--destructive)";
                  return (
                    <li
                      key={p.id || i}
                      className="flex items-center gap-3 py-2.5"
                      style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                    >
                      <span
                        className="font-mono tabular-nums text-muted-foreground"
                        style={{ fontSize: 11, width: 18 }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="text-foreground" style={{ fontSize: 13 }}>
                          {p.name}
                        </span>
                        <span
                          className="font-mono text-muted-foreground ml-2"
                          style={{ fontSize: 10 }}
                        >
                          {p.totalCalls} {p.totalCalls === 1 ? "call" : "calls"}
                        </span>
                      </span>
                      <span
                        className="font-mono tabular-nums font-medium"
                        style={{ fontSize: 13, color: scoreColor }}
                      >
                        {score !== null ? score.toFixed(1) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm mt-4">No data for this period.</p>
            )}
          </section>

          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <SectionHeader icon={Smiley} label="Sentiment breakdown" />
            <ul className="flex flex-col mt-4">
              {(["positive", "neutral", "negative"] as const).map((key, i) => {
                const color =
                  key === "positive"
                    ? "var(--sage)"
                    : key === "negative"
                    ? "var(--destructive)"
                    : "var(--muted-foreground)";
                const current = report?.sentiment[key] ?? 0;
                const prev = compareEnabled ? compareReport?.sentiment[key] : undefined;
                const d = compareEnabled && prev !== undefined ? delta(current, prev) : null;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                    <span
                      className="flex-1 capitalize text-foreground"
                      style={{ fontSize: 13 }}
                    >
                      {key}
                    </span>
                    <span
                      className="font-mono tabular-nums font-medium text-foreground"
                      style={{ fontSize: 13 }}
                    >
                      {current}
                    </span>
                    {d && (
                      <span
                        className="font-mono tabular-nums"
                        style={{
                          fontSize: 10,
                          color: d.positive ? "var(--sage)" : "var(--destructive)",
                        }}
                      >
                        ({d.positive ? "+" : ""}{d.pct}%)
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Error banners for secondary queries */}
        {compareError && compareEnabled && (
          <ErrorBanner>
            Failed to load comparison data: {(compareError as Error).message}
          </ErrorBanner>
        )}
        {agentProfileError && reportType === "employee" && selectedEmployee && (
          <ErrorBanner>
            Failed to load agent profile: {(agentProfileError as Error).message}
          </ErrorBanner>
        )}

        {/* Agent Profile Section (employee reports only) */}
        {reportType === "employee" && selectedEmployee && agentProfile && (
          <section className="bg-card border border-border" style={{ padding: "22px 24px" }}>
            <SectionHeader icon={User} label="Agent profile" />
            <h3
              className="font-display font-medium text-foreground mt-2"
              style={{ fontSize: 22, letterSpacing: "-0.4px" }}
            >
              {agentProfile.employee.name}
            </h3>
            <p
              className="text-muted-foreground mt-1 mb-5"
              style={{ fontSize: 12 }}
            >
              Aggregated feedback from {agentProfile.totalCalls} analyzed {agentProfile.totalCalls === 1 ? "call" : "calls"}
              {agentProfile.employee.role && <> · {agentProfile.employee.role}</>}
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                {
                  label: "Avg score",
                  value: agentProfile.avgPerformanceScore?.toFixed(1) ?? "—",
                  color: scoreTierColor(agentProfile.avgPerformanceScore),
                },
                {
                  label: "Best score",
                  value: agentProfile.highScore?.toFixed(1) ?? "—",
                  color: "var(--sage)",
                },
                {
                  label: "Lowest score",
                  value: agentProfile.lowScore?.toFixed(1) ?? "—",
                  color: "var(--destructive)",
                },
                {
                  label: "Total calls",
                  value: String(agentProfile.totalCalls),
                  color: "var(--foreground)",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-secondary"
                  style={{ padding: "12px 14px", border: "1px solid var(--border)" }}
                >
                  <div
                    className="font-mono uppercase text-muted-foreground"
                    style={{ fontSize: 10, letterSpacing: "0.12em" }}
                  >
                    {stat.label}
                  </div>
                  <div
                    className="font-display font-medium tabular-nums mt-1"
                    style={{ fontSize: 24, letterSpacing: "-0.5px", color: stat.color }}
                  >
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Agent score trend */}
            {agentProfile.scoreTrend.length > 1 && (
              <div className="mb-6">
                <div
                  className="font-mono uppercase text-muted-foreground mb-2"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  Score trend over time
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={agentProfile.scoreTrend.map(t => ({ ...t, monthLabel: formatMonth(t.month) }))}>
                    <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" />
                    <XAxis dataKey="monthLabel" tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                    <YAxis domain={[0, 10]} tick={CHART_TICK} stroke="var(--border)" axisLine={{ stroke: "var(--border)" }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} labelStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                    <Line type="monotone" dataKey="avgScore" name="Avg score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Strengths */}
              <div>
                <div
                  className="font-mono uppercase mb-2"
                  style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--sage)" }}
                >
                  Recurring strengths
                </div>
                {agentProfile.topStrengths.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {agentProfile.topStrengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2" style={{ fontSize: 13 }}>
                        <span style={{ color: "var(--sage)", marginTop: 1, flexShrink: 0 }}>+</span>
                        <span className="capitalize text-foreground">{s.text}</span>
                        {s.count > 1 && (
                          <span className="font-mono text-muted-foreground flex-shrink-0" style={{ fontSize: 10 }}>
                            ×{s.count}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground" style={{ fontSize: 12 }}>No data yet.</p>
                )}
              </div>

              {/* Suggestions */}
              <div>
                <div
                  className="font-mono uppercase mb-2"
                  style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--accent)" }}
                >
                  Recurring suggestions
                </div>
                {agentProfile.topSuggestions.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {agentProfile.topSuggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2" style={{ fontSize: 13 }}>
                        <span style={{ color: "var(--accent)", marginTop: 1, flexShrink: 0 }}>!</span>
                        <span className="capitalize text-foreground">{s.text}</span>
                        {s.count > 1 && (
                          <span className="font-mono text-muted-foreground flex-shrink-0" style={{ fontSize: 10 }}>
                            ×{s.count}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground" style={{ fontSize: 12 }}>No data yet.</p>
                )}
              </div>
            </div>

            {/* Common topics */}
            {agentProfile.commonTopics.length > 0 && (
              <div className="mt-5 pt-5 border-t border-border">
                <div
                  className="font-mono uppercase text-muted-foreground mb-2"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  Common call topics
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agentProfile.commonTopics.map((t, i) => (
                    <span
                      key={i}
                      className="font-mono uppercase inline-flex items-center gap-1 bg-secondary border border-border text-foreground"
                      style={{ fontSize: 10, padding: "3px 8px", letterSpacing: "0.05em" }}
                    >
                      <span className="capitalize">{t.text}</span>
                      {t.count > 1 && (
                        <span className="text-muted-foreground tabular-nums">({t.count})</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Flagged Calls */}
            {agentProfile.flaggedCalls && agentProfile.flaggedCalls.length > 0 && (
              <div className="mt-5 pt-5 border-t border-border">
                <div
                  className="font-mono uppercase text-muted-foreground mb-3"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  Flagged calls
                </div>
                <div className="flex flex-col gap-2">
                  {agentProfile.flaggedCalls.map(fc => (
                    <FlaggedCallCard key={fc.id} call={fc} />
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary */}
            <div className="mt-5 pt-5 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <div
                  className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  <Sparkle style={{ width: 12, height: 12 }} /> AI performance summary
                </div>
                <button
                  type="button"
                  onClick={() => summaryMutation.mutate()}
                  disabled={summaryMutation.isPending}
                  className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    aiSummary
                      ? "bg-card border border-border text-foreground hover:bg-secondary"
                      : "bg-primary text-[var(--paper)] border border-primary hover:opacity-90"
                  }`}
                  style={{ fontSize: 10, letterSpacing: "0.1em" }}
                >
                  <Sparkle style={{ width: 12, height: 12 }} />
                  {summaryMutation.isPending ? "Generating…" : aiSummary ? "Regenerate" : "Generate AI summary"}
                </button>
              </div>
              {summaryMutation.isError && (
                <div className="mb-3">
                  <ErrorBanner>
                    {summaryMutation.error?.message || "Failed to generate summary"}
                  </ErrorBanner>
                </div>
              )}
              {aiSummary && (
                <div
                  className="bg-secondary text-foreground whitespace-pre-wrap leading-relaxed"
                  style={{ padding: "14px 16px", fontSize: 13, border: "1px solid var(--border)" }}
                >
                  {toDisplayString(aiSummary)}
                </div>
              )}
              {!aiSummary && !summaryMutation.isPending && (
                <p className="text-muted-foreground" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Click "Generate AI summary" to create a narrative performance review based on
                  aggregated call data.
                </p>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper section header: icon + mono uppercase label — used across
// each panel in the Reports body. Tier color + Recharts styling were
// lifted to `components/analytics/chart-primitives` in installment 9
// (top-of-file import).
// ─────────────────────────────────────────────────────────────
function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon
        style={{ width: 14, height: 14, color: "var(--muted-foreground)" }}
      />
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 500 }}
      >
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper error banner: warm-red left stripe + soft bg. Used for
// secondary-query failures (compare report, agent profile).
// ─────────────────────────────────────────────────────────────
function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "10px 14px",
        fontSize: 12,
        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
      }}
    >
      <Warning style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper filter-row label (mono uppercase kicker over each Select)
// ─────────────────────────────────────────────────────────────
function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground mb-1.5"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </div>
  );
}
