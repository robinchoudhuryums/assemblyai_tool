import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CloudArrowUp, FileAudio, SpinnerGap, X, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { CALL_CATEGORIES } from "@shared/schema";
import type { Employee } from "@shared/schema";
import { useTranslation } from "@/lib/i18n";
import { MAX_BATCH_SIZE, MAX_FILE_SIZE, MAX_CONCURRENT_UPLOADS } from "@/lib/constants";
import { getCsrfToken } from "@/lib/queryClient";

interface UploadFile {
  file: File;
  employeeId: string;
  callCategory: string;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  callId?: string;
  processingStep?: string;
  processingProgress?: number;
  // Server-side terminal state — separate from UI `status` because the
  // upload-page UI maps `awaiting_analysis` (batch mode, hours-deferred)
  // to the same "completed" green-check as a real analyzed call. The
  // batch-summary toast needs the underlying truth to avoid declaring
  // "batch complete" before any analysis has actually run.
  serverStatus?: 'completed' | 'failed' | 'awaiting_analysis';
  // Flags from the analysis pipeline (passed through the WebSocket
  // completion broadcast). Empty array = analyzed cleanly. Used only
  // by the batch summary toast.
  flags?: string[];
}

// Quality-flag families, in display order. The toast only enumerates
// flags that appear; absent families are silently skipped. Ordered so
// the most-actionable (AI failures) surface first.
const FLAG_FAMILIES: { prefix: string; label: string }[] = [
  { prefix: "ai_unavailable", label: "AI unavailable" },
  { prefix: "output_anomaly", label: "Output anomaly" },
  { prefix: "prompt_injection", label: "Prompt injection" },
  { prefix: "low_confidence", label: "Low confidence" },
  { prefix: "low_transcript_quality", label: "Low transcript quality" },
  { prefix: "empty_transcript", label: "Empty transcript" },
];

function classifyFlag(flag: string): string | null {
  for (const { prefix, label } of FLAG_FAMILIES) {
    if (flag === prefix || flag.startsWith(`${prefix}:`)) return label;
  }
  return null;
}

