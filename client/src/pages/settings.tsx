import { Sun, Moon } from "@phosphor-icons/react";
import { Link } from "wouter";
import { useAppearance } from "@/components/appearance-provider";
import type { Theme } from "@/lib/appearance";
import { PALETTES, VALID_PALETTES, type PaletteDef, type PaletteId } from "@/lib/palettes";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Warm-paper primitives — kept local to this page (matches the pattern
// used in admin.tsx / employees.tsx) so each installment can move
// independently. Batch B will consolidate into a shared module.
// ─────────────────────────────────────────────────────────────

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.14em" }}
    >
      {children}
    </div>
  );
}

function SettingsPanel({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border border-border bg-card overflow-hidden">
      <div className="p-6 border-b border-border">
        <SectionKicker>{kicker}</SectionKicker>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: 18, letterSpacing: "-0.2px", lineHeight: 1.2 }}
        >
          {title}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5" style={{ maxWidth: 560 }}>
            {description}
          </p>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Warm-paper segmented toggle (mono uppercase chips, inverted-ink when
// selected). Mirrors the AdminTab pattern.
// ─────────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex gap-2 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "font-mono uppercase inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors",
              active
                ? "bg-foreground text-background border border-foreground"
                : "bg-card border border-border text-foreground hover:bg-secondary",
            )}
            style={{ fontSize: 10, letterSpacing: "0.1em" }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PalettePreview — three swatches (accent / accent-soft / dark-accent)
// on a warm-paper backdrop. Intentionally uses the palette's raw token
// values (not `var(--accent)`) so that the preview shows the option,
// not the currently active palette.
// ─────────────────────────────────────────────────────────────

function PalettePreview({ palette }: { palette: PaletteDef }) {
  const { tokens } = palette;
  return (
    <div
      className="relative w-full h-full flex items-center justify-center gap-2"
      style={{ background: "var(--paper-2)" }}
    >
      <span
        className="w-8 h-8 rounded-full"
        style={{ background: tokens.accent }}
        aria-hidden="true"
      />
      <span
        className="w-8 h-8 rounded-full border border-border"
        style={{ background: tokens.accentSoft }}
        aria-hidden="true"
      />
      <span
        className="w-2 h-8 rounded-sm"
        style={{ background: tokens.accentDark }}
        aria-hidden="true"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Selection tile — warm-paper card with a preview inset, a mono-
// uppercase label, and a description. Accent ring when active.
// ─────────────────────────────────────────────────────────────

function SelectionTile({
  active,
  onClick,
  label,
  description,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm overflow-hidden text-left transition-colors bg-card border",
        active ? "" : "hover:bg-secondary/40",
      )}
      style={{
        borderColor: active
          ? "var(--accent)"
          : "var(--border)",
        boxShadow: active
          ? "inset 0 0 0 1px color-mix(in oklch, var(--accent), transparent 70%)"
          : "none",
      }}
    >
      <div className="h-20">{children}</div>
      <div className="p-3 border-t border-border">
        <div
          className="font-mono uppercase"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            color: active ? "var(--accent)" : "var(--foreground)",
          }}
        >
          {label}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1" style={{ lineHeight: 1.4 }}>
            {description}
          </p>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { theme, palette, setTheme, setPalette } = useAppearance();

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="settings-page">
      {/* App bar */}
      <div
        className="flex items-center gap-3 px-7 py-3 bg-card border-b border-border"
        style={{ fontSize: 12 }}
      >
        <nav
          className="flex items-center gap-2 font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
          aria-label="Breadcrumb"
        >
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <span className="text-muted-foreground/40">›</span>
          <span className="text-foreground">Settings</span>
        </nav>
      </div>

      {/* Page header */}
      <div className="px-7 pt-6 pb-4 bg-background border-b border-border">
        <SectionKicker>Appearance</SectionKicker>
        <div
          className="font-display font-medium text-foreground mt-1"
          style={{ fontSize: "clamp(24px, 3vw, 30px)", letterSpacing: "-0.6px", lineHeight: 1.15 }}
        >
          Settings
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Tune the look and feel of the dashboard. Preferences are stored per-browser (not per-account) and apply
          immediately without a reload.
        </p>
      </div>

      <div className="px-7 py-6 max-w-4xl space-y-6">
        {/* Theme */}
        <SettingsPanel
          kicker="Theme"
          title="Light / dark"
          description="Switches the warm-paper palette into its dark-mode variant. Surfaces stay cool-neutral in dark mode to avoid a muddy-warm tint."
        >
          <ToggleGroup<Theme>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light", icon: <Sun style={{ width: 12, height: 12 }} /> },
              { value: "dark", label: "Dark", icon: <Moon style={{ width: 12, height: 12 }} /> },
            ]}
          />
        </SettingsPanel>

        {/* Accent palette */}
        <SettingsPanel
          kicker="Accent"
          title="Color palette"
          description="Changes the accent color across buttons, active navigation, score tiles, and chart primaries. The semantic signal colors (sage for positive, warm-red for negative, amber for warnings) stay fixed so scoring cues remain readable."
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {VALID_PALETTES.map((id: PaletteId) => {
              const def = PALETTES[id];
              return (
                <SelectionTile
                  key={id}
                  active={palette === id}
                  onClick={() => setPalette(id)}
                  label={def.label}
                  description={def.description}
                >
                  <PalettePreview palette={def} />
                </SelectionTile>
              );
            })}
          </div>
        </SettingsPanel>
      </div>
    </div>
  );
}
