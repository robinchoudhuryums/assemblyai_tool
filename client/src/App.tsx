import { useEffect, useState, useRef, lazy, Suspense, useCallback } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn, resetSessionExpired, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import I18nProvider from "@/components/i18n-provider";
import AppearanceProvider from "@/components/appearance-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogAction } from "@/components/ui/alert-dialog";
import { MfaSetupDialog } from "@/components/mfa-setup-dialog";
import Sidebar from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/lib/error-boundary";
import { LoadingIndicator } from "@/components/ui/loading";
import { useWebSocket, type ConnectionState } from "@/hooks/use-websocket";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "@/lib/i18n";

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
const MyCoachingPage = lazy(() => import("@/pages/my-coaching"));
const SecurityPage = lazy(() => import("@/pages/security"));
const SystemHealthPage = lazy(() => import("@/pages/system-health"));
const BatchStatusPage = lazy(() => import("@/pages/batch-status"));
const WebhooksHealthPage = lazy(() => import("@/pages/webhooks-health"));
const SimulatedCallsPage = lazy(() => import("@/pages/simulated-calls"));
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
    <motion.div {...pageTransition}>
      {children}
    </motion.div>
  );
}

// Centralized [path, Component] table for the SPA. Replaces the prior 25-line
// hand-written Switch with one declarative entry per route. Each route is
// auto-wrapped in <ErrorBoundary><AnimatedPage>...</AnimatedPage></ErrorBoundary>
// at render time below.
type RouteEntry = readonly [path: string, Component: React.ComponentType];
const ROUTE_TABLE: RouteEntry[] = [
  ["/", Dashboard],
  ["/upload", Upload],
  ["/transcripts", Transcripts],
  ["/transcripts/:id", Transcripts],
  ["/search", SearchPage],
  ["/performance", PerformancePage],
  ["/sentiment", SentimentPage],
  ["/reports", ReportsPage],
  ["/employees", EmployeesPage],
  ["/insights", InsightsPage],
  ["/coaching", CoachingPage],
  ["/admin", AdminPage],
  ["/admin/templates", PromptTemplatesPage],
  ["/admin/ab-testing", ABTestingPage],
  ["/admin/spend", SpendTrackingPage],
  ["/admin/security", SecurityPage],
  ["/admin/health", SystemHealthPage],
  ["/admin/batch", BatchStatusPage],
  ["/admin/webhooks-health", WebhooksHealthPage],
  ["/admin/simulated-calls", SimulatedCallsPage],
  ["/scorecard/:id", AgentScorecardPage],
  ["/analytics/teams", TeamAnalyticsPage],
  ["/analytics/compare", AgentComparePage],
  ["/analytics/heatmap", HeatmapCalendarPage],
  ["/analytics/clusters", CallClustersPage],
  ["/my-performance", MyPerformancePage],
  ["/my-coaching", MyCoachingPage],
  ["/leaderboard", LeaderboardPage],
  ["/settings", SettingsPage],
];

// Keyboard shortcut keys are stable; descriptions live in i18n so they
// translate alongside the rest of the UI.
const KEYBOARD_SHORTCUT_KEYS: Array<{ key: string; descriptionKey: string }> = [
  { key: "D", descriptionKey: "shortcut.dashboard" },
  { key: "K", descriptionKey: "shortcut.search" },
  { key: "N", descriptionKey: "shortcut.upload" },
  { key: "R", descriptionKey: "shortcut.reports" },
  { key: "?", descriptionKey: "shortcut.help" },
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("misc.keyboardShortcuts")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {KEYBOARD_SHORTCUT_KEYS.map(({ key, descriptionKey }) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">{t(descriptionKey)}</span>
              <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border border-border">{key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
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
      // Ignore any modifier combo so shortcuts don't hijack browser/OS chords.
      // Shift is included because e.g. Shift+? produces "?" on US layouts and
      // we still want plain "?" to open the help dialog — fall through there.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.shiftKey && e.key !== "?") return;

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
      {/* Accessibility: skip-to-content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none"
      >
        Skip to content
      </a>
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} wsState={wsState} />
      <main id="main-content" className="flex-1 overflow-auto bg-background relative">
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
              {ROUTE_TABLE.map(([path, Component]) => (
                <Route key={path} path={path}>
                  {() => (
                    <ErrorBoundary>
                      <AnimatedPage><Component /></AnimatedPage>
                    </ErrorBoundary>
                  )}
                </Route>
              ))}
              {/* Wrap NotFound in ErrorBoundary too — a buggy 404 page should
                  not bring down the whole app shell. */}
              <Route>
                {() => (
                  <ErrorBoundary>
                    <AnimatedPage><NotFound /></AnimatedPage>
                  </ErrorBoundary>
                )}
              </Route>
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
    refetchInterval: 60_000, // Detect server-side session expiry within 60s
  });

  // Track whether user was previously authenticated so we can show
  // "session expired" context on the login page instead of a blank state.
  const wasAuthenticated = useRef(false);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState(false);
  const [showMfaPrompt, setShowMfaPrompt] = useState(false);
  useEffect(() => {
    if (user) {
      wasAuthenticated.current = true;
      setSessionExpiredMsg(false);
    } else if (!isLoading && wasAuthenticated.current) {
      // User was logged in but /api/auth/me now returns null → session expired
      wasAuthenticated.current = false;
      setSessionExpiredMsg(true);
      queryClient.clear();
    }
  }, [user, isLoading]);

  // HIPAA: Auto-logout after 15 minutes of inactivity with 2-minute warning
  const handleIdleLogout = useCallback(async () => {
    try { await apiRequest("POST", "/api/auth/logout"); } catch { /* ignore */ }
    queryClient.clear();
    window.location.href = "/";
  }, []);

  const { showWarning, remainingSeconds } = useIdleTimeout(handleIdleLogout, !!user);

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
          onLogin={(options) => {
            resetSessionExpired();
            setSessionExpiredMsg(false);
            if (options?.mfaSetupRequired) setShowMfaPrompt(true);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          }}
          sessionExpired={sessionExpiredMsg}
        />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <Router />
      {/* HIPAA idle timeout warning — appears 2 minutes before auto-logout */}
      <AlertDialog open={showWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Session Expiring</AlertDialogTitle>
            <AlertDialogDescription>
              Your session will expire in <strong>{remainingSeconds}</strong> seconds due to inactivity.
              Move your mouse or press any key to stay logged in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Stay Logged In</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Post-login MFA setup prompt for users who haven't enrolled yet */}
      <MfaSetupDialog open={showMfaPrompt} onClose={() => setShowMfaPrompt(false)} />
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
