import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { KeyRound, ShieldCheck, ShieldOff, Copy, Check, AlertTriangle } from "lucide-react";

interface MfaSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mfaEnabled: boolean;
  onMfaChange: () => void;
}

type SetupStep = "idle" | "qr" | "verify" | "recovery" | "done";

export default function MfaSetupDialog({ open, onOpenChange, mfaEnabled, onMfaChange }: MfaSetupDialogProps) {
  const [step, setStep] = useState<SetupStep>("idle");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleStartSetup = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/mfa/setup");
      const data = await res.json();
      setQrCodeDataUrl(data.qrCodeDataUrl);
      setSecret(data.secret);
      setRecoveryCodes(data.recoveryCodes);
      setStep("qr");
    } catch (error: any) {
      toast({ title: "Setup Failed", description: "Could not start MFA setup.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/mfa/confirm", { code: verifyCode });
      setStep("recovery");
      toast({ title: "MFA Enabled", description: "Two-factor authentication is now active." });
    } catch (error: any) {
      toast({ title: "Verification Failed", description: "Invalid code. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable = async () => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/mfa/disable");
      toast({ title: "MFA Disabled", description: "Two-factor authentication has been disabled." });
      onMfaChange();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Error", description: "Could not disable MFA.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyRecoveryCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state on close
      setStep("idle");
      setQrCodeDataUrl("");
      setSecret("");
      setRecoveryCodes([]);
      setVerifyCode("");
      setCopied(false);
      if (step === "recovery" || step === "done") {
        onMfaChange();
      }
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            {mfaEnabled && step === "idle"
              ? "MFA is currently enabled on your account."
              : "Add an extra layer of security to your account."}
          </DialogDescription>
        </DialogHeader>

        {/* IDLE: Show enable/disable options */}
        {step === "idle" && (
          <div className="space-y-4 pt-2">
            {mfaEnabled ? (
              <>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <ShieldCheck className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-400">MFA is active on your account</span>
                </div>
                <Button variant="destructive" className="w-full" onClick={handleDisable} disabled={isLoading}>
                  <ShieldOff className="w-4 h-4 mr-2" />
                  Disable MFA
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Use an authenticator app (Google Authenticator, Authy, 1Password, etc.) to generate verification codes.
                </p>
                <Button className="w-full" onClick={handleStartSetup} disabled={isLoading}>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Set Up MFA
                </Button>
              </>
            )}
          </div>
        )}

        {/* QR CODE STEP */}
        {step === "qr" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app:
            </p>
            {qrCodeDataUrl && (
              <div className="flex justify-center">
                <img src={qrCodeDataUrl} alt="MFA QR Code" className="w-48 h-48 rounded-lg border" />
              </div>
            )}
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
              <code className="text-xs bg-muted px-2 py-1 rounded select-all break-all">{secret}</code>
            </div>
            <Button className="w-full" onClick={() => setStep("verify")}>
              Continue
            </Button>
          </div>
        )}

        {/* VERIFY STEP */}
        {step === "verify" && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground text-center">
              Enter the 6-digit code from your authenticator app to confirm setup:
            </p>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={verifyCode}
                onChange={setVerifyCode}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <span className="text-muted-foreground">-</span>
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button
              className="w-full"
              onClick={handleVerify}
              disabled={isLoading || verifyCode.length !== 6}
            >
              Verify & Enable MFA
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep("qr")}>
              Back to QR Code
            </Button>
          </div>
        )}

        {/* RECOVERY CODES STEP */}
        {step === "recovery" && (
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Save these recovery codes in a safe place. Each code can only be used once if you lose access to your authenticator app.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 bg-muted rounded-lg">
              {recoveryCodes.map((code, i) => (
                <code key={i} className="text-sm font-mono text-center py-1">{code}</code>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={handleCopyRecoveryCodes}>
              {copied ? (
                <><Check className="w-4 h-4 mr-2" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4 mr-2" /> Copy Recovery Codes</>
              )}
            </Button>
            <Button className="w-full" onClick={() => handleClose(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
