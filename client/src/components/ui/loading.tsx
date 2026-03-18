/**
 * Animated loading indicators for CallAnalyzer.
 * Replaces the generic spinning AudioWaveform icon with
 * an audio-equalizer style animation.
 */

/** Full-page / section loading indicator with animated equalizer bars */
export function LoadingIndicator({ text, size = "md" }: { text?: string; size?: "sm" | "md" | "lg" }) {
  const barCount = size === "sm" ? 3 : size === "lg" ? 7 : 5;
  const height = size === "sm" ? "h-6" : size === "lg" ? "h-12" : "h-8";
  const barWidth = size === "sm" ? "w-0.5" : "w-1";
  const gap = size === "sm" ? "gap-0.5" : "gap-1";

  return (
    <div className="flex flex-col items-center justify-center animate-fade-in-up">
      <div className={`flex items-end ${gap} ${height}`}>
        {Array.from({ length: barCount }).map((_, i) => (
          <div
            key={i}
            className={`${barWidth} rounded-full bg-primary animate-equalizer`}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
      {text && (
        <p className="mt-3 text-sm text-muted-foreground">{text}</p>
      )}
    </div>
  );
}

/** Inline loading indicator (for buttons, small areas) */
export function LoadingDots() {
  return (
    <span className="inline-flex gap-0.5 items-center">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-current animate-equalizer"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

/** Shimmer card placeholder for skeleton loading */
export function ShimmerCard({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-r from-muted via-muted-foreground/5 to-muted bg-[length:200%_100%] animate-shimmer ${className || ""}`}
    />
  );
}
