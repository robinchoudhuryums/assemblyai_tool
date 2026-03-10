import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Mic, BarChart3, Upload, FileText, Heart, Users, UserPlus, Search, LogOut, User, TrendingUp, Sun, Moon, Shield, Building2, SlidersHorizontal, ClipboardCheck, FlaskConical, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallWithDetails, Employee, AccessRequest, PaginatedCalls } from "@shared/schema";

type NavItem = { name: string; href: string; icon: any; section?: string; requireRole?: string[] };

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Upload Calls", href: "/upload", icon: Upload },
  { name: "Transcripts", href: "/transcripts", icon: FileText },
  { name: "Search", href: "/search", icon: Search },
  { name: "Sentiment", href: "/sentiment", icon: Heart, section: "Analytics" },
  { name: "Performance", href: "/performance", icon: Users },
  { name: "Reports", href: "/reports", icon: TrendingUp },
  { name: "Insights", href: "/insights", icon: Building2 },
  { name: "Employees", href: "/employees", icon: UserPlus, section: "Management" },
  { name: "Coaching", href: "/coaching", icon: ClipboardCheck, requireRole: ["manager", "admin"] },
];

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

export default function Sidebar() {
  const [location, navigate] = useLocation();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

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
          <button
            onClick={toggleDarkMode}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
          // Role-based visibility
          if (item.requireRole && (!user?.role || !item.requireRole.includes(user.role))) return null;

          const Icon = item.icon;
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const showBadge = item.name === "Dashboard" && flaggedCount > 0;

          return (
            <div key={item.name}>
              {item.section && (
                <div className="pt-3 pb-1 px-1">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">{item.section}</p>
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
                data-testid={`nav-link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
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
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Admin</p>
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
              <span>Administration</span>
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
              <span>Prompt Templates</span>
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
              <span>Model Testing</span>
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
              <span>Spend Tracking</span>
            </Link>
          </>
        )}
      </nav>

      {/* Quick-switch Employee Selector */}
      {employees && employees.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-1.5 px-1">Quick View Agent</p>
          <Select onValueChange={handleQuickSwitch}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Jump to agent profile..." />
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
