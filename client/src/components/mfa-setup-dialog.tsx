import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, CheckCircle, Copy, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode";

interface MfaStatus {
  enabled: boolean;
  username: string;
  recoveryCodesRemaining?: number;
}

interface MfaSetupResponse {
  secret: string;
  uri: string;
}

interface MfaEnableResponse {
  message: string;
  recoveryCodes?: string[];
}

interface RegenerateResponse {
  recoveryCodes: string[];
}

/** Renders otpauth:// URI as a scannable QR code on a canvas element. */
function QrCodeImage({ uri }: { uri: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && uri) {
      QRCode.toCanvas(canvasRef.current, uri, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }).catch(() => { /* QR generation failed — manual entry fallback available */ });
    }
  }, [uri]);
  return (
    <div className="flex justify-center">
      <canvas ref={canvasRef} className="rounded-lg border border-border" />
    </div>
  );
}

export function MfaSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"status" | "setup" | "verify" | "recovery-codes">("status");
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesCopied, setCodesCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const { data: mfaStatus } = useQuery<MfaStatus>({
    queryKey: ["/api/auth/mfa/status"],
    enabled: open,
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/mfa/setup");
      if (!res.ok) throw new Error("Failed to generate MFA secret");
      return res.json() as Promise<MfaSetupResponse>;
    },
    onSuccess: (data) => {
      setSetupData(data);
      setStep("verify");
    },
    onError: (error) => {
      toast({ title: "MFA Setup Failed", description: error.message, variant: "destructive" });
    },
  });

  const enableMutation = useMutation({
    mutationFn: async (totpCode: string) => {
      const res = await apiRequest("POST", "/api/auth/mfa/enable", { code: totpCode });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Invalid code");
      }
      return res.json() as Promise<MfaEnableResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      toast({ title: "MFA Enabled", description: "Save your recovery codes — this is the only time they'll be shown." });
      setRecoveryCodes(data.recoveryCodes || []);
      setCodesCopied(false);
      setAcknowledged(false);
      setStep("recovery-codes");
    },
    onError: (error) => {
      toast({ title: "Verification Failed", description: error.message, variant: "destructive" });
      setCode("");
    },
  });

  const regenerateCodesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/mfa/recovery-codes/regenerate");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to regenerate codes");
      }
      return res.json() as Promise<RegenerateResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      toast({ title: "Recovery Codes Regenerated", description: "Prior codes are now invalid. Save these new codes." });
      setRecoveryCodes(data.recoveryCodes);
      setCodesCopied(false);
      setAcknowledged(false);
      setStep("recovery-codes");
    },
    onError: (error) => {
      toast({ title: "Failed to Regenerate", description: error.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/mfa/disable");
      if (!res.ok) throw new Error("Failed to disable MFA");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/mfa/status"] });
      toast({ title: "MFA Disabled" });
      resetAndClose();
    },
    onError: (error) => {
      toast({ title: "Failed to Disable MFA", description: error.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setStep("status");
    setSetupData(null);
    setCode("");
    setCopied(false);
    setRecoveryCodes([]);
    setCodesCopied(false);
    setAcknowledged(false);
    onClose();
  };

  const copyRecoveryCodes = () => {
    if (recoveryCodes.length === 0) return;
    const formatted = recoveryCodes
      .map(c => `${c.slice(0, 5)}-${c.slice(5)}`)
      .join("\n");
    navigator.clipboard.writeText(formatted).then(() => {
      setCodesCopied(true);
      setTimeout(() => setCodesCopied(false), 3000);
    });
  };

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  // Escape-key to close — custom modal (not shadcn Dialog), so we wire
  // up the key listener ourselves. resetAndClose is captured in a ref so
  // the mount effect runs exactly once per open/close toggle.
  const resetAndCloseRef = useRef(resetAndClose);
  resetAndCloseRef.current = resetAndClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetAndCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={resetAndClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfa-dialog-title"
        className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3
            id="mfa-dialog-title"
            className="text-lg font-semibold text-foreground flex items-center gap-2"
          >
            <Shield className="w-5 h-5" />
            Two-Factor Authentication
          </h3>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close dialog"
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Status view */}
        {step === "status" && (
          <div className="space-y-4">
            <div
              className="flex items-center gap-3 p-3 rounded-sm"
              style={{ background: "var(--paper-2)" }}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  background: mfaStatus?.enabled ? "var(--sage)" : "var(--amber)",
                }}
              />
              <span className="text-sm font-medium text-foreground">
                MFA is {mfaStatus?.enabled ? "enabled" : "not enabled"}
              </span>
              {mfaStatus?.enabled && (
                <span
                  className="ml-auto font-mono uppercase inline-flex items-center gap-1 rounded-sm"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    padding: "3px 8px",
                    background: "var(--sage-soft)",
                    border: "1px solid color-mix(in oklch, var(--sage), transparent 55%)",
                    color: "var(--sage)",
                    fontWeight: 500,
                  }}
                >
                  <CheckCircle className="w-3 h-3" weight="fill" />
                  Active
                </span>
              )}
            </div>

            {!mfaStatus?.enabled && (
              <div
                className="flex items-start gap-2 p-3 rounded-sm"
                style={{
                  background: "var(--amber-soft)",
                  border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                  borderLeft: "3px solid var(--amber)",
                }}
              >
                <Warning
                  className="w-4 h-4 mt-0.5 shrink-0"
                  style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" }}
                />
                <p
                  className="text-xs"
                  style={{
                    color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                    lineHeight: 1.55,
                  }}
                >
                  MFA adds an extra layer of security to your account. You'll need an
                  authenticator app like Google Authenticator or Authy.
                </p>
              </div>
            )}

            {mfaStatus?.enabled && typeof mfaStatus.recoveryCodesRemaining === "number" && (
              <div
                className="flex items-start gap-2 p-3 rounded-sm text-xs"
                style={
                  mfaStatus.recoveryCodesRemaining <= 2
                    ? {
                        background: "var(--warm-red-soft)",
                        border:
                          "1px solid color-mix(in oklch, var(--destructive), transparent 55%)",
                        borderLeft: "3px solid var(--destructive)",
                        color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
                      }
                    : {
                        background: "var(--paper-2)",
                        color: "var(--muted-foreground)",
                      }
                }
              >
                <Warning className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p style={{ lineHeight: 1.55 }}>
                    <strong className="tabular-nums">{mfaStatus.recoveryCodesRemaining}</strong>{" "}
                    recovery code{mfaStatus.recoveryCodesRemaining === 1 ? "" : "s"} remaining.
                    {mfaStatus.recoveryCodesRemaining <= 2 && " Regenerate to get a fresh set."}
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={resetAndClose}>Close</Button>
              {mfaStatus?.enabled ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Regenerate recovery codes? Your existing codes will stop working immediately.")) {
                        regenerateCodesMutation.mutate();
                      }
                    }}
                    disabled={regenerateCodesMutation.isPending}
                  >
                    {regenerateCodesMutation.isPending ? "Regenerating..." : "Regenerate Recovery Codes"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    style={{
                      color: "var(--destructive)",
                      borderColor:
                        "color-mix(in oklch, var(--destructive), transparent 60%)",
                    }}
                    onClick={() => {
                      if (confirm("Disable two-factor authentication?"))
                        disableMutation.mutate();
                    }}
                    disabled={disableMutation.isPending}
                  >
                    Disable MFA
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
                  {setupMutation.isPending ? "Generating..." : "Set Up MFA"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Recovery codes view — shown exactly once after enable/regenerate */}
        {step === "recovery-codes" && recoveryCodes.length > 0 && (
          <div className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-sm"
              style={{
                background: "var(--amber-soft)",
                border: "1px solid color-mix(in oklch, var(--amber), transparent 55%)",
                borderLeft: "3px solid var(--amber)",
              }}
            >
              <Warning
                className="w-5 h-5 mt-0.5 shrink-0"
                style={{ color: "color-mix(in oklch, var(--amber), var(--ink) 30%)" }}
              />
              <div
                className="text-xs space-y-1"
                style={{
                  color: "color-mix(in oklch, var(--amber), var(--ink) 35%)",
                  lineHeight: 1.55,
                }}
              >
                <p className="font-semibold">Save these codes somewhere safe right now.</p>
                <p>
                  Each code can be used once if you lose access to your authenticator app. They
                  will <strong>never be shown again</strong> — if you lose them and lose your
                  device, an admin will have to disable MFA for you.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 p-4 rounded-md border border-input bg-muted font-mono text-sm">
              {recoveryCodes.map((code, idx) => (
                <div key={idx} className="select-all tracking-wider">
                  {code.slice(0, 5)}-{code.slice(5)}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={copyRecoveryCodes} className="flex-1">
                {codesCopied ? (
                  <>
                    <CheckCircle
                      className="w-4 h-4 mr-1.5"
                      style={{ color: "var(--sage)" }}
                      weight="fill"
                    />
                    Copied
                  </>
                ) : (
                  <><Copy className="w-4 h-4 mr-1.5" />Copy All Codes</>
                )}
              </Button>
            </div>

            <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1"
              />
              <span>I have saved my recovery codes in a safe place.</span>
            </label>

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={resetAndClose}
                disabled={!acknowledged}
              >
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Verify view — show QR + secret + code input */}
        {step === "verify" && setupData && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.):
            </p>

            {/* QR Code */}
            <QrCodeImage uri={setupData.uri} />

            {/* Manual entry fallback */}
            <details className="text-sm">
              <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Can't scan? Enter the key manually</summary>
              <div className="mt-2 space-y-2">
                <ol className="text-muted-foreground space-y-1 list-decimal list-inside text-xs">
                  <li>Tap <strong>+</strong> to add a new account</li>
                  <li>Choose <strong>"Enter a setup key"</strong></li>
                  <li>For <strong>Account name</strong>, enter your username</li>
                  <li>For <strong>Your key</strong>, paste the secret below</li>
                  <li>Set <strong>Type of key</strong> to <strong>Time based</strong></li>
                </ol>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Secret Key</label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 px-3 py-2 rounded-md border border-input bg-muted text-sm font-mono break-all select-all">
                      {setupData.secret}
                    </code>
                    <Button variant="outline" size="sm" onClick={copySecret} title="Copy secret">
                      {copied ? (
                        <CheckCircle
                          className="w-4 h-4"
                          style={{ color: "var(--sage)" }}
                          weight="fill"
                        />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </details>

            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); enableMutation.mutate(code); }}
            >
              <div>
                <label className="text-xs font-medium text-muted-foreground">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono text-center tracking-widest text-lg"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetAndClose}>Cancel</Button>
                <Button type="submit" size="sm" disabled={code.length !== 6 || enableMutation.isPending}>
                  {enableMutation.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
