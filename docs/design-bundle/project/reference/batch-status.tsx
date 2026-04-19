import { useQuery } from "@tanstack/react-query";
import { Pulse, ArrowsClockwise, CheckCircle, ClockClockwise, CloudArrowUp, Lightning, Timer, Warning } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingIndicator } from "@/components/ui/loading";

interface BatchStatusResponse {
  enabled: boolean;
  message?: string;
  currentMode?: "batch" | "immediate";
  schedule?: { start?: string; end?: string; description?: string };
  pendingItems?: number;
  activeJobs?: Array<{
    jobId: string;
    status: string;
    callCount: number;
    createdAt: string;
  }>;
  batchIntervalMinutes?: number;
  costSavings?: string;
  perUploadOverride?: string;
}

function formatRelative(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function JobStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    normalized === "completed"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : normalized === "failed" || normalized === "stopped" || normalized === "expired"
        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
        : normalized === "inprogress" || normalized === "submitted"
          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
          : "bg-muted-foreground/10 text-foreground";
  return <Badge className={variant}>{status}</Badge>;
}

export default function BatchStatusPage() {
  // Auto-refresh every 30s while the page is open so operators don't need
  // to remember to refresh. Uses the default queryFn (on401: returnNull).
  const { data, isLoading, error, refetch, isFetching } = useQuery<BatchStatusResponse>({
    queryKey: ["/api/admin/batch-status"],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingIndicator text="Loading batch status..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6 flex items-start gap-3">
            <Warning className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Failed to load batch status</p>
              <p className="text-sm text-muted-foreground mt-1">
                {(error as Error).message || "Unknown error"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  // Batch mode not enabled — show guidance
  if (!data.enabled) {
    return (
      <div className="min-h-screen" data-testid="batch-status-page">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <CloudArrowUp className="w-8 h-8 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-foreground">Batch Inference Status</h2>
              <p className="text-muted-foreground">AWS Bedrock batch mode for cost-optimized AI analysis</p>
            </div>
          </div>
        </header>
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Warning className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Batch mode is disabled</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {data.message || "Set BEDROCK_BATCH_MODE=true and BEDROCK_BATCH_ROLE_ARN in the server environment to enable deferred batch analysis (50% cost savings)."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const activeJobs = data.activeJobs ?? [];

  return (
    <div className="min-h-screen" data-testid="batch-status-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CloudArrowUp className="w-8 h-8 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-foreground">Batch Inference Status</h2>
              <p className="text-muted-foreground">AWS Bedrock batch jobs — {data.costSavings || "50% cost savings"}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <ArrowsClockwise className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Current mode + schedule */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Pulse className="w-4 h-4" /> Current mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {data.currentMode === "batch" ? (
                  <>
                    <ClockClockwise className="w-5 h-5 text-blue-600" />
                    <span className="text-xl font-semibold text-foreground">Batch</span>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Deferred</Badge>
                  </>
                ) : (
                  <>
                    <Lightning className="w-5 h-5 text-green-600" />
                    <span className="text-xl font-semibold text-foreground">Immediate</span>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">On-demand</Badge>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {data.schedule?.description || "Schedule not set"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Timer className="w-4 h-4" /> Pending items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{data.pendingItems ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Calls queued for the next batch cycle (every {data.batchIntervalMinutes ?? 15} min)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> Active jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{activeJobs.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeJobs.length === 0 ? "No in-flight batch jobs" : "Currently processing at AWS Bedrock"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active jobs list */}
        <Card>
          <CardHeader>
            <CardTitle>Active batch jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {activeJobs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No in-flight batch jobs. New jobs appear here when the scheduler submits them.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 font-medium">Job ID</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-right py-2 font-medium">Calls</th>
                      <th className="text-right py-2 font-medium">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeJobs.map(job => (
                      <tr key={job.jobId} className="border-b border-border/50">
                        <td className="py-2 font-mono text-xs text-muted-foreground truncate max-w-xs">
                          {job.jobId}
                        </td>
                        <td className="py-2">
                          <JobStatusBadge status={job.status} />
                        </td>
                        <td className="py-2 text-right font-medium">{job.callCount}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatRelative(job.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-6 space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">How it works:</strong> Uploaded calls queue for batch submission. Every {data.batchIntervalMinutes ?? 15} minutes the scheduler submits all pending items in a single JSONL file to AWS Bedrock. Completion typically within 24 hours.</p>
            {data.perUploadOverride && (
              <p><strong className="text-foreground">Override:</strong> {data.perUploadOverride}</p>
            )}
            <p className="text-xs">Auto-refreshes every 30 seconds.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
