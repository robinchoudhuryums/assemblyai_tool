/**
 * Bottom-docked audio scrubber (Phase 3 — warm-paper installment 4).
 *
 * Replaces the standalone `audio-waveform.tsx` rendered mid-page. One
 * combined control that shows:
 *   — 44px circular play/pause (copper accent)
 *   — mono tabular-nums elapsed / duration
 *   — rate selector (0.5× → 2×)
 *   — rail: waveform bars (past in accent, future muted) + sentiment
 *     ribbon along the bottom (per-utterance sentiment from
 *     call.sentiment.segments) + playhead cursor + hover tooltip
 *
 * No chapter markers or coaching flag pins — our current AI pipeline
 * doesn't emit either. Either could be added as a follow-on once the
 * data is produced.
 *
 * The waveform amplitude data is decoded client-side via Web Audio API,
 * same technique the legacy AudioWaveformDisplay used. Decoding is
 * one-shot on mount; the AudioContext is closed as soon as the buffer is
 * extracted to keep the audio thread idle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SpeakerHigh, SpeakerLow, SpeakerX } from "@phosphor-icons/react";
import { SPEED_OPTIONS } from "@/lib/constants";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

interface SentimentSegment {
  start?: number;
  end?: number;
  sentiment?: string;
}

interface ScrubberProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** currentTime in ms (matches the rest of transcript-viewer) */
  currentTime: number;
  /** duration in ms */
  duration: number;
  playing: boolean;
  playbackRate: number;
  /** Per-utterance sentiment segments — start/end are in ms to match transcript data */
  sentimentSegments?: SentimentSegment[];
  /** Volume 0–1. Persisted by parent. */
  volume: number;
  muted: boolean;
  onSeek: (ms: number) => void;
  onTogglePlay: () => void;
  onRate: (r: number) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
}

const BAR_COUNT = 180;
const VIEW_W = 840; // SVG viewBox width; scales via preserveAspectRatio="none"
const RAIL_H = 72;
const SENT_H = 20;

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Decode the audio buffer into ~180 amplitude bars using Web Audio API.
 * Cancels on unmount, closes the AudioContext as soon as the buffer is
 * extracted. Returns null while loading or on failure.
 */
function useWaveformBars(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const [bars, setBars] = useState<number[] | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio?.src) return;

    const controller = new AbortController();
    let audioCtx: AudioContext | null = null;

    const decode = async () => {
      try {
        const response = await fetch(audio.src, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        if (controller.signal.aborted) return;

        const rawData = decoded.getChannelData(0);
        const blockSize = Math.floor(rawData.length / BAR_COUNT);
        if (blockSize <= 0) return;
        const out: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          out.push(sum / blockSize);
        }
        const max = Math.max(...out, 0.001);
        setBars(out.map((b) => b / max));
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      } finally {
        if (audioCtx && audioCtx.state !== "closed") {
          audioCtx.close().catch(() => {
            /* already closed */
          });
        }
      }
    };
    decode();

    return () => {
      controller.abort();
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {
          /* already closed */
        });
      }
    };
  }, [audioRef]);

  return bars;
}

/**
 * Convert per-utterance sentiment segments into a path string for the
 * sentiment ribbon. Samples every ~4 seconds across the duration and
 * returns stroke + area fill paths.
 */
