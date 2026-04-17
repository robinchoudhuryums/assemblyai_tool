/**
 * Simulated Call Generator — admin-only page.
 *
 * Two tabs:
 *   - Generate: script builder form (or paste JSON) + voice picker + quality config
 *   - Library: table of generated calls with status, cost, audio player, actions
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Microphone className="w-6 h-6" />
            Simulated Call Generator
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate synthetic call recordings for QA, agent training, and pipeline regression testing.
          </p>
        </div>
        <Badge variant={capFull ? "destructive" : "secondary"}>
          {dailyUsed} / {dailyCap} today
        </Badge>
      </div>

      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="pt-4 text-sm">
          <strong>Synthetic isolation:</strong> generated calls never appear in dashboards, reports, leaderboards, coaching, or the AI's learning knowledge base. They exist only under this page. "Send to Analysis" creates a <code>synthetic = TRUE</code> call row.
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">Library ({calls.length})</TabsTrigger>
          <TabsTrigger value="generate">Generate New</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-6">
          <LibraryTable
            calls={calls}
            isLoading={isLoading}
            playingId={playingId}
            onPlay={setPlayingId}
          />
        </TabsContent>

        <TabsContent value="generate" className="mt-6">
          <GenerateForm voices={voices} capFull={capFull} onSuccess={() => setTab("library")} />
        </TabsContent>
      </Tabs>
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
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Microphone className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No simulated calls yet. Head to "Generate New" to create one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {calls.map((c) => {
        const badge = statusBadge(c.status);
        const isPlaying = playingId === c.id;
        return (
          <Card key={c.id}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium truncate">{c.title}</h3>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {c.qualityTier && <Badge variant="outline">{c.qualityTier}</Badge>}
                    {(c.config?.circumstances ?? []).map((circ: Circumstance) => (
                      <Badge key={circ} variant="outline" className="border-orange-500/40 text-orange-600 text-[10px]">
                        {CIRCUMSTANCE_META[circ]?.label ?? circ}
                      </Badge>
                    ))}
                    {c.sentToAnalysisCallId && (
                      <Badge variant="outline" className="border-green-500/50 text-green-600">
                        <CheckCircle className="w-3 h-3 mr-1" /> Analyzed
                      </Badge>
                    )}
                  </div>
                  {c.scenario && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{c.scenario}</p>
                  )}
                  <div className="text-xs text-muted-foreground mt-1 flex gap-4 flex-wrap">
                    {c.durationSeconds != null && <span>{c.durationSeconds}s</span>}
                    {c.ttsCharCount != null && <span>{c.ttsCharCount.toLocaleString()} chars</span>}
                    {c.estimatedCost != null && <span>~${c.estimatedCost.toFixed(4)}</span>}
                    <span>{c.createdAt?.slice(0, 19).replace("T", " ")}</span>
                  </div>
                  {c.error && (
                    <div className="text-xs text-red-600 mt-1 flex items-start gap-1">
                      <WarningCircle className="w-3 h-3 mt-0.5 shrink-0" />
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
                        className="border-purple-500/40 text-purple-600 hover:bg-purple-500/10"
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
                    className="text-red-600 hover:text-red-700"
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
                <audio
                  src={`/api/admin/simulated-calls/${c.id}/audio`}
                  controls
                  className="w-full mt-2"
                  autoPlay
                />
              )}
            </CardContent>
          </Card>
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
                        {active && <CheckCircle className="w-4 h-4 text-green-600" weight="fill" />}
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Script</CardTitle>
              <CardDescription>
                Build a call turn-by-turn, or paste an existing JSON script.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setJsonMode((v) => !v)}>
              {jsonMode ? "Form mode" : "JSON mode"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {jsonMode ? (
              <div>
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
          </CardContent>
        </Card>
      </div>

      {/* Right 1/3: config + submit */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Audio Quality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
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

            <div>
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
              <div>
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

            <div>
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

            <div>
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
            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <Label className="cursor-pointer">Filler words (um/uh)</Label>
                <p className="text-xs text-muted-foreground">Rate scales with quality tier</p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config.disfluencies !== false}
                onChange={(e) => setConfig({ ...config, disfluencies: e.target.checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="cursor-pointer">Backchannel overlays</Label>
                <p className="text-xs text-muted-foreground">"mm-hmm", "okay" under long turns</p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config.backchannels !== false}
                onChange={(e) => setConfig({ ...config, backchannels: e.target.checked })}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <Label className="cursor-pointer">Auto-analyze when ready</Label>
                <p className="text-xs text-muted-foreground">
                  Send the generated call through the real analysis pipeline automatically. Adds Bedrock + AssemblyAI cost per generation.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={config.analyzeAfterGeneration === true}
                onChange={(e) => setConfig({ ...config, analyzeAfterGeneration: e.target.checked })}
              />
            </div>
          </CardContent>
        </Card>

        <CircumstancePicker
          value={config.circumstances ?? []}
          onChange={(next) => setConfig({ ...config, circumstances: next })}
        />

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Turns:</span>
              <span>{script.turns.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">TTS chars:</span>
              <span>{totalChars.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. cost:</span>
              <span>${estimatedCost}</span>
            </div>
            {(config.circumstances?.length ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Circumstances:</span>
                <span>{config.circumstances!.length}</span>
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
          </CardContent>
        </Card>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Circumstances</CardTitle>
        <CardDescription className="text-xs">
          Apply to the script at generation time. Rule-based items take effect immediately; the rest only apply when you use "Create Variation" on a generated call (uses AI).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {CIRCUMSTANCE_VALUES.map((c) => {
          const meta = CIRCUMSTANCE_META[c];
          const active = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              className={
                "w-full text-left px-3 py-2 rounded-md border transition-colors " +
                (active
                  ? "bg-primary/10 border-primary/50 text-foreground"
                  : "border-border hover:bg-muted")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{meta.label}</span>
                <div className="flex gap-1 shrink-0">
                  {meta.ruleBased ? (
                    <Badge variant="outline" className="text-[10px] h-5">Rule</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] h-5 border-purple-400/50 text-purple-600">AI</Badge>
                  )}
                  {active && <CheckCircle className="w-4 h-4 text-green-600" weight="fill" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {meta.description}
              </p>
            </button>
          );
        })}
      </CardContent>
    </Card>
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
      return (await res.json()) as { script: SimulatedCallScript; modelTier: string };
    },
    onSuccess: (data) => {
      setScript({
        ...script,
        // Replace only the turns — keep the admin's other fields
        // (title, scenario, qualityTier, equipment, voices) authoritative.
        turns: data.script.turns,
      });
      toast({
        title: "Turns generated",
        description: `${data.script.turns.length} turns (${data.modelTier}). Review + edit as needed.`,
      });
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
    <div className="rounded-md border border-purple-400/40 bg-purple-500/5 p-3 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <Sparkle className="w-4 h-4 text-purple-600" weight="fill" />
          Generate turns from title + scenario
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Let AI write the dialogue from your title + scenario description. Haiku by default (~$0.003); Sonnet option for richer dialogue (~$0.034).
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-purple-500/50 text-purple-700 hover:bg-purple-500/10 shrink-0"
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
            <div className="rounded-md bg-muted p-3 text-xs space-y-1">
              <div><span className="text-muted-foreground">Title:</span> {script.title || <em>(empty)</em>}</div>
              {script.scenario && <div><span className="text-muted-foreground">Scenario:</span> {script.scenario}</div>}
              <div><span className="text-muted-foreground">Quality tier:</span> {script.qualityTier}</div>
            </div>

            <div>
              <Label>
                Target turns: {targetTurns} {targetTurns > 20 && <span className="text-xs text-amber-600">(long call)</span>}
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
        <Badge variant="outline" className="shrink-0 mt-2 capitalize">
          {turn.speaker}
        </Badge>
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
                            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" weight="fill" />
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
