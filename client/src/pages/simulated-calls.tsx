/**
 * Simulated Call Generator — admin-only page.
 *
 * Two tabs:
 *   - Generate: script builder form (or paste JSON) + voice picker + quality config
 *   - Library: table of generated calls with status, cost, audio player, actions
 */
import { useState, useMemo, useEffect } from "react";
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
import { Microphone, Play, Plus, SpinnerGap, Trash, WarningCircle, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import type {
  SimulatedCall,
  SimulatedCallStatus,
  SimulatedCallConfig,
  SimulatedCallScript,
} from "@shared/simulated-call-schema";

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
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
};

const EMPTY_SCRIPT: SimulatedCallScript = {
  title: "",
  scenario: "",
  qualityTier: "acceptable",
  equipment: "",
  voices: { agent: "pNInz6obpgDQGcFmaJgB", customer: "21m00Tcm4TlvDq8ikWAM" },
  turns: [
    { speaker: "agent", text: "Thank you for calling UMS, how can I help?" },
    { speaker: "customer", text: "Hi, I had a question about my order." },
  ],
};

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
    </div>
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
          </CardContent>
        </Card>

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
          <VoiceSelect
            voices={voices}
            value={script.voices.agent}
            onChange={(v) => update({ voices: { ...script.voices, agent: v } })}
          />
        </div>
        <div>
          <Label>Customer voice</Label>
          <VoiceSelect
            voices={voices}
            value={script.voices.customer}
            onChange={(v) => update({ voices: { ...script.voices, customer: v } })}
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
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
            <div key={i} className="flex gap-2 items-start">
              <Badge variant="outline" className="shrink-0 mt-2 capitalize">
                {turn.speaker}
              </Badge>
              {turn.speaker === "hold" ? (
                <Input
                  type="number"
                  value={turn.duration}
                  onChange={(e) =>
                    setTurn(i, { speaker: "hold", duration: parseInt(e.target.value) || 1 })
                  }
                  className="w-24"
                />
              ) : turn.speaker === "interrupt" ? (
                <div className="flex-1 space-y-1">
                  <Input
                    value={turn.text}
                    onChange={(e) => setTurn(i, { ...turn, text: e.target.value })}
                    placeholder="Primary speaker line"
                  />
                  <Input
                    value={turn.interruptText}
                    onChange={(e) => setTurn(i, { ...turn, interruptText: e.target.value })}
                    placeholder="Interruption"
                  />
                </div>
              ) : (
                <Textarea
                  rows={2}
                  value={turn.text}
                  onChange={(e) => setTurn(i, { speaker: turn.speaker, text: e.target.value })}
                  className="flex-1"
                />
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => removeTurn(i)}>
                <Trash className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VoiceSelect({
  voices,
  value,
  onChange,
}: {
  voices: Voice[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select voice" /></SelectTrigger>
      <SelectContent>
        {voices.length === 0 ? (
          <SelectItem value={value || "none"}>Loading voices…</SelectItem>
        ) : (
          voices.map((v) => (
            <SelectItem key={v.voice_id} value={v.voice_id}>
              {v.name}
              {v.labels?.accent ? ` — ${v.labels.accent}` : ""}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
