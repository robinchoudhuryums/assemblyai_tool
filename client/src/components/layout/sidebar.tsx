import { Link, useLocation } from "wouter";
import { Mic, BarChart3, Upload, FileText, Heart, Users, UserPlus, Search, LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

const navigation = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Upload Calls", href: "/upload", icon: Upload },
  { name: "Transcripts", href: "/transcripts", icon: FileText },
  { name: "Sentiment", href: "/sentiment", icon: Heart },
  { name: "Performance", href: "/performance", icon: Users },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Employees", href: "/employees", icon: UserPlus },
  { name: "Search", href: "/search", icon: Search },
];

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

export default function Sidebar() {
  const [location] = useLocation();

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });

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

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col" data-testid="sidebar">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Mic className="text-primary-foreground w-4 h-4" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground">CallAnalyzer</h1>
            <p className="text-xs text-muted-foreground">Pro Dashboard</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));

          return (
            <Link
              key={item.name}
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
            </Link>
          );
        })}
      </nav>

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
