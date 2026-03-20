import { useState, useRef, type ComponentType } from "react";
import { CaretDown, CaretUp, Eye, Pause, Play, Trophy, Warning } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

// ---- Types shared across report components ----

export type ReportType = "overall" | "employee" | "department";
export type DatePreset = "last30" | "last90" | "ytd" | "lastYear" | "custom";

export interface FilteredReportData {
  metrics: { totalCalls: number; avgSentiment: number; avgPerformanceScore: number };
  sentiment: { positive: number; neutral: number; negative: number };
  performers: Array<{ id: string; name: string; role: string; avgPerformanceScore: number | null; totalCalls: number }>;
  trends: Array<{ month: string; calls: number; avgScore: number | null; positive: number; neutral: number; negative: number }>;
  avgSubScores?: { compliance: number; customerExperience: number; communication: number; resolution: number } | null;
  autoAssignedCount?: number;
}

export interface AgentProfileData {
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
  flaggedCalls: Array<FlaggedCall>;
}

export interface FlaggedCall {
  id: string;
  fileName?: string;
  uploadedAt?: string;
  score: number | null;
  summary?: string;
  flags: string[];
  sentiment?: string;
  flagType: "good" | "bad";
}

// ---- Helpers ----

export function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
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
      return f > t ? { from: t, to: f } : { from: f, to: t };
    }
  }
}

export function formatMonth(m: string) {
  const [year, month] = m.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  last30: "Last 30 Days",
  last90: "Last 90 Days",
  ytd: "Year to Date",
  lastYear: "Last Year",
  custom: "Custom Range",
};

// ---- Sub-components ----

export function MetricCard({
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
          {d.positive ? <CaretUp className="w-3 h-3" /> : <CaretDown className="w-3 h-3" />}
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

export function FlaggedCallCard({ call }: { call: FlaggedCall }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const isGood = call.flagType === "good";
  const borderClass = isGood ? "border-emerald-200 dark:border-emerald-900" : "border-red-200 dark:border-red-900";
  const bgClass = isGood ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-red-50/50 dark:bg-red-950/20";
  const accentClass = isGood ? "text-emerald-600" : "text-red-600";
  const playerBg = isGood ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-red-100 dark:bg-red-900/40";
  const Icon = isGood ? Trophy : Warning;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
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
        <button
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${playerBg} ${accentClass} hover:opacity-80 transition-opacity`}
          aria-label={playing ? "Pause audio" : "Play audio"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
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
                const fcolor = isExceptional ? "bg-emerald-200 text-emerald-900" : isMisconduct ? "bg-red-200 text-red-900" : isMedicare ? "bg-blue-200 text-blue-900" : "bg-amber-200 text-amber-900";
                return <Badge key={i} className={`${fcolor} text-[10px] px-1.5 py-0`}>{label}</Badge>;
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

export function SubScoreCard({ icon: IconComponent, label, score, color, barColor }: {
  icon: ComponentType<{ className?: string }>;
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
        <IconComponent className={`w-4 h-4 ${color}`} />
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
