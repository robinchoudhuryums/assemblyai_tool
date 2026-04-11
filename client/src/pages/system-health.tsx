import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle,
  Warning,
  XCircle,
  Heartbeat,
  Database,
  Cloud,
  Brain,
  ArrowsClockwise,
  ChartLine,
  ShieldCheck,
} from "@phosphor-icons/react";

interface SubsystemHealth {
  auditLog: { droppedEntries: number; pendingEntries: number; healthy: boolean };
  jobQueue: { pending: number; running: number; completedToday: number; failedToday: number; backend: string };
  bedrockAI: { circuitState: string; healthy: boolean };
  ragKnowledgeBase: { enabled: boolean; cache?: { hits: number; misses: number; hitRate: string; entries: number; maxEntries: number } };
  batchInference: { enabled: boolean };
  scoringQuality: { total: number; upgrades: number; downgrades: number; avgDelta: number; alerts: Array<{ type: string; severity: string; message: string; timestamp: string }> };
  calibration: { lastSnapshot: string | null; driftDetected: boolean };
  telephony8x8: { enabled: boolean };
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  issues: string[];
  subsystems: SubsystemHealth;
}

const STATUS_STYLES = {
  healthy: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", icon: CheckCircle },
  degraded: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-400", icon: Warning },
  unhealthy: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-400", icon: XCircle },
};

function StatusBadge({ status }: { status: "healthy" | "degraded" | "unhealthy" | boolean }) {
  const resolved = typeof status === "boolean" ? (status ? "healthy" : "degraded") : status;
  const style = STATUS_STYLES[resolved];
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className="w-3 h-3" weight="fill" />
      {resolved.charAt(0).toUpperCase() + resolved.slice(1)}
    </span>
  );
}

export default function SystemHealthPage() {
  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ["/api/admin/health-deep"],
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Heartbeat className="w-6 h-6" />
              System Health
            </h2>
            <p className="text-muted-foreground">Operational status across all subsystems</p>
          </div>
          {data && <StatusBadge status={data.status} />}
        </div>
      </header>

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              <XCircle className="w-10 h-10 mx-auto mb-2" />
              <p>Failed to load system health data.</p>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            {/* Issues banner */}
            {data.issues.length > 0 && (
              <Card className="border-yellow-200 dark:border-yellow-800">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <Warning className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-yellow-800 dark:text-yellow-400">Active Issues</p>
                      <ul className="mt-1 space-y-1">
                        {data.issues.map((issue, i) => (
                          <li key={i} className="text-sm text-yellow-700 dark:text-yellow-300">{issue}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Subsystem cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Audit Log */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Audit Log</span>
                    <StatusBadge status={data.subsystems.auditLog.healthy} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Pending entries</span><span>{data.subsystems.auditLog.pendingEntries}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Dropped entries</span><span className={data.subsystems.auditLog.droppedEntries > 0 ? "text-red-600 font-medium" : ""}>{data.subsystems.auditLog.droppedEntries}</span></div>
                </CardContent>
              </Card>

              {/* Job Queue */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Database className="w-4 h-4" /> Job Queue</span>
                    <Badge variant="outline" className="text-xs">{data.subsystems.jobQueue.backend}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Pending</span><span>{data.subsystems.jobQueue.pending}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Running</span><span>{data.subsystems.jobQueue.running}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Completed today</span><span className="text-green-600">{data.subsystems.jobQueue.completedToday}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Failed today</span><span className={data.subsystems.jobQueue.failedToday > 0 ? "text-red-600 font-medium" : ""}>{data.subsystems.jobQueue.failedToday}</span></div>
                </CardContent>
              </Card>

              {/* Bedrock AI */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Brain className="w-4 h-4" /> Bedrock AI</span>
                    <StatusBadge status={data.subsystems.bedrockAI.healthy} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Circuit breaker</span>
                    <Badge variant={data.subsystems.bedrockAI.circuitState === "closed" ? "outline" : "destructive"} className="text-xs">
                      {data.subsystems.bedrockAI.circuitState}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* RAG Knowledge Base */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Cloud className="w-4 h-4" /> RAG Knowledge Base
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {data.subsystems.ragKnowledgeBase.enabled && data.subsystems.ragKnowledgeBase.cache ? (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Hit rate</span><span className="font-medium">{data.subsystems.ragKnowledgeBase.cache.hitRate}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Cache entries</span><span>{data.subsystems.ragKnowledgeBase.cache.entries}/{data.subsystems.ragKnowledgeBase.cache.maxEntries}</span></div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Disabled</p>
                  )}
                </CardContent>
              </Card>

              {/* Scoring Quality */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><ChartLine className="w-4 h-4" /> Scoring Quality</span>
                    {data.subsystems.scoringQuality.alerts.length > 0 && (
                      <Badge variant="destructive" className="text-xs">{data.subsystems.scoringQuality.alerts.length} alert(s)</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total corrections</span><span>{data.subsystems.scoringQuality.total}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Upgrades / Downgrades</span><span>{data.subsystems.scoringQuality.upgrades} / {data.subsystems.scoringQuality.downgrades}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Avg delta</span><span>{data.subsystems.scoringQuality.avgDelta}</span></div>
                  {data.subsystems.scoringQuality.alerts.map((alert, i) => (
                    <div key={i} className={`mt-2 p-2 rounded text-xs ${alert.severity === "critical" ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" : "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400"}`}>
                      {alert.message}
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Calibration */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowsClockwise className="w-4 h-4" /> Calibration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last snapshot</span>
                    <span>{data.subsystems.calibration.lastSnapshot ? new Date(data.subsystems.calibration.lastSnapshot).toLocaleDateString() : "Never"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Drift detected</span>
                    {data.subsystems.calibration.driftDetected
                      ? <Badge variant="destructive" className="text-xs">Yes</Badge>
                      : <span className="text-green-600">No</span>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <p className="text-xs text-muted-foreground text-right">
              Last updated: {new Date(data.timestamp).toLocaleTimeString()} (auto-refreshes every 30s)
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
