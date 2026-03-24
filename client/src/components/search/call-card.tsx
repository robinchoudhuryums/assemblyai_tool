import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "@/lib/i18n";
import type { CallWithDetails } from "@shared/schema";

interface CallCardProps {
  call: CallWithDetails;
  index: number;
}

export function CallCard({ call, index }: CallCardProps) {
  const { t } = useTranslation();

  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return <Badge variant="secondary">{t("call.unknown")}</Badge>;
    const variants: Record<string, "default" | "secondary" | "destructive"> = { positive: "default", neutral: "secondary", negative: "destructive" };
    return <Badge variant={variants[sentiment] || "secondary"}>{sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}</Badge>;
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <Badge variant="secondary">{t("call.unknown")}</Badge>;
    const colors: Record<string, string> = { completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" };
    return <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
  };

  const formatDuration = (seconds?: number | null) => {
    if (seconds === null || seconds === undefined) return t("call.na");
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const isProcessing = call.status === "processing" || call.status === "awaiting_analysis";

  return (
    <Card key={call.id} className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            {call.employee ? (
              <>
                <div
                  className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center"
                  aria-label={`${call.employee.name} initials`}
                >
                  <span className="text-primary font-semibold text-sm">{call.employee.initials ?? t("call.na")}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{call.employee.name ?? t("call.unknown")}</h3>
                  <p className="text-sm text-muted-foreground">{new Date(call.uploadedAt || "").toLocaleDateString()} • {formatDuration(call.duration)}</p>
                </div>
              </>
            ) : (
              <div>
                <h3 className="font-semibold text-foreground">{t("call.unassigned")}</h3>
                <p className="text-sm text-muted-foreground">{new Date(call.uploadedAt || "").toLocaleDateString()} • {formatDuration(call.duration)}</p>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {getSentimentBadge(call.sentiment?.overallSentiment)}
            {getStatusBadge(call.status)}
          </div>
        </div>
        {call.transcript?.text && (
          <div className="mb-4">
            <p className="text-sm text-muted-foreground line-clamp-2">{call.transcript.text}</p>
          </div>
        )}
        <div className="flex items-center justify-end">
          {isProcessing ? (
            <Button variant="outline" size="sm" disabled className="gap-1.5">
              <SpinnerGap className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              {t("status.processing")}
            </Button>
          ) : (
            <Link href={`/transcripts/${call.id}`}>
              <Button
                variant="outline"
                size="sm"
                disabled={call.status !== 'completed'}
                aria-label={`${t("call.viewDetails")} — ${call.employee?.name || t("call.unassigned")}`}
              >
                {t("call.viewDetails")}
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
