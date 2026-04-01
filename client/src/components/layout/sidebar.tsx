import { useState, useEffect, useRef, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { Bell, Buildings, CalendarDots, CaretDown, CaretUp, ChartBarHorizontal, CheckCircle, ClipboardText, CurrencyDollar, Eye, FileText, Flask, GearSix, GitDiff, Heart, MagnifyingGlass, Moon, Shield, ShieldWarning, SignOut, Sliders, Stack, Sun, TrendUp, Trophy, UploadSimple, User, UserPlus, Users, UsersThree, Warning, Waveform, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallWithDetails, Employee, AccessRequest, PaginatedCalls } from "@shared/schema";
import LanguageSelector from "@/components/language-selector";
import { useTranslation } from "@/lib/i18n";
import { useAppearance } from "@/components/appearance-provider";
import { CALLS_STALE_TIME_MS, EMPLOYEES_STALE_TIME_MS, MAX_NOTIFICATIONS } from "@/lib/constants";

type NavItem = { nameKey: string; href: string; icon: ComponentType<{ className?: string }>; sectionKey?: string; requireRole?: string[] };

const navigation: NavItem[] = [
  { nameKey: "nav.dashboard", href: "/", icon: ChartBarHorizontal },
  { nameKey: "nav.myPerformance", href: "/my-performance", icon: User },
  { nameKey: "nav.uploadCalls", href: "/upload", icon: UploadSimple },
  { nameKey: "nav.transcripts", href: "/transcripts", icon: FileText },
  { nameKey: "nav.search", href: "/search", icon: MagnifyingGlass },
  { nameKey: "nav.sentiment", href: "/sentiment", icon: Heart, sectionKey: "section.analytics" },
  { nameKey: "nav.performance", href: "/performance", icon: Users },
  { nameKey: "nav.reports", href: "/reports", icon: TrendUp },
  { nameKey: "nav.insights", href: "/insights", icon: Buildings },
  { nameKey: "nav.teamAnalytics", href: "/analytics/teams", icon: UsersThree },
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
  const [adminExpanded, setAdminExpanded] = useState(() => {
    // Auto-expand if user is currently on an admin page
    return location.startsWith("/admin");
  });
  const notifRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { theme, setTheme } = useAppearance();

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

  // Listen for WebSocket call completion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.callId) {
        const type = detail.status === "failed" ? "failed" as const : "completed" as const;
        const message = detail.status === "failed"
          ? `Call analysis failed`
          : detail.label || `Call analysis completed`;
        setNotifications(prev => [{
          id: `${detail.callId}-${Date.now()}`,
          callId: detail.callId,
          type,
          message,
          timestamp: new Date(),
          read: false,
        }, ...prev].slice(0, MAX_NOTIFICATIONS));
      }
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

  // Fetch calls for flagged count badge (default queryFn returns null on 401)
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
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

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    if (onClose) onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside className={cn(
        "w-64 h-full bg-sidebar backdrop-blur-xl border-r border-sidebar-border flex flex-col z-50",
        "lg:relative lg:translate-x-0",
        "fixed inset-y-0 left-0 transition-transform duration-200",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )} data-testid="sidebar">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Waveform className="text-primary-foreground w-4 h-4" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground">CallAnalyzer</h1>
            <p className="text-xs text-muted-foreground">Pro Dashboard</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 mt-3">
          <LanguageSelector />
          <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative"
                title={unreadCount > 0 ? `${unreadCount} new notification${unreadCount > 1 ? "s" : ""}` : "No new notifications"}
                aria-label={unreadCount > 0 ? `${unreadCount} new notification${unreadCount > 1 ? "s" : ""}` : "Notifications"}
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-bold bg-primary text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <h4 className="text-sm font-semibold text-foreground">Notifications</h4>
                    <div className="flex items-center gap-1">
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
                      )}
                      {notifications.length > 0 && (
                        <button onClick={clearNotifications} className="text-xs text-muted-foreground hover:text-foreground ml-2">Clear</button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map(n => (
                        <button
                          key={n.id}
                          className={cn(
                            "w-full text-left px-3 py-2.5 hover:bg-muted transition-colors border-b border-border last:border-0 flex items-start gap-2",
                            !n.read && "bg-primary/5"
                          )}
                          onClick={() => {
                            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                            setShowNotifications(false);
                            navigate(`/transcripts/${n.callId}`);
                          }}
                        >
                          {n.type === "completed" ? (
                            <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          ) : n.type === "failed" ? (
                            <Warning className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          ) : (
                            <Warning className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
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
                            <span className="w-2 h-2 rounded-full bg-primary mt-1 shrink-0" />
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
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              href="/settings"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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
                <div className="pt-3 pb-1 px-1">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">{t(item.sectionKey)}</p>
                </div>
              )}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                data-testid={`nav-link-${item.nameKey}`}
              >
                <Icon className="w-5 h-5" />
                <span>{name}</span>
                {showBadge && (
                  <span className={cn(
                    "ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold",
                    isActive
                      ? "bg-red-500 text-white"
                      : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                  )}>
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
              className="w-full flex items-center justify-between pt-2 pb-1 px-1 group"
              aria-expanded={adminExpanded}
              aria-label="Toggle admin section"
            >
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">{t("section.admin")}</p>
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                {adminExpanded ? <CaretUp className="w-3 h-3" /> : <CaretDown className="w-3 h-3" />}
              </span>
            </button>
            {adminExpanded && (
              <>
                <Link
                  href="/admin"
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                    location === "/admin"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-admin"
                >
                  <Shield className="w-5 h-5" />
                  <span>{t("nav.admin")}</span>
                  {pendingRequestCount > 0 && (
                    <span className={cn(
                      "ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold",
                      location === "/admin"
                        ? "bg-yellow-500 text-white"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                    )}>
                      {pendingRequestCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/admin/templates"
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                    location === "/admin/templates"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-templates"
                >
                  <Sliders className="w-5 h-5" />
                  <span>{t("nav.promptTemplates")}</span>
                </Link>
                <Link
                  href="/admin/ab-testing"
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                    location === "/admin/ab-testing"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-ab-testing"
                >
                  <Flask className="w-5 h-5" />
                  <span>{t("nav.modelTesting")}</span>
                </Link>
                <Link
                  href="/admin/spend"
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                    location === "/admin/spend"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-spend"
                >
                  <CurrencyDollar className="w-5 h-5" />
                  <span>{t("nav.spendTracking")}</span>
                </Link>
                <Link
                  href="/admin/security"
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md font-medium transition-colors",
                    location === "/admin/security"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  data-testid="nav-link-security"
                >
                  <ShieldWarning className="w-5 h-5" />
                  <span>{t("nav.security")}</span>
                </Link>
              </>
            )}
          </>
        )}
      </nav>

      {/* Quick-switch Employee Selector */}
      {employees && employees.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-1.5 px-1">{t("misc.quickViewAgent")}</p>
          <Select onValueChange={handleQuickSwitch}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t("misc.jumpToAgentProfile")} />
            </SelectTrigger>
            <SelectContent>
              {employees.filter(e => e.status === "Active").map(emp => (
                <SelectItem key={emp.id} value={emp.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[8px] font-bold flex items-center justify-center shrink-0">
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

      <div className="p-4 border-t border-sidebar-border mt-auto">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
            <User className="text-muted-foreground w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground truncate">{user?.name || "User"}</p>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-muted-foreground capitalize">{user?.role || "viewer"}</p>
              {wsState && (
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    wsState === "connected" && "bg-green-500",
                    wsState === "reconnecting" && "bg-yellow-500 animate-pulse",
                    wsState === "connecting" && "bg-yellow-500 animate-pulse",
                    wsState === "disconnected" && "bg-red-500",
                  )}
                  title={`Real-time updates: ${wsState}`}
                />
              )}
            </div>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            data-testid="logout-button"
          >
            <SignOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
