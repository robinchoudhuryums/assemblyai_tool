import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, Download, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CallWithDetails } from "@shared/schema";
import { AudioWaveform } from "lucide-react";

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
  const audioRef = useRef<HTMLAudioElement>(null);

  const { data: call, isLoading } = useQuery<CallWithDetails>({
    queryKey: ["/api/calls", callId],
  });

  // Sync audio time with transcript highlight
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime * 1000);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [call]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Analyzing performance...</p>
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

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive': return 'sentiment-positive';
      case 'negative': return 'sentiment-negative';
      default: return 'sentiment-neutral';
    }
  };

  const transcriptSegments = call.transcript?.words ?
    generateSegmentsFromWords(call.transcript.words as TranscriptWord[]) :
    [];

  function generateSegmentsFromWords(words: TranscriptWord[]) {
    const segments: any[] = [];
    if (!words || words.length === 0) return segments;

    let currentSegment = {
      start: words[0].start,
      end: words[0].end,
      text: words[0].text,
      speaker: words[0].speaker || 'Agent',
      sentiment: 'neutral' as const
    };

    words.slice(1).forEach(word => {
      const timeGap = word.start - currentSegment.end;
      const speakerChange = word.speaker && word.speaker !== currentSegment.speaker;

      if (timeGap > 2000 || speakerChange) {
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

  const jumpToTime = (timeMs: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = timeMs / 1000;
      if (!isPlaying) {
        audio.play().catch(() => {});
      }
    }
    setCurrentTime(timeMs);
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

    if (call.analysis?.actionItems && call.analysis.actionItems.length > 0) {
      lines.push('');
      lines.push(`Action Items`);
      lines.push(`------------`);
      call.analysis.actionItems.forEach((item: string, i: number) => {
        lines.push(`${i + 1}. ${item}`);
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

  // Determine which segment is currently active based on audio time
  const activeSegmentIndex = transcriptSegments.findIndex(
    (seg, i) => {
      const nextStart = transcriptSegments[i + 1]?.start ?? Infinity;
      return currentTime >= seg.start && currentTime < nextStart;
    }
  );

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="transcript-viewer">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Call Transcript</h3>
          <p className="text-sm text-muted-foreground">
            {call.employee?.name} • {new Date(call.uploadedAt || "").toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={handleExportTranscript} data-testid="export-transcript">
            <FileText className="w-4 h-4 mr-1" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadAudio} data-testid="download-audio">
            <Download className="w-4 h-4 mr-1" />
            Download
          </Button>
          <Button size="sm" onClick={togglePlayPause} data-testid="play-audio">
            {isPlaying ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
            {isPlaying ? "Pause" : "Play Audio"}
          </Button>
        </div>
      </div>

      {/* Hidden audio element that streams from GCS via the API */}
      <audio ref={audioRef} src={`/api/calls/${callId}/audio`} preload="metadata" />

      {/* Audio progress bar */}
      {audioRef.current && (
        <div className="mb-4">
          <div className="flex items-center space-x-3">
            <span className="text-xs text-muted-foreground w-10 text-right">
              {formatTimestamp(currentTime)}
            </span>
            <input
              type="range"
              className="flex-1 h-1.5 accent-primary cursor-pointer"
              min={0}
              max={(audioRef.current?.duration || 0) * 1000}
              value={currentTime}
              onChange={(e) => {
                const ms = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = ms / 1000;
                setCurrentTime(ms);
              }}
            />
            <span className="text-xs text-muted-foreground w-10">
              {formatTimestamp((audioRef.current?.duration || 0) * 1000)}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
            {call.status !== 'completed' ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  {call.status === 'processing' ? 'Transcript is being processed...' : 'Transcript not available'}
                </p>
              </div>
            ) : call.transcript?.text ? (
              <div className="space-y-3">
                {transcriptSegments.map((segment, index) => (
                  <div
                    key={index}
                    className={`transcript-line p-2 rounded cursor-pointer transition-colors ${
                      index === activeSegmentIndex ? 'bg-primary/10 ring-1 ring-primary/30' : ''
                    }`}
                    onClick={() => jumpToTime(segment.start)}
                    data-testid={`transcript-segment-${index}`}
                  >
                    <div className="flex items-start space-x-3">
                      <button
                        className="text-xs text-muted-foreground bg-background px-2 py-1 rounded hover:bg-primary hover:text-primary-foreground"
                        onClick={() => jumpToTime(segment.start)}
                      >
                        <Clock className="w-3 h-3 mr-1 inline" />
                        {formatTimestamp(segment.start)}
                      </button>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${segment.speaker === 'Agent' ? 'text-primary' : 'text-gray-600'}`}>
                          {segment.speaker === 'Agent' ? `Agent (${call.employee?.name}):` : 'Customer:'}
                        </p>
                        <p className="text-foreground">{segment.text}</p>
                      </div>
                      <Badge className={getSentimentColor(segment.sentiment)}>
                        {segment.sentiment.charAt(0).toUpperCase() + segment.sentiment.slice(1)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No transcript text available</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-muted rounded-lg p-4">
            <h4 className="font-semibold text-foreground mb-3">Call Summary</h4>
            <div className="space-y-2 text-sm">
              <p><strong>Duration:</strong> {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : 'Unknown'}</p>
              <p><strong>Status:</strong> <Badge>{call.status}</Badge></p>
              <p><strong>Sentiment:</strong> {call.sentiment?.overallSentiment ? (
                <Badge className={getSentimentColor(call.sentiment.overallSentiment)}>
                  {call.sentiment.overallSentiment.charAt(0).toUpperCase() + call.sentiment.overallSentiment.slice(1)}
                </Badge>
              ) : 'Unknown'}</p>
<p><strong>Performance Score:</strong> {call.analysis?.performanceScore ? Number(call.analysis.performanceScore).toFixed(1) : 'N/A'}/10</p>
            </div>
          </div>

          {call.analysis?.summary && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Key Points</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {call.analysis.summary.split('\n').map((point, index) => (
                  point.trim() && <li key={index}>{point.trim().replace(/^- /, '')}</li>
                ))}
              </ul>
            </div>
          )}

          {call.analysis?.topics && call.analysis.topics.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Key Topics</h4>
              <div className="flex flex-wrap gap-2">
                {call.analysis.topics.map((topic: string, index: number) => (
                  <Badge key={index} variant="outline" className="bg-primary/10 text-primary">
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {call.analysis?.actionItems && call.analysis.actionItems.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Action Items</h4>
              <ul className="space-y-1 text-sm">
                {call.analysis.actionItems.map((item: string, index: number) => (
                  <li key={index} className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {call.analysis?.feedback && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">AI Feedback</h4>
              <div className="space-y-2 text-sm">
                {(call.analysis.feedback as any).strengths?.length > 0 && (
                  <div>
                    <p className="font-medium text-green-600">Strengths:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {(call.analysis.feedback as any).strengths.map((strength: string, index: number) => (
                        <li key={index}>{strength}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(call.analysis.feedback as any).suggestions?.length > 0 && (
                  <div>
                    <p className="font-medium text-primary">Suggestions:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {(call.analysis.feedback as any).suggestions.map((suggestion: string, index: number) => (
                        <li key={index}>{suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
