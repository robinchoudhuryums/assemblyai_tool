import { useState, useRef, type ComponentType } from "react";
import { CaretDown, CaretUp, Eye, Pause, Play, Trophy, Warning } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { toDisplayString } from "@/lib/display-utils";
import { SCORE_EXCELLENT, SCORE_GOOD, SCORE_NEEDS_WORK } from "@/lib/constants";

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
    <div className="text-center">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-2"
        style={{
          fontSize: 36,
          letterSpacing: "-0.8px",
          lineHeight: 1,
          color: color || "var(--foreground)",
        }}
      >
        {formatted}
      </div>
      {d && (
        <div
          className="flex items-center justify-center gap-1 mt-2 font-mono tabular-nums"
          style={{
            fontSize: 11,
            color: d.positive ? "var(--sage)" : "var(--destructive)",
          }}
        >
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
  const accent = isGood ? "var(--sage)" : "var(--destructive)";
  const bg = isGood ? "var(--sage-soft)" : "var(--warm-red-soft)";
  const Icon = isGood ? Trophy : Warning;

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
    setPlaying(!playing);
  };

  return (
    <div
      className="border"
      style={{
        background: bg,
        borderColor: `color-mix(in oklch, ${accent}, transparent 60%)`,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        padding: "10px 12px",
      }}
    >
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
          className="rounded-full flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity"
          style={{
            width: 36,
            height: 36,
            background: `color-mix(in oklch, ${accent}, transparent 80%)`,
            color: accent,
          }}
          aria-label={playing ? "Pause audio" : "Play audio"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Icon className="shrink-0" style={{ width: 14, height: 14, color: accent }} />
            <span
              className="font-mono tabular-nums text-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {call.uploadedAt ? new Date(call.uploadedAt).toLocaleDateString() : "Unknown date"}
            </span>
            {call.score != null && (
              <span
                className="font-mono font-semibold tabular-nums"
                style={{ fontSize: 11, color: accent }}
              >
                {call.score.toFixed(1)}/10
              </span>
            )}
            <div className="flex gap-1 ml-auto flex-wrap">
              {call.flags.map((flag, i) => <FlagPill key={i} flag={flag} />)}
            </div>
          </div>
          {call.summary && (
            <p
              className="text-muted-foreground line-clamp-2"
              style={{ fontSize: 12, lineHeight: 1.5 }}
            >
              {toDisplayString(call.summary)}
            </p>
          )}
          <Link
            href={`/transcripts/${call.id}`}
            className="font-mono uppercase inline-flex items-center gap-1 mt-1.5 text-foreground hover:text-accent transition-colors"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            <Eye className="w-3 h-3" /> View full call
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Warm-paper flag pill used on FlaggedCallCard. Matches the
 * CallsPreviewRail flag pill palette so the same flag reads the same
 * way across pages.
 */
function FlagPill({ flag }: { flag: string }) {
  const isExceptional = flag === "exceptional_call";
  const isMisconduct = flag.startsWith("agent_misconduct");
  const isLow = flag === "low_score";
  const isMedicare = flag === "medicare_call";
  const label = isExceptional
    ? "Exceptional"
    : isMisconduct
    ? "Misconduct"
    : isLow
    ? "Low score"
    : isMedicare
    ? "Medicare"
    : flag.replace(/_/g, " ");
  const color = isExceptional
    ? "var(--sage)"
    : isMisconduct || isLow
    ? "var(--destructive)"
    : isMedicare
    ? "var(--accent)"
    : "var(--muted-foreground)";
  return (
    <span
      className="font-mono uppercase"
      style={{
        fontSize: 9,
        padding: "2px 6px",
        color,
        border: `1px solid ${color}`,
        borderRadius: 2,
        letterSpacing: "0.06em",
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
}

export function SubScoreCard({
  icon: IconComponent,
  label,
  score,
  color,
  // barColor kept in signature for back-compat; warm-paper ignores the gradient.
  barColor: _barColor,
}: {
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  score: number;
  color: string;
  barColor: string;
}) {
  const level =
    score >= SCORE_EXCELLENT
      ? "Excellent"
      : score >= SCORE_GOOD
      ? "Good"
      : score >= SCORE_NEEDS_WORK
      ? "Needs work"
      : "Critical";
  const tierColor =
    score >= SCORE_EXCELLENT
      ? "var(--sage)"
      : score >= SCORE_GOOD
      ? "var(--foreground)"
      : score >= SCORE_NEEDS_WORK
      ? "var(--accent)"
      : "var(--destructive)";
  return (
    <div className="bg-card border border-border" style={{ padding: "14px 16px" }}>
      <div className="flex items-center gap-2 mb-2">
        <IconComponent className={`w-4 h-4 ${color}`} />
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span
          className="font-display font-medium tabular-nums"
          style={{ fontSize: 24, letterSpacing: "-0.5px", color: tierColor }}
        >
          {score.toFixed(1)}
        </span>
        <span
          className="font-mono text-muted-foreground"
          style={{ fontSize: 11 }}
        >
          / 10
        </span>
      </div>
      <div
        className="w-full overflow-hidden"
        style={{ height: 3, background: "var(--secondary)", borderRadius: 2 }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, score * 10))}%`,
            background: tierColor,
          }}
        />
      </div>
      <p
        className="font-mono uppercase mt-1.5"
        style={{ fontSize: 9, letterSpacing: "0.1em", color: tierColor }}
      >
        {level}
      </p>
    </div>
  );
}
