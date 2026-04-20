import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  CheckCircle,
  FileAudio,
  Flask,
  SpinnerGap,
  Trash,
  UploadSimple,
  Warning,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react";
import { BEDROCK_MODEL_PRESETS, CALL_CATEGORIES, type ABTest } from "@shared/schema";
import { TestResultView } from "@/components/ab-testing/ab-test-components";

type ABTabView = "new" | "results" | "aggregate";

export default function ABTestingPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [testModel, setTestModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [callCategory, setCallCategory] = useState("");
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [tab, setTab] = useState<ABTabView>("new");

  const { data: tests = [], isLoading, error: testsError } = useQuery<ABTest[]>({
    queryKey: ["/api/ab-tests"],
    // F-21: Two-tier polling cadence so a second upload in the same session
    // resumes monitoring without a manual refresh.
    //   - If any test is still processing → 5s tight loop
    //   - Otherwise → 30s heartbeat (catches a new upload's status flip,
    //     batch-mode completion, or background corruption)
    // Also refetch when the user returns to the tab so the page never
    // shows stale data after a long blur.
    refetchInterval: (query) => {
      const data = query.state.data as ABTest[] | undefined;
      const hasProcessing = data?.some(t => t.status === "processing");
      return hasProcessing ? 5000 : 30000;
    },
    refetchOnWindowFocus: true,
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

      const csrf = getCsrfToken();
      const headers: Record<string, string> = { "X-Requested-With": "XMLHttpRequest" };
      if (csrf) headers["x-csrf-token"] = csrf;
      const res = await fetch("/api/ab-tests/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers,
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
    <div className="min-h-screen bg-background text-foreground" data-testid="ab-testing-page">
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
          <span className="text-foreground">A/B testing</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <Flask style={{ width: 12, height: 12, color: "var(--accent)" }} />
          Configuration
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{
            fontSize: "clamp(24px, 3vw, 30px)",
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
          }}
        >
          Model A/B testing
        </div>
        <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
          Compare Bedrock model analysis quality and cost. Test calls are excluded from all
          employee, department, and dashboard metrics (INV-34/INV-35).
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 px-7 py-3 bg-background border-b border-border flex-wrap">
        <ABTab active={tab === "new"} onClick={() => setTab("new")} label="New test" />
        <ABTab
          active={tab === "results"}
          onClick={() => setTab("results")}
          label="Past tests"
          badge={tests.length || undefined}
        />
        <ABTab
          active={tab === "aggregate"}
          onClick={() => setTab("aggregate")}
          label="Promote winner"
        />
      </div>

      <main className="px-7 py-6 space-y-6">
        {tab === "new" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Upload panel */}
              <ABPanel
                kicker="Step 1"
                icon={UploadSimple}
                title="Upload test call"
                description="This call will NOT be counted in employee, department, or dashboard metrics."
              >
                <div className="space-y-4">
                  {/* File drop zone */}
                  <div
                    className="rounded-sm p-6 text-center cursor-pointer transition-colors"
                    style={{
                      border: "2px dashed var(--border)",
                      background: selectedFile ? "var(--copper-soft)" : "transparent",
                    }}
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
                        <FileAudio
                          style={{ width: 18, height: 18, color: "var(--accent)" }}
                        />
                        <span className="text-sm font-medium text-foreground">
                          {selectedFile.name}
                        </span>
                        <span
                          className="font-mono text-muted-foreground"
                          style={{ fontSize: 11, letterSpacing: "0.02em" }}
                        >
                          ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      </div>
                    ) : (
                      <div>
                        <UploadSimple
                          style={{
                            width: 32,
                            height: 32,
                            margin: "0 auto",
                            color: "var(--muted-foreground)",
                          }}
                        />
                        <p className="text-sm text-foreground mt-2">
                          Click or drag audio file here
                        </p>
                        <p
                          className="font-mono uppercase text-muted-foreground mt-1"
                          style={{ fontSize: 10, letterSpacing: "0.1em" }}
                        >
                          MP3 · WAV · M4A · MP4 · FLAC · OGG
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Call category */}
                  <div>
                    <ABFieldLabel>Call category (optional)</ABFieldLabel>
                    <Select value={callCategory} onValueChange={setCallCategory}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select category…" />
                      </SelectTrigger>
                      <SelectContent>
                        {CALL_CATEGORIES.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </ABPanel>

              {/* Model selection panel */}
              <ABPanel
                kicker="Step 2"
                icon={Flask}
                title="Model selection"
                description={
                  <>
                    Baseline:{" "}
                    <span
                      className="font-mono rounded-sm"
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.02em",
                        padding: "2px 6px",
                        background: "var(--paper-2)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {currentModel}
                    </span>{" "}
                    (your current production model)
                  </>
                }
              >
                <div className="space-y-4">
                  <div>
                    <ABFieldLabel>Test model</ABFieldLabel>
                    <Select value={testModel} onValueChange={setTestModel}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Choose a model to compare…" />
                      </SelectTrigger>
                      <SelectContent>
                        {BEDROCK_MODEL_PRESETS.map((model) => (
                          <SelectItem key={model.value} value={model.value}>
                            <div className="flex items-center gap-2">
                              <span>{model.label}</span>
                              <span
                                className="font-mono text-muted-foreground"
                                style={{ fontSize: 10, letterSpacing: "0.02em" }}
                              >
                                {model.cost}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom model ID…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {testModel === "custom" && (
                    <div>
                      <ABFieldLabel>Custom Bedrock model ID</ABFieldLabel>
                      <Input
                        className="font-mono text-sm"
                        placeholder="e.g. anthropic.claude-3-haiku-20240307"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Cost note — amber-stripe banner */}
                  <div
                    className="rounded-sm flex items-start gap-2"
                    style={{
                      background: "var(--amber-soft)",
                      border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                      borderLeft: "3px solid var(--amber)",
                      padding: "10px 12px",
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
                    }}
                  >
                    <Warning
                      style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }}
                    />
                    <span>
                      <span
                        className="font-mono uppercase"
                        style={{ fontSize: 10, letterSpacing: "0.1em" }}
                      >
                        Cost note
                      </span>
                      <br />
                      Each test uses 1 AssemblyAI transcription + 2 Bedrock API calls (one per
                      model). Haiku models are significantly cheaper than Sonnet.
                    </span>
                  </div>

                  <Button
                    className="w-full"
                    disabled={
                      !selectedFile ||
                      !testModel ||
                      (testModel === "custom" && !customModel) ||
                      uploadMutation.isPending
                    }
                    onClick={() => uploadMutation.mutate()}
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <SpinnerGap className="w-4 h-4 mr-2 animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <Flask className="w-4 h-4 mr-2" />
                        Start A/B test
                      </>
                    )}
                  </Button>
                </div>
              </ABPanel>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <SpinnerGap
                  className="animate-spin"
                  style={{ width: 22, height: 22, color: "var(--muted-foreground)" }}
                />
              </div>
            ) : testsError ? (
              <ABErrorBanner message={testsError.message} />
            ) : tests.length === 0 ? (
              <ABPanel kicker="Empty" icon={Flask}>
                <div className="text-center py-10">
                  <Flask
                    style={{
                      width: 36,
                      height: 36,
                      margin: "0 auto",
                      color: "var(--muted-foreground)",
                    }}
                  />
                  <p
                    className="font-mono uppercase text-muted-foreground mt-3"
                    style={{ fontSize: 10, letterSpacing: "0.14em" }}
                  >
                    No A/B tests yet
                  </p>
                  <p className="text-sm text-foreground mt-2">
                    Upload a call from the New test tab to get started.
                  </p>
                </div>
              </ABPanel>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Test list */}
                <div>
                  <div
                    className="font-mono uppercase text-muted-foreground px-1 mb-2"
                    style={{ fontSize: 10, letterSpacing: "0.14em" }}
                  >
                    All tests · {tests.length}
                  </div>
                  <div className="space-y-2">
                    {tests.map((test) => {
                      const testModelLabel =
                        BEDROCK_MODEL_PRESETS.find((m) => m.value === test.testModel)?.label ||
                        test.testModel;
                      const isSelected = selectedTestId === test.id;
                      return (
                        <ABTestRow
                          key={test.id}
                          test={test}
                          testModelLabel={testModelLabel}
                          selected={isSelected}
                          onSelect={() => setSelectedTestId(test.id)}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Detail view */}
                <div className="lg:col-span-2">
                  {selectedTest ? (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        {deleteConfirmId === selectedTest.id ? (
                          <div className="flex items-center gap-2">
                            <span
                              className="font-mono uppercase"
                              style={{
                                fontSize: 10,
                                letterSpacing: "0.12em",
                                color: "var(--destructive)",
                              }}
                            >
                              Delete this test?
                            </span>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                deleteMutation.mutate(selectedTest.id);
                                setDeleteConfirmId(null);
                              }}
                              disabled={deleteMutation.isPending}
                              style={{
                                background: "var(--destructive)",
                                color: "var(--paper)",
                              }}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteConfirmId(selectedTest.id)}
                            disabled={deleteMutation.isPending}
                            style={{
                              color: "var(--destructive)",
                              borderColor:
                                "color-mix(in oklch, var(--destructive), transparent 60%)",
                            }}
                          >
                            <Trash className="w-3.5 h-3.5 mr-1" /> Delete test
                          </Button>
                        )}
                      </div>
                      {selectedTest.status === "processing" ||
                      selectedTest.status === "analyzing" ? (
                        <ABPanel kicker="In progress" icon={SpinnerGap}>
                          <div className="text-center py-10">
                            <SpinnerGap
                              className="animate-spin"
                              style={{
                                width: 32,
                                height: 32,
                                margin: "0 auto",
                                color: "var(--accent)",
                              }}
                            />
                            <p
                              className="font-mono uppercase text-muted-foreground mt-3"
                              style={{ fontSize: 10, letterSpacing: "0.14em" }}
                            >
                              {selectedTest.status === "processing"
                                ? "Transcribing audio…"
                                : "Running both models…"}
                            </p>
                            <p className="text-sm text-foreground mt-2">
                              This typically takes 2–4 minutes.
                            </p>
                          </div>
                        </ABPanel>
                      ) : (
                        <TestResultView test={selectedTest} />
                      )}
                    </div>
                  ) : (
                    <ABPanel kicker="Inspect">
                      <p
                        className="font-mono uppercase text-muted-foreground text-center py-10"
                        style={{ fontSize: 10, letterSpacing: "0.14em" }}
                      >
                        Select a test from the list to view results
                      </p>
                    </ABPanel>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "aggregate" && <AggregateResultsPanel />}
      </main>
    </div>
  );
}

interface AggregateRow {
  baselineModel: string;
  testModel: string;
  sampleSize: number;
  baselineWins: number;
  testWins: number;
  ties: number;
  avgBaselineScore: number | null;
  avgTestScore: number | null;
  avgScoreDelta: number | null;
  avgBaselineLatencyMs: number | null;
  avgTestLatencyMs: number | null;
  avgLatencyDeltaMs: number | null;
  recommendation: "promote_test" | "keep_baseline" | "inconclusive" | "insufficient_data";
}

interface AggregateResponse {
  aggregates: AggregateRow[];
  currentActiveModel?: string;
}

function AggregateResultsPanel() {
  const { toast } = useToast();
  const [promoteConfirmRow, setPromoteConfirmRow] = useState<AggregateRow | null>(null);

  const { data, isLoading, error } = useQuery<AggregateResponse>({
    queryKey: ["/api/ab-tests/aggregate"],
  });

  const promoteMutation = useMutation({
    mutationFn: async (row: AggregateRow) => {
      const csrf = getCsrfToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrf) headers["x-csrf-token"] = csrf;
      const res = await fetch("/api/ab-tests/promote", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          model: row.testModel,
          baselineModel: row.baselineModel,
          sampleSize: row.sampleSize,
          avgDelta: row.avgScoreDelta,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Promotion failed" }));
        throw new Error(err.message || "Promotion failed");
      }
      return res.json();
    },
    onSuccess: (_res, row) => {
      toast({
        title: "Model promoted",
        description: `${BEDROCK_MODEL_PRESETS.find(m => m.value === row.testModel)?.label || row.testModel} is now the active production model.`,
      });
      setPromoteConfirmRow(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests/aggregate"] });
    },
    onError: (err: Error) => {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <ABPanel kicker="Loading">
        <div className="text-center py-10">
          <SpinnerGap
            className="animate-spin"
            style={{
              width: 22,
              height: 22,
              margin: "0 auto",
              color: "var(--muted-foreground)",
            }}
          />
        </div>
      </ABPanel>
    );
  }

  if (error || !data) {
    return <ABErrorBanner message={error ? error.message : "No data"} />;
  }

  return (
    <div className="space-y-4">
      {data.currentActiveModel && (
        <div
          className="rounded-sm flex items-center gap-3"
          style={{
            background: "var(--copper-soft)",
            border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
            borderLeft: "3px solid var(--accent)",
            padding: "12px 16px",
          }}
        >
          <CheckCircle
            style={{ width: 14, height: 14, color: "var(--accent)" }}
            weight="fill"
          />
          <span className="text-sm text-foreground">
            <span
              className="font-mono uppercase mr-2"
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "var(--accent)",
              }}
            >
              Active production
            </span>
            <span
              className="font-mono rounded-sm"
              style={{
                fontSize: 11,
                letterSpacing: "0.02em",
                padding: "2px 8px",
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              {data.currentActiveModel}
            </span>
          </span>
        </div>
      )}

      {data.aggregates.length === 0 ? (
        <ABPanel kicker="Empty">
          <div className="text-center py-10">
            <Flask
              style={{
                width: 36,
                height: 36,
                margin: "0 auto",
                color: "var(--muted-foreground)",
              }}
            />
            <p
              className="font-mono uppercase text-muted-foreground mt-3"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              No comparisons yet
            </p>
            <p className="text-sm text-foreground mt-2">
              Run at least 3 tests with the same model pair to see a recommendation.
            </p>
          </div>
        </ABPanel>
      ) : (
        <div className="space-y-3">
          {data.aggregates.map((row) => (
            <AggregateRowCard
              key={`${row.baselineModel}||${row.testModel}`}
              row={row}
              isActive={data.currentActiveModel === row.testModel}
              promoteConfirmRow={promoteConfirmRow}
              onConfirm={(r) => setPromoteConfirmRow(r)}
              onCancel={() => setPromoteConfirmRow(null)}
              onPromote={(r) => promoteMutation.mutate(r)}
              isPending={promoteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Aggregate-row card
// ─────────────────────────────────────────────────────────────
function AggregateRowCard({
  row,
  isActive,
  promoteConfirmRow,
  onConfirm,
  onCancel,
  onPromote,
  isPending,
}: {
  row: AggregateRow;
  isActive: boolean;
  promoteConfirmRow: AggregateRow | null;
  onConfirm: (row: AggregateRow) => void;
  onCancel: () => void;
  onPromote: (row: AggregateRow) => void;
  isPending: boolean;
}) {
  const baselineLabel =
    BEDROCK_MODEL_PRESETS.find((m) => m.value === row.baselineModel)?.label ||
    row.baselineModel;
  const testLabel =
    BEDROCK_MODEL_PRESETS.find((m) => m.value === row.testModel)?.label || row.testModel;
  const canPromote = row.recommendation === "promote_test" && !isActive;

  const recMeta: Record<
    AggregateRow["recommendation"],
    { label: string; tone: "sage" | "amber" | "neutral"; stripe: string }
  > = {
    promote_test: {
      label: "Promote test",
      tone: "sage",
      stripe: "var(--sage)",
    },
    keep_baseline: { label: "Keep baseline", tone: "neutral", stripe: "var(--border)" },
    inconclusive: { label: "Inconclusive", tone: "neutral", stripe: "var(--border)" },
    insufficient_data: {
      label: "Need more samples",
      tone: "amber",
      stripe: "var(--amber)",
    },
  };
  const rec = recMeta[row.recommendation];
  const isConfirming =
    promoteConfirmRow?.testModel === row.testModel &&
    promoteConfirmRow.baselineModel === row.baselineModel;

  return (
    <div
      className="rounded-sm border bg-card px-5 py-4"
      style={{
        borderColor: "var(--border)",
        borderLeft: `3px solid ${rec.stripe}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-display font-medium text-foreground truncate"
              style={{ fontSize: 15, letterSpacing: "-0.1px" }}
            >
              {testLabel}
            </span>
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.1em" }}
            >
              vs
            </span>
            <span
              className="font-display font-medium text-foreground truncate"
              style={{ fontSize: 15, letterSpacing: "-0.1px" }}
            >
              {baselineLabel}
            </span>
          </div>
          <p
            className="font-mono text-muted-foreground tabular-nums mt-1"
            style={{ fontSize: 11, letterSpacing: "0.02em" }}
          >
            {row.sampleSize} test{row.sampleSize === 1 ? "" : "s"} · {row.testWins} test wins ·{" "}
            {row.baselineWins} baseline wins · {row.ties} ties
          </p>
        </div>
        <ABStatusPill tone={rec.tone}>{rec.label}</ABStatusPill>
      </div>

      <div
        className="grid grid-cols-3 gap-3 rounded-sm p-3 mb-3"
        style={{ background: "var(--paper-2)" }}
      >
        <ABStat label="Baseline avg" value={row.avgBaselineScore} />
        <ABStat label="Test avg" value={row.avgTestScore} />
        <ABStat
          label="Score delta"
          value={
            row.avgScoreDelta !== null
              ? (row.avgScoreDelta > 0 ? "+" : "") + row.avgScoreDelta
              : null
          }
          color={
            row.avgScoreDelta !== null && row.avgScoreDelta > 0
              ? "var(--sage)"
              : row.avgScoreDelta !== null && row.avgScoreDelta < 0
              ? "var(--amber)"
              : undefined
          }
        />
      </div>

      {row.avgBaselineLatencyMs !== null && row.avgTestLatencyMs !== null && (
        <p
          className="font-mono text-muted-foreground tabular-nums mb-3"
          style={{ fontSize: 11, letterSpacing: "0.02em", lineHeight: 1.5 }}
        >
          <span
            className="uppercase mr-1.5"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            Latency
          </span>
          {row.avgBaselineLatencyMs}ms baseline / {row.avgTestLatencyMs}ms test
          {row.avgLatencyDeltaMs !== null && (
            <span
              style={{
                marginLeft: 6,
                color:
                  row.avgLatencyDeltaMs > 0 ? "var(--amber)" : "var(--sage)",
              }}
            >
              ({row.avgLatencyDeltaMs > 0 ? "+" : ""}
              {row.avgLatencyDeltaMs}ms)
            </span>
          )}
        </p>
      )}

      <div className="flex justify-end">
        {isActive ? (
          <span
            className="font-mono uppercase inline-flex items-center gap-1.5 rounded-sm"
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              padding: "4px 8px",
              background: "var(--sage-soft)",
              border: "1px solid color-mix(in oklch, var(--sage), transparent 55%)",
              color: "var(--sage)",
              fontWeight: 500,
            }}
          >
            <CheckCircle style={{ width: 11, height: 11 }} weight="fill" />
            Currently active
          </span>
        ) : isConfirming ? (
          <div className="flex items-center gap-2">
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.12em" }}
            >
              Promote {testLabel}?
            </span>
            <Button
              size="sm"
              variant="default"
              disabled={isPending}
              onClick={() => onPromote(row)}
            >
              {isPending ? <SpinnerGap className="w-3 h-3 animate-spin" /> : "Confirm"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant={canPromote ? "default" : "outline"}
            onClick={() => onConfirm(row)}
            disabled={row.recommendation === "insufficient_data"}
            title={
              row.recommendation === "insufficient_data"
                ? "Need at least 3 samples"
                : "Promote the test model to production"
            }
          >
            Promote test model
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline helpers
// ─────────────────────────────────────────────────────────────
function ABTab({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors ${
        active
          ? "bg-foreground text-background border border-foreground"
          : "bg-card border border-border text-foreground hover:bg-secondary"
      }`}
      style={{ fontSize: 10, letterSpacing: "0.1em" }}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full tabular-nums"
          style={{
            width: 16,
            height: 16,
            fontSize: 9,
            background: active ? "var(--background)" : "var(--accent)",
            color: active ? "var(--foreground)" : "var(--paper)",
            marginLeft: 2,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function ABPanel({
  kicker,
  title,
  description,
  icon: IconComp,
  children,
}: {
  kicker: string;
  title?: string;
  description?: React.ReactNode;
  icon?: Icon;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      <div className="px-6 pt-5 pb-3">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {IconComp && <IconComp style={{ width: 12, height: 12 }} />}
          {kicker}
        </div>
        {title && (
          <div
            className="font-display font-medium text-foreground mt-1"
            style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
          >
            {title}
          </div>
        )}
        {description && (
          <p
            className="text-muted-foreground mt-1.5"
            style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 540 }}
          >
            {description}
          </p>
        )}
      </div>
      <div className="px-6 pb-5">{children}</div>
    </div>
  );
}

function ABFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="font-mono uppercase text-muted-foreground block mb-1.5"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </label>
  );
}

function ABTestRow({
  test,
  testModelLabel,
  selected,
  onSelect,
}: {
  test: ABTest;
  testModelLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const isProcessing = test.status === "processing" || test.status === "analyzing";
  const isCompleted = test.status === "completed";
  const StatusIcon = isProcessing ? SpinnerGap : isCompleted ? CheckCircle : WarningCircle;
  const statusColor = isProcessing
    ? "var(--accent)"
    : isCompleted
    ? "var(--sage)"
    : "var(--destructive)";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-sm border bg-card transition-colors text-left p-3 hover:border-foreground/30"
      style={{
        borderColor: selected ? "var(--accent)" : "var(--border)",
        background: selected ? "var(--copper-soft)" : "var(--card)",
        borderLeft: selected ? "3px solid var(--accent)" : "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-foreground truncate flex-1">
          {test.fileName}
        </span>
        <StatusIcon
          className={isProcessing ? "animate-spin" : ""}
          style={{ width: 13, height: 13, color: statusColor }}
          {...(isCompleted ? { weight: "fill" } : {})}
        />
      </div>
      <p
        className="font-mono uppercase text-muted-foreground truncate"
        style={{ fontSize: 10, letterSpacing: "0.1em" }}
      >
        vs {testModelLabel}
      </p>
      <div className="flex items-center justify-between mt-1.5">
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 9, letterSpacing: "0.1em" }}
        >
          {new Date(test.createdAt || "").toLocaleDateString()}
        </span>
        {isCompleted &&
          test.baselineAnalysis &&
          test.testAnalysis &&
          !test.baselineAnalysis.error &&
          !test.testAnalysis.error && (
            <span
              className="font-mono tabular-nums text-foreground"
              style={{ fontSize: 11, letterSpacing: "0.02em" }}
            >
              {(test.baselineAnalysis.performance_score as number | undefined)?.toFixed(1)}{" "}
              <span className="text-muted-foreground">vs</span>{" "}
              {(test.testAnalysis.performance_score as number | undefined)?.toFixed(1)}
            </span>
          )}
      </div>
    </button>
  );
}

function ABStatusPill({
  tone,
  children,
}: {
  tone: "sage" | "amber" | "neutral";
  children: React.ReactNode;
}) {
  const palette = {
    sage: {
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "var(--sage)",
    },
    amber: {
      bg: "var(--amber-soft)",
      border: "color-mix(in oklch, var(--amber), transparent 50%)",
      color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
    },
    neutral: {
      bg: "var(--paper-2)",
      border: "var(--border)",
      color: "var(--muted-foreground)",
    },
  }[tone];
  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-sm shrink-0"
      style={{
        fontSize: 10,
        letterSpacing: "0.1em",
        padding: "3px 8px",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

function ABStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string | null;
  color?: string;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 9, letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      <div
        className="font-display font-medium tabular-nums mt-0.5"
        style={{
          fontSize: 18,
          lineHeight: 1,
          color: color || "var(--foreground)",
          letterSpacing: "-0.3px",
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function ABErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-sm"
      style={{
        background: "var(--warm-red-soft)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
        borderLeft: "3px solid var(--destructive)",
        padding: "12px 16px",
        fontSize: 13,
        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
      }}
    >
      <Warning style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          Load failed
        </div>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}
