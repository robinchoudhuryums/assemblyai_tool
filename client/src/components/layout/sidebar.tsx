import { useState, useEffect, useRef, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { Bell, Buildings, CalendarDots, CaretDown, CaretUp, ChartBarHorizontal, CheckCircle, ClipboardText, CloudArrowUp, CurrencyDollar, FileText, Flask, GearSix, GitDiff, Heart, Heartbeat, Lock, MagnifyingGlass, Microphone, Moon, Shield, ShieldWarning, SignOut, Sliders, Stack, Sun, TrendUp, Trophy, UploadSimple, User, UserPlus, Users, UsersThree, Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { MfaSetupDialog } from "@/components/mfa-setup-dialog";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallWithDetails, Employee, AccessRequest, PaginatedCalls } from "@shared/schema";
import LanguageSelector from "@/components/language-selector";
import { useTranslation } from "@/lib/i18n";
import { useAppearance } from "@/components/appearance-provider";
import { CALLS_STALE_TIME_MS, EMPLOYEES_STALE_TIME_MS, MAX_NOTIFICATIONS } from "@/lib/constants";
import { useConfig } from "@/hooks/use-config";

type NavItem = { nameKey: string; href: string; icon: ComponentType<{ className?: string }>; sectionKey?: string; requireRole?: string[] };

const navigation: NavItem[] = [
  { nameKey: "nav.dashboard", href: "/", icon: ChartBarHorizontal },
  { nameKey: "nav.myPerformance", href: "/my-performance", icon: User },
  { nameKey: "nav.myCoaching", href: "/my-coaching", icon: ClipboardText },
  { nameKey: "nav.uploadCalls", href: "/upload", icon: UploadSimple },
  { nameKey: "nav.transcripts", href: "/transcripts", icon: FileText },
  { nameKey: "nav.search", href: "/search", icon: MagnifyingGlass },
  { nameKey: "nav.sentiment", href: "/sentiment", icon: Heart, sectionKey: "section.analytics" },
  { nameKey: "nav.performance", href: "/performance", icon: Users },
  { nameKey: "nav.reports", href: "/reports", icon: TrendUp },
  { nameKey: "nav.insights", href: "/insights", icon: Buildings },
  { nameKey: "nav.teamAnalytics", href: "/analytics/teams", icon: UsersThree, requireRole: ["manager", "admin"] },
  { nameKey: "nav.agentCompare", href: "/analytics/compare", icon: GitDiff },
  { nameKey: "nav.heatmap", href: "/analytics/heatmap", icon: CalendarDots },
  { nameKey: "nav.clusters", href: "/analytics/clusters", icon: Stack },
  { nameKey: "nav.leaderboard", href: "/leaderboard", icon: Trophy },
  { nameKey: "nav.employees", href: "/employees", icon: UserPlus, sectionKey: "section.management" },
  { nameKey: "nav.coaching", href: "/coaching", icon: ClipboardText, requireRole: ["manager", "admin"] },
];

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

interface Notification {
  id: string;
  callId: string;
  type: "completed" | "failed" | "flagged";
  message: string;
  timestamp: Date;
  read: boolean;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

export default function Sidebar({ isOpen, onClose, wsState }: { isOpen?: boolean; onClose?: () => void; wsState?: ConnectionState } = {}) {
  const [location, navigate] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mfaDialogOpen, setMfaDialogOpen] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(() => {
    // Auto-expand if user is currently on an admin page on first mount.
    return location.startsWith("/admin");
  });
  // ...and re-expand whenever the user navigates directly to /admin/* later
  // (e.g. via a deep link, sidebar quick-jump, or programmatic navigation).
  // Without this, an admin who collapsed the section and then deep-linked to
  // /admin/users sees the active item highlighted but the section still
  // collapsed, hiding all the sibling admin pages.
  useEffect(() => {
    if (location.startsWith("/admin")) setAdminExpanded(true);
  }, [location]);
  const notifRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { theme, setTheme } = useAppearance();
  const { appName } = useConfig();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Listen for WebSocket call completion events. Only terminal statuses
  // (completed / failed) create notifications — the pipeline broadcasts a
  // `ws:call_update` event for every step (uploading / transcribing /
  // analyzing / storing / etc.), and without this filter the notifications
  // drawer fills with one entry per pipeline step per file. Intermediate
  // steps are still used for progress indication by other components
  // (file-upload, calls-table); only the bell menu is deduped here.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.callId) return;
      const isCompleted = detail.status === "completed";
      const isFailed = detail.status === "failed";
      if (!isCompleted && !isFailed) return; // skip intermediate pipeline steps
      const type = isFailed ? "failed" as const : "completed" as const;
      const message = isFailed
        ? "Call analysis failed"
        : (detail.label || "Call analysis completed");
      setNotifications(prev => [{
        id: `${detail.callId}-${Date.now()}`,
        callId: detail.callId,
        type,
        message,
        timestamp: new Date(),
        read: false,
      }, ...prev].slice(0, MAX_NOTIFICATIONS));
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;
  const clearNotifications = () => setNotifications([]);
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

  // Fetch calls for flagged count badge (default queryFn returns null on 401).
  // Convention: omit filter params from the query key when none are set —
  // see dashboard.tsx for rationale.
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls"],
    staleTime: CALLS_STALE_TIME_MS,
  });
  const calls = callsResponse?.calls;

  // Fetch employees for quick-switch
  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    staleTime: EMPLOYEES_STALE_TIME_MS,
  });

  // Fetch access requests for admin badge count
  const { data: accessRequests } = useQuery<AccessRequest[]>({
    queryKey: ["/api/access-requests"],
    staleTime: 60000,
    enabled: user?.role === "admin",
  });

  const pendingRequestCount = (accessRequests || []).filter(r => r.status === "pending").length;

  const flaggedCount = (calls || []).filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.some(f => typeof f === "string" && (f === "low_score" || f.startsWith("agent_misconduct")));
  }).length;

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.clear();
      window.location.href = "/";
    } catch (e) {
      // Force reload on error
      window.location.href = "/";
    }
  };

  const handleQuickSwitch = (employeeId: string) => {
    navigate(`/reports?employee=${employeeId}`);
  };

  // Close sidebar on navigation (mobile). Only fire onClose if the sidebar
  // is actually open — calling onClose() while it's already closed re-fires
  // the parent's setSidebarOpen(false) on every route change for no reason.
  useEffect(() => {
    if (isOpen && onClose) onClose();
  }, [location, isOpen, onClose]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside className={cn(
        "w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col z-50",
        "lg:relative lg:translate-x-0",
        "fixed inset-y-0 left-0 transition-transform duration-200",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )} data-testid="sidebar">
      <div className="px-5 pt-5 pb-4 border-b border-sidebar-border">
        <p
          className="font-mono uppercase text-muted-foreground mb-1.5"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
        >
          Pro Dashboard
        </p>
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          />
          <h1
            className="font-display font-semibold tracking-tight text-foreground truncate"
            style={{ fontSize: 20, lineHeight: 1.1 }}
          >
            {appName}
          </h1>
        </div>
        <div className="flex items-center gap-1 mt-3 -ml-1.5">
          <LanguageSelector />
          <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-expanded={showNotifications}
                aria-haspopup="true"
                className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative"
                title={unreadCount > 0 ? `${unreadCount} new notification${unreadCount > 1 ? "s" : ""}` : "No new notifications"}
                aria-label={unreadCount > 0 ? `${unreadCount} new notification${unreadCount > 1 ? "s" : ""}` : "Notifications"}
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full font-mono tabular-nums"
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      background: "var(--warm-red)",
                      color: "var(--destructive-foreground)",
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-sm shadow-md z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <h4
                      className="font-mono uppercase text-foreground"
                      style={{ fontSize: 11, letterSpacing: "0.08em" }}
                    >
                      Notifications
                    </h4>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="font-mono uppercase text-muted-foreground hover:text-foreground transition-colors"
                          style={{ fontSize: 10, letterSpacing: "0.06em" }}
                        >
                          Mark read
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          onClick={clearNotifications}
                          className="font-mono uppercase text-muted-foreground hover:text-foreground transition-colors"
                          style={{ fontSize: 10, letterSpacing: "0.06em" }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="text-center py-8 text-[12px] text-muted-foreground">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map(n => (
                        <button
                          key={n.id}
                          className={cn(
                            "w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border last:border-0 flex items-start gap-2",
                            !n.read && "bg-[var(--copper-soft)]/50"
                          )}
                          onClick={() => {
                            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                            setShowNotifications(false);
                            navigate(`/transcripts/${n.callId}`);
                          }}
                        >
                          {n.type === "completed" ? (
                            <CheckCircle
                              className="w-4 h-4 mt-0.5 shrink-0"
                              style={{ color: "var(--sage)" }}
                              weight="fill"
                            />
                          ) : n.type === "failed" ? (
                            <Warning
                              className="w-4 h-4 mt-0.5 shrink-0"
                              style={{ color: "var(--destructive)" }}
                              weight="fill"
                            />
                          ) : (
                            <Warning
                              className="w-4 h-4 mt-0.5 shrink-0"
                              style={{ color: "var(--amber)" }}
                              weight="fill"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-xs", !n.read ? "font-medium text-foreground" : "text-muted-foreground")}>
                              {n.message}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {n.timestamp.toLocaleTimeString()}
                            </p>
                          </div>
                          {!n.read && (
                            <span
                              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                              style={{ background: "var(--accent)" }}
                            />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              href="/settings"
              className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Settings"
              aria-label="Settings"
            >
              <GearSix className="w-4 h-4" />
            </Link>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navigation.map((item) => {
          // Role-based visibility
          if (item.requireRole && (!user?.role || !item.requireRole.includes(user.role))) return null;

          const Icon = item.icon;
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const showBadge = item.nameKey === "nav.dashboard" && flaggedCount > 0;
          const name = t(item.nameKey);

          return (
            <div key={item.nameKey}>
              {item.sectionKey && (
                <div className="pt-4 pb-1.5 px-3">
                  <p
                    className="font-mono uppercase text-muted-foreground"
                    style={{ fontSize: 10, letterSpacing: "0.08em" }}
                  >
                    {t(item.sectionKey)}
                  </p>
                </div>
              )}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                  isActive
                    ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                data-testid={`nav-link-${item.nameKey}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{name}</span>
                {showBadge && (
                  <span
                    className="ml-auto font-mono tabular-nums inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      fontWeight: 600,
                      background: "var(--warm-red-soft)",
                      color: "var(--destructive)",
                      border: "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
                    }}
                  >
                    {flaggedCount}
                  </span>
                )}
              </Link>
            </div>
          );
        })}

        {/* Admin section — collapsible */}
        {user?.role === "admin" && (
          <>
            <button
              onClick={() => setAdminExpanded(prev => !prev)}
              className="w-full flex items-center justify-between pt-4 pb-1.5 px-3 group"
              aria-expanded={adminExpanded}
              aria-label="Toggle admin section"
            >
              <p
                className="font-mono uppercase text-muted-foreground group-hover:text-foreground transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                {t("section.admin")}
              </p>
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                {adminExpanded ? <CaretUp className="w-3 h-3" /> : <CaretDown className="w-3 h-3" />}
              </span>
            </button>
            {adminExpanded && (
              <>
                <Link
                  href="/admin"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-admin"
                >
                  <Shield className="w-4 h-4 shrink-0" />
                  <span>{t("nav.admin")}</span>
                  {pendingRequestCount > 0 && (
                    <span
                      className="ml-auto font-mono tabular-nums inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.04em",
                        fontWeight: 600,
                        background: "var(--amber-soft)",
                        color: "color-mix(in oklch, var(--amber), var(--ink) 30%)",
                        border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                      }}
                    >
                      {pendingRequestCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/admin/templates"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/templates"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-templates"
                >
                  <Sliders className="w-4 h-4 shrink-0" />
                  <span>{t("nav.promptTemplates")}</span>
                </Link>
                <Link
                  href="/admin/ab-testing"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/ab-testing"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-ab-testing"
                >
                  <Flask className="w-4 h-4 shrink-0" />
                  <span>{t("nav.modelTesting")}</span>
                </Link>
                <Link
                  href="/admin/spend"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/spend"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-spend"
                >
                  <CurrencyDollar className="w-4 h-4 shrink-0" />
                  <span>{t("nav.spendTracking")}</span>
                </Link>
                <Link
                  href="/admin/security"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/security"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-security"
                >
                  <ShieldWarning className="w-4 h-4 shrink-0" />
                  <span>{t("nav.security")}</span>
                </Link>
                <Link
                  href="/admin/health"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/health"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-health"
                >
                  <Heartbeat className="w-4 h-4 shrink-0" />
                  <span>{t("nav.systemHealth")}</span>
                </Link>
                <Link
                  href="/admin/batch"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/batch"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-batch"
                >
                  <CloudArrowUp className="w-4 h-4 shrink-0" />
                  <span>Batch Status</span>
                </Link>
                <Link
                  href="/admin/simulated-calls"
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[13px] transition-colors",
                    location === "/admin/simulated-calls"
                      ? "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-simulated-calls"
                >
                  <Microphone className="w-4 h-4 shrink-0" />
                  <span>Simulated Calls</span>
                </Link>
              </>
            )}
          </>
        )}
      </nav>

      {/* Quick-switch Employee Selector */}
      {employees && employees.length > 0 && (
        <div className="px-4 pt-3 pb-3 border-t border-sidebar-border">
          <p
            className="font-mono uppercase text-muted-foreground mb-2 px-1"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            {t("misc.quickViewAgent")}
          </p>
          <Select onValueChange={handleQuickSwitch}>
            <SelectTrigger
              className="h-8 text-[12px] bg-transparent border-sidebar-border rounded-sm hover:bg-muted transition-colors"
            >
              <SelectValue placeholder={t("misc.jumpToAgentProfile")} />
            </SelectTrigger>
            <SelectContent>
              {employees.filter(e => e.status === "Active").map(emp => (
                <SelectItem key={emp.id} value={emp.id}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center shrink-0"
                      style={{
                        background: "var(--copper-soft)",
                        color: "var(--accent)",
                      }}
                    >
                      {emp.initials || emp.name?.slice(0, 2).toUpperCase()}
                    </span>
                    {emp.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="px-4 py-3 border-t border-sidebar-border mt-auto">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-mono"
            style={{
              background: "var(--copper-soft)",
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
            aria-hidden="true"
          >
            {user?.name
              ? user.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join("")
                  .toUpperCase()
              : <User className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[13px] text-foreground truncate leading-tight">{user?.name || "User"}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.06em" }}
              >
                {user?.role || "viewer"}
              </p>
              {wsState && (
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    (wsState === "reconnecting" || wsState === "connecting") && "animate-pulse",
                  )}
                  style={{
                    background:
                      wsState === "connected"
                        ? "var(--sage)"
                        : wsState === "disconnected"
                        ? "var(--destructive)"
                        : "var(--amber)",
                  }}
                  title={`Real-time updates: ${wsState}`}
                />
              )}
            </div>
          </div>
          <button
            className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setMfaDialogOpen(true)}
            title="Security settings (MFA)"
            aria-label="Security settings"
          >
            <Lock className="w-4 h-4" />
          </button>
          <button
            className="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            data-testid="logout-button"
          >
            <SignOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      <MfaSetupDialog open={mfaDialogOpen} onClose={() => setMfaDialogOpen(false)} />
    </aside>
    </>
  );
}