function useSentimentPath(
  sentimentSegments: SentimentSegment[] | undefined,
  duration: number,
): { stroke: string; area: string } | null {
  return useMemo(() => {
    if (!sentimentSegments || sentimentSegments.length === 0 || duration <= 0) {
      return null;
    }

    const toValue = (s?: string): number => {
      if (!s) return 0;
      const low = s.toLowerCase();
      if (low === "positive") return 1;
      if (low === "negative") return -1;
      return 0;
    };

    const sampleCount = 120;
    const stepMs = duration / sampleCount;
    let d = "";
    for (let i = 0; i <= sampleCount; i++) {
      const t = i * stepMs;
      const seg = sentimentSegments.find(
        (s) =>
          typeof s.start === "number" &&
          typeof s.end === "number" &&
          t >= s.start &&
          t <= s.end,
      );
      const v = toValue(seg?.sentiment);
      const x = (i / sampleCount) * VIEW_W;
      const y = SENT_H / 2 - v * (SENT_H / 2) * 0.9;
      d += (d ? " L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    }
    const area = d + ` L${VIEW_W},${SENT_H / 2} L0,${SENT_H / 2} Z`;
    return { stroke: d, area };
  }, [sentimentSegments, duration]);
}

export default function Scrubber({
  audioRef,
  currentTime,
  duration,
  playing,
  playbackRate,
  sentimentSegments,
  volume,
  muted,
  onSeek,
  onTogglePlay,
  onRate,
  onVolumeChange,
  onToggleMute,
}: ScrubberProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const bars = useWaveformBars(audioRef);
  const sentPath = useSentimentPath(sentimentSegments, duration);

  const pct = duration > 0 ? currentTime / duration : 0;

  const clientXToMs = useCallback(
    (clientX: number): number => {
      const r = railRef.current?.getBoundingClientRect();
      if (!r || duration <= 0) return 0;
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      return (x / r.width) * duration;
    },
    [duration],
  );

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    onSeek(clientXToMs(e.clientX));
  };
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    setHoverMs(clientXToMs(e.clientX));
    if (dragging) onSeek(clientXToMs(e.clientX));
  };
  const onMouseLeave = () => {
    setHoverMs(null);
    setDragging(false);
  };

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  const barW = VIEW_W / BAR_COUNT;
  const waveAreaH = RAIL_H - SENT_H - 6;

  return (
    <div className="flex flex-col gap-2.5 w-full" data-testid="scrubber">
      {/* Transport row */}
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          data-testid="scrubber-play"
          className="flex items-center justify-center rounded-full bg-primary text-[var(--paper)] border-none cursor-pointer transition-opacity hover:opacity-90"
          style={{
            width: 44,
            height: 44,
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            flexShrink: 0,
          }}
        >
          {playing ? (
            <Pause weight="fill" style={{ width: 16, height: 16 }} />
          ) : (
            <Play weight="fill" style={{ width: 16, height: 16 }} />
          )}
        </button>

        <div
          className="font-mono tabular-nums text-foreground"
          style={{ fontSize: 13, minWidth: 96 }}
        >
          <span style={{ fontWeight: 600 }}>{fmtTime(currentTime)}</span>
          <span className="text-muted-foreground"> / {fmtTime(duration)}</span>
        </div>

        <div className="flex-1" />

        {/* Rate selector */}
        <div
          className="flex items-center gap-0.5 border border-border rounded-sm"
          style={{ padding: 2 }}
          role="group"
          aria-label="Playback rate"
        >
          {SPEED_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRate(r)}
              aria-pressed={playbackRate === r}
              className={`font-mono cursor-pointer border-none rounded-sm ${
                playbackRate === r
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontSize: 10, padding: "3px 6px" }}
              data-testid={`scrubber-rate-${r}`}
            >
              {r}×
            </button>
          ))}
        </div>

        {/* Volume popover — colocated with play/rate so audio controls are
            together instead of split between the top toolbar and bottom dock. */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={muted ? "Unmute" : `Volume ${Math.round(volume * 100)}%`}
              title={muted ? "Unmute" : `Volume ${Math.round(volume * 100)}%`}
              data-testid="scrubber-volume"
              className="font-mono inline-flex items-center border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
            >
              {muted || volume === 0 ? (
                <SpeakerX style={{ width: 12, height: 12 }} />
              ) : volume < 0.5 ? (
                <SpeakerLow style={{ width: 12, height: 12 }} />
              ) : (
                <SpeakerHigh style={{ width: 12, height: 12 }} />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="end">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Volume</span>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="text-foreground hover:underline"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              </div>
              <Slider
                value={[muted ? 0 : volume]}
                onValueChange={([v]) => {
                  onVolumeChange(v);
                  if (v > 0 && muted) onToggleMute();
                }}
                min={0}
                max={1}
                step={0.05}
              />
              <div className="text-[10px] text-muted-foreground text-right">
                {Math.round((muted ? 0 : volume) * 100)}%
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Rail */}
      <div
        ref={railRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        className="relative w-full border border-border bg-secondary select-none"
        style={{
          height: RAIL_H,
          cursor: dragging ? "grabbing" : "pointer",
        }}
      >
        <svg
          width="100%"
          height={RAIL_H}
          viewBox={`0 0 ${VIEW_W} ${RAIL_H}`}
          preserveAspectRatio="none"
          style={{ display: "block", pointerEvents: "none" }}
          aria-hidden="true"
        >
          {/* Waveform bars */}
          {bars &&
            bars.map((v, i) => {
              const x = i * barW;
              const h = Math.max(1, v * waveAreaH);
              const y = (RAIL_H - SENT_H - h) / 2;
              const inPast = i / BAR_COUNT <= pct;
              return (
                <rect
                  key={i}
                  x={x + 0.5}
                  y={y}
                  width={Math.max(1, barW - 1)}
                  height={h}
                  fill={inPast ? "var(--accent)" : "var(--muted-foreground)"}
                  opacity={inPast ? 0.85 : 0.35}
                />
              );
            })}

          {/* Sentiment ribbon along bottom */}
          <g transform={`translate(0, ${RAIL_H - SENT_H})`}>
            <rect x={0} y={0} width={VIEW_W} height={SENT_H} fill="var(--background)" opacity={0.6} />
            <line
              x1={0}
              x2={VIEW_W}
              y1={SENT_H / 2}
              y2={SENT_H / 2}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            {sentPath && (
              <>
                <path d={sentPath.area} fill="var(--accent)" opacity={0.15} />
                <path d={sentPath.stroke} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
              </>
            )}
          </g>
        </svg>

        {/* Hover tooltip */}
        {hoverMs != null && duration > 0 && (
          <div
            className="absolute font-mono bg-foreground text-background rounded-sm pointer-events-none whitespace-nowrap"
            style={{
              left: `${(hoverMs / duration) * 100}%`,
              top: -24,
              transform: "translateX(-50%)",
              fontSize: 10,
              padding: "2px 6px",
            }}
          >
            {fmtTime(hoverMs)}
          </div>
        )}

        {/* Playhead */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${pct * 100}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: "var(--foreground)",
            boxShadow: "0 0 0 2px color-mix(in oklch, var(--background), transparent 40%)",
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              left: -5,
              top: -5,
              width: 12,
              height: 12,
              background: "var(--foreground)",
              border: "2px solid var(--background)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
