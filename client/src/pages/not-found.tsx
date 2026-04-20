import { Link } from "wouter";
import { WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

// ─────────────────────────────────────────────────────────────
// 404 page — warm-paper treatment. Single centered panel with copper
// warning glyph, display-font heading, and a "Back to dashboard" link.
// Keeps translation strings (`error.pageNotFound`, `error.pageNotFoundDesc`).
// ─────────────────────────────────────────────────────────────
export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center bg-background text-foreground px-6"
      data-testid="not-found-page"
    >
      <div
        className="w-full max-w-md rounded-sm border bg-card px-8 py-10"
        style={{ borderColor: "var(--border)" }}
        role="alert"
      >
        <div className="flex items-center gap-3">
          <div
            className="rounded-full flex items-center justify-center shrink-0"
            style={{
              width: 44,
              height: 44,
              background: "var(--warm-red-soft)",
              border: "1px solid color-mix(in oklch, var(--destructive), transparent 55%)",
            }}
          >
            <WarningCircle
              style={{ width: 22, height: 22, color: "var(--destructive)" }}
              weight="fill"
              aria-hidden="true"
            />
          </div>
          <div>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: "0.18em" }}
            >
              404
            </div>
            <h1
              className="font-display font-medium text-foreground mt-0.5"
              style={{
                fontSize: "clamp(20px, 2.5vw, 26px)",
                letterSpacing: "-0.4px",
                lineHeight: 1.15,
              }}
            >
              {t("error.pageNotFound")}
            </h1>
          </div>
        </div>

        <p
          className="text-muted-foreground mt-5"
          style={{ fontSize: 14, lineHeight: 1.6 }}
        >
          {t("error.pageNotFoundDesc")}
        </p>

        <div className="mt-6 pt-5 border-t border-border">
          <Link href="/">
            <Button size="sm">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
