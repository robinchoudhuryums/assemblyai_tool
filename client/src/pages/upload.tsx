import { Link } from "wouter";
import FileUpload from "@/components/upload/file-upload";

/**
 * Upload page (warm-paper installment 6, phase 5).
 *
 * Single-purpose page: agent drops audio files and they're queued for
 * transcription + AI analysis. Chrome trimmed — the earlier "Supported
 * Formats" + "Processing Features" info grid was agent-facing cruft
 * (FileUpload already lists the supported formats in the dropzone
 * caption).
 */
export default function Upload() {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="upload-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 px-4 sm:px-7 py-3 bg-card border-b border-border"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Upload</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border max-w-3xl">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          Upload call recordings
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Drop audio in. We'll transcribe and score it.
        </div>
        <p
          className="text-muted-foreground mt-3 leading-relaxed"
          style={{ fontSize: 13, maxWidth: 520 }}
        >
          Processing typically takes 2–3 minutes per file. The call will appear in Transcripts
          once it's done; you'll see live status updates while it's in flight.
        </p>
      </div>

      <div className="px-4 sm:px-7 py-6 max-w-5xl">
        <FileUpload />
      </div>
    </div>
  );
}
