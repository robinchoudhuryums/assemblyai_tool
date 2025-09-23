import { useQuery } from "@tanstack/react-query";
import { Smile, Frown, Minus } from "lucide-react";

// Define a type for our sentiment data
interface SentimentData {
  positive: number;
  neutral: number;
  negative: number;
}

export default function SentimentPage() {
  // Fetch data from the existing dashboard sentiment endpoint
  const { data: sentiment, isLoading } = useQuery<SentimentData>({
    queryKey: ["/api/dashboard/sentiment"],
  });

  if (isLoading) {
    return <div>Loading sentiment data...</div>;
  }

  return (
    <div className="min-h-screen" data-testid="sentiment-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Sentiment Analysis</h2>
          <p className="text-muted-foreground">Overall sentiment distribution across all analyzed calls.</p>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Positive Sentiment Card */}
          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <Smile className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Positive Calls</p>
              <p className="text-3xl font-bold text-foreground">{sentiment?.positive ?? 0}</p>
            </div>
          </div>

          {/* Neutral Sentiment Card */}
          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
              <Minus className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Neutral Calls</p>
              <p className="text-3xl font-bold text-foreground">{sentiment?.neutral ?? 0}</p>
            </div>
          </div>

          {/* Negative Sentiment Card */}
          <div className="bg-card rounded-lg border border-border p-6 flex items-center space-x-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <Frown className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Negative Calls</p>
              <p className="text-3xl font-bold text-foreground">{sentiment?.negative ?? 0}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
