/**
 * @deprecated The weekly-changes narrative now renders inline inside the
 * Ledger / Pulse dashboard variants (as the AI briefing + manager hero).
 * Not rendered by any active page after design theme installment 2.
 * Kept in-repo for one release cycle.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowUp, ArrowDown, TrendUp, Warning, Star } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * WeeklyChangesWidget
 *
 * Surfaces a "what changed this week" narrative on the dashboard. Compares the
 * current 7-day window to the previous 7-day window and calls out score deltas,
 * top agent movers, flag counts, and a few noteworthy calls.
 *
 * Backed by GET /api/dashboard/weekly-changes.
 */

interface AgentDelta {
  employeeId: string;
  employeeName: string;
  currentAvg: number;
  previousAvg: number;
  delta: number;
  currentCount: number;
  previousCount: number;
}

interface FlagPair {
  current: number;
  previous: number;
}

interface NoteworthyCall {
  callId: string;
  fileName: string | null;
  score: number | null;
  employeeName: string | null;
  kind: "exceptional" | "regression" | "flag";
}

interface WeeklyChangesResponse {
  windowDays: number;
  currentWeek: { callCount: number; avgScore: number | null; positivePct: number | null; start: string; end: string };
  previousWeek: { callCount: number; avgScore: number | null; positivePct: number | null; start: string; end: string };
  scoreDelta: number | null;
  positiveDelta: number | null;
  topImprovers: AgentDelta[];
  topRegressions: AgentDelta[];
  flags: {
    lowScore: FlagPair;
    exceptional: FlagPair;
    agentMisconduct: FlagPair;
    missingRequiredPhrase: FlagPair;
    promptInjection: FlagPair;
  };
  noteworthy: NoteworthyCall[];
  narrative: string;
}

export default function WeeklyChangesWidget() {
  const { data, isLoading, error } = useQuery<WeeklyChangesResponse>({
    queryKey: ["/api/dashboard/weekly-changes"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">This week in review</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data || !data.currentWeek || !data.previousWeek || !data.flags) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">This week in review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load weekly changes.</p>
        </CardContent>
      </Card>
    );
  }

  const scoreDeltaClass = data.scoreDelta === null
    ? "text-muted-foreground"
    : Math.abs(data.scoreDelta) < 0.1
      ? "text-muted-foreground"
      : data.scoreDelta > 0
        ? "text-green-600 dark:text-green-400"
        : "text-amber-600 dark:text-amber-400";

  const flagDelta = (pair: FlagPair): string => {
    const delta = pair.current - pair.previous;
    if (delta === 0) return "±0";
    return delta > 0 ? `+${delta}` : String(delta);
  };

  return (
    <Card data-testid="weekly-changes-widget">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendUp className="w-4 h-4 text-primary" />
              This week in review
            </CardTitle>
            <CardDescription className="text-xs">
              {data.currentWeek.callCount} calls this week vs {data.previousWeek.callCount} last week
            </CardDescription>
          </div>
          {data.scoreDelta !== null && Math.abs(data.scoreDelta) >= 0.1 && (
            <div className={`flex items-center gap-1 text-sm font-semibold ${scoreDeltaClass}`}>
              {data.scoreDelta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(data.scoreDelta)}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Narrative */}
        <p className="text-sm text-foreground" role="status">{data.narrative}</p>

        {/* Summary grid */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="p-2 bg-muted/40 rounded">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg score</p>
            <p className="text-lg font-bold">{data.currentWeek.avgScore ?? "—"}</p>
            {data.scoreDelta !== null && (
              <p className={`text-[10px] ${scoreDeltaClass}`}>
                {data.scoreDelta > 0 ? "+" : ""}{data.scoreDelta} vs last week
              </p>
            )}
          </div>
          <div className="p-2 bg-muted/40 rounded">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Positive %</p>
            <p className="text-lg font-bold">{data.currentWeek.positivePct !== null ? `${data.currentWeek.positivePct}%` : "—"}</p>
            {data.positiveDelta !== null && (
              <p className={`text-[10px] ${data.positiveDelta > 0 ? "text-green-600 dark:text-green-400" : data.positiveDelta < 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {data.positiveDelta > 0 ? "+" : ""}{data.positiveDelta} pts
              </p>
            )}
          </div>
          <div className="p-2 bg-muted/40 rounded">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Low scores</p>
            <p className="text-lg font-bold">{data.flags.lowScore.current}</p>
            <p className={`text-[10px] ${data.flags.lowScore.current > data.flags.lowScore.previous ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {flagDelta(data.flags.lowScore)} vs last week
            </p>
          </div>
        </div>

        {/* Movers */}
        {(data.topImprovers.length > 0 || data.topRegressions.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {data.topImprovers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1">
                  <ArrowUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                  Top improvers
                </p>
                <ul className="space-y-1 text-xs">
                  {data.topImprovers.map(a => (
                    <li key={a.employeeId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.employeeName}</span>
                      <Badge className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        +{a.delta}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.topRegressions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1">
                  <ArrowDown className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  Needs attention
                </p>
                <ul className="space-y-1 text-xs">
                  {data.topRegressions.map(a => (
                    <li key={a.employeeId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.employeeName}</span>
                      <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        {a.delta}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Noteworthy calls */}
        {data.noteworthy.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Noteworthy this week</p>
            <ul className="space-y-1 text-xs">
              {data.noteworthy.map(n => (
                <li key={n.callId} className="flex items-center gap-2">
                  {n.kind === "exceptional" ? (
                    <Star className="w-3 h-3 text-green-600 dark:text-green-400 shrink-0" />
                  ) : n.kind === "regression" ? (
                    <ArrowDown className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <Warning className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <Link href={`/transcripts/${n.callId}`} className="truncate hover:underline">
                    {n.fileName || n.callId}
                  </Link>
                  {n.score !== null && (
                    <span className="text-muted-foreground ml-auto">{n.score}/10</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
