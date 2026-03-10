import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  FlaskConical, Upload, Trash2, Clock, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Loader2, FileAudio,
} from "lucide-react";
import { BEDROCK_MODEL_PRESETS, CALL_CATEGORIES, type ABTest } from "@shared/schema";

/** Safely display a value that may be string or object from AI. */
function toDisplayString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") {
    return (val as any).text || (val as any).name || (val as any).description || JSON.stringify(val);
  }
  return String(val ?? "");
}

function ScoreComparison({ label, baseline, test }: { label: string; baseline?: number; test?: number }) {
  const diff = (test ?? 0) - (baseline ?? 0);
  const DiffIcon = diff > 0.5 ? TrendingUp : diff < -0.5 ? TrendingDown : Minus;
  const diffColor = diff > 0.5 ? "text-green-600" : diff < -0.5 ? "text-red-600" : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium w-12 text-right">{baseline?.toFixed(1) ?? "—"}</span>
        <span className="text-xs text-muted-foreground">vs</span>
        <span className="text-sm font-medium w-12">{test?.toFixed(1) ?? "—"}</span>
        <span className={`flex items-center gap-0.5 text-xs w-16 ${diffColor}`}>
          <DiffIcon className="w-3 h-3" />
          {diff > 0 ? "+" : ""}{diff.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function AnalysisPanel({ title, model, analysis, latencyMs }: {
  title: string;
  model: string;
  analysis: any;
  latencyMs?: number;
}) {
  if (!analysis) return null;
  if (analysis.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="font-mono text-xs">{model}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">Analysis failed: {analysis.error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const topics = Array.isArray(analysis.topics) ? analysis.topics : [];
  const actionItems = Array.isArray(analysis.action_items) ? analysis.action_items : [];
  const strengths = analysis.feedback?.strengths || [];
  const suggestions = analysis.feedback?.suggestions || [];
  const flags = Array.isArray(analysis.flags) ? analysis.flags : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="font-mono text-xs">{model}</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{analysis.performance_score?.toFixed(1) ?? "—"}<span className="text-sm text-muted-foreground">/10</span></div>
            {latencyMs && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {(latencyMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sentiment */}
        <div className="flex items-center gap-2">
          <Badge variant={analysis.sentiment === "positive" ? "default" : analysis.sentiment === "negative" ? "destructive" : "secondary"}>
            {analysis.sentiment || "unknown"}
          </Badge>
          <span className="text-xs text-muted-foreground">Score: {analysis.sentiment_score?.toFixed(2) ?? "—"}</span>
        </div>

        {/* Summary */}
        <div>
          <h4 className="text-sm font-medium mb-1">Summary</h4>
          <p className="text-sm text-muted-foreground">{analysis.summary || "No summary"}</p>
        </div>

        {/* Sub-scores */}
        {analysis.sub_scores && (
          <div>
            <h4 className="text-sm font-medium mb-1">Sub-Scores</h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(analysis.sub_scores).map(([key, val]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                  <span className="font-medium">{(val as number)?.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {topics.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Topics</h4>
            <div className="flex flex-wrap gap-1">
              {topics.map((t: any, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">{toDisplayString(t)}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Strengths */}
        {strengths.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Strengths</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {strengths.map((s: any, i: number) => (
                <li key={i}>+ {toDisplayString(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Suggestions</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {suggestions.map((s: any, i: number) => (
                <li key={i}>- {toDisplayString(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Items */}
        {actionItems.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Action Items</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {actionItems.map((a: any, i: number) => (
                <li key={i}>{i + 1}. {toDisplayString(a)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Flags */}
        {flags.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Flags</h4>
            <div className="flex flex-wrap gap-1">
              {flags.map((f: any, i: number) => (
                <Badge key={i} variant="destructive" className="text-xs">{toDisplayString(f)}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TestResultView({ test }: { test: ABTest }) {
  const baselineLabel = BEDROCK_MODEL_PRESETS.find(m => m.value === test.baselineModel)?.label || test.baselineModel;
  const testLabel = BEDROCK_MODEL_PRESETS.find(m => m.value === test.testModel)?.label || test.testModel;

  const baseline = test.baselineAnalysis as any;
  const testAnalysis = test.testAnalysis as any;
  const hasScores = baseline && !baseline.error && testAnalysis && !testAnalysis.error;

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">{test.fileName}</h3>
          <p className="text-xs text-muted-foreground">
            {test.callCategory || "Uncategorized"} &middot; {new Date(test.createdAt || "").toLocaleString()} &middot; by {test.createdBy}
          </p>
        </div>
        <Badge variant={test.status === "completed" ? "default" : test.status === "failed" ? "destructive" : "secondary"}>
          {test.status}
        </Badge>
      </div>

      {/* Score comparison summary */}
      {hasScores && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Score Comparison</CardTitle>
            <CardDescription className="text-xs flex gap-4">
              <span>Baseline: {baselineLabel}</span>
              <span>Test: {testLabel}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreComparison label="Overall" baseline={baseline?.performance_score} test={testAnalysis?.performance_score} />
            <Separator className="my-1" />
            <ScoreComparison label="Compliance" baseline={baseline?.sub_scores?.compliance} test={testAnalysis?.sub_scores?.compliance} />
            <ScoreComparison label="Customer Exp." baseline={baseline?.sub_scores?.customer_experience} test={testAnalysis?.sub_scores?.customer_experience} />
            <ScoreComparison label="Communication" baseline={baseline?.sub_scores?.communication} test={testAnalysis?.sub_scores?.communication} />
            <ScoreComparison label="Resolution" baseline={baseline?.sub_scores?.resolution} test={testAnalysis?.sub_scores?.resolution} />
            <Separator className="my-1" />
            <ScoreComparison label="Sentiment" baseline={baseline?.sentiment_score} test={testAnalysis?.sentiment_score} />
            {/* Latency comparison */}
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">Latency</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium w-12 text-right">{test.baselineLatencyMs ? (test.baselineLatencyMs / 1000).toFixed(1) + "s" : "—"}</span>
                <span className="text-xs text-muted-foreground">vs</span>
                <span className="text-sm font-medium w-12">{test.testLatencyMs ? (test.testLatencyMs / 1000).toFixed(1) + "s" : "—"}</span>
                {test.baselineLatencyMs && test.testLatencyMs && (
                  <span className={`text-xs w-16 ${test.testLatencyMs < test.baselineLatencyMs ? "text-green-600" : "text-red-600"}`}>
                    {((test.testLatencyMs - test.baselineLatencyMs) / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Side-by-side analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalysisPanel
          title="Baseline"
          model={baselineLabel}
          analysis={baseline}
          latencyMs={test.baselineLatencyMs}
        />
        <AnalysisPanel
          title="Test Model"
          model={testLabel}
          analysis={testAnalysis}
          latencyMs={test.testLatencyMs}
        />
      </div>
    </div>
  );
}

export default function ABTestingPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [testModel, setTestModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [callCategory, setCallCategory] = useState("");
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  const { data: tests = [], isLoading } = useQuery<ABTest[]>({
    queryKey: ["/api/ab-tests"],
    refetchInterval: 10000, // Poll for updates while tests are processing
  });

  const selectedTest = tests.find(t => t.id === selectedTestId);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const modelId = testModel === "custom" ? customModel : testModel;
      if (!modelId) throw new Error("No test model selected");

      const formData = new FormData();
      formData.append("audioFile", selectedFile);
      formData.append("testModel", modelId);
      if (callCategory) formData.append("callCategory", callCategory);

      const res = await fetch("/api/ab-tests/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "A/B test started", description: "Both models are analyzing the call. This may take a few minutes." });
      setSelectedFile(null);
      setTestModel("");
      setCustomModel("");
      setCallCategory("");
      setSelectedTestId(data.id);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ab-tests/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Test deleted" });
      setSelectedTestId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
    },
  });

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  const currentModel = BEDROCK_MODEL_PRESETS.find(
    m => m.value === (process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6")
  )?.label || "Claude Sonnet 4.6";

  return (
    <div className="min-h-screen" data-testid="ab-testing-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold text-foreground">Model A/B Testing</h2>
            <p className="text-muted-foreground">Compare Bedrock model analysis quality and cost — test calls are excluded from all metrics</p>
          </div>
        </div>
      </header>

      <div className="p-6">
        <Tabs defaultValue="new" className="space-y-4">
          <TabsList>
            <TabsTrigger value="new">New Test</TabsTrigger>
            <TabsTrigger value="results">
              Past Tests {tests.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{tests.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Upload card */}
              <Card>
                <CardHeader>
                  <CardTitle>Upload Test Call</CardTitle>
                  <CardDescription>This call will NOT be counted in employee or department metrics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* File drop zone */}
                  <div
                    className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp3,.wav,.m4a,.mp4,.flac,.ogg"
                      className="hidden"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    />
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileAudio className="w-5 h-5 text-primary" />
                        <span className="text-sm font-medium">{selectedFile.name}</span>
                        <span className="text-xs text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                      </div>
                    ) : (
                      <div>
                        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Click or drag audio file here</p>
                        <p className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A, MP4, FLAC, OGG</p>
                      </div>
                    )}
                  </div>

                  {/* Call category */}
                  <div>
                    <Label className="text-sm">Call Category (optional)</Label>
                    <Select value={callCategory} onValueChange={setCallCategory}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select category..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CALL_CATEGORIES.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Model selection card */}
              <Card>
                <CardHeader>
                  <CardTitle>Model Selection</CardTitle>
                  <CardDescription>Baseline: <span className="font-mono text-xs">{currentModel}</span> (your current production model)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm">Test Model</Label>
                    <Select value={testModel} onValueChange={setTestModel}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Choose a model to compare..." />
                      </SelectTrigger>
                      <SelectContent>
                        {BEDROCK_MODEL_PRESETS.map((model) => (
                          <SelectItem key={model.value} value={model.value}>
                            <div className="flex items-center gap-2">
                              <span>{model.label}</span>
                              <span className="text-xs text-muted-foreground">{model.cost}</span>
                            </div>
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom Model ID...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {testModel === "custom" && (
                    <div>
                      <Label className="text-sm">Custom Bedrock Model ID</Label>
                      <Input
                        className="mt-1 font-mono text-sm"
                        placeholder="e.g., anthropic.claude-3-haiku-20240307"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      <strong>Cost note:</strong> Each test uses 1 AssemblyAI transcription + 2 Bedrock API calls (one per model).
                      Haiku models are significantly cheaper than Sonnet.
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    disabled={!selectedFile || !testModel || (testModel === "custom" && !customModel) || uploadMutation.isPending}
                    onClick={() => uploadMutation.mutate()}
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="w-4 h-4 mr-2" />
                        Start A/B Test
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : tests.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FlaskConical className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No A/B tests yet. Upload a call to get started.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Test list */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground px-1">All Tests</h3>
                  {tests.map((test) => {
                    const testModelLabel = BEDROCK_MODEL_PRESETS.find(m => m.value === test.testModel)?.label || test.testModel;
                    const isSelected = selectedTestId === test.id;
                    return (
                      <Card
                        key={test.id}
                        className={`cursor-pointer transition-colors hover:border-primary/50 ${isSelected ? "border-primary bg-primary/5" : ""}`}
                        onClick={() => setSelectedTestId(test.id)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium truncate flex-1">{test.fileName}</span>
                            <div className="flex items-center gap-1">
                              {test.status === "processing" || test.status === "analyzing" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                              ) : test.status === "completed" ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">vs {testModelLabel}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-muted-foreground">
                              {new Date(test.createdAt || "").toLocaleDateString()}
                            </span>
                            {test.status === "completed" && test.baselineAnalysis && test.testAnalysis && !(test.baselineAnalysis as any).error && !(test.testAnalysis as any).error && (
                              <span className="text-xs font-medium">
                                {(test.baselineAnalysis as any).performance_score?.toFixed(1)} vs {(test.testAnalysis as any).performance_score?.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Detail view */}
                <div className="lg:col-span-2">
                  {selectedTest ? (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteMutation.mutate(selectedTest.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Delete Test
                        </Button>
                      </div>
                      {selectedTest.status === "processing" || selectedTest.status === "analyzing" ? (
                        <Card>
                          <CardContent className="py-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                            <p className="text-muted-foreground">
                              {selectedTest.status === "processing" ? "Transcribing audio..." : "Running analysis with both models..."}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">This typically takes 2-4 minutes</p>
                          </CardContent>
                        </Card>
                      ) : (
                        <TestResultView test={selectedTest} />
                      )}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">Select a test from the list to view results</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
