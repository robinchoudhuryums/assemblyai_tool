import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reusable error display for failed TanStack queries.
 * Shows the error message and a retry button.
 */
export function QueryError({ error, onRetry, compact }: {
  error: Error;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="truncate">{error.message}</span>
        <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2" onClick={onRetry}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
      <p className="font-medium text-foreground mb-1">Something went wrong</p>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">{error.message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw className="w-4 h-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}
