import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Download, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CallWithDetails } from "@shared/schema";

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

  const { data: call, isLoading } = useQuery<CallWithDetails>({
    queryKey: ["/api/calls", callId],
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="h-96 bg-muted rounded"></div>
            </div>
            <div className="space-y-4">
              <div className="h-32 bg-muted rounded"></div>
              <div className="h-24 bg-muted rounded"></div>
              <div className="h-24 bg-muted rounded"></div>
            </div>
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

  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive': return 'sentiment-positive';
      case 'negative': return 'sentiment-negative';
      default: return 'sentiment-neutral';
    }
  };

  // Mock transcript segments for demonstration
  const transcriptSegments = call.transcript?.words ? 
    generateSegmentsFromWords(call.transcript.words as TranscriptWord[]) : 
    [];

  function generateSegmentsFromWords(words: TranscriptWord[]) {
    // Group words into segments by speaker or time gaps
    const segments = [];
    let currentSegment = { 
      start: 0, 
      end: 0, 
      text: '', 
      speaker: 'Agent',
      sentiment: 'positive' as const
    };
    
    words.forEach((word, index) => {
      if (index === 0 || word.start - currentSegment.end > 5) {
        if (currentSegment.text) {
          segments.push({ ...currentSegment });
        }
        currentSegment = {
          start: word.start,
          end: word.end,
          text: word.text,
          speaker: word.speaker || (segments.length % 2 === 0 ? 'Agent' : 'Customer'),
          sentiment: 'positive' as const
        };
      } else {
        currentSegment.text += ' ' + word.text;
        currentSegment.end = word.end;
      }
    });
    
    if (currentSegment.text) {
      segments.push(currentSegment);
    }
    
    return segments;
  }

  const jumpToTime = (time: number) => {
    setCurrentTime(time);
    // In a real implementation, this would seek the audio player
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="transcript-viewer">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Call Transcript</h3>
          <p className="text-sm text-muted-foreground">
            {call.employee?.name} • {new Date(call.uploadedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" data-testid="export-transcript">
            <Download className="w-4 h-4 mr-1" />
            Export
          </Button>
          <Button size="sm" data-testid="play-audio">
            <Play className="w-4 h-4 mr-1" />
            Play Audio
          </Button>
        </div>
      </div>
      
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
                    className="transcript-line p-2 rounded cursor-pointer"
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
                        <p className={`text-sm font-medium ${
                          segment.speaker === 'Agent' ? 'text-primary' : 'text-gray-600'
                        }`}>
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
              <p><strong>Performance Score:</strong> {call.analysis?.performanceScore?.toFixed(1) || 'N/A'}/10</p>
            </div>
          </div>
          
          {call.analysis?.topics && call.analysis.topics.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Key Topics</h4>
              <div className="flex flex-wrap gap-2">
                {call.analysis.topics.map((topic, index) => (
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
                {call.analysis.actionItems.map((item, index) => (
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
