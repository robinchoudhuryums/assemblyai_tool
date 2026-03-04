import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Home } from "lucide-react";
import TranscriptViewer from "@/components/transcripts/transcript-viewer";
import CallsTable from "@/components/tables/calls-table";
import type { CallWithDetails } from "@shared/schema";

export default function Transcripts() {
  const params = useParams();
  const callId = params?.id;

  // If we have a specific call ID, show the transcript viewer
  if (callId) {
    return (
      <div className="min-h-screen" data-testid="transcript-detail-page">
        {/* Header with Breadcrumbs */}
        <header className="bg-card border-b border-border px-6 py-4">
          <nav className="flex items-center text-sm text-muted-foreground mb-2">
            <Link href="/" className="hover:text-foreground transition-colors">
              <Home className="w-4 h-4" />
            </Link>
            <ChevronRight className="w-3 h-3 mx-2" />
            <Link href="/transcripts" className="hover:text-foreground transition-colors">
              Transcripts
            </Link>
            <ChevronRight className="w-3 h-3 mx-2" />
            <span className="text-foreground font-medium">Call Details</span>
          </nav>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call Transcript</h2>
            <p className="text-muted-foreground">Interactive transcript with sentiment analysis and performance insights</p>
          </div>
        </header>

        <div className="p-6">
          <TranscriptViewer callId={callId} />
        </div>
      </div>
    );
  }

  // Otherwise, show the transcripts list
  return (
    <div className="min-h-screen" data-testid="transcripts-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Call Transcripts</h2>
          <p className="text-muted-foreground">Browse and analyze all call recordings and their transcripts</p>
        </div>
      </header>

      <div className="p-6">
        <CallsTable />
        
        {/* Additional Features */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Transcript Features</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <span>Click timestamps to navigate audio</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <span>Real-time sentiment analysis per segment</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <span>Speaker identification and labeling</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <span>Export transcripts as text or PDF</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <span>Search within transcript content</span>
              </li>
            </ul>
          </div>
          
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Analysis Capabilities</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span>Performance scoring and metrics</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span>Topic extraction and categorization</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span>Action item identification</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span>AI-powered feedback and suggestions</span>
              </li>
              <li className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                <span>Call summary generation</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
