import { Switch, Route } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Upload from "@/pages/upload";
import Transcripts from "@/pages/transcripts";
import PerformancePage from "@/pages/performance";
import SentimentPage from "@/pages/sentiment";
import ReportsPage from "@/pages/reports";
import SearchPage from "@/pages/search";
import EmployeesPage from "@/pages/employees";
import AuthPage from "@/pages/auth";
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { AudioWaveform } from "lucide-react";

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

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
          <Route path="/employees" component={EmployeesPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user, isLoading, error } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity, // Session doesn't change without user action
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || error) {
    return (
      <AuthPage
        onLogin={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        }}
      />
    );
  }

  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
