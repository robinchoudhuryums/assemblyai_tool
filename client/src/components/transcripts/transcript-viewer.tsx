import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CaretDown, CaretUp, ClipboardText, Clock, ClockCounterClockwise, FileText, Flag, FloppyDisk, MagnifyingGlass, PencilSimple, Shield, ShieldStar, SkipForward, SpeakerHigh, SpeakerLow, SpeakerX, Trophy, Warning, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "wouter";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import type { CallWithDetails } from "@shared/schema";
import { toDisplayString } from "@/lib/display-utils";
import { safeSet } from "@/lib/safe-storage";
import { computeSearchMatches, findGlobalMatchIndex } from "@/lib/transcript-search";
import { LoadingIndicator } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreRing } from "@/components/ui/animated-number";
import Scrubber from "./scrubber";
import SideRail from "./side-rail";

interface TranscriptViewerProps {
  callId: string;
}

interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export default function TranscriptViewer({ callId }: TranscriptViewerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  // Volume + mute state. Persisted per-session in localStorage so a user's
  // preferred level sticks across navigations. Falls back to full volume.
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const raw = localStorage.getItem("transcript-audio-volume");
    const parsed = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
  });
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const queryClient = useQueryClient();

  /** Milliseconds of silence before splitting into a new transcript segment */
  const SEGMENT_GAP_MS = 2000;

  // cycleSpeed removed in phase 5 — the bottom-docked Scrubber owns the
  // rate selector now. setPlaybackRate still drives audioRef.playbackRate
  // from the Scrubber's onRate callback.

  // Apply volume / mute to the audio element whenever they change. Also
  // persist the volume so the user's preferred level sticks across
  // navigations. Mute is session-only (not persisted) — restoring muted
  // on page load would be surprising.
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    audioRef.current.muted = muted;
  }, [volume, muted]);
  useEffect(() => {
    safeSet("transcript-audio-volume", String(volume));
  }, [volume]);

  // Manual edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editScore, setEditScore] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editReason, setEditReason] = useState("");

  // Transcript search state — query is driven by ViewerHeader via
  // `transcript:search-query` window events; we keep only the query +
  // match index locally.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Warn before navigating away with unsaved edits
  useBeforeUnload(isEditing && (editScore !== "" || editSummary !== "" || editReason !== ""));

  const { data: call, isLoading } = useQuery<CallWithDetails>({
    queryKey: ["/api/calls", callId],
  });

  const editMutation = useMutation({
    mutationFn: async (payload: { updates: Record<string, string | number>; reason: string }) => {
      const { getCsrfToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/calls/${callId}/analysis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(getCsrfToken() ? { "x-csrf-token": getCsrfToken()! } : {}) },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save edit");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
      setIsEditing(false);
      setEditReason("");
    },
  });

  const startEditing = () => {
    setEditScore(call?.analysis?.performanceScore?.toString() || "");
    setEditSummary(toDisplayString(call?.analysis?.summary) || "");
    setEditReason("");
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editReason.trim()) return;
    const updates: Record<string, string | number> = {};
    if (editScore !== (call?.analysis?.performanceScore?.toString() || "")) {
      updates.performanceScore = editScore;
    }
    if (editSummary !== (toDisplayString(call?.analysis?.summary) || "")) {
      updates.summary = editSummary;
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      return;
    }
    editMutation.mutate({ updates, reason: editReason.trim() });
  };

  // Close edit mode on Escape key (broadcast from App.tsx).
  // Phase-5 note: the legacy "close search popup on Escape" branch was
  // dropped when the in-column search bar moved into ViewerHeader.
  useEffect(() => {
    const onEscape = () => {
      if (searchQuery) { setSearchQuery(""); return; }
      if (isEditing) setIsEditing(false);
    };
    window.addEventListener("app:escape", onEscape);
    return () => window.removeEventListener("app:escape", onEscape);
  }, [isEditing, searchQuery]);

  // Ctrl+F / Cmd+F focuses the ViewerHeader search input. Keeps the
  // familiar shortcut working without reopening the old popup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        const el = transcriptContainerRef.current;
        if (!el) return;
        const headerInput = document.getElementById("transcript-header-search") as HTMLInputElement | null;
        if (!headerInput) return;
        e.preventDefault();
        headerInput.focus();
        headerInput.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Bridge: ViewerHeader controls (search / export / download) dispatch
  // window events; the viewer listens and handles them. Keeps the header
  // presentational without prop-drilling across a sibling. Handlers go
  // through refs so the window listener always calls the current closure
  // (otherwise an empty-deps effect would capture stale call data).
  const exportHandlerRef = useRef<() => void>(() => {});
  const downloadHandlerRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onSearch = (e: Event) => {
      const detail = (e as CustomEvent<{ query: string }>).detail;
      setSearchQuery(detail?.query ?? "");
      setSearchMatchIdx(0);
    };
    const onExport = () => exportHandlerRef.current();
    const onDownload = () => downloadHandlerRef.current();
    window.addEventListener("transcript:search-query", onSearch);
    window.addEventListener("transcript:export", onExport);
    window.addEventListener("transcript:download", onDownload);
    return () => {
      window.removeEventListener("transcript:search-query", onSearch);
      window.removeEventListener("transcript:export", onExport);
      window.removeEventListener("transcript:download", onDownload);
    };
  }, []);

  // toDisplayString is a pure function imported from @/lib/display-utils — no memoization needed

  // Build keyword set from detected topics for highlighting
  // MUST be called before any early returns to respect Rules of Hooks
  const topicKeywords = useMemo(() => {
    try {
      if (!call?.analysis?.topics || !Array.isArray(call.analysis.topics)) return [];
      return (call.analysis.topics as unknown[])
        .map(t => {
          if (typeof t === "string") return t;
          if (t && typeof t === "object") {
            const obj = t as Record<string, unknown>;
            return typeof obj.text === "string" ? obj.text : typeof obj.name === "string" ? obj.name : JSON.stringify(t);
          }
          return String(t ?? "");
        })
        .filter(t => t.length >= 3)
        .map(t => t.toLowerCase());
    } catch {
      return [];
    }
  }, [call?.analysis?.topics]);

  // Build transcript segments from word-level data
  // MUST be called before early returns to respect Rules of Hooks
  const transcriptSegments = useMemo(() => {
    if (call?.transcript?.words && Array.isArray(call.transcript.words) && call.transcript.words.length > 0) {
      const base = generateSegmentsFromWords(call.transcript.words as TranscriptWord[]);
      return enrichSegmentSentiment(base, call?.sentiment?.segments);
    }
    return [];
  }, [call?.transcript?.words, call?.sentiment?.segments]);

  // Compute search matches across segments
  // MUST be called before early returns to respect Rules of Hooks
  const searchMatches = useMemo(
    () => computeSearchMatches(transcriptSegments, searchQuery),
    [searchQuery, transcriptSegments],
  );

  // Navigate between search matches
  // MUST be called before early returns to respect Rules of Hooks
  const goToMatch = useCallback((idx: number) => {
    if (searchMatches.length === 0) return;
    const wrapped = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(wrapped);
    const segIdx = searchMatches[wrapped].segmentIndex;
    const el = transcriptContainerRef.current?.querySelector(`[data-testid="transcript-segment-${segIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchMatches]);

  // Sync audio time with transcript highlight
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      setAudioDuration(audio.duration * 1000);
      setAudioReady(true);
    };
    const onError = () => setAudioReady(false);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    // If metadata already loaded (e.g. cached)
    if (audio.readyState >= 1) {
      setAudioDuration(audio.duration * 1000);
      setAudioReady(true);
    }
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
    };
  }, [call]);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6 space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        {/* Audio waveform skeleton */}
        <Skeleton className="h-16 w-full rounded-lg" />
        {/* Call details skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Call not found</p>
        </div>
      </div>
    );
  }

  // AssemblyAI word timestamps are in milliseconds
  const formatTimestamp = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
    speaker: string;
    sentiment: "neutral" | "positive" | "negative";
  }

  function generateSegmentsFromWords(words: TranscriptWord[]) {
    const segments: TranscriptSegment[] = [];
    if (!words || !Array.isArray(words) || words.length === 0) return segments;

    const first = words[0];
    if (!first || typeof first !== "object") return segments;

    let currentSegment = {
      start: first.start || 0,
      end: first.end || 0,
      text: first.text || '',
      speaker: first.speaker || 'Agent',
      sentiment: 'neutral' as const
    };

    words.slice(1).forEach(word => {
      const timeGap = word.start - currentSegment.end;
      const speakerChange = word.speaker && word.speaker !== currentSegment.speaker;

      if (timeGap > SEGMENT_GAP_MS || speakerChange) {
        segments.push({ ...currentSegment });
        currentSegment = {
          start: word.start,
          end: word.end,
          text: word.text,
          speaker: word.speaker || currentSegment.speaker,
          sentiment: 'neutral' as const
        };
      } else {
        currentSegment.text += ' ' + word.text;
        currentSegment.end = word.end;
      }
    });

    segments.push(currentSegment);
    return segments;
  }

  // Enrich transcript segments with per-utterance sentiment from the
  // sentiment_analyses.segments array (AssemblyAI sentiment_analysis_results,
  // persisted end-to-end but previously unused at the frontend). Matches by
  // timestamp midpoint overlap — sentiment utterances and word-derived
  // segments don't align 1:1, but midpoint-in-range is a good-enough match
  // for a visible dot.
  function enrichSegmentSentiment(
    segments: TranscriptSegment[],
    sentimentSegments: Array<{ start?: number; end?: number; sentiment?: string }> | undefined,
  ): TranscriptSegment[] {
    if (!sentimentSegments || sentimentSegments.length === 0) return segments;
    return segments.map((seg) => {
      const mid = (seg.start + seg.end) / 2;
      const match = sentimentSegments.find(
        (s) => typeof s.start === "number" && typeof s.end === "number" && mid >= s.start && mid <= s.end,
      );
      if (!match?.sentiment) return seg;
      const s = match.sentiment.toLowerCase();
      if (s === "positive" || s === "negative") {
        return { ...seg, sentiment: s };
      }
      return seg;
    });
  }

  const jumpToTime = (timeMs: number) => {
    if (!Number.isFinite(timeMs) || timeMs < 0) return;
    const audio = audioRef.current;
    let clampedMs = timeMs;
    if (audio) {
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : Infinity;
      clampedMs = Math.min(timeMs, durationMs);
      audio.currentTime = clampedMs / 1000;
      if (!isPlaying) {
        audio.play().catch(() => {});
      }
    }
    setCurrentTime(clampedMs);
  };

  // Parse an AI-supplied timestamp string ("M:SS", "MM:SS", or "HH:MM:SS") into milliseconds.
  // Returns null if the string is malformed or out of bounds. Used by feedback jump buttons.
  const parseTimestampString = (ts: unknown): number | null => {
    if (typeof ts !== "string") return null;
    const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(ts.trim());
    if (!match) return null;
    const a = parseInt(match[1], 10);
    const b = parseInt(match[2], 10);
    const c = match[3] !== undefined ? parseInt(match[3], 10) : null;
    if (!Number.isFinite(a) || !Number.isFinite(b) || (c !== null && !Number.isFinite(c))) return null;
    let totalSeconds: number;
    if (c !== null) {
      // HH:MM:SS
      if (b > 59 || c > 59) return null;
      totalSeconds = a * 3600 + b * 60 + c;
    } else {
      // M:SS or MM:SS
      if (b > 59) return null;
      totalSeconds = a * 60 + b;
    }
    if (totalSeconds < 0 || totalSeconds > 24 * 3600) return null; // Cap at 24 hours
    return totalSeconds * 1000;
  };

  // Skip to next segment (skips silence gaps between speakers)
  const skipToNextSegment = () => {
    const nextIdx = activeSegmentIndex + 1;
    if (nextIdx < transcriptSegments.length) {
      jumpToTime(transcriptSegments[nextIdx].start);
    }
  };

  // Jump to next flagged/negative sentiment segment
  const jumpToFlagged = () => {
    const startIdx = activeSegmentIndex >= 0 ? activeSegmentIndex + 1 : 0;
    for (let i = startIdx; i < transcriptSegments.length; i++) {
      if (transcriptSegments[i].sentiment === "negative") {
        jumpToTime(transcriptSegments[i].start);
        return;
      }
    }
    // Wrap around from beginning
    for (let i = 0; i < startIdx; i++) {
      if (transcriptSegments[i].sentiment === "negative") {
        jumpToTime(transcriptSegments[i].start);
        return;
      }
    }
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  };

  const handleDownloadAudio = () => {
    window.open(`/api/calls/${callId}/audio?download=true`, '_blank');
  };

  const handleExportTranscript = () => {
    if (!call.transcript?.text && transcriptSegments.length === 0) return;

    // Build a text export with metadata
    const lines: string[] = [];
    lines.push(`Call Transcript Export`);
    lines.push(`=====================`);
    lines.push(`Employee: ${call.employee?.name || 'Unknown'}`);
    lines.push(`Date: ${call.uploadedAt ? new Date(call.uploadedAt).toLocaleString() : 'Unknown'}`);
    lines.push(`Duration: ${call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 'Unknown'}`);
    lines.push(`Status: ${call.status}`);
    if (call.sentiment?.overallSentiment) {
      lines.push(`Sentiment: ${call.sentiment.overallSentiment}`);
    }
    if (call.analysis?.performanceScore) {
      lines.push(`Performance Score: ${Number(call.analysis.performanceScore).toFixed(1)}/10`);
    }
    lines.push('');
    lines.push(`Transcript`);
    lines.push(`----------`);

    if (transcriptSegments.length > 0) {
      for (const seg of transcriptSegments) {
        const speaker = seg.speaker === 'Agent' ? `Agent (${call.employee?.name})` : 'Customer';
        lines.push(`[${formatTimestamp(seg.start)}] ${speaker}:`);
        lines.push(`  ${seg.text}`);
        lines.push('');
      }
    } else if (call.transcript?.text) {
      lines.push(call.transcript.text);
    }

    if (call.analysis?.summary) {
      lines.push('');
      lines.push(`Summary`);
      lines.push(`-------`);
      lines.push(call.analysis.summary);
    }

    if (call.analysis?.actionItems && Array.isArray(call.analysis.actionItems) && call.analysis.actionItems.length > 0) {
      lines.push('');
      lines.push(`Action Items`);
      lines.push(`------------`);
      call.analysis.actionItems.forEach((item: unknown, i: number) => {
        const text = typeof item === "string" ? item : typeof item === "object" && item !== null ? ((item as Record<string, unknown>).text || (item as Record<string, unknown>).task || JSON.stringify(item)) : String(item);
        lines.push(`${i + 1}. ${text}`);
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${callId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Re-bind every render so the window event listeners always call the
  // latest closure (captures current `call` / `transcriptSegments`).
  exportHandlerRef.current = handleExportTranscript;
  downloadHandlerRef.current = handleDownloadAudio;

  const highlightKeywords = (text: string | any, segmentIndex?: number): React.ReactNode => {
    const str = typeof text === "string" ? text : toDisplayString(text);
    // Build combined regex for topics + search
    const patterns: string[] = [];
    if (topicKeywords.length > 0) {
      patterns.push(...topicKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const sq = searchQuery.trim().toLowerCase();
    if (sq) {
      patterns.push(sq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    if (patterns.length === 0) return <>{str}</>;
    const regex = new RegExp(`(${patterns.join("|")})`, "gi");
    const parts = str.split(regex);
    // Walk parts tracking running char position so each search-match part can be
    // mapped back to its (segmentIndex, charIndex) entry in `searchMatches`,
    // then compared against the global active index `searchMatchIdx`.
    let runningPos = 0;
    return <>{parts.map((part, i) => {
      const lower = part.toLowerCase();
      const isSearchMatch = sq.length > 0 && lower === sq;
      const isTopicMatch = topicKeywords.includes(lower);
      const partStart = runningPos;
      runningPos += part.length;
      if (isSearchMatch) {
        const globalIdx = segmentIndex !== undefined
          ? findGlobalMatchIndex(searchMatches, segmentIndex, partStart)
          : -1;
        const isActive = globalIdx !== -1 && globalIdx === searchMatchIdx;
        return (
          <mark
            key={i}
            className="rounded-sm px-0.5"
            style={
              isActive
                ? {
                    background: "var(--amber)",
                    color: "color-mix(in oklch, var(--amber), var(--ink) 75%)",
                  }
                : {
                    background: "var(--amber-soft)",
                    color: "var(--foreground)",
                  }
            }
          >
            {part}
          </mark>
        );
      }
      if (isTopicMatch) {
        return <mark key={i} className="bg-primary/15 text-primary rounded px-0.5">{part}</mark>;
      }
      return part;
    })}</>;
  };

  // Determine which segment is currently active based on audio time
  const activeSegmentIndex = transcriptSegments.findIndex(
    (seg, i) => {
      const nextStart = transcriptSegments[i + 1]?.start ?? Infinity;
      return currentTime >= seg.start && currentTime < nextStart;
    }
  );

  return (
    <div data-testid="transcript-viewer">
      {/* Compact secondary toolbar — only controls that aren't already in
          the ViewerHeader (search/export/download) or the Scrubber
          (play/rate). Kept here because these are functional shortcuts
          without a better home: skip to next segment, jump to next
          flagged moment, and the volume popover. */}
      <div className="flex items-center justify-end gap-1.5 mb-3">
        <button
          type="button"
          onClick={skipToNextSegment}
          aria-label="Skip to next segment"
          title="Skip silence / next speaker"
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <SkipForward style={{ width: 12, height: 12 }} />
          Skip
        </button>
        <button
          type="button"
          onClick={jumpToFlagged}
          aria-label="Jump to next flagged moment"
          title="Jump to next negative sentiment"
          className="font-mono uppercase inline-flex items-center gap-1.5 border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.1em" }}
        >
          <Flag style={{ width: 12, height: 12 }} />
          Flag
        </button>
        {/* Volume popover — persisted to localStorage; mute is session-only. */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={muted ? "Unmute" : `Volume ${Math.round(volume * 100)}%`}
              title={muted ? "Unmute" : `Volume ${Math.round(volume * 100)}%`}
              className="font-mono inline-flex items-center border border-border rounded-sm px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
            >
              {muted || volume === 0
                ? <SpeakerX style={{ width: 12, height: 12 }} />
                : volume < 0.5
                  ? <SpeakerLow style={{ width: 12, height: 12 }} />
                  : <SpeakerHigh style={{ width: 12, height: 12 }} />}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="end">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Volume</span>
                <button
                  type="button"
                  onClick={() => setMuted((v) => !v)}
                  className="text-foreground hover:underline"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              </div>
              <Slider
                value={[muted ? 0 : volume]}
                onValueChange={([v]) => {
                  setVolume(v);
                  if (v > 0 && muted) setMuted(false);
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

      {/* Hidden audio element that streams from S3 via the API */}
      <audio ref={audioRef} src={`/api/calls/${callId}/audio`} preload="auto" />

      {/* Waveform + sentiment ribbon moved to the bottom-docked Scrubber
          rendered after the main grid — see end of this component. */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {/* Search hit chip — driven by ViewerHeader's search input via
              `transcript:search-query` events. Prev / next buttons walk the
              matches and scroll the column to the hit segment. */}
          {searchQuery && (
            <div
              className="flex items-center gap-2 mb-2 bg-card border border-border px-3 py-2"
              role="status"
              aria-live="polite"
            >
              <MagnifyingGlass className="text-muted-foreground shrink-0" style={{ width: 14, height: 14 }} />
              <span
                className="font-mono tabular-nums text-foreground flex-1 truncate"
                style={{ fontSize: 11 }}
              >
                {searchMatches.length > 0
                  ? `${searchMatchIdx + 1} / ${searchMatches.length}`
                  : "0 results"}
                <span className="text-muted-foreground"> · "{searchQuery}"</span>
              </span>
              <button
                onClick={() => goToMatch(searchMatchIdx - 1)}
                disabled={searchMatches.length === 0}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Previous match"
              >
                <CaretUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => goToMatch(searchMatchIdx + 1)}
                disabled={searchMatches.length === 0}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Next match"
              >
                <CaretDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div
            ref={transcriptContainerRef}
            className="bg-card border border-border overflow-y-auto"
            style={{ padding: "24px 28px", maxHeight: 384 }}
          >
            {call.status !== 'completed' ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  {call.status === 'processing' ? 'Transcript is being processed...' : 'Transcript not available'}
                </p>
              </div>
            ) : call.transcript?.text ? (
              <div>
                {transcriptSegments.map((segment, index) => {
                  const active = index === activeSegmentIndex;
                  const past = currentTime >= segment.end;
                  const isAgent = segment.speaker === 'Agent';
                  const dotColor =
                    segment.sentiment === "positive"
                      ? "var(--sage)"
                      : segment.sentiment === "negative"
                      ? "var(--destructive)"
                      : null;
                  return (
                    <div
                      key={index}
                      className="grid gap-4 cursor-pointer transition-colors rounded-sm"
                      style={{
                        gridTemplateColumns: "48px 1fr",
                        padding: "10px 12px",
                        margin: "2px -12px",
                        background: active ? "var(--accent-soft)" : "transparent",
                        opacity: past || active ? 1 : 0.82,
                      }}
                      onClick={() => jumpToTime(segment.start)}
                      data-testid={`transcript-segment-${index}`}
                    >
                      {/* Timestamp */}
                      <div
                        className="font-mono tabular-nums"
                        style={{
                          fontSize: 11,
                          color: active ? "var(--accent)" : "var(--muted-foreground)",
                          fontWeight: active ? 600 : 400,
                          paddingTop: 3,
                        }}
                      >
                        {formatTimestamp(segment.start)}
                      </div>

                      {/* Content */}
                      <div style={{ minWidth: 0 }}>
                        {/* Speaker header */}
                        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                          <span
                            className="font-display font-semibold"
                            style={{
                              fontSize: 12,
                              color: isAgent ? "var(--accent)" : "var(--foreground)",
                              letterSpacing: "0.02em",
                            }}
                          >
                            {isAgent
                              ? call.employee?.name || "Agent"
                              : "Customer"}
                          </span>
                          <span
                            className="font-mono uppercase text-muted-foreground"
                            style={{ fontSize: 9, letterSpacing: "0.12em" }}
                          >
                            {isAgent ? "Agent" : "Patient"}
                          </span>
                          {dotColor && (
                            <span
                              aria-label={`${segment.sentiment} sentiment`}
                              title={segment.sentiment}
                              style={{
                                display: "inline-block",
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: dotColor,
                              }}
                            />
                          )}
                        </div>

                        {/* Text */}
                        <div
                          className="text-foreground"
                          style={{
                            fontSize: 14,
                            lineHeight: 1.58,
                            borderLeft: isAgent ? "none" : "2px solid var(--border)",
                            paddingLeft: isAgent ? 0 : 10,
                          }}
                        >
                          {highlightKeywords(segment.text, index)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No transcript text available</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Manual Edit Indicator */}
          {call.analysis?.manualEdits && Array.isArray(call.analysis.manualEdits) && (call.analysis.manualEdits as unknown[]).length > 0 && (
            <div
              className="rounded-sm p-3"
              style={{
                background: "var(--amber-soft)",
                border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                borderLeft: "3px solid var(--amber)",
              }}
            >
              <div
                className="flex items-center gap-1.5 text-xs font-medium mb-1"
                style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" }}
              >
                <ClockCounterClockwise className="w-3.5 h-3.5" />
                Manually Edited ({(call.analysis.manualEdits as unknown[]).length} edit{(call.analysis.manualEdits as unknown[]).length > 1 ? "s" : ""})
              </div>
              {(call.analysis.manualEdits as Array<{ editedBy?: string; reason?: string; editedAt?: string }>).map((edit, i: number) => (
                <div key={i} className="text-xs text-muted-foreground mt-1 pl-5">
                  <span className="font-medium">{edit.editedBy}</span> — {edit.reason}
                  <span className="text-muted-foreground/60 ml-1">
                    ({new Date(edit.editedAt || "").toLocaleDateString()} {new Date(edit.editedAt || "").toLocaleTimeString()})
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Side rail (Phase 4) — score + rubric + AI verdict, AI summary,
              coaching highlights, commitments, topics. Replaces the legacy
              bg-muted Card stack. Editing state still owned here so
              useBeforeUnload keeps consistent unsaved-changes detection. */}
          <SideRail
            call={call}
            onSeek={jumpToTime}
            parseTimestampString={parseTimestampString}
            isEditing={isEditing}
            editScore={editScore}
            editSummary={editSummary}
            editReason={editReason}
            editError={editMutation.isError ? (editMutation.error?.message || "Save failed") : null}
            editPending={editMutation.isPending}
            onStartEditing={startEditing}
            onCancelEditing={() => setIsEditing(false)}
            onChangeEditScore={setEditScore}
            onChangeEditSummary={setEditSummary}
            onChangeEditReason={setEditReason}
            onSave={handleSaveEdit}
          />

          {/* AI Analysis Skipped banner — surfaced prominently when the
              pipeline quality gate fired (empty transcript or low transcript
              confidence). Without this, the UI fell back to showing the
              default score (~5.0) and a verbatim transcript excerpt as the
              summary, which made it look like the call had been analyzed. */}
          {call.analysis?.flags && Array.isArray(call.analysis.flags) && (() => {
            const flagStrs = (call.analysis.flags as unknown[]).map(f => toDisplayString(f));
            const emptyTranscript = flagStrs.includes("empty_transcript");
            const lowQuality = flagStrs.includes("low_transcript_quality");
            if (!emptyTranscript && !lowQuality) return null;
            const reason = emptyTranscript
              ? "the transcript was empty or under 10 characters"
              : "the transcript confidence was below 60%";
            return (
              <div
                role="alert"
                className="rounded-sm p-4"
                style={{
                  background: "var(--amber-soft)",
                  border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                  borderLeft: "3px solid var(--amber)",
                  color: "color-mix(in oklch, var(--amber), var(--ink) 25%)",
                }}
              >
                <h4
                  className="font-semibold mb-1 flex items-center gap-1.5"
                  style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" }}
                >
                  <Warning className="w-4 h-4" weight="fill" /> AI analysis skipped
                </h4>
                <p className="text-sm">
                  The AI scoring step was not run on this call because {reason}. Any score,
                  summary, or feedback shown below is a placeholder — treat them as unavailable
                  rather than as AI-generated insights.
                </p>
                <p
                  className="text-xs mt-2"
                  style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 35%)" }}
                >
                  Re-analysis won't help: it re-transcribes the same audio and will hit the same
                  gate. Re-upload higher-quality audio instead.
                </p>
              </div>
            );
          })()}

          {/* Call Flags */}
          {call.analysis?.flags && Array.isArray(call.analysis.flags) && (call.analysis.flags as unknown[]).length > 0 && (() => {
            const flags = (call.analysis.flags as unknown[]).map(f => toDisplayString(f));
            const hasExceptional = flags.includes("exceptional_call");
            const hasBad = flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
            const positive = hasExceptional && !hasBad;
            const stripeColor = positive ? "var(--sage)" : "var(--destructive)";
            const bgColor = positive ? "var(--sage-soft)" : "var(--warm-red-soft)";
            const headerColor = positive
              ? "color-mix(in oklch, var(--sage), var(--ink) 20%)"
              : "color-mix(in oklch, var(--destructive), var(--ink) 20%)";
            const HeaderIcon = positive ? Trophy : Warning;
            return (
              <div
                role="alert"
                className="rounded-sm p-4"
                style={{
                  background: bgColor,
                  border: `1px solid color-mix(in oklch, ${stripeColor}, transparent 55%)`,
                  borderLeft: `3px solid ${stripeColor}`,
                }}
              >
                <h4
                  className="font-semibold mb-2 flex items-center gap-1.5"
                  style={{ color: headerColor }}
                >
                  <HeaderIcon className="w-4 h-4" weight="fill" /> Flags
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {flags.map((flag: string, i: number) => {
                    const isExceptional = flag === "exceptional_call";
                    const isMedicare = flag === "medicare_call";
                    const isMisconduct = flag.startsWith("agent_misconduct");
                    const isLow = flag === "low_score";
                    const label = isExceptional
                      ? "Exceptional Call"
                      : isMedicare
                      ? "Medicare Call"
                      : isMisconduct
                      ? flag.replace("agent_misconduct:", "Misconduct: ")
                      : isLow
                      ? "Low Score"
                      : flag;
                    const tone = isExceptional
                      ? { bg: "var(--sage-soft)", border: "color-mix(in oklch, var(--sage), transparent 55%)", color: "var(--sage)" }
                      : isMisconduct
                      ? { bg: "var(--warm-red-soft)", border: "color-mix(in oklch, var(--destructive), transparent 55%)", color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)" }
                      : isMedicare
                      ? { bg: "var(--copper-soft)", border: "color-mix(in oklch, var(--accent), transparent 55%)", color: "var(--accent)" }
                      : { bg: "var(--amber-soft)", border: "color-mix(in oklch, var(--amber), transparent 50%)", color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" };
                    return (
                      <span
                        key={i}
                        className="font-mono uppercase inline-flex items-center rounded-sm"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          padding: "2px 8px",
                          background: tone.bg,
                          border: `1px solid ${tone.border}`,
                          color: tone.color,
                          fontWeight: 500,
                        }}
                      >
                        {isExceptional && (
                          <Trophy className="w-3 h-3 mr-1 inline" weight="fill" />
                        )}
                        {label}
                      </span>
                    );
                  })}
                </div>
                {hasBad && call.employee && (
                  <Link
                    href={`/coaching?newSession=true&employeeId=${call.employee.id}&callId=${callId}&category=${flags.some(f => f.startsWith("agent_misconduct")) ? "compliance" : "general"}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <ClipboardText className="w-3.5 h-3.5" /> Create Coaching Session
                  </Link>
                )}
              </div>
            );
          })()}

          {/* Call Party Type */}
          {call.analysis?.callPartyType && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Shield className="w-4 h-4" /> Call Party
              </h4>
              <Badge variant="outline" className="capitalize">{toDisplayString(call.analysis.callPartyType).replace(/_/g, " ")}</Badge>
            </div>
          )}

          {/* AI Confidence Score */}
          {call.analysis?.confidenceScore && (() => {
            const raw = call.analysis.confidenceScore;
            const confidence = parseFloat(typeof raw === "string" ? raw : String(raw));
            if (isNaN(confidence)) return null;
            const isLow = confidence < 0.7;
            const isHigh = confidence >= 0.85;
            const pct = (confidence * 100).toFixed(0);
            const factors = (call.analysis.confidenceFactors && typeof call.analysis.confidenceFactors === "object")
              ? call.analysis.confidenceFactors as { transcriptConfidence?: number; wordCount?: number; callDurationSeconds?: number; callDuration?: number } : undefined;
            const barColor = isLow
              ? "var(--amber)"
              : isHigh
              ? "var(--sage)"
              : "var(--accent)";
            const panelStyle = isLow
              ? {
                  background: "var(--amber-soft)",
                  border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                  borderLeft: "3px solid var(--amber)",
                }
              : { background: "var(--paper-2)" };
            const headerColor = isLow
              ? "color-mix(in oklch, var(--amber), var(--ink) 30%)"
              : "var(--foreground)";
            return (
              <div className="rounded-sm p-4" style={panelStyle}>
                <h4
                  className="font-semibold mb-2 flex items-center gap-1.5"
                  style={{ color: headerColor }}
                >
                  <ShieldStar className="w-4 h-4" /> AI Confidence
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-display font-medium tabular-nums"
                      style={{
                        fontSize: 20,
                        lineHeight: 1,
                        color: barColor,
                        letterSpacing: "-0.2px",
                      }}
                    >
                      {pct}%
                    </span>
                    {isLow && (
                      <span
                        className="font-mono uppercase inline-flex items-center rounded-sm"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          padding: "2px 8px",
                          background: "color-mix(in oklch, var(--amber), var(--paper) 50%)",
                          border:
                            "1px solid color-mix(in oklch, var(--amber), transparent 45%)",
                          color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
                          fontWeight: 500,
                        }}
                      >
                        Needs review
                      </span>
                    )}
                  </div>
                  <div
                    className="w-full h-2 rounded-sm overflow-hidden"
                    style={{ background: "var(--paper-2)" }}
                  >
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                  {factors && (
                    <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
                      {factors.transcriptConfidence != null && (
                        <p>Transcript clarity: {(Number(factors.transcriptConfidence) * 100).toFixed(0)}%</p>
                      )}
                      {factors.wordCount !== undefined && (
                        <p>Word count: {factors.wordCount} words</p>
                      )}
                      {(factors.callDurationSeconds ?? factors.callDuration) !== undefined && (
                        <p>Call duration: {factors.callDurationSeconds ?? factors.callDuration}s</p>
                      )}
                    </div>
                  )}
                  {isLow && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" }}
                    >
                      This analysis may be less reliable. Consider manual review.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Score Breakdown — "Why this score?" drill-down */}
          <ScoreBreakdown call={call} />

          {/* Transcript Annotations */}
          <AnnotationsPanel callId={callId} currentTime={currentTime} onJump={jumpToTime} />
        </div>
      </div>

      {/* Bottom-docked scrubber — waveform + per-utterance sentiment
          ribbon. Phase 3 installment; phase 5 prunes the duplicate top-bar
          play/skip/speed/volume controls above. */}
      {audioReady && (
        <div
          className="mt-5 pt-4 border-t border-border"
          data-testid="scrubber-dock"
        >
          <Scrubber
            audioRef={audioRef}
            currentTime={currentTime}
            duration={audioDuration}
            playing={isPlaying}
            playbackRate={playbackRate}
            sentimentSegments={call.sentiment?.segments}
            onSeek={(ms) => {
              if (audioRef.current) audioRef.current.currentTime = ms / 1000;
              setCurrentTime(ms);
            }}
            onTogglePlay={togglePlayPause}
            onRate={(r) => {
              setPlaybackRate(r);
              if (audioRef.current) audioRef.current.playbackRate = r;
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * ScoreBreakdown — surfaces the signals that drove the composite score:
 * sub-scores, flags (with human-readable labels), and RAG knowledge-base
 * sources that grounded the AI analysis. Answers "why did this call get
 * this score?" without any new backend — all data is already on the
 * analysis object.
 */
function ScoreBreakdown({ call }: { call: CallWithDetails }) {
  const [expanded, setExpanded] = useState(false);
  const analysis = call.analysis;
  if (!analysis) return null;

  const flags = Array.isArray(analysis.flags) ? (analysis.flags as string[]) : [];
  const ragSources = (analysis.confidenceFactors && typeof analysis.confidenceFactors === "object")
    ? ((analysis.confidenceFactors as Record<string, unknown>).ragSources as Array<{ title?: string; source?: string }> | undefined)
    : undefined;

  // Warm-paper pill tone per flag: amber for ambiguous quality (low
  // confidence), destructive for safety (prompt injection), accent for
  // deferred/in-progress states (awaiting batch).
  type PillTone = { bg: string; border: string; color: string };
  const pillTone: Record<"amber" | "destructive" | "accent" | "orange" | "neutral", PillTone> = {
    amber: {
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 50%)",
      color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
    },
    destructive: {
      bg: "var(--warm-red-soft)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
      color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
    },
    accent: {
      bg: "var(--copper-soft)",
      border: "color-mix(in oklch, var(--accent), transparent 55%)",
      color: "var(--accent)",
    },
    orange: {
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 45%)",
      color: "color-mix(in oklch, var(--amber), var(--warm-red) 40%)",
    },
    neutral: {
      bg: "var(--paper-2)",
      border: "var(--border)",
      color: "var(--muted-foreground)",
    },
  };
  const flagLabels: Record<string, { label: string; tone: keyof typeof pillTone }> = {
    low_confidence: { label: "Low transcript confidence", tone: "amber" },
    prompt_injection_detected: { label: "Possible prompt injection in transcript", tone: "destructive" },
    awaiting_batch_analysis: { label: "Awaiting batch analysis", tone: "accent" },
  };

  const hasAnything = flags.length > 0 || (ragSources && ragSources.length > 0) || analysis.subScores;
  if (!hasAnything) return null;

  return (
    <div className="rounded-lg p-4 bg-muted">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full text-left"
        aria-expanded={expanded}
      >
        <h4 className="font-semibold text-foreground flex items-center gap-1.5">
          <MagnifyingGlass className="w-4 h-4" /> Why this score?
        </h4>
        {expanded ? <CaretUp className="w-4 h-4" /> : <CaretDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 text-sm">
          {/* Flags — classified anomalies detected during analysis */}
          {flags.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Analysis flags</h5>
              <div className="flex flex-wrap gap-1.5">
                {flags.map((flag, i) => {
                  const known = flagLabels[flag];
                  // output_anomaly:* flags carry a suffix like "invalid_feedback_timestamps:3"
                  const isOutputAnomaly = flag.startsWith("output_anomaly:");
                  const tone = known
                    ? pillTone[known.tone]
                    : isOutputAnomaly
                    ? pillTone.orange
                    : pillTone.neutral;
                  return (
                    <span
                      key={`${flag}-${i}`}
                      className="font-mono uppercase inline-flex items-center rounded-sm"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        padding: "2px 8px",
                        background: tone.bg,
                        border: `1px solid ${tone.border}`,
                        color: tone.color,
                        fontWeight: 500,
                      }}
                    >
                      {known?.label ?? flag}
                    </span>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Flags record conditions the AI noticed while analyzing. They don't directly change the score but explain its limitations.
              </p>
            </div>
          )}

          {/* RAG sources — knowledge-base docs that grounded the analysis */}
          {ragSources && ragSources.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Reference documents used</h5>
              <ul className="space-y-1">
                {ragSources.slice(0, 5).map((src, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <FileText className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{src.title || src.source || "Untitled source"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-1.5">
                These company knowledge-base documents were retrieved and passed to the AI alongside the transcript. Scoring reflects compliance with policies in these sources.
              </p>
            </div>
          )}

          {/* Sub-score interpretation guide */}
          {analysis.subScores && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Sub-score weights</h5>
              <p className="text-xs text-muted-foreground">
                The performance score combines four dimensions equally: Compliance, Customer Experience, Communication, and Resolution (1–10 each). A sub-score below 5 typically signals an improvement area; the feedback section above highlights what triggered it.
              </p>
            </div>
          )}

          {/* Detected agent — attribution */}
          {analysis.detectedAgentName && (
            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">Detected speaker:</strong> AI identified "{toDisplayString(analysis.detectedAgentName)}" as the agent. Coaching alerts and employee assignments use this detection.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Annotations panel — timestamped comments from managers */
function AnnotationsPanel({ callId, currentTime, onJump }: { callId: string; currentTime: number; onJump: (ms: number) => void }) {
  const [newText, setNewText] = React.useState("");
  const queryClient = useQueryClient();

  const { data: annotations } = useQuery<import("@shared/schema").Annotation[]>({
    queryKey: ["/api/calls", callId, "annotations"],
    queryFn: async () => {
      const res = await fetch(`/api/calls/${callId}/annotations`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (payload: { timestampMs: number; text: string }) => {
      const { getCsrfToken: getToken } = await import("@/lib/queryClient");
      const res = await fetch(`/api/calls/${callId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getToken() ? { "x-csrf-token": getToken()! } : {}) },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to add annotation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId, "annotations"] });
      setNewText("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { getCsrfToken: csrf } = await import("@/lib/queryClient");
      const res = await fetch(`/api/calls/${callId}/annotations/${id}`, { method: "DELETE", credentials: "include", headers: csrf() ? { "x-csrf-token": csrf()! } : {} });
      if (!res.ok) throw new Error("Failed to delete annotation");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/calls", callId, "annotations"] }),
  });

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="bg-muted rounded-lg p-4">
      <h4 className="font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <ClipboardText className="w-4 h-4" /> Annotations
      </h4>
      {(annotations || []).length > 0 && (
        <div className="space-y-2 mb-3">
          {(annotations || []).map(a => (
            <div key={a.id} className="text-xs border-l-2 border-primary/30 pl-2 group">
              <button
                className="text-primary font-mono hover:underline"
                onClick={() => onJump(a.timestampMs)}
              >
                {formatTime(a.timestampMs)}
              </button>
              <span className="text-muted-foreground ml-1">— {a.author}</span>
              <p className="text-foreground mt-0.5">{a.text}</p>
              <button
                className="text-destructive/50 hover:text-destructive text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => deleteMutation.mutate(a.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input
          className="h-7 text-xs flex-1"
          placeholder={`Note at ${formatTime(currentTime)}...`}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && newText.trim()) {
              addMutation.mutate({ timestampMs: Math.round(currentTime), text: newText.trim() });
            }
          }}
        />
        <Button
          size="sm"
          className="h-7 text-xs px-2"
          disabled={!newText.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate({ timestampMs: Math.round(currentTime), text: newText.trim() })}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
