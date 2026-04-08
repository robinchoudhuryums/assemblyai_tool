import { useParams } from "wouter";
import { Link } from "wouter";
import { CaretRight, House, Warning } from "@phosphor-icons/react";
import TranscriptViewer from "@/components/transcripts/transcript-viewer";
import CallsTable from "@/components/tables/calls-table";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Transcripts() {
  const params = useParams();
  const callId = params?.id;

  // Reject malformed call IDs at the route boundary so a typo or copy-paste
  // accident shows an explicit 404 instead of firing an API request that
  // 500s on the server side and renders an empty viewer.
  if (callId && !UUID_RE.test(callId)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8" data-testid="transcript-not-found">
        <Warning className="w-12 h-12 text-amber-500 mb-4" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Call not found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The call ID <code className="bg-muted px-1.5 py-0.5 rounded">{callId}</code> is not valid.
        </p>
        <Link href="/transcripts" className="text-primary hover:underline">
          Back to transcripts
        </Link>
      </div>
    );
  }

  // If we have a specific call ID, show the transcript viewer
  if (callId) {
    return (
      <div className="min-h-screen" data-testid="transcript-detail-page">
        {/* Header with Breadcrumbs */}
        <header className="bg-card border-b border-border px-6 py-4">
          <nav className="flex items-center text-sm text-muted-foreground mb-2">
            <Link href="/" className="hover:text-foreground transition-colors">
              <House className="w-4 h-4" />
            </Link>
            <CaretRight className="w-3 h-3 mx-2" />
            <Link href="/transcripts" className="hover:text-foreground transition-colors">
              Transcripts
            </Link>
            <CaretRight className="w-3 h-3 mx-2" />
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
