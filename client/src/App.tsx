import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Upload from "@/pages/upload";
import Transcripts from "@/pages/transcripts";
import SentimentPage from "@/pages/sentiment";
import PerformancePage from "@/pages/performance";
import Search from "@/pages/search";
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/layout/sidebar";

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
          <Route path="/search" component={Search} />
          <Route path="/sentiment" component={SentimentPage} />
          <Route path="/performance" component={PerformancePage} /> 
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
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
