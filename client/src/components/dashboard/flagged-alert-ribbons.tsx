/**
 * Flagged-calls alert ribbons for the role-routed dashboard variants.
 *
 * The old dashboard had gradient-bordered hero banners that surfaced
 * "N call(s) need attention" / "N exceptional call(s)" at the top of
 * the page. The warm-paper design installment is anti-gradient; this
 * component re-instates the information but renders it as a pair of
 * slim, hairline-bordered callouts matching the new system:
 *   - warm-red left-rule + soft-red fill for needs-attention
 *   - sage    left-rule + soft-sage  fill for exemplars
 * Tokens: `--destructive`, `--warm-red-soft`, `--chart-2`, `--sage-soft`.
 *
 * Pure presentational; the page wires up the underlying calls data.
 */
import { Link } from "wouter";
import type { CallWithDetails } from "@shared/schema";

interface Props {
  badCalls: CallWithDetails[];
  goodCalls: CallWithDetails[];
  /** Max badges to render per ribbon before "+ N more" takes over. */
  maxBadges?: number;
}

export default function FlaggedAlertRibbons({ badCalls, goodCalls, maxBadges = 5 }: Props) {
  if (badCalls.length === 0 && goodCalls.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {badCalls.length > 0 && (
        <AlertRibbon
          role="alert"
          tone="bad"
          label={`${badCalls.length} call${badCalls.length > 1 ? "s" : ""} need attention`}
          sub="Flagged for low score or agent misconduct."
          calls={badCalls}
          max={maxBadges}
          testId="flagged-bad-banner"
        />
      )}
      {goodCalls.length > 0 && (
        <AlertRibbon
          role="status"
          tone="good"
          label={`${goodCalls.length} exceptional call${goodCalls.length > 1 ? "s" : ""}`}
          sub="Calls where agents went above and beyond."
          calls={goodCalls}
          max={maxBadges}
          testId="flagged-good-banner"
        />
      )}
    </div>
  );
}

interface AlertRibbonProps {
  role: "alert" | "status";
  tone: "bad" | "good";
  label: string;
  sub: string;
  calls: CallWithDetails[];
  max: number;
  testId: string;
}

function AlertRibbon({ role, tone, label, sub, calls, max, testId }: AlertRibbonProps) {
  // Palette per tone, pulled from the new theme tokens so this
  // automatically follows light/dark mode changes.
  const bg = tone === "bad" ? "var(--warm-red-soft)" : "var(--sage-soft)";
  const accent = tone === "bad" ? "var(--destructive)" : "var(--chart-2)";
  const glyph = tone === "bad" ? "●" : "★";

  return (
    <div
      role={role}
      data-testid={testId}
      className="text-sm leading-relaxed"
      style={{
        background: bg,
        border: `1px solid color-mix(in oklch, ${accent}, transparent 60%)`,
        borderLeft: `3px solid ${accent}`,
        padding: "12px 18px",
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: accent, paddingTop: 4 }}>
          {glyph} attention
        </span>
        <div className="flex-1 min-w-0" style={{ minWidth: 0 }}>
          <div className="font-display text-[14px] font-medium text-foreground">{label}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">{sub}</div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {calls.slice(0, max).map((c) => {
              const score = parseFloat(c.analysis?.performanceScore || "0");
              return (
                <Link key={c.id} href={`/transcripts/${c.id}`}>
                  <a
                    className="font-mono text-[10px] uppercase tracking-[0.08em] inline-block"
                    style={{
                      padding: "3px 8px",
                      border: `1px solid color-mix(in oklch, ${accent}, transparent 50%)`,
                      color: accent,
                      background: "var(--card)",
                      textDecoration: "none",
                      borderRadius: 2,
                    }}
                  >
                    {(c.employee?.name || "Unassigned")} · {Number.isFinite(score) ? score.toFixed(1) : "—"}
                  </a>
                </Link>
              );
            })}
            {calls.length > max && (
              <Link href="/reports">
                <a
                  className="font-mono text-[10px] uppercase tracking-[0.08em] inline-block"
                  style={{
                    padding: "3px 8px",
                    border: "1px solid var(--border)",
                    color: "var(--muted-foreground)",
                    background: "var(--card)",
                    textDecoration: "none",
                    borderRadius: 2,
                  }}
                >
                  + {calls.length - max} more
                </a>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
