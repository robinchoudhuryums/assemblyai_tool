import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eye, Gear, Key, Shield, SignIn, UserPlus, Waveform } from "@phosphor-icons/react";
import { apiRequest, SessionExpiredError } from "@/lib/queryClient";
import { extractErrorMessage } from "@/lib/display-utils";
import { sanitizeReturnTo } from "@/lib/return-to";
import { USER_ROLES } from "@shared/schema";
import { ROLE_CONFIG } from "@/lib/constants";
import { useConfig } from "@/hooks/use-config";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AuthPageProps {
  onLogin: (options?: { mfaSetupRequired?: boolean }) => void;
  sessionExpired?: boolean;
}

type AuthView = "login" | "request-access";

export default function AuthPage({ onLogin, sessionExpired }: AuthPageProps) {
  const [view, setView] = useState<AuthView>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { appName } = useConfig();

  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  // Request access form state
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestedRole, setRequestedRole] = useState("viewer");
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  /**
   * If the current URL carries a trusted `?return_to=<url>` (validated
   * against the `.umscallanalyzer.com` zone), send the user there after
   * login instead of the default dashboard. Used by RAG's SSO "Sign in
   * with CallAnalyzer" button so a round-trip lands the user back where
   * they clicked. Reads `window.location` each call so it works
   * regardless of wouter's internal routing state.
   */
  const redirectToReturnToIfPresent = (): boolean => {
    const raw = new URLSearchParams(window.location.search).get("return_to");
    const sanitized = sanitizeReturnTo(raw);
    if (!sanitized) return false;
    window.location.href = sanitized;
    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await apiRequest("POST", "/api/auth/login", { username, password });
      const data = await response.json();

      if (data.mfaRequired) {
        // MFA step needed
        setMfaRequired(true);
        setMfaToken(data.mfaToken);
        setIsLoading(false);
        return;
      }

      onLogin({ mfaSetupRequired: !!data.mfaSetupRequired });
      // MFA-setup users must enroll in CA before leaving; skip return_to
      // for that flow so they don't bypass the setup prompt.
      if (!data.mfaSetupRequired) redirectToReturnToIfPresent();
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      toast({
        title: "Login Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/login", { mfaToken, totpCode });
      onLogin();
      redirectToReturnToIfPresent();
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      toast({
        title: "Verification Failed",
        description: message,
        variant: "destructive",
      });
      // Always clear code so user can retry immediately
      setTotpCode("");
      // If the server signaled the MFA token has expired (structured code,
      // not substring matching), go back to the username/password form so
      // the user re-authenticates from scratch.
      const isMfaExpired =
        error instanceof SessionExpiredError && error.code === "mfa_session_expired";
      if (isMfaExpired) {
        setMfaRequired(false);
        setMfaToken("");
        setUseRecoveryCode(false);
      } else {
        // Re-focus the input for quick retry
        setTimeout(() => totpInputRef.current?.focus(), 100);
      }
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
    } catch (error: unknown) {
      toast({
        title: "Request Failed",
        description: extractErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const roleIconComponents: Record<string, typeof Eye> = { viewer: Eye, manager: Gear, admin: Shield };
  const roleIcons: Record<string, React.ReactNode> = Object.fromEntries(
    Object.entries(roleIconComponents).map(([role, Icon]) => [
      role,
      <Icon
        key={role}
        className="w-4 h-4"
        style={{ color: ROLE_CONFIG[role]?.color || "var(--muted-foreground)" }}
      />,
    ])
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="bg-card border border-border" style={{ padding: "28px 32px" }}>
          <div className="text-center">
            {sessionExpired && (
              <div
                className="mb-5 text-left"
                style={{
                  padding: "10px 14px",
                  background: "var(--amber-soft)",
                  border: "1px solid color-mix(in oklch, var(--amber), transparent 50%)",
                  borderLeft: "3px solid var(--amber)",
                  fontSize: 12,
                  color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                }}
                role="alert"
              >
                Your session has expired. Please sign in again.
              </div>
            )}
            <div className="flex items-center justify-center gap-2 mb-3">
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }}
              />
              <Waveform
                style={{ width: 14, height: 14, color: "var(--muted-foreground)" }}
              />
            </div>
            <h1
              className="font-display font-medium text-foreground"
              style={{ fontSize: 28, letterSpacing: "-0.4px", lineHeight: 1.1 }}
            >
              {appName}
            </h1>
            <p
              className="text-muted-foreground mt-2 max-w-xs mx-auto"
              style={{ fontSize: 13, lineHeight: 1.5 }}
            >
              {mfaRequired
                ? "Enter the verification code from your authenticator app"
                : view === "login"
                  ? "Sign in to access the call analysis dashboard"
                  : requestSubmitted
                    ? "Your request has been submitted"
                    : "Request access to the platform"}
            </p>
          </div>
          <div className="mt-6">
            {/* MFA VERIFICATION FORM */}
            {mfaRequired && (
              <form onSubmit={handleMfaVerify} className="space-y-4">
                <div className="flex justify-center mb-3">
                  <div
                    className="rounded-full flex items-center justify-center"
                    style={{
                      width: 48,
                      height: 48,
                      border: "1px solid color-mix(in oklch, var(--amber), transparent 50%)",
                      background: "var(--amber-soft)",
                    }}
                  >
                    <Key
                      style={{
                        width: 20,
                        height: 20,
                        color: "color-mix(in oklch, var(--amber), var(--ink) 20%)",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground" htmlFor="totp-code">
                    {useRecoveryCode ? "Recovery Code" : "Verification Code"}
                  </label>
                  {useRecoveryCode ? (
                    <Input
                      ref={totpInputRef}
                      id="totp-code"
                      type="text"
                      maxLength={11}
                      placeholder="XXXXX-XXXXX"
                      value={totpCode}
                      onChange={(e) => {
                        const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
                        setTotpCode(raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw);
                      }}
                      required
                      autoFocus
                      className="text-center text-lg tracking-widest font-mono"
                    />
                  ) : (
                    <Input
                      ref={totpInputRef}
                      id="totp-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      required
                      autoComplete="one-time-code"
                      autoFocus
                      className="text-center text-2xl tracking-[0.5em] font-mono"
                    />
                  )}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {useRecoveryCode
                      ? "Enter one of your saved recovery codes. Each code can only be used once."
                      : "Open your authenticator app and enter the 6-digit code"}
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    isLoading ||
                    (useRecoveryCode
                      ? totpCode.replace(/[^A-Z0-9]/gi, "").length !== 10
                      : totpCode.length !== 6)
                  }
                >
                  {isLoading ? (
                    <Waveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-2" />
                  )}
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => { setUseRecoveryCode(v => !v); setTotpCode(""); setTimeout(() => totpInputRef.current?.focus(), 50); }}
                >
                  {useRecoveryCode ? "Use authenticator app code instead" : "Can't access your authenticator? Use a recovery code"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => { setMfaRequired(false); setMfaToken(""); setTotpCode(""); setUseRecoveryCode(false); }}
                >
                  Back to Sign In
                </Button>
              </form>
            )}

            {/* Tab switcher (hidden during MFA) */}
            {!mfaRequired && (
              <div className="flex rounded-lg bg-muted p-1 mb-6">
                <button
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    view === "login" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setView("login")}
                >
                  <SignIn className="w-4 h-4 inline mr-1.5 -mt-0.5" />
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
            )}

            {/* LOGIN FORM */}
            {view === "login" && !mfaRequired && (
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
                <Button type="submit" className="w-full" disabled={isLoading || !username.trim() || !password}>
                  {isLoading ? (
                    <Waveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <SignIn className="w-4 h-4 mr-2" />
                  )}
                  Sign In
                </Button>
              </form>
            )}

            {/* REQUEST ACCESS FORM */}
            {view === "request-access" && !requestSubmitted && !mfaRequired && (
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
                <Button type="submit" className="w-full" disabled={isLoading || !requestName.trim() || !requestEmail.trim()}>
                  {isLoading ? (
                    <Waveform className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Submit Request
                </Button>
              </form>
            )}

            {/* REQUEST SUBMITTED CONFIRMATION */}
            {view === "request-access" && requestSubmitted && !mfaRequired && (
              <div className="text-center py-6">
                <div
                  className="mx-auto rounded-full flex items-center justify-center mb-4"
                  style={{
                    width: 48,
                    height: 48,
                    border: "1px solid color-mix(in oklch, var(--sage), transparent 50%)",
                    background: "var(--sage-soft)",
                  }}
                >
                  <UserPlus style={{ width: 20, height: 20, color: "var(--sage)" }} />
                </div>
                <h3
                  className="font-display font-medium text-foreground mb-1"
                  style={{ fontSize: 18, letterSpacing: "-0.2px" }}
                >
                  Request submitted
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  An administrator will review your request and set up your account. You'll be notified at <strong>{requestEmail}</strong>.
                </p>
                <Button variant="outline" onClick={() => { setView("login"); setRequestSubmitted(false); }}>
                  Back to Sign In
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Permission levels info card (hidden during MFA) */}
        {!mfaRequired && (
          <div
            className="border border-dashed border-border"
            style={{ background: "var(--secondary)", padding: "20px 24px" }}
          >
            <h4
              className="font-mono uppercase text-muted-foreground mb-3"
              style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 500 }}
            >
              Permission Levels
            </h4>
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
          </div>
        )}
      </div>
    </div>
  );
}
