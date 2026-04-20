import { useParams } from "wouter";
import { Link } from "wouter";
import { Warning } from "@phosphor-icons/react";
import TranscriptViewer from "@/components/transcripts/transcript-viewer";
import ViewerHeader from "@/components/transcripts/viewer-header";
import CallsTable from "@/components/tables/calls-table";
import CallsListHeader from "@/components/tables/calls-list-header";

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
      <div className="min-h-screen bg-background text-foreground" data-testid="transcript-detail-page">
        <ViewerHeader callId={callId} />
        <div className="p-6">
          <TranscriptViewer callId={callId} />
        </div>
      </div>
    );
  }

  // Otherwise, show the transcripts list
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="transcripts-page">
      <CallsListHeader />
      <div className="px-7 py-6">
        <CallsTable />
      </div>
    </div>
  );
}
