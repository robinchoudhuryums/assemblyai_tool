import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Mic, BarChart3, Upload, FileText, Heart, Users, UserPlus, Search, LogOut, User, TrendingUp, Sun, Moon, Shield, Building2, SlidersHorizontal, ClipboardCheck, FlaskConical, DollarSign, Bell, X, Eye, AlertTriangle, CheckCircle2, Users2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallWithDetails, Employee, AccessRequest, PaginatedCalls } from "@shared/schema";
import LanguageSelector from "@/components/language-selector";
import { useTranslation } from "@/lib/i18n";

type NavItem = { nameKey: string; href: string; icon: any; sectionKey?: string; requireRole?: string[] };

const navigation: NavItem[] = [
  { nameKey: "nav.dashboard", href: "/", icon: BarChart3 },
  { nameKey: "nav.uploadCalls", href: "/upload", icon: Upload },
  { nameKey: "nav.transcripts", href: "/transcripts", icon: FileText },
  { nameKey: "nav.search", href: "/search", icon: Search },
  { nameKey: "nav.sentiment", href: "/sentiment", icon: Heart, sectionKey: "section.analytics" },
  { nameKey: "nav.performance", href: "/performance", icon: Users },
  { nameKey: "nav.reports", href: "/reports", icon: TrendingUp },
  { nameKey: "nav.insights", href: "/insights", icon: Building2 },
  { nameKey: "nav.teamAnalytics", href: "/analytics/teams", icon: Users2 },
  { nameKey: "nav.employees", href: "/employees", icon: UserPlus, sectionKey: "section.management" },
  { nameKey: "nav.coaching", href: "/coaching", icon: ClipboardCheck, requireRole: ["manager", "admin"] },
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

export default function Sidebar() {
  const [location, navigate] = useLocation();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

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
        }, ...prev].slice(0, 30));
      }
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;
  const clearNotifications = () => setNotifications([]);
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const toggleDarkMode = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  // Initialize dark mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    }
  }, []);

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

  // Fetch calls for flagged count badge
  const { data: callsResponse } = useQuery<PaginatedCalls>({
    queryKey: ["/api/calls", { status: "", sentiment: "", employee: "" }],
    staleTime: 30000,
  });
  const calls = callsResponse?.calls;

  // Fetch employees for quick-switch
  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    staleTime: 60000,
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
    return Array.isArray(flags) && flags.some(f => f === "low_score" || f.startsWith("agent_misconduct"));
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

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col" data-testid="sidebar">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Mic className="text-primary-foreground w-4 h-4" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-foreground">CallAnalyzer</h1>
              <p className="text-xs text-muted-foreground">Pro Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSelector />
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative"
                title={unreadCount > 0 ? `${unreadCount} new notification${unreadCount > 1 ? "s" : ""}` : "No new notifications"}
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
                            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          ) : n.type === "failed" ? (
                            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
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
              onClick={toggleDarkMode}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
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

        {/* Admin-only link */}
        {user?.role === "admin" && (
          <>
            <div className="pt-2 pb-1 px-1">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">{t("section.admin")}</p>
            </div>
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
              <SlidersHorizontal className="w-5 h-5" />
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
              <FlaskConical className="w-5 h-5" />
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
              <DollarSign className="w-5 h-5" />
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
              <ShieldAlert className="w-5 h-5" />
              <span>{t("nav.security")}</span>
            </Link>
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

      <div className="p-4 border-t border-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
            <User className="text-muted-foreground w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground truncate">{user?.name || "User"}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role || "viewer"}</p>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            title="Sign out"
            data-testid="logout-button"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
