/**
 * KnowledgeTrigger — floating "Ask KB" button + KnowledgeDrawer pair.
 * Self-contained: reads /api/config to decide whether the KB integration
 * is available and renders nothing if not. Place once per page that
 * should expose KB lookup.
 *
 * The button sits in the bottom-right corner with a 44×44 tap target
 * (WCAG 2.5.5) so it doesn't compete with other floating UI. Clicking
 * it toggles the drawer open; clicking again while open closes it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Books } from "@phosphor-icons/react";
import { KnowledgeDrawer } from "./KnowledgeDrawer";

interface AppConfig {
  kb?: {
    enabled?: boolean;
    embedUrl?: string | null;
  };
}

export function KnowledgeTrigger() {
  const [open, setOpen] = useState(false);
  const { data: cfg } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
    staleTime: Infinity,
  });

  const enabled = cfg?.kb?.enabled === true && !!cfg.kb.embedUrl;
  if (!enabled || !cfg?.kb?.embedUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close knowledge base" : "Open knowledge base"}
        aria-expanded={open}
        title="Ask the knowledge base"
        data-testid="kb-trigger"
        className="fixed bottom-6 right-6 z-30 inline-flex h-11 min-w-[44px] items-center gap-2 rounded-full border border-border bg-card px-4 text-[13px] font-medium text-foreground shadow-md hover:bg-muted"
        style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
      >
        <Books size={16} aria-hidden="true" />
        <span>Ask KB</span>
      </button>
      <KnowledgeDrawer
        open={open}
        onClose={() => setOpen(false)}
        embedUrl={cfg.kb.embedUrl}
      />
    </>
  );
}