const PROCESSING_STEPS = [
  { key: "uploading", label: "Uploading audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "analyzing", label: "AI analysis" },
  { key: "processing", label: "Processing results" },
  { key: "saving", label: "Saving" },
  { key: "completed", label: "Complete" },
];

type ProcessingMode = "" | "immediate" | "batch";
type AudioLanguage = "" | "en" | "es";

const AUDIO_LANGUAGES = [
  { value: "", labelKey: "lang.auto" },
  { value: "en", labelKey: "lang.en" },
  { value: "es", labelKey: "lang.es" },
];

export default function FileUpload() {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("");
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguage>("");
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Listen for WebSocket call updates via the shared connection (dispatched by useWebSocket hook)
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.callId) {
        setUploadFiles(prev => prev.map(f => {
          if (f.callId === data.callId) {
            const stepIndex = PROCESSING_STEPS.findIndex(s => s.key === data.status);
            const progress = stepIndex >= 0 ? Math.round(((stepIndex + 1) / PROCESSING_STEPS.length) * 100) : f.processingProgress;
            const serverStatus =
              data.status === "completed" ? "completed" as const :
              data.status === "failed" ? "failed" as const :
              data.status === "awaiting_analysis" ? "awaiting_analysis" as const :
              f.serverStatus;
            // Flags only arrive on the completion broadcast. Preserve any
            // earlier value if a later (non-completion) tick comes in.
            const flags = Array.isArray(data.flags) ? (data.flags as string[]) : f.flags;
            return {
              ...f,
              processingStep: data.label || data.status,
              processingProgress: progress || 0,
              status: data.status === "completed" ? "completed" as const :
                      data.status === "failed" ? "error" as const :
                      data.status === "awaiting_analysis" ? "completed" as const : "processing" as const,
              error: data.status === "failed" ? "Processing failed" : undefined,
              serverStatus,
              flags,
            };
          }
          return f;
        }));
      }
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, []);

  // Batch quality summary — tracks the cohort of callIds dispatched by
  // the most recent uploadAll() click so we can fire a single toast once
  // every call in the batch reaches a terminal server-side state. State
  // (not ref) so updates trigger the watcher even when all WebSocket
  // ticks landed before uploadAll's await loop returned. Cleared to null
  // after the toast fires.
  const [batchCohort, setBatchCohort] = useState<{
    callIds: Set<string>;
    total: number;
  } | null>(null);

  // Watcher: fires the batch summary toast when every cohort callId has
  // resolved (completed | failed). Files in `awaiting_analysis` keep the
  // cohort open — batch-mode uploads will trigger the toast hours later
  // when the actual analysis lands. Upload-time failures (no callId) are
  // counted via batchCohort.total vs callIds.size so "5 of 8 reached the
  // pipeline, 3 failed to upload" still produces a meaningful summary.
  useEffect(() => {
    if (!batchCohort) return;
    const { callIds, total } = batchCohort;
    if (callIds.size === 0) return;
    const cohortFiles = uploadFiles.filter(f => f.callId && callIds.has(f.callId));
    if (cohortFiles.length < callIds.size) return; // some not seen yet
    const allTerminal = cohortFiles.every(
      f => f.serverStatus === "completed" || f.serverStatus === "failed"
    );
    if (!allTerminal) return;

    const cohortSize = callIds.size;
    const uploadFailed = total - cohortSize; // failed to even reach pipeline
    const failed = cohortFiles.filter(f => f.serverStatus === "failed").length;
    const completed = cohortFiles.filter(f => f.serverStatus === "completed");
    const flagged = completed.filter(f => (f.flags?.length ?? 0) > 0);
    const clean = completed.length - flagged.length;

    // Aggregate flag-family counts across the batch.
    const familyCounts = new Map<string, number>();
    for (const f of flagged) {
      for (const flag of f.flags ?? []) {
        const family = classifyFlag(flag);
        if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
      }
    }
    const familySummary = Array.from(familyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, n]) => `${n} ${label.toLowerCase()}`)
      .join(", ");

    const parts: string[] = [];
    if (clean > 0) parts.push(`${clean} analyzed cleanly`);
    if (flagged.length > 0) {
      parts.push(
        familySummary
          ? `${flagged.length} flagged (${familySummary})`
          : `${flagged.length} flagged`,
      );
    }
    if (failed > 0) parts.push(`${failed} failed`);
    if (uploadFailed > 0) parts.push(`${uploadFailed} upload-failed`);

    const description = parts.join(" · ");
    const isClean = flagged.length === 0 && failed === 0 && uploadFailed === 0;
    toast({
      title: `Batch of ${total} complete`,
      description: description || "All processed",
      variant: isClean ? "default" : "destructive",
    });

    setBatchCohort(null);
  }, [uploadFiles, batchCohort, toast]);

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, employeeId, callCategory, processingMode: mode, language }: { file: File; employeeId?: string; callCategory?: string; processingMode?: string; language?: string }) => {
      const formData = new FormData();
      formData.append('audioFile', file);
      if (employeeId) formData.append('employeeId', employeeId);
      if (callCategory) formData.append('callCategory', callCategory);
      if (mode) formData.append('processingMode', mode);
      if (language) formData.append('language', language);

      const csrf = getCsrfToken();
      const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
      if (csrf) headers['x-csrf-token'] = csrf;
      const response = await fetch('/api/calls/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      file, employeeId: '', callCategory: '', progress: 0, status: 'pending' as const,
    }));
    setUploadFiles(prev => [...prev, ...newFiles]);
  }, []);

  // MAX_BATCH_SIZE & MAX_FILE_SIZE imported from @/lib/constants

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        const reasons = rejected.map(r => r.errors.map(e => e.message).join(", ")).join("; ");
        toast({ title: "Some files rejected", description: reasons, variant: "destructive" });
      }
      const currentCount = uploadFiles.length;
      const allowed = accepted.slice(0, MAX_BATCH_SIZE - currentCount);
      if (allowed.length < accepted.length) {
        toast({ title: "Batch limit", description: `Maximum ${MAX_BATCH_SIZE} files per batch. ${accepted.length - allowed.length} file(s) were skipped.`, variant: "destructive" });
      }
      onDrop(allowed);
    },
    accept: { 'audio/*': ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'] },
    maxSize: MAX_FILE_SIZE,
  });

  const updateFile = (index: number, updates: Partial<UploadFile>) => {
    setUploadFiles(prev => prev.map((file, i) => i === index ? { ...file, ...updates } : file));
  };

  const removeFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Upload one file. Returns the server-issued callId on success (so the
   * batch-summary cohort can collect them) or null on terminal failure.
   */
  const uploadFile = async (index: number): Promise<string | null> => {
    const fileData = uploadFiles[index];
    // Automatic retry-on-429: if the per-IP upload rate limit is hit
    // (default 30/min, env-tunable as UPLOAD_RATE_LIMIT_PER_MIN), the
    // server returns 429 + "try again later". A short backoff usually
    // clears the window. We retry up to 3 times with 5s / 12s / 25s
    // backoff before surfacing the failure as an error the user can
    // manually retry. The backoff times bracket the 60s window — by
    // attempt 3 the window has rotated and the slot is free.
    const RETRY_DELAYS_MS = [5000, 12000, 25000];
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const stepLabel = attempt === 0
          ? "Uploading to server..."
          : `Rate-limited, retrying (${attempt + 1}/${RETRY_DELAYS_MS.length + 1})...`;
        updateFile(index, { status: 'uploading', progress: 0, processingStep: stepLabel });
        const result = await uploadMutation.mutateAsync({
          file: fileData.file,
          employeeId: fileData.employeeId || undefined,
          callCategory: fileData.callCategory || undefined,
          processingMode: processingMode || undefined,
          language: audioLanguage || undefined,
        });
        // The API returns the call ID — track it for WebSocket updates
        const callId: string | undefined = result?.id || result?.callId;
        updateFile(index, {
          status: 'processing',
          progress: 100,
          callId,
          processingStep: "Queued for processing...",
          processingProgress: 10,
        });
        toast({ title: t("toast.uploadSuccess"), description: t("toast.uploadSuccessDesc") });
        return callId ?? null;
      } catch (error) {
        lastError = error;
        // Only retry on 429-shaped errors. Non-rate-limit failures (auth,
        // file-too-large, server crash) shouldn't trigger silent retries.
        const msg = error instanceof Error ? error.message : "";
        const is429 = /429|too many|rate limit/i.test(msg);
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        if (!is429 || isLastAttempt) break;
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
    updateFile(index, {
      status: 'error',
      error: lastError instanceof Error ? lastError.message : 'Upload failed',
    });
    return null;
  };

  /** Reset a single file from error → pending so uploadAll re-picks it up. */
  const retryFile = (index: number) => {
    updateFile(index, { status: 'pending', error: undefined, processingStep: undefined });
    // Fire the upload immediately for single-row retry — uploadAll's
    // batch loop is for "Upload all" workflows.
    void uploadFile(index);
  };

  const MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;

  const uploadAll = async () => {
    // Pick up both 'pending' (never tried) and 'error' (failed last
    // time, e.g. 429 after the in-call retries exhausted, or a
    // transient server error). Clicking "Upload all" again is the
    // operator's intent to reset and retry — clear the stale error
    // state for those rows before re-uploading.
    const pendingIndices = uploadFiles
      .map((file, index) =>
        file.status === 'pending' || file.status === 'error' ? index : -1,
      )
      .filter(i => i >= 0);
    for (const idx of pendingIndices) {
      if (uploadFiles[idx].status === 'error') {
        updateFile(idx, { status: 'pending', error: undefined, processingStep: undefined });
      }
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    const cohortCallIds: string[] = [];

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < pendingIndices.length; i += MAX_CONCURRENT) {
      const batch = pendingIndices.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(batch.map(idx => uploadFile(idx)));
      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value) {
            totalSuccess++;
            cohortCallIds.push(result.value);
          } else {
            totalFailed++;
          }
        } else {
          totalFailed++;
        }
      }
    }

    // Register the batch cohort for the quality-summary toast. Only arm
    // for batches with >1 file — single uploads already get the existing
    // per-row toasts and don't need a summary.
    if (pendingIndices.length > 1) {
      setBatchCohort({
        callIds: new Set(cohortCallIds),
        total: pendingIndices.length,
      });
    }

    // Report upload-step failures immediately. The analysis-quality summary
    // fires later via the cohort watcher when every call reaches a server
    // terminal state.
    if (totalFailed > 0 && totalSuccess === 0) {
      toast({ title: t("toast.uploadFailed"), description: `${totalFailed} file(s) failed to upload.`, variant: "destructive" });
    } else if (totalFailed > 0) {
      toast({ title: t("toast.batchComplete"), description: `${totalSuccess} uploaded, ${totalFailed} failed.`, variant: "destructive" });
    }
  };

  return (
    <div className="bg-card border border-border" style={{ padding: "24px 28px" }}>
      <div
        {...getRootProps()}
        role="button"
        aria-label={t("upload.dragDrop")}
        className="text-center cursor-pointer transition-colors"
        style={{
          border: `1.5px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`,
          background: isDragActive ? "var(--accent-soft)" : "transparent",
          padding: "48px 24px",
        }}
      >
        <input {...getInputProps()} aria-label={t("upload.dragDrop")} />
        <CloudArrowUp
          className="mx-auto"
          style={{
            width: 44,
            height: 44,
            color: isDragActive ? "var(--accent)" : "var(--muted-foreground)",
          }}
        />
        <p
          className="font-display mt-3 text-foreground"
          style={{ fontSize: 16, letterSpacing: "-0.2px" }}
        >
          {isDragActive ? "Drop files here…" : "Drag & drop files here, or click to select"}
        </p>
        <p
          className="font-mono text-muted-foreground mt-2"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
        >
          MP3 · WAV · M4A · MP4 · FLAC · OGG — up to 100MB per file, {MAX_BATCH_SIZE} files max
        </p>
      </div>

      {uploadFiles.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-foreground">
              Files to Upload
              <span className="text-xs text-muted-foreground ml-2 font-normal">
                ({uploadFiles.filter(f => f.status === 'completed').length}/{uploadFiles.length} complete)
              </span>
            </h4>
            <div className="flex items-center gap-2">
              {uploadFiles.length > 1 && uploadFiles.some(f => f.status !== 'pending') && (
                <span className="text-xs text-muted-foreground">
                  {uploadFiles.filter(f => f.status === 'uploading' || f.status === 'processing').length} in progress
                </span>
              )}
              {uploadFiles.some(f => f.status === 'pending' || f.status === 'error') && (
                <Button type="button" onClick={uploadAll} disabled={uploadMutation.isPending}>
                  {(() => {
                    const pending = uploadFiles.filter(f => f.status === 'pending').length;
                    const errored = uploadFiles.filter(f => f.status === 'error').length;
                    if (errored > 0 && pending === 0) {
                      return `Retry Failed (${errored})`;
                    }
                    if (errored > 0) {
                      return `Upload All (${pending} new + ${errored} retry)`;
                    }
                    return `Upload All (${pending})`;
                  })()}
                </Button>
              )}
            </div>
          </div>

          {/* Batch controls: Apply employee/category to all pending files at once */}
          {uploadFiles.filter(f => f.status === 'pending').length > 1 && (
            <div
              className="p-3 rounded-sm"
              style={{
                background: "var(--copper-soft)",
                border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
                borderLeft: "3px solid var(--accent)",
              }}
            >
              <p
                className="text-xs font-medium mb-2"
                style={{
                  color: "var(--accent)",
                }}
              >
                Apply to all pending files:
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <Select onValueChange={(value) => {
                  const cat = value;
                  setUploadFiles(prev => prev.map(f =>
                    f.status === 'pending' ? { ...f, callCategory: cat } : f
                  ));
                }}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Set all call types" /></SelectTrigger>
                  <SelectContent>
                    {CALL_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select onValueChange={(value) => {
                  const empId = value === "__unassigned__" ? "" : value;
                  setUploadFiles(prev => prev.map(f =>
                    f.status === 'pending' ? { ...f, employeeId: empId } : f
                  ));
                }}>
                  <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Set all agents" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">
                      <span className="text-muted-foreground italic">Unassigned (auto-detect)</span>
                    </SelectItem>
                    {employees?.map(employee => (
                      <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={processingMode || "default"} onValueChange={(value) => setProcessingMode(value === "default" ? "" : value as ProcessingMode)}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder={t("form.processingMode")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      <span className="text-muted-foreground italic">{t("mode.auto")}</span>
                    </SelectItem>
                    <SelectItem value="immediate">{t("mode.immediate")}</SelectItem>
                    <SelectItem value="batch">{t("mode.batch")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={audioLanguage || "auto"} onValueChange={(value) => setAudioLanguage(value === "auto" ? "" : value as AudioLanguage)}>
                  <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder={t("form.language")} /></SelectTrigger>
                  <SelectContent>
                    {AUDIO_LANGUAGES.map(lang => (
                      <SelectItem key={lang.value || "auto"} value={lang.value || "auto"}>
                        {lang.value === "" ? <span className="text-muted-foreground italic">{t(lang.labelKey)}</span> : t(lang.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {uploadFiles.map((fileData, index) => (
            <div key={index} className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center space-x-3">
                <FileAudio className="text-primary w-8 h-8 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{fileData.file.name}</p>
                  <p className="text-xs text-muted-foreground">{(fileData.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>

                {fileData.status === 'pending' && (
                  <>
                    <Select onValueChange={(value) => updateFile(index, { callCategory: value })}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Call type" /></SelectTrigger>
                      <SelectContent>
                        {CALL_CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select onValueChange={(value) => updateFile(index, { employeeId: value === "__unassigned__" ? "" : value })}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="Assign to agent" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unassigned__">
                          <span className="text-muted-foreground italic">Unassigned (auto-detect)</span>
                        </SelectItem>
                        {employees?.map(employee => (
                          <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" aria-label="Remove file" onClick={() => removeFile(index)}><X className="w-4 h-4" /></Button>
                  </>
                )}

                {fileData.status === 'completed' && (
                  <div
                    className="flex items-center gap-2"
                    style={{ color: "var(--sage)" }}
                  >
                    <CheckCircle className="w-5 h-5" weight="fill" />
                    <span className="text-sm font-medium">Complete</span>
                    <Button size="sm" variant="ghost" aria-label="Remove file" onClick={() => removeFile(index)}><X className="w-4 h-4" /></Button>
                  </div>
                )}

                {fileData.status === 'error' && (
                  <div
                    className="flex items-center gap-2"
                    style={{ color: "var(--destructive)" }}
                  >
                    <XCircle className="w-5 h-5" weight="fill" />
                    <span className="text-sm flex-1 min-w-0 truncate" title={fileData.error}>{fileData.error}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryFile(index)}
                      title="Retry this upload"
                      aria-label="Retry upload"
                    >
                      Retry
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Remove file" onClick={() => removeFile(index)}><X className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>

              {/* Processing Progress Indicator */}
              {(fileData.status === 'uploading' || fileData.status === 'processing') && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <SpinnerGap className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs font-medium text-primary">
                      {fileData.processingStep || "Processing..."}
                    </span>
                  </div>
                  <Progress value={fileData.processingProgress || 0} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
                    {PROCESSING_STEPS.map((step, i) => {
                      const currentIdx = PROCESSING_STEPS.findIndex(s =>
                        fileData.processingStep?.toLowerCase().includes(s.key)
                      );
                      const isDone = i <= currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <span key={step.key} className={`${isDone ? "text-primary" : ""} ${isCurrent ? "font-semibold" : ""}`}>
                          {step.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
