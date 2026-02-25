import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { CallWithDetails } from "@shared/schema";

interface CallCardProps {
  call: CallWithDetails;
  index: number;
}

export function CallCard({ call, index }: CallCardProps) {
  const getSentimentBadge = (sentiment?: string) => {
    if (!sentiment) return <Badge variant="secondary">Unknown</Badge>;
    const variants: Record<string, any> = { positive: "default", neutral: "secondary", negative: "destructive" };
    return <Badge variant={variants[sentiment] || "secondary"}>{sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}</Badge>;
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return <Badge variant="secondary">Unknown</Badge>;
    const colors: Record<string, string> = { completed: "bg-green-100 text-green-800", processing: "bg-blue-100 text-blue-800", failed: "bg-red-100 text-red-800" };
    return <Badge className={colors[status] || "bg-gray-100 text-gray-800"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
  };

  const formatDuration = (seconds?: number | null) => {
    if (seconds === null || seconds === undefined) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Card key={call.id} className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            {call.employee ? (
              <>
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-primary font-semibold text-sm">{call.employee.initials ?? 'N/A'}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{call.employee.name ?? 'Unknown'}</h3>
                  <p className="text-sm text-muted-foreground">{new Date(call.uploadedAt || "").toLocaleDateString()} • {formatDuration(call.duration)}</p>
                </div>
              </>
            ) : (
              <div>
                <h3 className="font-semibold text-foreground">Unassigned</h3>
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
          <Link href={`/transcripts/${call.id}`}><Button variant="outline" size="sm" disabled={call.status !== 'completed'}>View Details</Button></Link>
        </div>
      </CardContent>
    </Card>
  );
}
