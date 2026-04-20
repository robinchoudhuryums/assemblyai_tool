import React from 'react';
import { Warning, ArrowCounterClockwise, House } from "@phosphor-icons/react";
import { getTranslation, getSavedLocale, type Locale } from "@/lib/i18n";
import { captureException } from "@/lib/sentry";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Isolate error to this boundary without affecting parent boundaries */
  isolate?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
  /** Locale captured at catch time so re-renders don't re-read localStorage. */
  locale: Locale;
}

const MAX_RETRIES = 3;

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0, locale: "en" };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error.message, errorInfo.componentStack);
    // Cache the locale once at catch time. Reading localStorage on every
    // fallback render is wasteful and risks throwing in restricted contexts
    // (private mode / sandboxed iframes).
    this.setState({ locale: getSavedLocale() });
    // Report to Sentry through the PHI-scrubbed wrapper. The wrapper no-ops
    // when Sentry is not initialized (e.g. dev mode without VITE_SENTRY_DSN).
    captureException(error, {
      componentStack: errorInfo.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorCount: prev.errorCount + 1,
    }));
  };

  private handleNavigateHome = () => {
    this.setState({ hasError: false, error: null, errorCount: 0 });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const canRetry = this.state.errorCount < MAX_RETRIES;
      const t = (key: string) => getTranslation(this.state.locale, key);

      return (
        <div
          className="flex flex-col items-center justify-center p-8 min-h-[200px]"
          role="alert"
        >
          <div
            className="p-6 rounded-sm max-w-md text-center"
            style={{
              background: "var(--warm-red-soft)",
              border: "1px solid color-mix(in oklch, var(--destructive), transparent 55%)",
              borderLeft: "3px solid var(--destructive)",
              color: "color-mix(in oklch, var(--destructive), var(--ink) 20%)",
            }}
          >
            <Warning
              className="w-8 h-8 mx-auto mb-3"
              style={{ color: "var(--destructive)" }}
              weight="fill"
              aria-hidden="true"
            />
            <p className="font-bold mb-1">{t("error.somethingWentWrong")}</p>
            <p className="text-sm mb-4" style={{ opacity: 0.85 }}>
              {this.state.error?.message || t("error.unexpectedError")}
            </p>
            <div className="flex items-center justify-center gap-3">
              {canRetry && (
                <button
                  onClick={this.handleRetry}
                  aria-label={t("error.tryAgain")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-sm transition-colors"
                  style={{
                    background: "color-mix(in oklch, var(--destructive), transparent 85%)",
                    border:
                      "1px solid color-mix(in oklch, var(--destructive), transparent 60%)",
                    color: "var(--destructive)",
                  }}
                >
                  <ArrowCounterClockwise className="w-4 h-4" aria-hidden="true" />
                  {t("error.tryAgain")}
                </button>
              )}
              <button
                onClick={this.handleNavigateHome}
                aria-label={t("error.goToDashboard")}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-sm transition-colors"
                style={{
                  background: "var(--paper-2)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                }}
              >
                <House className="w-4 h-4" aria-hidden="true" />
                {t("error.goToDashboard")}
              </button>
            </div>
            {!canRetry && (
              <p
                className="text-xs mt-3"
                style={{ color: "var(--destructive)", opacity: 0.7 }}
              >
                {t("error.retriesFailed")}
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
