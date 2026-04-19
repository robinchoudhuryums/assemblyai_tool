import { useRef, useEffect, useState, useCallback } from "react";

interface AudioWaveformProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number; // in ms
  duration: number; // in ms
  onSeek: (ms: number) => void;
}

/**
 * Canvas-based audio waveform that shows playback progress.
 * Decodes audio via Web Audio API and renders amplitude bars.
 * Falls back gracefully if audio can't be decoded.
 */
export default function AudioWaveformDisplay({ audioRef, currentTime, duration, onSeek }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Decode the audio buffer to extract waveform amplitudes.
  // Uses an AbortController to cancel the in-flight fetch on unmount and
  // closes the AudioContext on cleanup so we don't leak the audio thread.
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

        // Down-sample to ~200 bars
        const rawData = decoded.getChannelData(0);
        const barCount = 200;
        const blockSize = Math.floor(rawData.length / barCount);
        const bars: number[] = [];
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          bars.push(sum / blockSize);
        }
        // Normalize to 0-1
        const max = Math.max(...bars, 0.001);
        setWaveformData(bars.map(b => b / max));
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        // Close the AudioContext as soon as decoding finishes (or fails) —
        // we only need it for the one-shot decodeAudioData call.
        if (audioCtx && audioCtx.state !== "closed") {
          audioCtx.close().catch(() => { /* already closed */ });
        }
      }
    };
    decode();
    return () => {
      controller.abort();
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => { /* already closed */ });
      }
    };
  }, [audioRef]);

  // Draw the waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const barCount = waveformData.length;
    const barWidth = w / barCount;
    const progress = duration > 0 ? currentTime / duration : 0;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barHeight = Math.max(2, waveformData[i] * (h * 0.9));
      const y = (h - barHeight) / 2;

      const isPast = (i / barCount) < progress;
      ctx.fillStyle = isPast
        ? "var(--primary)"
        : "color-mix(in oklch, var(--muted-foreground), transparent 50%)";
      ctx.fillRect(x + 0.5, y, Math.max(barWidth - 1, 1), barHeight);
    }

    // Playhead line
    const px = progress * w;
    ctx.fillStyle = "var(--primary)";
    ctx.fillRect(px - 1, 0, 2, h);
  }, [waveformData, currentTime, duration]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    onSeek(Math.round(ratio * duration));
  }, [duration, onSeek]);

  if (failed || !waveformData) {
    return null; // Fall back to the default range input
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-12 cursor-pointer rounded"
      onClick={handleClick}
      title="Click to seek"
    />
  );
}
