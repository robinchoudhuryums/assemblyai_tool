import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Chat, FileText, Flask, FloppyDisk, PencilSimple, Plus, Scales, ShieldCheck, Trash, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <div className="min-h-screen" data-testid="prompt-templates-page">
      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}
        title="Delete prompt template?"
        description="This will permanently remove this prompt template. New calls with this category will use the default evaluation criteria."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
      />
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Prompt Templates & Scoring Rubrics</h2>
            <p className="text-muted-foreground">Configure AI analysis criteria per call category for tailored evaluation</p>
          </div>
          <Button onClick={() => setShowNewForm(true)} disabled={showNewForm}>
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Info card */}
        <Card className="border-dashed bg-muted/30">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Templates customize how the AI evaluates calls for each category. Set weighted scoring criteria,
              required disclaimers/phrases that agents must say, and additional evaluation instructions.
              Templates apply automatically to new calls matching the configured category.
            </p>
          </CardContent>
        </Card>

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
          <Card><CardContent className="pt-6 text-center text-muted-foreground">
            <p className="font-medium">Failed to load templates</p>
            <p className="text-sm">{templatesError.message}</p>
          </CardContent></Card>
        ) : isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : templates && templates.length > 0 ? (
          <div className="space-y-4">
            {templates.map((tmpl) => (
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
              )
            ))}
          </div>
        ) : !showNewForm ? (
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-primary/60" />
            </div>
            <h4 className="font-semibold text-foreground mb-1">No prompt templates configured</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Create templates to customize how the AI evaluates calls for each category.
              Without templates, the default evaluation criteria will be used.
            </p>
            <Button onClick={() => setShowNewForm(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Template
            </Button>
          </div>
        ) : null}
      </div>

      {/* Back-test results dialog */}
      <Dialog open={testResults !== null} onOpenChange={(open) => { if (!open) setTestResults(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Back-test results: {testResults?.templateName}</DialogTitle>
            <DialogDescription>
              Candidate template run against {testResults?.sampleSize ?? 0} recent completed calls in the
              <span className="mx-1 font-mono">{testResults?.callCategory}</span>
              category. These results are not persisted and did not affect stored analyses.
            </DialogDescription>
          </DialogHeader>

          {testResults && testResults.sampleSize === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>{testResults.message || "No calls available for testing."}</p>
            </div>
          ) : testResults ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3 p-3 bg-muted/40 rounded-md">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Current avg</p>
                  <p className="text-lg font-bold">{testResults.summary.avgCurrentScore ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Candidate avg</p>
                  <p className="text-lg font-bold">{testResults.summary.avgTestScore ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg delta</p>
                  <p className={`text-lg font-bold ${
                    testResults.summary.scoreDirection === "higher" ? "text-green-600 dark:text-green-400" :
                    testResults.summary.scoreDirection === "lower" ? "text-amber-600 dark:text-amber-400" :
                    "text-muted-foreground"
                  }`}>
                    {testResults.summary.avgDelta !== null
                      ? (testResults.summary.avgDelta > 0 ? "+" : "") + testResults.summary.avgDelta
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Successful runs</p>
                  <p className="text-lg font-bold">{testResults.summary.successfulRuns} / {testResults.sampleSize}</p>
                </div>
              </div>

              {/* Per-call results */}
              <div className="space-y-2">
                {testResults.results.map((r) => (
                  <div key={r.callId} className="p-3 border border-border rounded-md text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-[60%]" title={r.fileName || r.callId}>
                        {r.fileName || r.callId}
                      </span>
                      {r.error ? (
                        <Badge variant="secondary" className="text-[10px]">Error</Badge>
                      ) : r.delta !== null ? (
                        <Badge className={`text-[10px] ${
                          r.delta > 0.1 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                          r.delta < -0.1 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {r.delta > 0 ? "+" : ""}{r.delta}
                        </Badge>
                      ) : null}
                    </div>
                    {r.error ? (
                      <p className="text-xs text-muted-foreground">{r.error}</p>
                    ) : (
                      <div className="flex gap-4 text-xs">
                        <span>Current: <span className="font-semibold">{r.currentScore ?? "—"}</span></span>
                        <span className="text-muted-foreground">→</span>
                        <span>Candidate: <span className="font-semibold">{r.testScore ?? "—"}</span></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestResults(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({ template, onEdit, onDelete, onTest, isTesting }: {
  template: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  isTesting: boolean;
}) {
  const category = CALL_CATEGORIES.find(c => c.value === template.callCategory);
  const weights = template.scoringWeights;
  const phrases = (template.requiredPhrases as PhraseEntry[]) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">{template.name}</CardTitle>
            <Badge variant="outline">{category?.label || template.callCategory}</Badge>
            {template.isActive ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onTest} disabled={isTesting} title="Back-test this template against the last 5 completed calls in its category">
              <Flask className="w-3 h-3 mr-1" /> {isTesting ? "Testing…" : "Test"}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilSimple className="w-3 h-3 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={onDelete}>
              <Trash className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Evaluation Criteria */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Scales className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium">Evaluation Criteria</p>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{template.evaluationCriteria}</p>
        </div>

        {/* Scoring Weights */}
        {weights && (
          <div>
            <p className="text-sm font-medium mb-2">Scoring Weights</p>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(weights).map(([key, val]) => (
                <div key={key} className="text-center p-2 bg-muted rounded-md">
                  <p className="text-lg font-bold text-foreground">{val as number}%</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Required Phrases */}
        {phrases.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-medium">Required/Recommended Phrases ({phrases.length})</p>
            </div>
            <div className="space-y-1">
              {phrases.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Badge variant={p.severity === "required" ? "default" : "secondary"} className="text-[10px]">
                    {p.severity}
                  </Badge>
                  <span className="text-muted-foreground">"{p.phrase}"</span>
                  <span className="text-xs text-muted-foreground">— {p.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Additional Instructions */}
        {template.additionalInstructions && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Chat className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-medium">Additional Instructions</p>
            </div>
            <p className="text-sm text-muted-foreground">{template.additionalInstructions}</p>
          </div>
        )}

        {template.updatedAt && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Last updated {new Date(template.updatedAt).toLocaleDateString()}
            {template.updatedBy ? ` by ${template.updatedBy}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
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
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-lg">{initial ? "Edit Template" : "New Prompt Template"}</CardTitle>
        <CardDescription>Configure how the AI evaluates calls for this category</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Template Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Medicare Compliance Rubric" required />
            </div>
            <div>
              <label className="text-sm font-medium">Call Category</label>
              <Select value={callCategory} onValueChange={setCallCategory} required>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CALL_CATEGORIES.map(cat => (
                    <SelectItem
                      key={cat.value}
                      value={cat.value}
                      disabled={usedCategories.has(cat.value) && initial?.callCategory !== cat.value}
                    >
                      {cat.label} {usedCategories.has(cat.value) && initial?.callCategory !== cat.value ? "(has template)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Evaluation Criteria</label>
            <p className="text-xs text-muted-foreground mb-1">What should the AI evaluate the agent on? Be specific about your company's standards.</p>
            <textarea
              className="w-full border border-border rounded-md p-3 text-sm bg-background min-h-[120px] resize-y"
              value={evaluationCriteria}
              onChange={e => setEvaluationCriteria(e.target.value)}
              placeholder={`Example:\n- Compliance with Medicare regulations and required disclosures (40%)\n- Customer empathy and satisfaction (25%)\n- Accuracy of information provided (20%)\n- Call efficiency and resolution (15%)\n- De-escalation effectiveness when customer is frustrated`}
              required
            />
          </div>

          {/* Scoring Weights */}
          <div>
            <label className="text-sm font-medium">Scoring Weights</label>
            <p className="text-xs text-muted-foreground mb-2">
              How much each area contributes to the overall score. Total: {totalWeight}%
              {totalWeight !== 100 && <span className="text-red-500 ml-1">(should be 100%)</span>}
            </p>
            <div className="grid grid-cols-4 gap-3">
              {(Object.keys(weights) as Array<keyof ScoringWeights>).map(key => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={weights[key]}
                    onChange={e => updateWeight(key, parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Required Phrases */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-sm font-medium">Required / Recommended Phrases</label>
                <p className="text-xs text-muted-foreground">Phrases agents must say. AI flags calls missing required phrases.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addPhrase}>
                <Plus className="w-3 h-3 mr-1" /> Add Phrase
              </Button>
            </div>
            {phrases.length > 0 && (
              <div className="space-y-2">
                {phrases.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={p.severity} onValueChange={v => updatePhrase(i, { severity: v as "required" | "recommended" })}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="required">Required</SelectItem>
                        <SelectItem value="recommended">Recommended</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Phrase (e.g. 'calling on a recorded line')"
                      value={p.phrase}
                      onChange={e => updatePhrase(i, { phrase: e.target.value })}
                      className="flex-1 h-8 text-sm"
                    />
                    <Input
                      placeholder="Label"
                      value={p.label}
                      onChange={e => updatePhrase(i, { label: e.target.value })}
                      className="w-40 h-8 text-sm"
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => removePhrase(i)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Instructions */}
          <div>
            <label className="text-sm font-medium">Additional Instructions (optional)</label>
            <textarea
              className="w-full border border-border rounded-md p-3 text-sm bg-background min-h-[80px] resize-y"
              value={additionalInstructions}
              onChange={e => setAdditionalInstructions(e.target.value)}
              placeholder="Any other instructions for the AI when analyzing this type of call..."
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
              Active (template applies to new calls)
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
              <Button type="submit" disabled={isPending || !name || !callCategory || !evaluationCriteria}>
                <FloppyDisk className="w-4 h-4 mr-2" />
                {initial ? "Update" : "Create"} Template
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
