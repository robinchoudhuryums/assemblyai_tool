import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Upload from "@/pages/upload";
import Transcripts from "@/pages/transcripts";
import PerformancePage from "@/pages/performance";
import SentimentPage from "@/pages/sentiment";
import ReportsPage from "@/pages/reports";
import SearchPage from "@/pages/search"; // Using the simplified search page
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary"; // 1. Import the ErrorBoundary

function Router() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/upload" component={Upload} />
          <Route path="/transcripts" component={Transcripts} />
          <Route path="/transcripts/:id" component={Transcripts} />
          <Route path="/search" component={SearchPage} />
          <Route path="/performance" component={PerformancePage} />
          <Route path="/sentiment" component={SentimentPage} />
          <Route path="/reports" component={ReportsPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/* 2. Wrap the entire Router in the ErrorBoundary */}
        <ErrorBoundary>
          <Router />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

