import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Warning } from "@phosphor-icons/react";
import type { CallWithDetails, PaginatedCalls } from "@shared/schema";
import TranscriptViewer from "@/components/transcripts/transcript-viewer";
import ViewerHeader from "@/components/transcripts/viewer-header";
import CallsTable from "@/components/tables/calls-table";
import CallsListHeader from "@/components/tables/calls-list-header";
import CallsPreviewRail, { PreviewRailTab } from "@/components/tables/calls-preview-rail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthUser {
  id: string;
  role?: string;
}

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

  return <CallsListMode />;
}

/**
 * Calls list layout with a collapsible right-docked preview rail
 * (warm-paper installment 6, phase 3).
 *
 * The table + rail live side-by-side in a flex row below the page
 * header. Row click selects a call for preview; the rail stays in
 * sync. When the rail is collapsed the right-edge tab brings it back.
 */
function CallsListMode() {
  const [previewOpen, setPreviewOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Same query key CallsTable + CallsListHeader use — TanStack dedupes.
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls"],
  });
  const calls: CallWithDetails[] = callsResponse?.calls ?? [];
  const selectedCall = selectedId ? calls.find((c) => c.id === selectedId) ?? null : null;

  // canCoach gates the rail's "+ Coach" CTA — manager/admin only.
  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const role = (me?.role || "viewer").toLowerCase();
  const canCoach = role === "manager" || role === "admin";

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      data-testid="transcripts-page"
    >
      <CallsListHeader />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 px-7 py-6 overflow-x-auto">
          <CallsTable
            onRowSelect={(id) => {
              setSelectedId(id);
              if (!previewOpen) setPreviewOpen(true);
            }}
            selectedCallId={previewOpen ? selectedId : null}
          />
        </div>
        {previewOpen && (
          <CallsPreviewRail
            call={selectedCall}
            canCoach={canCoach}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </div>
      {!previewOpen && <PreviewRailTab onOpen={() => setPreviewOpen(true)} />}
    </div>
  );
}
