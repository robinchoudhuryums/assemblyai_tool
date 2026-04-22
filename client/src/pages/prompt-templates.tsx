import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Chat,
  FileText,
  Flask,
  FloppyDisk,
  PencilSimple,
  Plus,
  Scales,
  ShieldCheck,
  Trash,
  Warning,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/lib/confirm-dialog";
import { CALL_CATEGORIES } from "@shared/schema";
import type { PromptTemplate, InsertPromptTemplate } from "@shared/schema";

interface TemplateTestResult {
  callId: string;
  fileName: string | null;
  currentScore: number | null;
  testScore: number | null;
  delta: number | null;
  currentSummary: string | null;
  testSummary: string | null;
  error: string | null;
}

interface TemplateTestResponse {
  templateId: string;
  templateName: string;
  callCategory: string;
  sampleSize: number;
  results: TemplateTestResult[];
  summary: {
    avgCurrentScore: number | null;
    avgTestScore: number | null;
    avgDelta: number | null;
    scoreDirection: "higher" | "lower" | "neutral" | "unknown";
    successfulRuns: number;
  };
  message?: string;
}

interface PhraseEntry {
  phrase: string;
  label: string;
  severity: "required" | "recommended";
}

interface ScoringWeights {
  compliance: number;
  customerExperience: number;
  communication: number;
  resolution: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = { compliance: 25, customerExperience: 25, communication: 25, resolution: 25 };

export default function PromptTemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TemplateTestResponse | null>(null);

  const { data: templates, isLoading, error: templatesError } = useQuery<PromptTemplate[]>({
    queryKey: ["/api/prompt-templates"],
  });

