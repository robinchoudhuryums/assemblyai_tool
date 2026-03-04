import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveform, LogIn, UserPlus, Shield, Eye, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { USER_ROLES } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AuthPageProps {
  onLogin: () => void;
}

type AuthView = "login" | "request-access";

export default function AuthPage({ onLogin }: AuthPageProps) {
  const [view, setView] = useState<AuthView>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Request access form state
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestedRole, setRequestedRole] = useState("viewer");
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/login", { username, password });
      onLogin();
    } catch (error: any) {
      const message = error.message?.includes(":")
        ? error.message.split(": ").slice(1).join(": ")
        : error.message;
      toast({
        title: "Login Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/access-requests", {
        name: requestName,
        email: requestEmail,
        reason: requestReason || undefined,
        requestedRole,
      });
      setRequestSubmitted(true);
      toast({
        title: "Request Submitted",
        description: "An administrator will review your access request.",
      });
    } catch (error: any) {
      toast({
        title: "Request Failed",
        description: error.message || "Could not submit access request.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const roleIcons: Record<string, React.ReactNode> = {
    viewer: <Eye className="w-4 h-4 text-blue-500" />,
    manager: <Settings className="w-4 h-4 text-amber-500" />,
    admin: <Shield className="w-4 h-4 text-purple-500" />,
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex items-center justify-center">
                <AudioWaveform className="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">CallAnalyzer</CardTitle>
            <CardDescription>
              {view === "login"
                ? "Sign in to access the call analysis dashboard"
                : requestSubmitted
                  ? "Your request has been submitted"
                  : "Request access to the platform"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Tab switcher */}
            <div className="flex rounded-lg bg-muted p-1 mb-6">
              <button
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  view === "login" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView("login")}
              >
                <LogIn className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Sign In
              </button>
              <button
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  view === "request-access" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setView("request-access")}
              >
                <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Request Access
              </button>
            </div>

            {/* LOGIN FORM */}
            {view === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="username">
                    Username
                  </label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="password">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4 mr-2" />
                  )}
                  Sign In
                </Button>
              </form>
            )}

            {/* REQUEST ACCESS FORM */}
            {view === "request-access" && !requestSubmitted && (
              <form onSubmit={handleRequestAccess} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-name">
                    Full Name
                  </label>
                  <Input
                    id="req-name"
                    type="text"
                    placeholder="Your full name"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-email">
                    Email Address
                  </label>
                  <Input
                    id="req-email"
                    type="email"
                    placeholder="you@company.com"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-role">
                    Requested Access Level
                  </label>
                  <Select value={requestedRole} onValueChange={setRequestedRole}>
                    <SelectTrigger id="req-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer — View dashboards & reports</SelectItem>
                      <SelectItem value="manager">Manager / QA — Edit & manage calls</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="req-reason">
                    Reason for Access <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="req-reason"
                    type="text"
                    placeholder="Why do you need access?"
                    value={requestReason}
                    onChange={(e) => setRequestReason(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <AudioWaveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Submit Request
                </Button>
              </form>
            )}

            {/* REQUEST SUBMITTED CONFIRMATION */}
            {view === "request-access" && requestSubmitted && (
              <div className="text-center py-6">
                <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-100 to-green-50 dark:from-green-900/30 dark:to-green-900/10 rounded-full flex items-center justify-center mb-4">
                  <UserPlus className="w-7 h-7 text-green-600" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">Request Submitted</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  An administrator will review your request and set up your account. You'll be notified at <strong>{requestEmail}</strong>.
                </p>
                <Button variant="outline" onClick={() => { setView("login"); setRequestSubmitted(false); }}>
                  Back to Sign In
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Permission levels info card */}
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="pt-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">Permission Levels</h4>
            <div className="space-y-3">
              {USER_ROLES.map((role) => (
                <div key={role.value} className="flex items-start gap-3">
                  <div className="mt-0.5">{roleIcons[role.value]}</div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{role.label}</p>
                    <p className="text-xs text-muted-foreground">{role.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
