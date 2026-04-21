/**
 * Simulated Call Generator — admin-only page.
 *
 * Two tabs:
 *   - Generate: script builder form (or paste JSON) + voice picker + quality config
 *   - Library: table of generated calls with status, cost, audio player, actions
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Microphone, Pause, Play, Plus, SpinnerGap, Sparkle, SlidersHorizontal, Trash, WarningCircle, CheckCircle, PaperPlaneTilt, CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import type {
  SimulatedCall,
  SimulatedCallStatus,
  SimulatedCallConfig,
  SimulatedCallScript,
  Circumstance,
} from "@shared/simulated-call-schema";
import { CIRCUMSTANCE_VALUES, CIRCUMSTANCE_META } from "@shared/simulated-call-schema";

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  /** ElevenLabs CDN URL of a short preview clip — renders a play button in the picker. */
  preview_url?: string;
  description?: string;
}

interface ListResponse {
  calls: SimulatedCall[];
  dailyUsed: number;
  dailyCap: number;
}

interface VoicesResponse {
  voices: Voice[];
  cached: boolean;
}

const DEFAULT_CONFIG: SimulatedCallConfig = {
  gapDistribution: "natural",
  gapMeanSeconds: 0.8,
  gapStdDevSeconds: 0.3,
  connectionQuality: "phone",
  backgroundNoise: "none",
  backgroundNoiseLevel: 0.15,
  holdMusicUrl: null,
  analyzeAfterGeneration: false,
  disfluencies: true,
  backchannels: true,
  circumstances: [],
};

const DEFAULT_TURNS_TEXT = [
  "Thank you for calling, how can I help?",
  "Hi, I had a question about my order.",
] as const;

const EMPTY_SCRIPT: SimulatedCallScript = {
  title: "",
  scenario: "",
  qualityTier: "acceptable",
  equipment: "",
  voices: { agent: "pNInz6obpgDQGcFmaJgB", customer: "21m00Tcm4TlvDq8ikWAM" },
  turns: [
    { speaker: "agent", text: DEFAULT_TURNS_TEXT[0] },
    { speaker: "customer", text: DEFAULT_TURNS_TEXT[1] },
  ],
};

/**
 * Returns true if the user has customized the turn list — more than the
 * two default turns, or different text in the defaults. Used to decide
 * whether to confirm before the Scenario Generator overwrites the turns.
 */
function hasCustomizedTurns(turns: SimulatedCallScript["turns"]): boolean {
  if (turns.length !== 2) return true;
  const [a, b] = turns;
  if (a.speaker !== "agent" || b.speaker !== "customer") return true;
  const aText = (a as { text?: string }).text ?? "";
  const bText = (b as { text?: string }).text ?? "";
  return aText !== DEFAULT_TURNS_TEXT[0] || bText !== DEFAULT_TURNS_TEXT[1];
}

function statusBadge(status: SimulatedCallStatus) {
  const variants: Record<SimulatedCallStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Queued", variant: "secondary" },
    generating: { label: "Generating", variant: "default" },
    ready: { label: "Ready", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
  };
  return variants[status] || { label: status, variant: "outline" };
}

/** Document-style status pill — mono uppercase small-caps, tonal per status. */
function StatusPill({ status }: { status: SimulatedCallStatus }) {
  const meta = (() => {
    switch (status) {
      case "ready":
        return { label: "Ready", cls: "border-[color-mix(in_oklch,var(--sage),transparent_50%)] text-[var(--sage)] bg-[var(--sage-soft)]" };
      case "generating":
        return { label: "Generating", cls: "border-primary text-primary bg-[color-mix(in_oklch,var(--primary),transparent_88%)]" };
      case "pending":
        return { label: "Queued", cls: "border-border text-muted-foreground bg-muted" };
      case "failed":
        return { label: "Failed", cls: "border-[color-mix(in_oklch,var(--destructive),transparent_60%)] text-destructive bg-[color-mix(in_oklch,var(--destructive),transparent_92%)]" };
      default:
        return { label: status, cls: "border-border text-muted-foreground bg-muted" };
    }
  })();
  return (
    <span
      className={`font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 border rounded-sm ${meta.cls}`}
      data-testid={`status-pill-${status}`}
    >
      {meta.label}
    </span>
  );
}

/** Document-style quality-tier pill — outline-only, color-encoded. */
function QualityPill({ tier }: { tier: "excellent" | "acceptable" | "poor" }) {
  const color =
    tier === "excellent"
      ? "text-[var(--sage)] border-[color-mix(in_oklch,var(--sage),transparent_50%)]"
      : tier === "poor"
      ? "text-destructive border-[color-mix(in_oklch,var(--destructive),transparent_60%)]"
      : "text-muted-foreground border-border";
  return (
    <span className={`font-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 border rounded-sm bg-transparent ${color}`}>
      {tier}
    </span>
  );
}

