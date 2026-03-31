import { useEffect, useState, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn, resetSessionExpired } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import I18nProvider from "@/components/i18n-provider";
import AppearanceProvider from "@/components/appearance-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { LoadingIndicator } from "@/components/ui/loading";
import { useWebSocket, type ConnectionState } from "@/hooks/use-websocket";
import { AnimatePresence, motion } from "framer-motion";
import { useAppearance } from "@/components/appearance-provider";
import HexBackground from "@/components/hex-background";
import SoftWavesBackground from "@/components/bg-soft-waves";
import NeonFlowBackground from "@/components/bg-neon-flow";
import TopoMeshBackground from "@/components/bg-topo-mesh";

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
const ABTestingPage = lazy(() => import("@/pages/ab-testing"));
const SpendTrackingPage = lazy(() => import("@/pages/spend-tracking"));
const AgentScorecardPage = lazy(() => import("@/pages/agent-scorecard"));
const TeamAnalyticsPage = lazy(() => import("@/pages/team-analytics"));
const AgentComparePage = lazy(() => import("@/pages/agent-compare"));
const HeatmapCalendarPage = lazy(() => import("@/pages/heatmap-calendar"));
const CallClustersPage = lazy(() => import("@/pages/call-clusters"));
const MyPerformancePage = lazy(() => import("@/pages/my-performance"));
const SecurityPage = lazy(() => import("@/pages/security"));
const LeaderboardPage = lazy(() => import("@/pages/leaderboard"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const AuthPage = lazy(() => import("@/pages/auth"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingIndicator />
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
    <motion.div className="relative z-10" {...pageTransition}>
      {children}
    </motion.div>
  );
}

const KEYBOARD_SHORTCUTS = [
  { key: "D", description: "Go to Dashboard" },
  { key: "K", description: "Go to Search" },
  { key: "N", description: "Upload new call" },
  { key: "R", description: "Go to Reports" },
  { key: "?", description: "Show this help" },
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {KEYBOARD_SHORTCUTS.map(({ key, description }) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">{description}</span>
              <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border border-border">{key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackgroundLayer() {
  const { background } = useAppearance();
  switch (background) {
    case "hexagons": return <HexBackground />;
    case "softWaves": return <SoftWavesBackground />;
    case "neonFlow": return <NeonFlowBackground />;
    case "topoMesh": return <TopoMeshBackground />;
    default: return null;
  }
}

function Router() {
  const [location, navigate] = useLocation();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // WebSocket listener for real-time notifications (returns connection state)
  const wsState = useWebSocket();

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "Escape":
          setShowShortcuts(false);
          setSidebarOpen(false);
          // Broadcast escape to child components (edit modes, panels, etc.)
          window.dispatchEvent(new CustomEvent("app:escape"));
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts(prev => !prev);
          break;
        case "k":
        case "K":
          e.preventDefault();
          navigate("/search");
          break;
        case "n":
        case "N":
          e.preventDefault();
          navigate("/upload");
          break;
        case "d":
        case "D":
          e.preventDefault();
          navigate("/");
          break;
        case "r":
        case "R":
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
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} wsState={wsState} />
      <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 relative">
        {/* Background pattern (selected via Settings page) */}
        <BackgroundLayer />
        {/* Mobile hamburger button */}
        <button
          className="lg:hidden fixed top-3 left-3 z-30 p-2 rounded-md bg-card border border-border shadow-sm"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Suspense fallback={<PageLoader />}>
          <AnimatePresence mode="wait">
            <Switch key={location}>
              <Route path="/">{() => <ErrorBoundary><AnimatedPage><Dashboard /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/upload">{() => <ErrorBoundary><AnimatedPage><Upload /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/transcripts">{() => <ErrorBoundary><AnimatedPage><Transcripts /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/transcripts/:id">{() => <ErrorBoundary><AnimatedPage><Transcripts /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/search">{() => <ErrorBoundary><AnimatedPage><SearchPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/performance">{() => <ErrorBoundary><AnimatedPage><PerformancePage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/sentiment">{() => <ErrorBoundary><AnimatedPage><SentimentPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/reports">{() => <ErrorBoundary><AnimatedPage><ReportsPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/employees">{() => <ErrorBoundary><AnimatedPage><EmployeesPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/insights">{() => <ErrorBoundary><AnimatedPage><InsightsPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/coaching">{() => <ErrorBoundary><AnimatedPage><CoachingPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin">{() => <ErrorBoundary><AnimatedPage><AdminPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/templates">{() => <ErrorBoundary><AnimatedPage><PromptTemplatesPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/ab-testing">{() => <ErrorBoundary><AnimatedPage><ABTestingPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/spend">{() => <ErrorBoundary><AnimatedPage><SpendTrackingPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/scorecard/:id">{() => <ErrorBoundary><AnimatedPage><AgentScorecardPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/analytics/teams">{() => <ErrorBoundary><AnimatedPage><TeamAnalyticsPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/analytics/compare">{() => <ErrorBoundary><AnimatedPage><AgentComparePage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/analytics/heatmap">{() => <ErrorBoundary><AnimatedPage><HeatmapCalendarPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/analytics/clusters">{() => <ErrorBoundary><AnimatedPage><CallClustersPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/my-performance">{() => <ErrorBoundary><AnimatedPage><MyPerformancePage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/leaderboard">{() => <ErrorBoundary><AnimatedPage><LeaderboardPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/admin/security">{() => <ErrorBoundary><AnimatedPage><SecurityPage /></AnimatedPage></ErrorBoundary>}</Route>
              <Route path="/settings">{() => <ErrorBoundary><AnimatedPage><SettingsPage /></AnimatedPage></ErrorBoundary>}</Route>
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
        <LoadingIndicator size="lg" text="Loading CallAnalyzer..." />
      </div>
    );
  }

  if (!user || error) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AuthPage
          onLogin={() => {
            resetSessionExpired();
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
      <AppearanceProvider>
        <I18nProvider>
          <TooltipProvider>
            <Toaster />
            <AuthenticatedApp />
          </TooltipProvider>
        </I18nProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}

export default App;
