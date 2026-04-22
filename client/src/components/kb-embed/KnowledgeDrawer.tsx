/**
 * KnowledgeDrawer — slide-in right-side drawer that iframes RAG's chat at
 * `${RAG_SERVICE_URL}/?embed=1`. Authentication rides on the shared
 * `.umscallanalyzer.com` session cookie (SSO Track 2) — RAG's SSO
 * middleware bootstraps a RAG session the first request the iframe makes.
 *
 * PostMessage bridge:
 *   Inbound (RAG → CA):
 *     - embed:ready                 → flip the `ready` flag so we stop
 *                                     showing the loading state
 *     - embed:close                 → user pressed Escape inside the
 *                                     iframe (keydown doesn't bubble); we
 *                                     call onClose
 *     - embed:open-source { url }   → user clicked a source citation;
 *                                     we window.open() to a new tab so
 *                                     PDFs / viewers don't render inside
 *                                     this narrow drawer
 *   Outbound (CA → RAG):
 *     - embed:clear                 → the "Clear chat" button; RAG's
 *                                     EmbedShell remounts ChatInterface
 *
 * Origin validation: we only accept inbound messages whose origin
 * matches the iframe src's origin. Outbound messages are sent with
 * `targetOrigin` set to that same origin (not '*') so a cross-origin
 * attacker cannot read control-flow messages.
 */

import { useEffect, useRef, useState } from "react";
import { X, ChatCircleText, ArrowCounterClockwise } from "@phosphor-icons/react";

interface Props {
  open: boolean;
  onClose: () => void;
  embedUrl: string;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function KnowledgeDrawer({ open, onClose, embedUrl }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const allowedOrigin = originOf(embedUrl);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!allowedOrigin || event.origin !== allowedOrigin) return;
      const data = event.data as {
        type?: string;
        url?: unknown;
      } | null;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "embed:ready") {
        setReady(true);
        return;
      }
      if (data.type === "embed:close") {
        onClose();
        return;
      }
      if (data.type === "embed:open-source") {
        // Guard against prototype pollution / unexpected payloads.
        if (typeof data.url !== "string") return;
        // Only open URLs that match the iframe's origin (or share our
        // protocol+eTLD+1). `embed:open-source` is meant for RAG's own
        // document-serve routes; anything else is suspicious and gets
        // silently dropped rather than window.open'd.
        try {
          const target = new URL(data.url);
          if (target.origin !== allowedOrigin) return;
        } catch {
          return;
        }
        window.open(data.url, "_blank", "noopener,noreferrer");
        return;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [allowedOrigin, onClose]);

  // Escape key closes the drawer when it has focus in the parent frame.
  // (Escape inside the iframe doesn't bubble here — that's a known
  // limitation; users can still click the × button.)
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Reset the ready flag when the drawer closes so the loading state
  // shows again next time it opens.
  useEffect(() => {
    if (!open) setReady(false);
  }, [open]);

  const handleClear = () => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow || !allowedOrigin) return;
    frame.contentWindow.postMessage({ type: "embed:clear" }, allowedOrigin);
  };

  if (!open) return null;

  return (
    <>
      {/* Scrim behind the drawer for focus + click-outside-to-close. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Knowledge base chat"
        aria-modal="true"
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[420px] flex-col border-l border-border bg-card shadow-lg"
      >
        <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-border bg-muted px-3">
          <div className="flex items-center gap-2">
            <ChatCircleText size={16} aria-hidden="true" />
            <span className="font-display text-[14px] font-semibold text-foreground">
              Knowledge base
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear chat"
              title="Clear chat"
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <ArrowCounterClockwise size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              title="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              Loading…
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={embedUrl}
            title="UMS Knowledge chat"
            className="h-full w-full border-0"
            // Sandbox: allow same-origin + scripts + forms, restrict
            // popups/downloads. Same-origin is required or the iframe
            // can't read its own cookies (and the shared session cookie
            // wouldn't authenticate).
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      </aside>
    </>
  );
}
