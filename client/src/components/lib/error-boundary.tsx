import React from 'react';
import { Warning, ArrowCounterClockwise, House } from "@phosphor-icons/react";
import { getTranslation, getSavedLocale } from "@/lib/i18n";

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
}

const MAX_RETRIES = 3;

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error.message, errorInfo.componentStack);
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
      const locale = getSavedLocale();
      const t = (key: string) => getTranslation(locale, key);

      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[200px]" role="alert">
          <div className="p-6 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 rounded-lg text-red-700 dark:text-red-400 max-w-md text-center">
            <Warning className="w-8 h-8 mx-auto mb-3 text-red-500" aria-hidden="true" />
            <p className="font-bold mb-1">{t("error.somethingWentWrong")}</p>
            <p className="text-sm mb-4 text-red-600 dark:text-red-400/80">
              {this.state.error?.message || t("error.unexpectedError")}
            </p>
            <div className="flex items-center justify-center gap-3">
              {canRetry && (
                <button
                  onClick={this.handleRetry}
                  aria-label={t("error.tryAgain")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900/70 rounded-md transition-colors"
                >
                  <ArrowCounterClockwise className="w-4 h-4" aria-hidden="true" />
                  {t("error.tryAgain")}
                </button>
              )}
              <button
                onClick={this.handleNavigateHome}
                aria-label={t("error.goToDashboard")}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md transition-colors"
              >
                <House className="w-4 h-4" aria-hidden="true" />
                {t("error.goToDashboard")}
              </button>
            </div>
            {!canRetry && (
              <p className="text-xs mt-3 text-red-500/70">
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
