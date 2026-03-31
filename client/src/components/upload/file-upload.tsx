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
            return {
              ...f,
              processingStep: data.label || data.status,
              processingProgress: progress || 0,
              status: data.status === "completed" ? "completed" as const :
                      data.status === "failed" ? "error" as const :
                      data.status === "awaiting_analysis" ? "completed" as const : "processing" as const,
              error: data.status === "failed" ? "Processing failed" : undefined,
            };
          }
          return f;
        }));
      }
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, []);

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

      const response = await fetch('/api/calls/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
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

  const uploadFile = async (index: number) => {
    const fileData = uploadFiles[index];
    try {
      updateFile(index, { status: 'uploading', progress: 0, processingStep: "Uploading to server..." });
      const result = await uploadMutation.mutateAsync({
        file: fileData.file,
        employeeId: fileData.employeeId || undefined,
        callCategory: fileData.callCategory || undefined,
        processingMode: processingMode || undefined,
        language: audioLanguage || undefined,
      });
      // The API returns the call ID — track it for WebSocket updates
      const callId = result?.id || result?.callId;
      updateFile(index, {
        status: 'processing',
        progress: 100,
        callId,
        processingStep: "Queued for processing...",
        processingProgress: 10,
      });
      toast({ title: t("toast.uploadSuccess"), description: t("toast.uploadSuccessDesc") });
    } catch (error) {
      updateFile(index, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' });
    }
  };

  const MAX_CONCURRENT = MAX_CONCURRENT_UPLOADS;

  const uploadAll = async () => {
    const pendingIndices = uploadFiles
      .map((file, index) => file.status === 'pending' ? index : -1)
      .filter(i => i >= 0);

    let totalSuccess = 0;
    let totalFailed = 0;

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < pendingIndices.length; i += MAX_CONCURRENT) {
      const batch = pendingIndices.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.allSettled(batch.map(idx => uploadFile(idx)));
      for (const result of results) {
        if (result.status === "fulfilled") totalSuccess++;
        else totalFailed++;
      }
    }

    // Report batch results to user
    if (totalFailed > 0 && totalSuccess === 0) {
      toast({ title: t("toast.uploadFailed"), description: `${totalFailed} file(s) failed to upload.`, variant: "destructive" });
    } else if (totalFailed > 0) {
      toast({ title: t("toast.batchComplete"), description: `${totalSuccess} uploaded, ${totalFailed} failed.`, variant: "destructive" });
    }
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Upload Call Recordings</h3>
      <div {...getRootProps()} role="button" aria-label={t("upload.dragDrop")} className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
        isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}>
        <input {...getInputProps()} aria-label={t("upload.dragDrop")} />
        <CloudArrowUp className={`mx-auto h-12 w-12 ${isDragActive ? "text-primary" : "text-muted-foreground"}`} />
        <p className="mt-2 text-sm text-muted-foreground">
          {isDragActive ? "Drop files here..." : "Drag & drop files here, or click to select files"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A, MP4, FLAC, OGG — up to 100MB per file, {MAX_BATCH_SIZE} files max</p>
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
              {uploadFiles.some(f => f.status === 'pending') && (
                <Button type="button" onClick={uploadAll} disabled={uploadMutation.isPending}>
                  Upload All ({uploadFiles.filter(f => f.status === 'pending').length})
                </Button>
              )}
            </div>
          </div>

          {/* Batch controls: Apply employee/category to all pending files at once */}
          {uploadFiles.filter(f => f.status === 'pending').length > 1 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
              <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-2">Apply to all pending files:</p>
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
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">Complete</span>
                    <Button size="sm" variant="ghost" aria-label="Remove file" onClick={() => removeFile(index)}><X className="w-4 h-4" /></Button>
                  </div>
                )}

                {fileData.status === 'error' && (
                  <div className="flex items-center gap-2 text-red-600">
                    <XCircle className="w-5 h-5" />
                    <span className="text-sm">{fileData.error}</span>
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
