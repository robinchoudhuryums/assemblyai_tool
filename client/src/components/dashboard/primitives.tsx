/**
 * Shared visual primitives for the role-routed analytics dashboard
 * (Ledger + Pulse variants — see `ledger-variant.tsx`, `pulse-variant.tsx`).
 *
 * These are pure, presentational components. No data fetching. Each one
 * maps to a primitive defined in the Claude Design handoff bundle at
 * `docs/design-bundle/project/primitives.jsx`. Kept deliberately simple:
 * inline SVG, no Recharts, no external deps. The tokens (`--paper`,
 * `--ink`, `--accent`, `--good`, `--warn`, `--line`, `--muted-ink`,
 * `--paper-2`, `--paper-card`) come from the app-wide theme in
 * `client/src/index.css`.
 */
import type { CSSProperties, ReactNode } from "react";

// ───────────────────────────────────────────────────────────
// Sparkline — compact line graph inside stat blocks.
// ───────────────────────────────────────────────────────────
interface SparklineProps {
  data: Array<number | null>;
  width?: number;
  height?: number;
  stroke?: string;
}

export function Sparkline({ data, width = 90, height = 18, stroke = "currentColor" }: SparklineProps) {
  const clean = data.filter((v): v is number => v != null);
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  let d = "";
  data.forEach((v, i) => {
    if (v == null) return;
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    d += (d ? " L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
  });
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ───────────────────────────────────────────────────────────
// Sentiment curve — continuous 24h curve with volume bars underneath.
// `sentiment` and `volume` are parallel arrays of length 24.
// Values in [-1, 1] for sentiment; any non-negative ints for volume.
// ───────────────────────────────────────────────────────────
interface SentimentCurveProps {
  sentiment: Array<number | null>;
  volume: number[];
  width?: number;
  height?: number;
}

export function SentimentCurve({ sentiment, volume, width = 820, height = 180 }: SentimentCurveProps) {
  const pad = { l: 32, r: 16, t: 16, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = sentiment.length;
  const x = (i: number) => pad.l + (i / (n - 1)) * w;
  const y = (v: number) => pad.t + (1 - (v + 1) / 2) * h;
  const maxVol = Math.max(...volume, 1);

  const pts: Array<[number, number]> = [];
  sentiment.forEach((v, i) => {
    if (v != null) pts.push([x(i), y(v)]);
  });

  // Quadratic-smoothed path through the non-null points
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    if (i === 0) {
      d += `M${px},${py}`;
    } else {
      const [qx, qy] = pts[i - 1];
      const mx = (px + qx) / 2;
      d += ` Q${mx},${qy} ${mx},${(py + qy) / 2} T${px},${py}`;
    }
  }
  const area = pts.length > 0 ? d + ` L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";

  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24-hour sentiment and call volume curve">
      {/* zero line */}
      <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="2 3" />
      {/* y-axis ticks */}
      <text x={pad.l - 6} y={y(1) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">+1</text>
      <text x={pad.l - 6} y={y(0) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">0</text>
      <text x={pad.l - 6} y={y(-1) + 3} textAnchor="end" fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">-1</text>
      {/* volume bars at the bottom */}
      {volume.map((v, i) => {
        const bh = (v / maxVol) * 22;
        return (
          <rect key={i} x={x(i) - 3} y={height - pad.b + 2} width="6" height={bh} fill="var(--border)" opacity="0.6" />
        );
      })}
      {/* hour labels */}
      {[0, 6, 12, 18, 23].map((i) => (
        <text key={i} x={x(i)} y={height - 2} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)" fontFamily="var(--font-mono)">
          {String(i).padStart(2, "0")}:00
        </text>
      ))}
      {/* area fill */}
      {area && <path d={area} fill="var(--accent)" opacity="0.08" />}
      {/* sentiment line */}
      {d && <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {/* data dots */}
      {sentiment.map((v, i) =>
        v == null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--background)" stroke="var(--accent)" strokeWidth="1.5" />
        ),
      )}
    </svg>
  );
}

// ───────────────────────────────────────────────────────────
// Rubric rack — four vertical bars for sub-scores.
// ───────────────────────────────────────────────────────────
export interface RubricValues {
  compliance: number;
  customerExperience: number;
  communication: number;
  resolution: number;
}

export function RubricRack({ rubric, compact = false }: { rubric: RubricValues; compact?: boolean }) {
  const entries: Array<[string, number]> = [
    ["Compliance", rubric.compliance],
    ["Customer Exp.", rubric.customerExperience],
    ["Communication", rubric.communication],
    ["Resolution", rubric.resolution],
  ];
  const barH = compact ? 120 : 160;
  return (
    <div style={{ display: "flex", gap: compact ? 18 : 28, alignItems: "flex-end" }}>
      {entries.map(([name, val]) => {
        const pct = Math.min(100, Math.max(0, (val / 10) * 100));
        const low = val < 7;
        return (
          <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div className="font-mono text-[11px] tabular-nums font-medium text-foreground">{val.toFixed(1)}</div>
            <div style={{ width: 20, height: barH, background: "var(--secondary)", border: "1px solid var(--border)", position: "relative" }}>
              <div
                className="score-bar-fill"
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: pct + "%",
                  background: low ? "var(--destructive)" : "var(--accent)",
                }}
              />
              {[2.5, 5, 7.5].map((t) => (
                <div
                  key={t}
                  style={{
                    position: "absolute",
                    left: -3,
                    right: -3,
                    bottom: (t / 10) * barH,
                    height: 1,
                    background: "var(--border)",
                    opacity: 0.6,
                  }}
                />
              ))}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground text-center leading-tight" style={{ maxWidth: 68 }}>
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Score dial — circular progress + numeric center.
// ───────────────────────────────────────────────────────────
export function ScoreDial({ value, size = 120, label = "Score" }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / 10));
  const off = c * (1 - pct);
  const stroke = value >= 8.5 ? "var(--chart-2)" : value >= 7 ? "var(--accent)" : "var(--destructive)";
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="font-display font-medium text-foreground tabular-nums"
          style={{ fontSize: size * 0.32, letterSpacing: "-1px", lineHeight: 1 }}
        >
          {value.toFixed(1)}
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground" style={{ marginTop: -2 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Sentiment dot — positive / negative / neutral indicator.
// ───────────────────────────────────────────────────────────
export function SentimentDot({ kind }: { kind: "positive" | "negative" | "neutral" }) {
  const color = kind === "positive" ? "var(--chart-2)" : kind === "negative" ? "var(--destructive)" : "var(--muted-foreground)";
  return (
    <span
      aria-label={`${kind} sentiment`}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color }}
    />
  );
}

// ───────────────────────────────────────────────────────────
// Avatar — initials in a circle. Uses display font.
// ───────────────────────────────────────────────────────────
export function Avatar({ initials, size = 28 }: { initials: string; size?: number }) {
  return (
    <div
      className="font-display font-medium text-foreground"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--secondary)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Stat block — label + big number + delta + optional sparkline.
// ───────────────────────────────────────────────────────────
export interface StatBlockProps {
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  spark?: Array<number | null>;
  sparkColor?: string;
  style?: CSSProperties;
}

export function StatBlock({ label, value, unit, delta, spark, sparkColor, style }: StatBlockProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div
          className="font-display font-medium tabular-nums text-foreground"
          style={{ fontSize: 32, letterSpacing: "-1px", lineHeight: 1 }}
        >
          {value}
        </div>
        {unit && <div className="font-mono text-[12px] text-muted-foreground">{unit}</div>}
      </div>
      {(delta != null || spark) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {delta != null && (
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: delta >= 0 ? "var(--chart-2)" : "var(--destructive)" }}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
            </span>
          )}
          {spark && (
            <div style={{ color: sparkColor || "var(--accent)" }}>
              <Sparkline data={spark} width={90} height={18} stroke="currentColor" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Section header — mono kicker + display title. Used throughout
// the Ledger / Pulse variants to break up the page.
// ───────────────────────────────────────────────────────────
export function SectionHeader({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{kicker}</div>
        <div className="font-display text-[22px] font-medium tracking-[-0.01em] mt-0.5">{title}</div>
      </div>
      {right}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Pulse-style card wrapper — used inside the Pulse variant and
// reusable anywhere a bordered-card panel is needed.
// ───────────────────────────────────────────────────────────
export function PulseCard({
  title,
  kicker,
  children,
  pad = 24,
  style,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  pad?: number;
  style?: CSSProperties;
}) {
  return (
    <div className="bg-card border border-border" style={{ borderRadius: 2, ...style }}>
      <div
        style={{
          padding: pad === 0 ? "20px 24px 12px" : `${pad}px ${pad}px 12px`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div>
          {kicker && (
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{kicker}</div>
          )}
          <div className="font-display text-[18px] font-medium tracking-[-0.01em] mt-0.5">{title}</div>
        </div>
      </div>
      <div style={{ padding: pad === 0 ? 0 : `4px ${pad}px ${pad}px` }}>{children}</div>
    </div>
  );
}