/** Warm-amber circumstance chip — matches the isolation-banner family. */
function CircumstanceChip({ id, compact = false }: { id: Circumstance; compact?: boolean }) {
  const meta = CIRCUMSTANCE_META[id];
  if (!meta) return null;
  return (
    <span
      className={`font-mono text-[9px] uppercase tracking-[0.1em] border rounded-sm border-[color-mix(in_oklch,var(--amber),transparent_50%)] text-[color-mix(in_oklch,var(--amber),var(--ink)_35%)] bg-[var(--amber-soft)] ${
        compact ? "px-1.5 py-0.5" : "px-2 py-0.5"
      }`}
    >
      {meta.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper primitives (installment 18 — simulated-calls redesign).
// Kept page-local following the same pattern admin.tsx / settings.tsx
// use: each installment owns its primitives, and shared ones get
// hoisted in a future cleanup pass if a second consumer appears.
// ─────────────────────────────────────────────────────────────

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {children}
    </div>
  );
}

function Panel({
  kicker,
  title,
  description,
  action,
  children,
  dense = false,
}: {
  kicker?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** dense: tighter vertical padding for sidebar panels. */
  dense?: boolean;
}) {
  const hasHeader = kicker || title || description || action;
  return (
    <div className="rounded-sm border border-border bg-card overflow-hidden">
      {hasHeader && (
        <div
          className={`border-b border-border flex items-start justify-between gap-3 ${
            dense ? "px-4 py-3" : "px-5 py-4"
          }`}
        >
          <div className="min-w-0 flex-1">
            {kicker && <SectionKicker>{kicker}</SectionKicker>}
            {title && (
              <div
                className={`font-display font-medium text-foreground ${kicker ? "mt-1" : ""}`}
                style={{
                  fontSize: dense ? 15 : 16,
                  letterSpacing: "-0.2px",
                  lineHeight: 1.2,
                }}
              >
                {title}
              </div>
            )}
            {description && (
              <p
                className="text-sm text-muted-foreground mt-1.5"
                style={{ maxWidth: 560, lineHeight: 1.5 }}
              >
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={dense ? "p-4" : "p-5"}>{children}</div>
    </div>
  );
}

function ToolbarTab({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count?: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors border " +
        (active
          ? "bg-foreground text-background border-foreground"
          : "bg-card text-foreground border-border hover:bg-secondary")
      }
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      {children}
      {count !== undefined && (
        <span className="font-mono tabular-nums" style={{ opacity: active ? 0.75 : 0.55 }}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Mono-uppercase speaker tag — replaces shadcn Badge in the turn row. */
function SpeakerTag({ speaker }: { speaker: string }) {
  const toneStyle: React.CSSProperties = (() => {
    switch (speaker) {
      case "agent":
        return {
          background: "var(--copper-soft)",
          color: "var(--accent)",
          borderColor: "color-mix(in oklch, var(--accent), transparent 55%)",
        };
      case "customer":
        return {
          background: "var(--sage-soft)",
          color: "var(--sage)",
          borderColor: "color-mix(in oklch, var(--sage), transparent 55%)",
        };
      case "hold":
        return {
          background: "var(--paper-2)",
          color: "var(--muted-foreground)",
          borderColor: "var(--border)",
        };
      case "interrupt":
        return {
          background: "var(--amber-soft)",
          color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
          borderColor: "color-mix(in oklch, var(--amber), transparent 55%)",
        };
      default:
        return {
          background: "var(--paper-2)",
          color: "var(--muted-foreground)",
          borderColor: "var(--border)",
        };
    }
  })();
  return (
    <span
      className="font-mono uppercase border rounded-sm shrink-0 tracking-[0.1em]"
      style={{
        ...toneStyle,
        fontSize: 9,
        padding: "3px 6px",
        marginTop: 8,
      }}
    >
      {speaker}
    </span>
  );
}

/** Mini pill for CircumstancePicker — either "Rule" (accent) or "AI" (sage). */
function CircumstanceKindPill({ kind }: { kind: "rule" | "ai" }) {
  const toneStyle: React.CSSProperties =
    kind === "rule"
      ? {
          background: "var(--copper-soft)",
          color: "var(--accent)",
          borderColor: "color-mix(in oklch, var(--accent), transparent 55%)",
        }
      : {
          background: "var(--sage-soft)",
          color: "var(--sage)",
          borderColor: "color-mix(in oklch, var(--sage), transparent 55%)",
        };
  return (
    <span
      className="font-mono uppercase border rounded-sm tracking-[0.1em]"
      style={{
        ...toneStyle,
        fontSize: 9,
        padding: "2px 5px",
      }}
    >
      {kind}
    </span>
  );
}

export default function SimulatedCallsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("library");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/admin/simulated-calls"],
    refetchInterval: (query) => {
      const d = query.state.data as ListResponse | undefined;
      const active = d?.calls?.some((c) => c.status === "pending" || c.status === "generating");
      return active ? 3000 : 15_000;
    },
    refetchOnWindowFocus: true,
  });

  const { data: voicesData } = useQuery<VoicesResponse>({
    queryKey: ["/api/admin/simulated-calls/voices"],
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  // Listen for the WS event to invalidate the list.
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
    };
    window.addEventListener("ws:simulated_call_update", handler);
    return () => window.removeEventListener("ws:simulated_call_update", handler);
  }, []);

  const voices = voicesData?.voices ?? [];
  const calls = data?.calls ?? [];
  const dailyUsed = data?.dailyUsed ?? 0;
  const dailyCap = data?.dailyCap ?? 20;
  const capFull = dailyUsed >= dailyCap;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="simulated-calls-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border"
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
          <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">
            Admin
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Simulated Calls</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div className="flex items-end justify-between gap-8">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              Admin · Synthetic QA studio
            </div>
            <h1
              className="font-display font-medium text-foreground flex items-center gap-3"
              style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
            >
              <Microphone className="w-6 h-6 shrink-0" style={{ color: "var(--accent)" }} />
              Simulated Call Generator
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Generate synthetic call recordings for QA, agent training, and pipeline regression testing.
            </p>
          </div>
          <div
            className={`font-mono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border rounded-sm tabular-nums shrink-0 ${
              capFull
                ? "border-destructive text-destructive bg-[color-mix(in_oklch,var(--destructive),transparent_92%)]"
                : "border-border text-muted-foreground bg-card"
            }`}
            data-testid="daily-cap-pill"
          >
            {dailyUsed} / {dailyCap} today
          </div>
        </div>
      </div>

      <div className="px-7 py-6 max-w-7xl mx-auto space-y-6">

      <div
        className="border border-[color-mix(in_oklch,var(--amber),transparent_50%)] border-l-[3px] border-l-[var(--amber)] bg-[var(--amber-soft)] text-foreground text-sm leading-relaxed px-5 py-3"
        role="note"
        data-testid="isolation-banner"
      >
        <strong className="font-display font-semibold">Synthetic isolation:</strong>{" "}
        generated calls never appear in dashboards, reports, leaderboards, coaching, or the AI's
        learning knowledge base. They exist only under this page.{" "}
        <span className="text-muted-foreground">
          "Send to Analysis" creates a{" "}
          <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded-sm">
            synthetic = TRUE
          </code>{" "}
          call row.
        </span>
      </div>

      <div className="space-y-5">
        <div className="flex items-center gap-2" role="tablist" aria-label="Simulated calls">
          <ToolbarTab active={tab === "library"} count={calls.length} onClick={() => setTab("library")}>
            Library
          </ToolbarTab>
          <ToolbarTab active={tab === "generate"} onClick={() => setTab("generate")}>
            Generate New
          </ToolbarTab>
          <ToolbarTab active={tab === "calibration"} onClick={() => setTab("calibration")}>
            Calibration
          </ToolbarTab>
        </div>
        {tab === "library" ? (
          <LibraryTable
            calls={calls}
            isLoading={isLoading}
            playingId={playingId}
            onPlay={setPlayingId}
          />
        ) : tab === "generate" ? (
          <GenerateForm voices={voices} capFull={capFull} onSuccess={() => setTab("library")} />
        ) : (
          <CalibrationSuitePanel />
        )}
      </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Library table
// ─────────────────────────────────────────────────────────────
function LibraryTable({
  calls,
  isLoading,
  playingId,
  onPlay,
}: {
  calls: SimulatedCall[];
  isLoading: boolean;
  playingId: string | null;
  onPlay: (id: string | null) => void;
}) {
  const { toast } = useToast();
  const [variantSource, setVariantSource] = useState<SimulatedCall | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/simulated-calls/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
      toast({ title: "Deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const analyzeMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/simulated-calls/${id}/analyze`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
      toast({ title: "Sent to analysis", description: "The real analysis pipeline is now running. Results will appear here when done." });
    },
    onError: (e: Error) => toast({ title: "Analyze failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (calls.length === 0) {
    return (
      <div className="border border-border bg-card py-20 text-center text-muted-foreground">
        <Microphone className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <div className="font-display text-[15px] mb-1 text-foreground">No simulated calls yet</div>
        <div className="text-xs">Head to "Generate New" to create one.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {calls.map((c) => {
        const isPlaying = playingId === c.id;
        return (
          <div key={c.id} className="bg-card border border-border px-4 py-3.5">
            <div className="flex items-start gap-3.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <h3 className="font-display text-[14px] font-medium text-foreground truncate mr-1">{c.title}</h3>
                    <StatusPill status={c.status} />
                    {c.qualityTier && <QualityPill tier={c.qualityTier as "excellent" | "acceptable" | "poor"} />}
                    {(c.config?.circumstances ?? []).map((circ: Circumstance) => (
                      <CircumstanceChip key={circ} id={circ} compact />
                    ))}
                    {c.sentToAnalysisCallId && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--sage)] inline-flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Analyzed
                      </span>
                    )}
                  </div>
                  {c.scenario && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{c.scenario}</p>
                  )}
                  <div className="font-mono text-[10px] text-muted-foreground mt-2 flex gap-3.5 flex-wrap tabular-nums">
                    {c.durationSeconds != null && <span>{c.durationSeconds}s</span>}
                    {c.ttsCharCount != null && <span>{c.ttsCharCount.toLocaleString()} chars</span>}
                    {c.estimatedCost != null && <span>~${c.estimatedCost.toFixed(4)}</span>}
                    <span>{c.createdAt?.slice(0, 19).replace("T", " ")}</span>
                  </div>
                  {c.error && (
                    <div className="mt-2 px-2.5 py-2 border border-[color-mix(in_oklch,var(--destructive),transparent_70%)] bg-[var(--warm-red-soft)] text-[11px] text-destructive flex items-start gap-1.5">
                      <WarningCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{c.error}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {c.status === "ready" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onPlay(isPlaying ? null : c.id)}>
                        <Play className="w-4 h-4 mr-1" />
                        {isPlaying ? "Hide" : "Play"}
                      </Button>
                      {!c.sentToAnalysisCallId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={analyzeMut.isPending}
                          onClick={() => analyzeMut.mutate(c.id)}
                        >
                          <PaperPlaneTilt className="w-4 h-4 mr-1" />
                          Analyze
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[color-mix(in_oklch,var(--chart-5),transparent_60%)] text-[var(--chart-5)] hover:bg-[color-mix(in_oklch,var(--chart-5),transparent_92%)]"
                        onClick={() => setVariantSource(c)}
                      >
                        <Sparkle className="w-4 h-4 mr-1" />
                        Variation
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMut.isPending}
                    onClick={() => {
                      if (confirm(`Delete "${c.title}"?`)) deleteMut.mutate(c.id);
                    }}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
            </div>
            {isPlaying && c.status === "ready" && (
              <div className="mt-3 px-3.5 py-2.5 bg-muted">
                <audio
                  src={`/api/admin/simulated-calls/${c.id}/audio`}
                  controls
                  className="w-full"
                  autoPlay
                />
              </div>
            )}
          </div>
        );
      })}
      <VariationDialog source={variantSource} onClose={() => setVariantSource(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Variation dialog — calls the Bedrock rewriter preview endpoint,
// then lets the admin confirm + queue generation. Two-step flow:
// preview → confirm. The admin sees the rewritten script before
// spending TTS credits.
// ─────────────────────────────────────────────────────────────
function VariationDialog({
  source,
  onClose,
}: {
  source: SimulatedCall | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [circumstances, setCircumstances] = useState<Circumstance[]>([]);
  const [targetTier, setTargetTier] = useState<"poor" | "acceptable" | "excellent" | "inherit">("inherit");
  const [preview, setPreview] = useState<SimulatedCallScript | null>(null);

  // Reset state each time a new source is opened.
  useEffect(() => {
    if (source) {
      setCircumstances([]);
      setTargetTier("inherit");
      setPreview(null);
    }
  }, [source?.id]);

  const rewriteMut = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("no source");
      const body: Record<string, unknown> = { circumstances };
      if (targetTier !== "inherit") body.targetQualityTier = targetTier;
      const res = await apiRequest("POST", `/api/admin/simulated-calls/${source.id}/rewrite`, body);
      return res.json() as Promise<{ sourceId: string; script: SimulatedCallScript }>;
    },
    onSuccess: (data) => {
      setPreview(data.script);
    },
    onError: (e: Error) => toast({ title: "Rewrite failed", description: e.message, variant: "destructive" }),
  });

  const generateMut = useMutation({
    mutationFn: async () => {
      if (!preview || !source) throw new Error("no preview");
      const script = preview;
      // Build a config that carries the circumstances so the Library shows
      // them as badges, and the rule-based modifiers compose on top at
      // generation time (unless the admin clears them here).
      const config = { ...(source.config ?? {}), circumstances };
      const res = await apiRequest("POST", "/api/admin/simulated-calls/generate", { script, config });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
      toast({ title: "Variation queued", description: "Generation will complete shortly." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const toggleCirc = (c: Circumstance) => {
    setCircumstances((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    setPreview(null); // invalidate any prior preview when selection changes
  };

  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle className="w-5 h-5" />
            Create Variation
          </DialogTitle>
          <DialogDescription>
            Pick circumstances and the AI will rewrite the script. Preview before spending TTS credits. Rewrite cost: ~$0.003 on Haiku / ~$0.034 on Sonnet.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Source</Label>
              <p className="text-sm font-medium">{source?.title}</p>
            </div>

            <div>
              <Label className="mb-2 block">Circumstances (1–4)</Label>
              <div className="grid grid-cols-2 gap-2">
                {CIRCUMSTANCE_VALUES.map((c) => {
                  const active = circumstances.includes(c);
                  const meta = CIRCUMSTANCE_META[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCirc(c)}
                      className={
                        "text-left px-3 py-2 rounded-md border text-sm transition-colors " +
                        (active ? "bg-primary/10 border-primary/50" : "border-border hover:bg-muted")
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span>{meta.label}</span>
                        {active && (
                          <CheckCircle
                            className="w-4 h-4"
                            style={{ color: "var(--sage)" }}
                            weight="fill"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Target quality tier</Label>
              <Select value={targetTier} onValueChange={(v) => setTargetTier(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit from source ({source?.qualityTier})</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="acceptable">Acceptable</SelectItem>
                  <SelectItem value="excellent">Excellent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => rewriteMut.mutate()}
                disabled={rewriteMut.isPending || circumstances.length === 0 || circumstances.length > 4}
              >
                {rewriteMut.isPending ? <SpinnerGap className="w-4 h-4 animate-spin mr-2" /> : <Sparkle className="w-4 h-4 mr-2" />}
                Preview rewrite
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Rewritten script</Label>
              <p className="text-sm font-medium">{preview.title}</p>
              {preview.scenario && (
                <p className="text-xs text-muted-foreground mt-1">{preview.scenario}</p>
              )}
            </div>

            <ScrollArea className="h-72 border rounded-md p-3 bg-muted/30">
              <div className="space-y-2 text-sm">
                {preview.turns.map((t, i) => {
                  if (t.speaker === "hold") {
                    return (
                      <div key={i} className="italic text-muted-foreground">
                        — hold, {t.duration}s —
                      </div>
                    );
                  }
                  const label = t.speaker === "interrupt" ? `${t.primarySpeaker} (interrupt)` : t.speaker;
                  const text = t.speaker === "interrupt" ? `${t.text} / [${t.interruptText}]` : t.text;
                  return (
                    <div key={i}>
                      <span className="font-medium capitalize text-xs">{label}:</span>{" "}
                      <span>{text}</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="text-xs text-muted-foreground">
              {preview.turns.length} turns · Clicking Generate will queue a new simulated call using this rewritten script and the selected circumstances as config metadata.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>Back</Button>
              <Button
                onClick={() => generateMut.mutate()}
                disabled={generateMut.isPending}
              >
                {generateMut.isPending ? <SpinnerGap className="w-4 h-4 animate-spin mr-2" /> : null}
                Generate variation
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Generate form
// ─────────────────────────────────────────────────────────────
function GenerateForm({
  voices,
  capFull,
  onSuccess,
}: {
  voices: Voice[];
  capFull: boolean;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [script, setScript] = useState<SimulatedCallScript>(EMPTY_SCRIPT);
  const [config, setConfig] = useState<SimulatedCallConfig>(DEFAULT_CONFIG);

  // When voice list loads, default voices if unset.
  useEffect(() => {
    if (voices.length === 0) return;
    setScript((s) => {
      const agentOk = voices.some((v) => v.voice_id === s.voices.agent);
      const customerOk = voices.some((v) => v.voice_id === s.voices.customer);
      if (agentOk && customerOk) return s;
      return {
        ...s,
        voices: {
          agent: agentOk ? s.voices.agent : (voices[0]?.voice_id ?? s.voices.agent),
          customer: customerOk ? s.voices.customer : (voices[1]?.voice_id ?? voices[0]?.voice_id ?? s.voices.customer),
        },
      };
    });
  }, [voices]);

  const generateMut = useMutation({
    mutationFn: async (payload: { script: SimulatedCallScript; config: SimulatedCallConfig }) => {
      const res = await apiRequest("POST", "/api/admin/simulated-calls/generate", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Generation queued", description: "Your call will appear in the Library tab shortly." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const totalChars = useMemo(() => {
    return script.turns.reduce((sum, turn) => {
      // Hold turns have no text; interrupt turns have both text and interruptText.
      if (turn.speaker === "hold") return sum;
      if (turn.speaker === "interrupt") {
        return sum + (turn.text?.length || 0) + (turn.interruptText?.length || 0);
      }
      return sum + (turn.text?.length || 0);
    }, 0);
  }, [script]);

  const estimatedCost = (totalChars * 0.0003).toFixed(4);

  const handleSubmit = () => {
    if (capFull) {
      toast({ title: "Daily cap reached", description: "Try again tomorrow.", variant: "destructive" });
      return;
    }
    let finalScript = script;
    if (jsonMode) {
      try {
        finalScript = JSON.parse(jsonText);
      } catch (e) {
        toast({ title: "Invalid JSON", description: (e as Error).message, variant: "destructive" });
        return;
      }
    }
    if (!finalScript.title || finalScript.turns.length === 0) {
      toast({ title: "Missing fields", description: "Title and at least one turn are required.", variant: "destructive" });
      return;
    }
    // Surface empty turn text up-front so the user doesn't round-trip to
    // the server for a Zod min(1) rejection on `script.turns.N.text` /
    // `script.turns.N.interruptText`. These are the most common sources
    // of a 400 from the generate endpoint when a user adds a turn via
    // the "+ Agent" / "+ Customer" / "+ Hold" buttons and forgets to
    // fill in the text box.
    const emptyTurnIndexes: number[] = [];
    finalScript.turns.forEach((turn, idx) => {
      if (turn.speaker === "hold") return;
      const text = (turn as { text?: string }).text ?? "";
      const interruptText =
        turn.speaker === "interrupt" ? (turn.interruptText ?? "") : "";
      if (!text.trim()) emptyTurnIndexes.push(idx);
      else if (turn.speaker === "interrupt" && !interruptText.trim()) emptyTurnIndexes.push(idx);
    });
    if (emptyTurnIndexes.length > 0) {
      toast({
        title: "Empty turns found",
        description: `Turn${emptyTurnIndexes.length > 1 ? "s" : ""} ${emptyTurnIndexes.map(i => i + 1).join(", ")} ha${emptyTurnIndexes.length > 1 ? "ve" : "s"} no text. Fill in each turn or remove the blank ones before generating.`,
        variant: "destructive",
      });
      return;
    }
    generateMut.mutate({ script: finalScript, config });
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      {/* Left 2/3: script builder */}
      <div className="md:col-span-2 space-y-4">
        <Panel
          kicker="Script"
          title={jsonMode ? "JSON script" : "Dialogue builder"}
          description="Build a call turn-by-turn, or paste an existing JSON script."
          action={
            <Button variant="outline" size="sm" onClick={() => setJsonMode((v) => !v)}>
              {jsonMode ? "Form mode" : "JSON mode"}
            </Button>
          }
        >
          {jsonMode ? (
            <div className="space-y-2">
              <Label>Script JSON</Label>
              <Textarea
                rows={20}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={JSON.stringify(EMPTY_SCRIPT, null, 2)}
                className="font-mono text-xs"
              />
            </div>
          ) : (
            <FormScriptBuilder script={script} setScript={setScript} voices={voices} />
          )}
        </Panel>
      </div>

      {/* Right 1/3: config + submit */}
      <div className="space-y-4">
        <Panel kicker="Capture" title="Audio quality" dense>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Connection quality</Label>
              <Select
                value={config.connectionQuality}
                onValueChange={(v) => setConfig({ ...config, connectionQuality: v as any })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clean">Clean (studio)</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="degraded">Degraded</SelectItem>
                  <SelectItem value="poor">Poor connection</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Background noise</Label>
              <Select
                value={config.backgroundNoise}
                onValueChange={(v) => setConfig({ ...config, backgroundNoise: v as any })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="office">Office</SelectItem>
                  <SelectItem value="callcenter">Call center</SelectItem>
                  <SelectItem value="static">Static</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.backgroundNoise !== "none" && (
              <div className="space-y-1.5">
                <Label>Noise level: {(config.backgroundNoiseLevel * 100).toFixed(0)}%</Label>
                <Slider
                  value={[config.backgroundNoiseLevel]}
                  onValueChange={([v]) => setConfig({ ...config, backgroundNoiseLevel: v })}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Gap between turns</Label>
              <Select
                value={config.gapDistribution}
                onValueChange={(v) => setConfig({ ...config, gapDistribution: v as any })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Natural (randomized)</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Mean gap: {config.gapMeanSeconds.toFixed(2)}s</Label>
              <Slider
                value={[config.gapMeanSeconds]}
                onValueChange={([v]) => setConfig({ ...config, gapMeanSeconds: v })}
                min={0}
                max={3}
                step={0.1}
              />
            </div>

            {/* Realism toggles — both default ON. Disable to get clean, fluent
                TTS without filler words or active-listening overlays. */}
            <div className="pt-3 -mx-4 px-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="cursor-pointer">Filler words (um/uh)</Label>
                  <p className="text-xs text-muted-foreground">Rate scales with quality tier</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={config.disfluencies !== false}
                  onChange={(e) => setConfig({ ...config, disfluencies: e.target.checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="cursor-pointer">Backchannel overlays</Label>
                  <p className="text-xs text-muted-foreground">"mm-hmm", "okay" under long turns</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={config.backchannels !== false}
                  onChange={(e) => setConfig({ ...config, backchannels: e.target.checked })}
                />
              </div>
            </div>

            <div className="pt-3 -mx-4 px-4 border-t border-border">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="cursor-pointer">Auto-analyze when ready</Label>
                  <p className="text-xs text-muted-foreground">
                    Send the generated call through the real analysis pipeline automatically. Adds Bedrock + AssemblyAI cost per generation.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={config.analyzeAfterGeneration === true}
                  onChange={(e) => setConfig({ ...config, analyzeAfterGeneration: e.target.checked })}
                />
              </div>
            </div>
          </div>
        </Panel>

        <CircumstancePicker
          value={config.circumstances ?? []}
          onChange={(next) => setConfig({ ...config, circumstances: next })}
        />

        <Panel kicker="Summary" title="Estimate" dense>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-baseline">
              <span className="font-mono uppercase text-muted-foreground" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Turns</span>
              <span className="font-mono tabular-nums">{script.turns.length}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-mono uppercase text-muted-foreground" style={{ fontSize: 10, letterSpacing: "0.08em" }}>TTS chars</span>
              <span className="font-mono tabular-nums">{totalChars.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-mono uppercase text-muted-foreground" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Est. cost</span>
              <span className="font-mono tabular-nums text-foreground">${estimatedCost}</span>
            </div>
            {(config.circumstances?.length ?? 0) > 0 && (
              <div className="flex justify-between items-baseline">
                <span className="font-mono uppercase text-muted-foreground" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Circumstances</span>
                <span className="font-mono tabular-nums">{config.circumstances!.length}</span>
              </div>
            )}
            <Button
              className="w-full mt-3"
              onClick={handleSubmit}
              disabled={generateMut.isPending || capFull}
            >
              {generateMut.isPending ? <SpinnerGap className="w-4 h-4 animate-spin mr-2" /> : null}
              Generate
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Script builder (form mode)
// ─────────────────────────────────────────────────────────────
function FormScriptBuilder({
  script,
  setScript,
  voices,
}: {
  script: SimulatedCallScript;
  setScript: (s: SimulatedCallScript) => void;
  voices: Voice[];
}) {
  const update = (patch: Partial<SimulatedCallScript>) => setScript({ ...script, ...patch });

  const setTurn = (i: number, turn: SimulatedCallScript["turns"][number]) => {
    const turns = [...script.turns];
    turns[i] = turn;
    update({ turns });
  };
  const removeTurn = (i: number) => {
    update({ turns: script.turns.filter((_, idx) => idx !== i) });
  };
  const addTurn = (speaker: "agent" | "customer" | "hold") => {
    const newTurn =
      speaker === "hold"
        ? { speaker: "hold" as const, duration: 5 }
        : { speaker, text: "" };
    update({ turns: [...script.turns, newTurn] });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Title</Label>
          <Input
            value={script.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. CPAP status check"
          />
        </div>
        <div>
          <Label>Quality tier</Label>
          <Select value={script.qualityTier} onValueChange={(v) => update({ qualityTier: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="excellent">Excellent</SelectItem>
              <SelectItem value="acceptable">Acceptable</SelectItem>
              <SelectItem value="poor">Poor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Scenario</Label>
        <Textarea
          rows={2}
          value={script.scenario ?? ""}
          onChange={(e) => update({ scenario: e.target.value })}
          placeholder="What this call is about"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Agent voice</Label>
          <VoicePicker
            voices={voices}
            value={script.voices.agent}
            onChange={(v) => update({ voices: { ...script.voices, agent: v } })}
          />
        </div>
        <div>
          <Label>Customer voice</Label>
          <VoicePicker
            voices={voices}
            value={script.voices.customer}
            onChange={(v) => update({ voices: { ...script.voices, customer: v } })}
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <ScenarioGeneratorButton script={script} setScript={setScript} />
        <div className="flex items-center justify-between mb-2 mt-4">
          <Label>Turns ({script.turns.length})</Label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => addTurn("agent")}>
              <Plus className="w-3 h-3 mr-1" />Agent
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addTurn("customer")}>
              <Plus className="w-3 h-3 mr-1" />Customer
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addTurn("hold")}>
              <Plus className="w-3 h-3 mr-1" />Hold
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {script.turns.map((turn, i) => (
            <TurnRow
              key={i}
              turn={turn}
              onChange={(next) => setTurn(i, next)}
              onRemove={() => removeTurn(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Circumstance multi-select — toggle chips that reflect the
// real-call situations the script should simulate. Rule-based
// circumstances (angry, hard_of_hearing, escalation) take effect
// at generation time via server/services/circumstance-modifiers.ts.
// Non-rule circumstances are inputs to the Bedrock script rewriter
// (Phase B) and are accepted here but are no-ops until the admin
// uses the "Create Variation" flow.
// ─────────────────────────────────────────────────────────────
function CircumstancePicker({
  value,
  onChange,
}: {
  value: Circumstance[];
  onChange: (next: Circumstance[]) => void;
}) {
  const toggle = (c: Circumstance) => {
    if (value.includes(c)) {
      onChange(value.filter((x) => x !== c));
    } else {
      onChange([...value, c]);
    }
  };

  return (
    <Panel
      kicker="Layer"
      title="Circumstances"
      description="Apply to the script at generation time. Rule-based items take effect immediately; AI items only apply when you use Create Variation on a generated call."
      dense
    >
      <div className="space-y-2">
        {CIRCUMSTANCE_VALUES.map((c) => {
          const meta = CIRCUMSTANCE_META[c];
          const active = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={active}
              className={
                "w-full text-left px-3 py-2 rounded-sm border transition-colors " +
                (active
                  ? "bg-[var(--copper-soft)] border-[color-mix(in_oklch,var(--accent),transparent_50%)] text-foreground"
                  : "bg-transparent border-border hover:bg-secondary")
              }
              style={
                active
                  ? { boxShadow: "inset 2px 0 0 var(--accent)" }
                  : undefined
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{meta.label}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <CircumstanceKindPill kind={meta.ruleBased ? "rule" : "ai"} />
                  {active && (
                    <CheckCircle
                      className="w-4 h-4 shrink-0"
                      style={{ color: "var(--sage)" }}
                      weight="fill"
                    />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {meta.description}
              </p>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Voice bank — popover-based picker with search, filter chips,
// and inline preview playback (uses ElevenLabs preview_url field).
// Replaces the prior plain-Select VoiceSelect.
// ─────────────────────────────────────────────────────────────

type GenderFilter = "all" | "female" | "male";

function matchesGender(voice: Voice, filter: GenderFilter): boolean {
  if (filter === "all") return true;
  const g = String(voice.labels?.gender ?? "").toLowerCase();
  return g === filter;
}

function matchesSearch(voice: Voice, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [
    voice.name,
    voice.description ?? "",
    ...Object.values(voice.labels ?? {}),
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

function voiceMetaLine(voice: Voice): string {
  const labels = voice.labels ?? {};
  return [labels.gender, labels.age, labels.accent, labels.description]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Replacement for VoiceSelect. A Popover trigger showing the currently
 * selected voice; clicking opens a searchable, filterable list of
 * voices. Each row has a ▶ button that plays the voice's preview clip
 * via a single shared <audio> element (only one preview plays at a time).
 */
// ─────────────────────────────────────────────────────────────
// Scenario Generator — "Generate turns from title + scenario" button
// above the Turns section. Calls Bedrock via the
// /api/admin/simulated-calls/generate-from-scenario endpoint to cold-start
// the dialogue. Haiku is the default model (fast + cheap); toggle uses
// Sonnet for higher quality. Always visible but gated on title being
// non-empty. Confirms before overwriting customized turns.
// ─────────────────────────────────────────────────────────────
function ScenarioGeneratorButton({
  script,
  setScript,
}: {
  script: SimulatedCallScript;
  setScript: (s: SimulatedCallScript) => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetTurns, setTargetTurns] = useState(10);
  const [useSonnet, setUseSonnet] = useState(false);
  const { toast } = useToast();

  const generateMut = useMutation({
    mutationFn: async () => {
      const body = {
        title: script.title,
        scenario: script.scenario || undefined,
        equipment: script.equipment || undefined,
        qualityTier: script.qualityTier,
        voices: script.voices,
        targetTurnCount: targetTurns,
        useSonnet,
      };
      const res = await apiRequest(
        "POST",
        "/api/admin/simulated-calls/generate-from-scenario",
        body,
      );
      return (await res.json()) as {
        script: SimulatedCallScript;
        modelTier: string;
        fellBackFromHaiku?: boolean;
      };
    },
    onSuccess: (data) => {
      setScript({
        ...script,
        // Replace only the turns — keep the admin's other fields
        // (title, scenario, qualityTier, equipment, voices) authoritative.
        turns: data.script.turns,
      });
      // If the server fell back from Haiku to the default model, surface it
      // so the admin knows (a) why they were charged Sonnet rates and
      // (b) that they can enable Haiku 4.5 in AWS Bedrock Model Access for
      // cheaper future generations.
      if (data.fellBackFromHaiku) {
        toast({
          title: "Turns generated (using Sonnet — Haiku unavailable)",
          description: `${data.script.turns.length} turns. Haiku 4.5 isn't enabled in your AWS account; Sonnet was used instead (~10× cost). Enable Haiku 4.5 in AWS Bedrock → Model Access for cheaper generations.`,
        });
      } else {
        toast({
          title: "Turns generated",
          description: `${data.script.turns.length} turns (${data.modelTier}). Review + edit as needed.`,
        });
      }
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Generation failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleOpen = () => {
    if (!script.title.trim()) {
      toast({
        title: "Title required",
        description: "Fill in the Title field first — the generator uses it + scenario to write the dialogue.",
        variant: "destructive",
      });
      return;
    }
    if (hasCustomizedTurns(script.turns)) {
      const ok = confirm(
        "You have turns that differ from the defaults. Generating will REPLACE them with AI-generated dialogue. Continue?",
      );
      if (!ok) return;
    }
    setOpen(true);
  };

  return (
    <div
      className="rounded-sm border border-border bg-[var(--copper-soft)]/40 p-3 flex items-center justify-between gap-3"
      style={{ boxShadow: "inset 2px 0 0 var(--accent)" }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="font-mono uppercase text-muted-foreground mb-1"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          AI assist
        </div>
        <div className="flex items-center gap-1.5 font-display font-medium text-[14px] text-foreground">
          <Sparkle className="w-4 h-4" style={{ color: "var(--accent)" }} weight="fill" />
          Generate turns from title + scenario
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Let AI write the dialogue from your title + scenario description. Haiku by default (~$0.003); Sonnet option for richer dialogue (~$0.034).
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={handleOpen}
      >
        <Sparkle className="w-4 h-4 mr-1" />
        Generate
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkle className="w-5 h-5" />
              Generate turns from scenario
            </DialogTitle>
            <DialogDescription>
              Target a turn count and model quality. The AI will write all turns from scratch using your title + scenario description.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-sm border border-border bg-[var(--paper-2)] p-3 text-xs space-y-1">
              <div><span className="font-mono uppercase text-muted-foreground mr-1" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Title</span> {script.title || <em className="text-muted-foreground">(empty)</em>}</div>
              {script.scenario && <div><span className="font-mono uppercase text-muted-foreground mr-1" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Scenario</span> {script.scenario}</div>}
              <div><span className="font-mono uppercase text-muted-foreground mr-1" style={{ fontSize: 10, letterSpacing: "0.08em" }}>Quality tier</span> {script.qualityTier}</div>
            </div>

            <div>
              <Label>
                Target turns: {targetTurns}{" "}
                {targetTurns > 20 && (
                  <span className="text-xs" style={{ color: "var(--amber)" }}>
                    (long call)
                  </span>
                )}
              </Label>
              <Slider
                value={[targetTurns]}
                onValueChange={([v]) => setTargetTurns(v)}
                min={4}
                max={30}
                step={1}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Model may produce ±20%. Typical 2–3 minute call is 8–12 turns.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="cursor-pointer">Use Sonnet (higher quality)</Label>
                <p className="text-xs text-muted-foreground">~10× cost. Richer dialogue but Haiku is usually enough.</p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={useSonnet}
                onChange={(e) => setUseSonnet(e.target.checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending}
            >
              {generateMut.isPending ? (
                <SpinnerGap className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Sparkle className="w-4 h-4 mr-2" />
              )}
              Generate turns
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Single turn row with an expandable per-turn voice-settings panel.
// The settings toggle is only shown for spoken + interrupt turns
// (hold turns have no TTS to tune).
// ─────────────────────────────────────────────────────────────
function TurnRow({
  turn,
  onChange,
  onRemove,
}: {
  turn: SimulatedCallScript["turns"][number];
  onChange: (next: SimulatedCallScript["turns"][number]) => void;
  onRemove: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasCustomSettings = turn.speaker !== "hold" && !!turn.voiceSettings && (
    turn.voiceSettings.stability !== undefined ||
    turn.voiceSettings.similarityBoost !== undefined
  );

  const updateVoiceSettings = (patch: { stability?: number; similarityBoost?: number } | null) => {
    if (turn.speaker === "hold") return;
    const next = patch === null ? undefined : { ...(turn.voiceSettings ?? {}), ...patch };
    onChange({ ...turn, voiceSettings: next } as typeof turn);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-start">
        <SpeakerTag speaker={turn.speaker} />
        {turn.speaker === "hold" ? (
          <Input
            type="number"
            value={turn.duration}
            onChange={(e) =>
              onChange({ speaker: "hold", duration: parseInt(e.target.value) || 1 })
            }
            className="w-24"
          />
        ) : turn.speaker === "interrupt" ? (
          <div className="flex-1 space-y-1">
            <Input
              value={turn.text}
              onChange={(e) => onChange({ ...turn, text: e.target.value })}
              placeholder="Primary speaker line"
            />
            <Input
              value={turn.interruptText}
              onChange={(e) => onChange({ ...turn, interruptText: e.target.value })}
              placeholder="Interruption (other speaker)"
            />
          </div>
        ) : (
          <Textarea
            rows={2}
            value={turn.text}
            onChange={(e) => onChange({ speaker: turn.speaker, text: e.target.value, voiceSettings: turn.voiceSettings })}
            className="flex-1"
          />
        )}
        {turn.speaker !== "hold" && (
          <Button
            type="button"
            size="sm"
            variant={hasCustomSettings ? "default" : "ghost"}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Per-turn voice settings"
            title={hasCustomSettings ? "Custom voice settings set" : "Voice settings (stability, similarity)"}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          <Trash className="w-4 h-4" />
        </Button>
      </div>
      {settingsOpen && turn.speaker !== "hold" && (
        <div className="ml-[70px] p-2 bg-muted/50 rounded-md space-y-2">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Stability: {turn.voiceSettings?.stability !== undefined ? turn.voiceSettings.stability.toFixed(2) : "(inherit)"}
              </Label>
              {turn.voiceSettings?.stability !== undefined && (
                <button
                  type="button"
                  onClick={() => updateVoiceSettings({ stability: undefined })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  clear
                </button>
              )}
            </div>
            <Slider
              value={[turn.voiceSettings?.stability ?? 0.5]}
              onValueChange={([v]) => updateVoiceSettings({ stability: v })}
              min={0}
              max={1}
              step={0.05}
            />
            <p className="text-[10px] text-muted-foreground">
              Lower = more expressive / variable. Higher = more consistent.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Similarity boost: {turn.voiceSettings?.similarityBoost !== undefined ? turn.voiceSettings.similarityBoost.toFixed(2) : "(inherit)"}
              </Label>
              {turn.voiceSettings?.similarityBoost !== undefined && (
                <button
                  type="button"
                  onClick={() => updateVoiceSettings({ similarityBoost: undefined })}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  clear
                </button>
              )}
            </div>
            <Slider
              value={[turn.voiceSettings?.similarityBoost ?? 0.75]}
              onValueChange={([v]) => updateVoiceSettings({ similarityBoost: v })}
              min={0}
              max={1}
              step={0.05}
            />
            <p className="text-[10px] text-muted-foreground">
              How closely this turn adheres to the reference voice.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function VoicePicker({
  voices,
  value,
  onChange,
  placeholder = "Select voice",
}: {
  voices: Voice[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = useMemo(() => {
    return voices.filter(
      (v) => matchesGender(v, gender) && matchesSearch(v, query),
    );
  }, [voices, gender, query]);

  const selected = voices.find((v) => v.voice_id === value);

  // Stop any playing preview when the popover closes or component unmounts.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPreviewingId(null);
    }
  }, [open]);
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function playPreview(voice: Voice, e: React.MouseEvent) {
    e.stopPropagation();
    if (!voice.preview_url) return;
    // If this voice is currently playing, pause.
    if (previewingId === voice.voice_id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    // Otherwise, switch to this voice's preview.
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => setPreviewingId(null));
    }
    audioRef.current.src = voice.preview_url;
    audioRef.current.play().then(() => setPreviewingId(voice.voice_id)).catch(() => {
      // Autoplay block or network error — silently ignore, the user can retry.
      setPreviewingId(null);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.name : (voices.length === 0 ? "Loading voices…" : placeholder)}
            {selected?.labels?.accent ? (
              <span className="text-muted-foreground ml-1">— {selected.labels.accent}</span>
            ) : null}
          </span>
          <CaretDown className="w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <div className="border-b p-2 space-y-2">
          <div className="relative">
            <MagnifyingGlass className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, accent, description…"
              className="pl-8 h-8"
              autoFocus
            />
          </div>
          <div className="flex gap-1">
            {(["all", "female", "male"] as GenderFilter[]).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={gender === g ? "default" : "outline"}
                className="h-7 text-xs capitalize flex-1"
                onClick={() => setGender(g)}
              >
                {g}
              </Button>
            ))}
          </div>
        </div>
        <ScrollArea className="h-72">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No voices match your filter.
            </div>
          ) : (
            <ul className="p-1">
              {filtered.map((v) => {
                const isSelected = v.voice_id === value;
                const isPlaying = previewingId === v.voice_id;
                return (
                  <li key={v.voice_id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(v.voice_id);
                        setOpen(false);
                      }}
                      className={
                        "w-full text-left px-2 py-2 rounded-md flex items-center gap-2 hover:bg-muted " +
                        (isSelected ? "bg-muted" : "")
                      }
                    >
                      {v.preview_url ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 shrink-0"
                          onClick={(e) => playPreview(v, e)}
                          aria-label={isPlaying ? `Pause preview of ${v.name}` : `Play preview of ${v.name}`}
                        >
                          {isPlaying ? (
                            <Pause className="w-4 h-4" weight="fill" />
                          ) : (
                            <Play className="w-4 h-4" weight="fill" />
                          )}
                        </Button>
                      ) : (
                        <div className="w-8 h-8 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{v.name}</span>
                          {isSelected && (
                            <CheckCircle
                              className="w-4 h-4 shrink-0"
                              style={{ color: "var(--sage)" }}
                              weight="fill"
                            />
                          )}
                        </div>
                        {voiceMetaLine(v) && (
                          <div className="text-xs text-muted-foreground truncate">
                            {voiceMetaLine(v)}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t p-2 text-xs text-muted-foreground">
          {filtered.length} of {voices.length} voice{voices.length === 1 ? "" : "s"}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────
// Calibration suite panel (#1 roadmap).
//
// Read-only report of presets with `config.expectedScoreRange`.
// Each preset's actual score (from the linked analyzed call) is compared
// against the expected range. Pass = green, fail = destructive, not-run =
// muted. Operators use this after prompt template edits or model swaps
// to detect scoring regressions before they hit production agents.
// ─────────────────────────────────────────────────────────────
interface CalibrationPreset {
  id: string;
  title: string;
  qualityTier: string | null | undefined;
  expectedMin: number;
  expectedMax: number;
  actualScore: number | null;
  sentToAnalysisCallId: string | null | undefined;
  analyzedAt: string | null;
  status: "pass" | "fail" | "not_run";
  delta: number | null;
}
interface CalibrationSuiteResponse {
  presets: CalibrationPreset[];
  summary: { total: number; passed: number; failed: number; notRun: number };
}

function CalibrationSuitePanel() {
  const { toast } = useToast();
  const { data, isLoading, refetch, isFetching } = useQuery<CalibrationSuiteResponse>({
    queryKey: ["/api/admin/simulated-calls/calibration-suite"],
    refetchOnWindowFocus: true,
  });

  // Runner: re-analyzes every preset with an expectedScoreRange against the
  // current prompt template + AI model. Does NOT regenerate audio; audio
  // is reused from S3. Returns immediately with counts; the actual analyses
  // take a few minutes to complete. Operator refreshes the report to see
  // updated pass/fail status once the jobs finish.
  const runMutation = useMutation({
    mutationFn: async (): Promise<{
      presetsTotal: number;
      presetsEligible: number;
      queued: number;
      skipped: number;
      skippedReasons: Array<{ id: string; title: string; reason: string }>;
    }> => {
      const res = await apiRequest(
        "POST",
        "/api/admin/simulated-calls/calibration-suite/run",
        {},
      );
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Calibration suite running",
        description: `${result.queued} preset${result.queued === 1 ? "" : "s"} queued for re-analysis. ${result.skipped > 0 ? `${result.skipped} skipped.` : ""} Results appear in a few minutes.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/simulated-calls/calibration-suite"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] });
    },
    onError: (err) => {
      toast({
        title: "Calibration run failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground p-8 border border-border">
        Loading calibration report…
      </div>
    );
  }

  const presets = data?.presets ?? [];
  const summary = data?.summary ?? { total: 0, passed: 0, failed: 0, notRun: 0 };

  if (presets.length === 0) {
    return (
      <div
        className="border border-border p-6 text-sm"
        style={{ backgroundColor: "var(--card)" }}
      >
        <div className="font-medium text-foreground mb-2">No calibration presets configured</div>
        <div className="text-muted-foreground">
          To enable the calibration suite, add{" "}
          <code className="font-mono text-xs">expectedScoreRange: {"{ min, max }"}</code>{" "}
          to a simulated call preset's <code className="font-mono text-xs">config</code> JSON.
          Presets with an expected range will appear here after they've been analyzed via the
          "Send to Analysis" action.
        </div>
      </div>
    );
  }

  const tone = (s: CalibrationPreset["status"]) => {
    if (s === "pass") return { color: "var(--sage)", label: "PASS" };
    if (s === "fail") return { color: "var(--destructive)", label: "FAIL" };
    return { color: "var(--muted-foreground)", label: "NOT RUN" };
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div
        className="grid grid-cols-4 gap-px border border-border"
        style={{ backgroundColor: "var(--border)" }}
      >
        <SummaryCell label="Total" value={summary.total} tone="var(--foreground)" />
        <SummaryCell label="Passed" value={summary.passed} tone="var(--sage)" />
        <SummaryCell label="Failed" value={summary.failed} tone="var(--destructive)" />
        <SummaryCell label="Not run" value={summary.notRun} tone="var(--muted-foreground)" />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="text-xs text-muted-foreground flex-1" style={{ lineHeight: 1.55 }}>
          Each preset with an expected score range is compared against its most recently analyzed score.
          Click <span className="font-medium text-foreground">Run suite</span> to re-analyze every preset
          against the current prompt template + AI model (audio is reused; no regeneration cost).
          Analyses complete over a few minutes; refresh to see updated pass/fail.
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="font-mono uppercase rounded-sm px-3 py-2 bg-primary text-[var(--paper)] border border-primary disabled:opacity-60"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
            data-testid="calibration-run"
          >
            {runMutation.isPending ? "Queueing…" : "Run suite"}
          </button>
        </div>
      </div>

      {/* Preset rows */}
      <div className="border border-border" style={{ backgroundColor: "var(--card)" }}>
        {presets.map((p, i) => {
          const t = tone(p.status);
          return (
            <div
              key={p.id}
              className="px-4 py-3 grid grid-cols-[auto_1fr_auto_auto] items-center gap-4"
              style={{
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                boxShadow: p.status === "fail" ? "inset 3px 0 0 var(--destructive)" : undefined,
              }}
            >
              <span
                className="font-mono text-xs"
                style={{
                  color: t.color,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  minWidth: 60,
                }}
              >
                {t.label}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-foreground truncate">{p.title}</div>
                <div className="text-xs text-muted-foreground">
                  Expected {p.expectedMin.toFixed(1)}–{p.expectedMax.toFixed(1)}
                  {p.qualityTier ? ` · ${p.qualityTier}` : ""}
                  {p.analyzedAt ? ` · last analyzed ${new Date(p.analyzedAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-lg tabular-nums" style={{ color: t.color }}>
                  {p.actualScore === null ? "—" : p.actualScore.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">actual</div>
              </div>
              {p.delta !== null && p.status === "fail" && (
                <div
                  className="font-mono text-xs tabular-nums"
                  style={{ color: "var(--destructive)", minWidth: 40, textAlign: "right" }}
                >
                  {p.delta > 0 ? "+" : ""}
                  {p.delta.toFixed(1)}
                </div>
              )}
              {(p.status === "pass" || p.status === "not_run") && (
                <div style={{ minWidth: 40 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="p-4" style={{ backgroundColor: "var(--card)" }}>
      <div
        className="font-mono text-xs text-muted-foreground uppercase"
        style={{ letterSpacing: "0.08em" }}
      >
        {label}
      </div>
      <div className="font-display text-2xl mt-1 tabular-nums" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}
