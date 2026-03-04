import { useEffect, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { AudioWaveform } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { AnimatePresence, motion } from "framer-motion";

// Route-level code splitting — each page loads on demand
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Upload = lazy(() => import("@/pages/upload"));
const Transcripts = lazy(() => import("@/pages/transcripts"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const SentimentPage = lazy(() => import("@/pages/sentiment"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const SearchPage = lazy(() => import("@/pages/search"));
const EmployeesPage = lazy(() => import("@/pages/employees"));
const AdminPage = lazy(() => import("@/pages/admin"));
const PromptTemplatesPage = lazy(() => import("@/pages/prompt-templates"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const CoachingPage = lazy(() => import("@/pages/coaching"));
const AuthPage = lazy(() => import("@/pages/auth"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <AudioWaveform className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeInOut" },
};

function AnimatedPage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...pageTransition}>
      {children}
    </motion.div>
  );
}

function Router() {
  const [location, navigate] = useLocation();

  // WebSocket listener for real-time notifications
  useWebSocket();

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          navigate("/search");
          break;
        case "n":
          e.preventDefault();
          navigate("/upload");
          break;
        case "d":
          e.preventDefault();
          navigate("/");
          break;
        case "r":
          e.preventDefault();
          navigate("/reports");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Suspense fallback={<PageLoader />}>
          <AnimatePresence mode="wait">
            <Switch key={location}>
              <Route path="/">{() => <AnimatedPage><Dashboard /></AnimatedPage>}</Route>
              <Route path="/upload">{() => <AnimatedPage><Upload /></AnimatedPage>}</Route>
              <Route path="/transcripts">{() => <AnimatedPage><Transcripts /></AnimatedPage>}</Route>
              <Route path="/transcripts/:id">{() => <AnimatedPage><Transcripts /></AnimatedPage>}</Route>
              <Route path="/search">{() => <AnimatedPage><SearchPage /></AnimatedPage>}</Route>
              <Route path="/performance">{() => <AnimatedPage><PerformancePage /></AnimatedPage>}</Route>
              <Route path="/sentiment">{() => <AnimatedPage><SentimentPage /></AnimatedPage>}</Route>
              <Route path="/reports">{() => <AnimatedPage><ReportsPage /></AnimatedPage>}</Route>
              <Route path="/employees">{() => <AnimatedPage><EmployeesPage /></AnimatedPage>}</Route>
              <Route path="/insights">{() => <AnimatedPage><InsightsPage /></AnimatedPage>}</Route>
              <Route path="/coaching">{() => <AnimatedPage><CoachingPage /></AnimatedPage>}</Route>
              <Route path="/admin">{() => <AnimatedPage><AdminPage /></AnimatedPage>}</Route>
              <Route path="/admin/templates">{() => <AnimatedPage><PromptTemplatesPage /></AnimatedPage>}</Route>
              <Route>{() => <AnimatedPage><NotFound /></AnimatedPage>}</Route>
            </Switch>
          </AnimatePresence>
        </Suspense>
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user, isLoading, error } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: Infinity,
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
      <Suspense fallback={<PageLoader />}>
        <AuthPage
          onLogin={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          }}
        />
      </Suspense>
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
