import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";
import type { ABTest } from "@shared/schema";
import { BEDROCK_MODEL_PRESETS } from "@shared/schema";
import { toDisplayString } from "@/lib/display-utils";

export function ScoreComparison({ label, baseline, test }: { label: string; baseline?: number; test?: number }) {
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

interface ABAnalysis {
  error?: string;
  performance_score?: number;
  sentiment?: string;
  sentiment_score?: number;
  summary?: string;
  sub_scores?: Record<string, number>;
  topics?: unknown[];
  action_items?: unknown[];
  feedback?: { strengths?: unknown[]; suggestions?: unknown[] };
  flags?: unknown[];
}

export function AnalysisPanel({ title, model, analysis, latencyMs }: {
  title: string;
  model: string;
  analysis: ABAnalysis | null;
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
        <div className="flex items-center gap-2">
          <Badge variant={analysis.sentiment === "positive" ? "default" : analysis.sentiment === "negative" ? "destructive" : "secondary"}>
            {analysis.sentiment || "unknown"}
          </Badge>
          <span className="text-xs text-muted-foreground">Score: {analysis.sentiment_score?.toFixed(2) ?? "—"}</span>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-1">Summary</h4>
          <p className="text-sm text-muted-foreground">{analysis.summary || "No summary"}</p>
        </div>

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

        {topics.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Topics</h4>
            <div className="flex flex-wrap gap-1">
              {topics.map((t: unknown, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">{toDisplayString(t)}</Badge>
              ))}
            </div>
          </div>
        )}

        {strengths.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Strengths</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {strengths.map((s: unknown, i: number) => (
                <li key={i}>+ {toDisplayString(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {suggestions.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Suggestions</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {suggestions.map((s: unknown, i: number) => (
                <li key={i}>- {toDisplayString(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {actionItems.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Action Items</h4>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {actionItems.map((a: unknown, i: number) => (
                <li key={i}>{i + 1}. {toDisplayString(a)}</li>
              ))}
            </ul>
          </div>
        )}

        {flags.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-1">Flags</h4>
            <div className="flex flex-wrap gap-1">
              {flags.map((f: unknown, i: number) => (
                <Badge key={i} variant="destructive" className="text-xs">{toDisplayString(f)}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TestResultView({ test }: { test: ABTest }) {
  const baselineLabel = BEDROCK_MODEL_PRESETS.find(m => m.value === test.baselineModel)?.label || test.baselineModel;
  const testLabel = BEDROCK_MODEL_PRESETS.find(m => m.value === test.testModel)?.label || test.testModel;

  const baseline = test.baselineAnalysis as ABAnalysis | null;
  const testAnalysis = test.testAnalysis as ABAnalysis | null;
  const hasScores = baseline && !baseline.error && testAnalysis && !testAnalysis.error;

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalysisPanel title="Baseline" model={baselineLabel} analysis={baseline} latencyMs={test.baselineLatencyMs} />
        <AnalysisPanel title="Test Model" model={testLabel} analysis={testAnalysis} latencyMs={test.testLatencyMs} />
      </div>
    </div>
  );
}
