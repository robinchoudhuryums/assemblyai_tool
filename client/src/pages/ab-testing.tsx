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
import { CheckCircle, FileAudio, Flask, SpinnerGap, Trash, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { BEDROCK_MODEL_PRESETS, CALL_CATEGORIES, type ABTest } from "@shared/schema";
import { TestResultView } from "@/components/ab-testing/ab-test-components";

export default function ABTestingPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [testModel, setTestModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [callCategory, setCallCategory] = useState("");
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: tests = [], isLoading, error: testsError } = useQuery<ABTest[]>({
    queryKey: ["/api/ab-tests"],
    // Only poll while tests are actively processing — stop once all are done
    refetchInterval: (query) => {
      const data = query.state.data as ABTest[] | undefined;
      const hasProcessing = data?.some(t => t.status === "processing");
      return hasProcessing ? 5000 : false;
    },
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
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "UploadSimple failed");
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
      toast({ title: "UploadSimple failed", description: error.message, variant: "destructive" });
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
          <Flask className="w-6 h-6 text-primary" />
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
              {/* UploadSimple card */}
              <Card>
                <CardHeader>
                  <CardTitle>UploadSimple Test Call</CardTitle>
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
                        <UploadSimple className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
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
                        <SpinnerGap className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Flask className="w-4 h-4 mr-2" />
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
                <SpinnerGap className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : testsError ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <p className="font-medium">Failed to load A/B tests</p>
                  <p className="text-sm">{testsError.message}</p>
                </CardContent>
              </Card>
            ) : tests.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Flask className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No A/B tests yet. UploadSimple a call to get started.</p>
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
                                <SpinnerGap className="w-3.5 h-3.5 animate-spin text-blue-500" />
                              ) : test.status === "completed" ? (
                                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <WarningCircle className="w-3.5 h-3.5 text-red-500" />
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
                        {deleteConfirmId === selectedTest.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600">Delete this test?</span>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => { deleteMutation.mutate(selectedTest.id); setDeleteConfirmId(null); }}
                              disabled={deleteMutation.isPending}
                            >
                              Confirm
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => setDeleteConfirmId(selectedTest.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash className="w-3.5 h-3.5 mr-1" />
                            Delete Test
                          </Button>
                        )}
                      </div>
                      {selectedTest.status === "processing" || selectedTest.status === "analyzing" ? (
                        <Card>
                          <CardContent className="py-12 text-center">
                            <SpinnerGap className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
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