  const testMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await apiRequest("POST", `/api/prompt-templates/${templateId}/test`, { sampleSize: 5 });
      return (await res.json()) as TemplateTestResponse;
    },
    onSuccess: (data) => {
      setTestResults(data);
      if (data.sampleSize === 0) {
        toast({
          title: "No calls to test against",
          description: data.message || "No completed calls in this category yet.",
        });
      } else {
        toast({
          title: "Back-test complete",
          description: `Tested against ${data.sampleSize} call${data.sampleSize === 1 ? "" : "s"}. Avg delta: ${data.summary.avgDelta ?? "n/a"}`,
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Back-test failed", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertPromptTemplate) => {
      const res = await apiRequest("POST", "/api/prompt-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompt-templates"] });
      toast({ title: "Template Created", description: "Prompt template saved successfully." });
      setShowNewForm(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertPromptTemplate> }) => {
      const res = await apiRequest("PATCH", `/api/prompt-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompt-templates"] });
      toast({ title: "Template Updated" });
      setEditingId(null);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/prompt-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompt-templates"] });
      toast({ title: "Template Deleted" });
    },
  });

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  // Categories that don't have templates yet
  const usedCategories = new Set((templates || []).map(t => t.callCategory));

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      data-testid="prompt-templates-page"
    >
      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
        title="Delete prompt template?"
        description="This will permanently remove this prompt template. New calls with this category will use the default evaluation criteria."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
      />

      {/* App bar */}
      <div
        className="flex items-center gap-3 pl-16 pr-4 sm:px-7 py-3 bg-card border-b border-border"
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
          <span className="text-foreground">Prompt templates</span>
        </nav>
        <div className="flex-1" />
        <Button onClick={() => setShowNewForm(true)} disabled={showNewForm} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> New template
        </Button>
      </div>

      {/* Page header */}
      <div className="px-4 sm:px-7 pt-6 pb-4 bg-background border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontSize: 10, letterSpacing: "0.18em" }}
        >
          <FileText style={{ width: 12, height: 12 }} />
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
          Prompt templates &amp; scoring rubrics
        </div>
        <p className="text-muted-foreground mt-2" style={{ fontSize: 14, maxWidth: 620 }}>
          Configure AI analysis criteria per call category for tailored evaluation. Templates
          apply automatically to new calls matching the configured category.
        </p>
      </div>

      <main className="px-4 sm:px-7 py-6 space-y-6">
        {/* Info banner — paper-2 with em-dash bullets explaining what templates do */}
        <div
          className="rounded-sm p-5"
          style={{
            background: "var(--paper-2)",
            border: "1px dashed var(--border)",
          }}
        >
          <div
            className="font-mono uppercase text-muted-foreground mb-2"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            How templates work
          </div>
          <ul className="space-y-1.5 text-sm text-foreground" style={{ lineHeight: 1.55 }}>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>Set weighted scoring criteria per call category.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>Add required disclaimers / phrases that agents must say; missing required phrases are flagged on the call.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-muted-foreground" style={{ marginTop: 2 }}>—</span>
              <span>Back-test a candidate template against the last 5 completed calls before promoting.</span>
            </li>
          </ul>
        </div>

        {/* New template form */}
        {showNewForm && (
          <TemplateForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowNewForm(false)}
            isPending={createMutation.isPending}
            usedCategories={usedCategories}
          />
        )}

        {/* Existing templates */}
        {templatesError ? (
          <ErrorBanner message={templatesError.message} />
        ) : isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-sm border bg-card p-6"
                style={{ borderColor: "var(--border)" }}
              >
                <Skeleton className="h-32 w-full" />
              </div>
            ))}
          </div>
        ) : templates && templates.length > 0 ? (
          <div className="space-y-4">
            {templates.map((tmpl) =>
              editingId === tmpl.id ? (
                <TemplateForm
                  key={tmpl.id}
                  initial={tmpl}
                  onSave={(data) => updateMutation.mutate({ id: tmpl.id, data })}
                  onCancel={() => setEditingId(null)}
                  isPending={updateMutation.isPending}
                  usedCategories={usedCategories}
                />
              ) : (
                <TemplateCard
                  key={tmpl.id}
                  template={tmpl}
                  onEdit={() => setEditingId(tmpl.id)}
                  onDelete={() => handleDelete(tmpl.id)}
                  onTest={() => testMutation.mutate(tmpl.id)}
                  isTesting={testMutation.isPending && testMutation.variables === tmpl.id}
                />
              ),
            )}
          </div>
        ) : !showNewForm ? (
          <div
            className="rounded-sm border bg-card text-center py-14 px-6"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                background: "var(--copper-soft)",
                border: "1px solid color-mix(in oklch, var(--accent), transparent 60%)",
              }}
            >
              <FileText style={{ width: 26, height: 26, color: "var(--accent)" }} />
            </div>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Empty
            </div>
            <p className="text-sm text-foreground mt-2" style={{ maxWidth: 420, margin: "8px auto 16px" }}>
              No prompt templates configured. Without templates, the default evaluation criteria
              will be used for every call.
            </p>
            <Button onClick={() => setShowNewForm(true)} size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> Create your first template
            </Button>
          </div>
        ) : null}
      </main>

      {/* Back-test results dialog */}
      <Dialog
        open={testResults !== null}
        onOpenChange={(open) => {
          if (!open) setTestResults(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Back-test
            </div>
            <DialogTitle>
              <span
                className="font-display font-medium"
                style={{ fontSize: 20, letterSpacing: "-0.3px" }}
              >
                {testResults?.templateName}
              </span>
            </DialogTitle>
            <p
              className="text-muted-foreground"
              style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 620 }}
            >
              Candidate template run against {testResults?.sampleSize ?? 0} recent completed calls
              in the
              <span
                className="mx-1 font-mono rounded-sm"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.02em",
                  padding: "2px 6px",
                  background: "var(--paper-2)",
                  border: "1px solid var(--border)",
                }}
              >
                {testResults?.callCategory}
              </span>
              category. Results are not persisted and did not affect stored analyses.
            </p>
          </DialogHeader>

          {testResults && testResults.sampleSize === 0 ? (
            <div className="py-10 text-center">
              <p
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                {testResults.message || "No calls available for testing"}
              </p>
            </div>
          ) : testResults ? (
            <div className="space-y-4">
              {/* Summary tiles */}
              <div
                className="grid grid-cols-4 gap-3 rounded-sm p-4"
                style={{ background: "var(--paper-2)" }}
              >
                <BackTestStat label="Current avg" value={testResults.summary.avgCurrentScore} />
                <BackTestStat label="Candidate avg" value={testResults.summary.avgTestScore} />
                <BackTestStat
                  label="Avg delta"
                  value={
                    testResults.summary.avgDelta !== null
                      ? (testResults.summary.avgDelta > 0 ? "+" : "") +
                        testResults.summary.avgDelta
                      : null
                  }
                  color={
                    testResults.summary.scoreDirection === "higher"
                      ? "var(--sage)"
                      : testResults.summary.scoreDirection === "lower"
                      ? "var(--amber)"
                      : "var(--muted-foreground)"
                  }
                />
                <BackTestStat
                  label="Successful runs"
                  value={`${testResults.summary.successfulRuns} / ${testResults.sampleSize}`}
                  isText
                />
              </div>

              {/* Per-call results */}
              <div className="space-y-2">
                {testResults.results.map((r) => (
                  <div
                    key={r.callId}
                    className="rounded-sm border bg-card p-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between mb-1.5 gap-3">
                      <span
                        className="font-mono text-muted-foreground truncate max-w-[60%]"
                        style={{ fontSize: 11, letterSpacing: "0.02em" }}
                        title={r.fileName || r.callId}
                      >
                        {r.fileName || r.callId}
                      </span>
                      {r.error ? (
                        <DeltaPill tone="neutral">Error</DeltaPill>
                      ) : r.delta !== null ? (
                        <DeltaPill
                          tone={r.delta > 0.1 ? "sage" : r.delta < -0.1 ? "amber" : "neutral"}
                        >
                          {r.delta > 0 ? "+" : ""}
                          {r.delta}
                        </DeltaPill>
                      ) : null}
                    </div>
                    {r.error ? (
                      <p className="text-xs text-muted-foreground">{r.error}</p>
                    ) : (
                      <div
                        className="flex items-center gap-3 font-mono tabular-nums text-foreground"
                        style={{ fontSize: 12, letterSpacing: "0.02em" }}
                      >
                        <span>
                          <span className="text-muted-foreground">Current</span>{" "}
                          {r.currentScore ?? "—"}
                        </span>
                        <span className="text-muted-foreground/60">→</span>
                        <span>
                          <span className="text-muted-foreground">Candidate</span>{" "}
                          {r.testScore ?? "—"}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestResults(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onTest,
  isTesting,
}: {
  template: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  isTesting: boolean;
}) {
  const category = CALL_CATEGORIES.find((c) => c.value === template.callCategory);
  const weights = template.scoringWeights;
  const phrases = (template.requiredPhrases as PhraseEntry[]) || [];

  return (
    <div className="rounded-sm border bg-card" style={{ borderColor: "var(--border)" }}>
      {/* Header row */}
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3 border-b border-border">
        <div className="min-w-0">
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            {category?.label || template.callCategory}
          </div>
          <div
            className="font-display font-medium text-foreground mt-1 flex items-center gap-2 flex-wrap"
            style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
          >
            {template.name}
            {template.isActive ? (
              <PromptStatusPill tone="sage">Active</PromptStatusPill>
            ) : (
              <PromptStatusPill tone="neutral">Inactive</PromptStatusPill>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={isTesting}
            title="Back-test this template against the last 5 completed calls in its category"
          >
            <Flask className="w-3.5 h-3.5 mr-1" /> {isTesting ? "Testing…" : "Test"}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <PencilSimple className="w-3.5 h-3.5 mr-1" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDelete}
            style={{
              color: "var(--destructive)",
              borderColor: "color-mix(in oklch, var(--destructive), transparent 60%)",
            }}
          >
            <Trash className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Evaluation criteria */}
        <PromptSection icon={Scales} label="Evaluation criteria">
          <p
            className="text-foreground whitespace-pre-wrap"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {template.evaluationCriteria}
          </p>
        </PromptSection>

        {/* Scoring weights */}
        {weights && (
          <PromptSection label="Scoring weights">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(weights).map(([key, val]) => (
                <div
                  key={key}
                  className="rounded-sm px-3 py-2.5"
                  style={{ background: "var(--paper-2)", border: "1px solid var(--border)" }}
                >
                  <div
                    className="font-mono uppercase text-muted-foreground"
                    style={{ fontSize: 9, letterSpacing: "0.12em" }}
                  >
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </div>
                  <div
                    className="font-display font-medium tabular-nums text-foreground mt-0.5"
                    style={{ fontSize: 20, lineHeight: 1, letterSpacing: "-0.3px" }}
                  >
                    {val as number}
                    <span
                      className="font-mono text-muted-foreground ml-0.5"
                      style={{ fontSize: 11, letterSpacing: "0.02em" }}
                    >
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </PromptSection>
        )}

        {/* Required phrases */}
        {phrases.length > 0 && (
          <PromptSection icon={ShieldCheck} label={`Required / recommended phrases · ${phrases.length}`}>
            <ul className="space-y-1.5">
              {phrases.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ lineHeight: 1.5 }}>
                  <PromptStatusPill tone={p.severity === "required" ? "accent" : "neutral"}>
                    {p.severity}
                  </PromptStatusPill>
                  <span className="text-foreground italic">&ldquo;{p.phrase}&rdquo;</span>
                  <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                    — {p.label}
                  </span>
                </li>
              ))}
            </ul>
          </PromptSection>
        )}

        {/* Additional instructions */}
        {template.additionalInstructions && (
          <PromptSection icon={Chat} label="Additional instructions">
            <p
              className="text-foreground whitespace-pre-wrap"
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              {template.additionalInstructions}
            </p>
          </PromptSection>
        )}

        {template.updatedAt && (
          <p
            className="font-mono uppercase text-muted-foreground pt-3 border-t border-border"
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            Last updated {new Date(template.updatedAt).toLocaleDateString()}
            {template.updatedBy ? ` · ${template.updatedBy}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function TemplateForm({
  initial,
  onSave,
  onCancel,
  isPending,
  usedCategories,
}: {
  initial?: PromptTemplate;
  onSave: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
  usedCategories: Set<string>;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [callCategory, setCallCategory] = useState(initial?.callCategory || "");
  const [evaluationCriteria, setEvaluationCriteria] = useState(initial?.evaluationCriteria || "");
  const [additionalInstructions, setAdditionalInstructions] = useState(initial?.additionalInstructions || "");
  const [isActive, setIsActive] = useState(initial?.isActive !== false);
  const [weights, setWeights] = useState<ScoringWeights>(
    initial?.scoringWeights || { ...DEFAULT_WEIGHTS }
  );
  const [phrases, setPhrases] = useState<PhraseEntry[]>(
    (initial?.requiredPhrases as PhraseEntry[]) || []
  );

  const updateWeight = (key: keyof ScoringWeights, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }));
  };

  const addPhrase = () => {
    setPhrases(prev => [...prev, { phrase: "", label: "", severity: "required" }]);
  };

  const updatePhrase = (index: number, updates: Partial<PhraseEntry>) => {
    setPhrases(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
  };

  const removePhrase = (index: number) => {
    setPhrases(prev => prev.filter((_, i) => i !== index));
  };

  const totalWeight = weights.compliance + weights.customerExperience + weights.communication + weights.resolution;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      callCategory,
      evaluationCriteria,
      additionalInstructions: additionalInstructions || undefined,
      isActive,
      scoringWeights: weights,
      requiredPhrases: phrases.filter(p => p.phrase.trim()),
    });
  };

  return (
    <div
      className="rounded-sm border bg-card"
      style={{
        borderColor: "color-mix(in oklch, var(--accent), transparent 60%)",
      }}
    >
      <div className="px-6 pt-5 pb-3 border-b border-border">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.14em" }}
        >
          {initial ? "Edit" : "New"}
        </div>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {initial ? "Edit template" : "New prompt template"}
        </div>
        <p className="text-muted-foreground mt-1.5" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Configure how the AI evaluates calls for this category.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <PromptFieldLabel htmlFor="tmpl-name">Template name</PromptFieldLabel>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Medicare Compliance Rubric"
              required
            />
          </div>
          <div>
            <PromptFieldLabel htmlFor="tmpl-cat">Call category</PromptFieldLabel>
            <Select value={callCategory} onValueChange={setCallCategory} required>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CALL_CATEGORIES.map((cat) => (
                  <SelectItem
                    key={cat.value}
                    value={cat.value}
                    disabled={
                      usedCategories.has(cat.value) && initial?.callCategory !== cat.value
                    }
                  >
                    {cat.label}
                    {usedCategories.has(cat.value) && initial?.callCategory !== cat.value
                      ? " (has template)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <PromptFieldLabel htmlFor="tmpl-criteria">Evaluation criteria</PromptFieldLabel>
          <p
            className="text-muted-foreground mb-1.5"
            style={{ fontSize: 11, lineHeight: 1.5 }}
          >
            What should the AI evaluate the agent on? Be specific about your company's standards.
          </p>
          <textarea
            id="tmpl-criteria"
            className="w-full border border-input rounded-sm p-3 text-sm bg-background min-h-[140px] resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={evaluationCriteria}
            onChange={(e) => setEvaluationCriteria(e.target.value)}
            placeholder={`Example:\n- Compliance with Medicare regulations and required disclosures (40%)\n- Customer empathy and satisfaction (25%)\n- Accuracy of information provided (20%)\n- Call efficiency and resolution (15%)\n- De-escalation effectiveness when customer is frustrated`}
            required
          />
        </div>

        {/* Scoring weights */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <PromptFieldLabel>Scoring weights</PromptFieldLabel>
            <div
              className="font-mono uppercase tabular-nums"
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                color:
                  totalWeight === 100 ? "var(--sage)" : "var(--destructive)",
              }}
            >
              Total {totalWeight}%
              {totalWeight !== 100 ? " · should be 100%" : ""}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(weights) as Array<keyof ScoringWeights>).map((key) => (
              <div key={key}>
                <label
                  className="font-mono uppercase text-muted-foreground block mb-1"
                  style={{ fontSize: 9, letterSpacing: "0.12em" }}
                >
                  {key.replace(/([A-Z])/g, " $1").trim()}
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[key]}
                  onChange={(e) => updateWeight(key, parseInt(e.target.value) || 0)}
                  className="h-9 text-sm tabular-nums font-mono"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Required phrases */}
        <div>
          <div className="flex items-end justify-between mb-2 gap-3">
            <div>
              <PromptFieldLabel>Required / recommended phrases</PromptFieldLabel>
              <p
                className="text-muted-foreground"
                style={{ fontSize: 11, lineHeight: 1.5 }}
              >
                Phrases agents must say. AI flags calls missing required phrases.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addPhrase}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add phrase
            </Button>
          </div>
          {phrases.length > 0 && (
            <div className="space-y-2">
              {phrases.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={p.severity}
                    onValueChange={(v) =>
                      updatePhrase(i, { severity: v as "required" | "recommended" })
                    }
                  >
                    <SelectTrigger className="w-36 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="required">Required</SelectItem>
                      <SelectItem value="recommended">Recommended</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Phrase (e.g. 'calling on a recorded line')"
                    value={p.phrase}
                    onChange={(e) => updatePhrase(i, { phrase: e.target.value })}
                    className="flex-1 h-9 text-sm"
                  />
                  <Input
                    placeholder="Label"
                    value={p.label}
                    onChange={(e) => updatePhrase(i, { label: e.target.value })}
                    className="w-44 h-9 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removePhrase(i)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Additional instructions */}
        <div>
          <PromptFieldLabel htmlFor="tmpl-extra">Additional instructions</PromptFieldLabel>
          <p
            className="text-muted-foreground mb-1.5"
            style={{ fontSize: 11, lineHeight: 1.5 }}
          >
            Optional. Any other instructions for the AI when analyzing this type of call.
          </p>
          <textarea
            id="tmpl-extra"
            className="w-full border border-input rounded-sm p-3 text-sm bg-background min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            placeholder="Any other instructions for the AI when analyzing this type of call..."
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded-sm"
            />
            <span>
              Active{" "}
              <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                (template applies to new calls)
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !name || !callCategory || !evaluationCriteria}
            >
              <FloppyDisk className="w-4 h-4 mr-1.5" />
              {initial ? "Update template" : "Create template"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline helpers
// ─────────────────────────────────────────────────────────────
function PromptFieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono uppercase text-muted-foreground block mb-1.5"
      style={{ fontSize: 10, letterSpacing: "0.12em" }}
    >
      {children}
    </label>
  );
}

function PromptStatusPill({
  tone,
  children,
}: {
  tone: "sage" | "accent" | "neutral";
  children: React.ReactNode;
}) {
  const palette = {
    sage: {
      bg: "var(--sage-soft)",
      border: "color-mix(in oklch, var(--sage), transparent 55%)",
      color: "var(--sage)",
    },
    accent: {
      bg: "var(--copper-soft)",
      border: "color-mix(in oklch, var(--accent), transparent 55%)",
      color: "var(--accent)",
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
        fontSize: 9,
        letterSpacing: "0.1em",
        padding: "2px 7px",
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

function PromptSection({
  icon: IconComp,
  label,
  children,
}: {
  icon?: Icon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground flex items-center gap-1.5 mb-2"
        style={{ fontSize: 10, letterSpacing: "0.12em" }}
      >
        {IconComp && <IconComp style={{ width: 11, height: 11 }} />}
        {label}
      </div>
      {children}
    </div>
  );
}

function BackTestStat({
  label,
  value,
  color,
  isText,
}: {
  label: string;
  value: number | string | null;
  color?: string;
  isText?: boolean;
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
        className={`font-display font-medium mt-0.5 ${isText ? "" : "tabular-nums"}`}
        style={{
          fontSize: 20,
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

function DeltaPill({
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
      className="font-mono tabular-nums inline-flex items-center rounded-sm shrink-0"
      style={{
        fontSize: 11,
        letterSpacing: "0.02em",
        padding: "2px 8px",
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

function ErrorBanner({ message }: { message: string }) {
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
