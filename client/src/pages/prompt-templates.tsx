import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileText, Scale, ShieldCheck, MessageSquare, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CALL_CATEGORIES } from "@shared/schema";
import type { PromptTemplate } from "@shared/schema";

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

  const { data: templates, isLoading } = useQuery<PromptTemplate[]>({
    queryKey: ["/api/prompt-templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
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
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
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
    if (window.confirm("Delete this prompt template?")) {
      deleteMutation.mutate(id);
    }
  };

  // Categories that don't have templates yet
  const usedCategories = new Set((templates || []).map(t => t.callCategory));

  return (
    <div className="min-h-screen" data-testid="prompt-templates-page">
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
        {isLoading ? (
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
    </div>
  );
}

function TemplateCard({ template, onEdit, onDelete }: { template: PromptTemplate; onEdit: () => void; onDelete: () => void }) {
  const category = CALL_CATEGORIES.find(c => c.value === template.callCategory);
  const weights = template.scoringWeights as any;
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
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={onDelete}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Evaluation Criteria */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-muted-foreground" />
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
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
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
    (initial?.scoringWeights as any) || { ...DEFAULT_WEIGHTS }
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
                    <Select value={p.severity} onValueChange={v => updatePhrase(i, { severity: v as any })}>
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
                <Save className="w-4 h-4 mr-2" />
                {initial ? "Update" : "Create"} Template
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
