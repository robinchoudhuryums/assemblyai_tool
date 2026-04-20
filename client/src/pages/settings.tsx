import { Sun, Moon } from "@phosphor-icons/react";
import { Link } from "wouter";
import { useAppearance } from "@/components/appearance-provider";
import type { Theme, BackgroundPattern, GlassEffect } from "@/lib/appearance";
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
// GlassPreview — intentionally retains its pre-warm-paper blue gradient
// chrome; the preview is a "here's what each glass level does" sample,
// not a canvas we style to match the surrounding page. Do NOT migrate
// this SVG/gradient to warm-paper tokens.
// ─────────────────────────────────────────────────────────────

function GlassPreview({ level }: { level: GlassEffect }) {
  const blurMap = { subtle: "backdrop-blur-sm", medium: "backdrop-blur-md", strong: "backdrop-blur-xl" };
  const alphaMap = {
    subtle: "bg-white/60 dark:bg-slate-800/60",
    medium: "bg-white/45 dark:bg-slate-800/50",
    strong: "bg-white/30 dark:bg-slate-800/35",
  };
  return (
    <div className="relative w-full h-20 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-indigo-300 to-cyan-400 dark:from-blue-600 dark:via-indigo-500 dark:to-cyan-600" />
      <div
        className={cn(
          "absolute inset-2 rounded-sm border border-white/40 dark:border-white/10 flex items-center justify-center",
          blurMap[level],
          alphaMap[level],
        )}
      >
        <span className="text-xs font-medium text-foreground/80">Card preview</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BgPreview — SVG thumbnails for each decorative background option.
// These are intentionally NOT warm-paper styled: they show the user
// what each non-default background looks like so they can pick one if
// they prefer a different aesthetic over warm paper.
// ─────────────────────────────────────────────────────────────

function BgPreview({ bg }: { bg: BackgroundPattern }) {
  const base = "absolute inset-0";
  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className={cn(base, "bg-slate-50 dark:bg-slate-900")} />

      {bg === "hexagons" && (
        <svg className={cn(base)} viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">
          <g stroke="currentColor" className="text-slate-300 dark:text-slate-600" fill="none" strokeWidth="0.5" opacity="0.5">
            <polygon points="14,0 28,8 28,24 14,32 0,24 0,8" />
            <polygon points="42,0 56,8 56,24 42,32 28,24 28,8" />
            <polygon points="70,0 84,8 84,24 70,32 56,24 56,8" />
            <polygon points="98,0 112,8 112,24 98,32 84,24 84,8" />
            <polygon points="28,24 42,32 42,48 28,56 14,48 14,32" />
            <polygon points="56,24 70,32 70,48 56,56 42,48 42,32" />
            <polygon points="84,24 98,32 98,48 84,56 70,48 70,32" />
            <polygon points="14,48 28,56 28,72 14,80 0,72 0,56" />
            <polygon points="42,48 56,56 56,72 42,80 28,72 28,56" />
            <polygon points="70,48 84,56 84,72 70,80 56,72 56,56" />
            <polygon points="98,48 112,56 112,72 98,80 84,72 84,56" />
          </g>
          <g opacity="0.4">
            <polygon points="14,0 28,8 28,24 14,32 0,24 0,8" fill="hsl(217,80%,70%)" opacity="0.5" transform="translate(14,48)" />
            <polygon points="14,0 28,8 28,24 14,32 0,24 0,8" fill="hsl(280,50%,70%)" opacity="0.4" transform="translate(56,24)" />
            <polygon points="14,0 28,8 28,24 14,32 0,24 0,8" fill="hsl(330,60%,72%)" opacity="0.4" transform="translate(84,0)" />
          </g>
        </svg>
      )}

      {bg === "softWaves" && (
        <svg className={cn(base)} viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="80" fill="hsl(210,80%,95%)" className="dark:hidden" />
          <rect width="120" height="80" fill="hsl(220,30%,10%)" className="hidden dark:block" />
          <path d="M-10,50 C20,35 40,55 70,40 C100,25 110,45 130,35 L130,80 L-10,80 Z" fill="hsl(210,90%,85%)" opacity="0.5" className="dark:hidden" />
          <path d="M-10,30 C30,50 50,35 80,45 C110,55 120,30 130,40 L130,80 L-10,80 Z" fill="hsl(210,85%,90%)" opacity="0.4" className="dark:hidden" />
          <path d="M-10,50 C20,35 40,55 70,40 C100,25 110,45 130,35 L130,80 L-10,80 Z" fill="hsl(215,50%,18%)" opacity="0.5" className="hidden dark:block" />
          <path d="M-10,30 C30,50 50,35 80,45 C110,55 120,30 130,40 L130,80 L-10,80 Z" fill="hsl(210,45%,14%)" opacity="0.4" className="hidden dark:block" />
        </svg>
      )}

      {bg === "neonFlow" && (
        <svg className={cn(base)} viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="80" fill="hsl(220,40%,6%)" />
          <path d="M0,38 C20,30 40,45 60,37 C80,29 90,42 120,35" fill="none" stroke="hsl(340,85%,60%)" strokeWidth="1.5" opacity="0.7" />
          <path d="M0,42 C20,35 40,48 60,40 C80,32 90,45 120,38" fill="none" stroke="hsl(330,80%,55%)" strokeWidth="1" opacity="0.5" />
          <path d="M0,40 C20,45 50,33 70,42 C90,51 100,38 120,43" fill="none" stroke="hsl(190,85%,55%)" strokeWidth="1.5" opacity="0.7" />
          <path d="M0,44 C20,48 50,36 70,45 C90,54 100,41 120,46" fill="none" stroke="hsl(180,80%,50%)" strokeWidth="1" opacity="0.5" />
          <circle cx="25" cy="36" r="1" fill="hsl(340,80%,60%)" opacity="0.6" />
          <circle cx="95" cy="40" r="1" fill="hsl(185,80%,55%)" opacity="0.6" />
        </svg>
      )}

      {bg === "topoMesh" && (
        <svg className={cn(base)} viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">
          <rect width="120" height="80" fill="hsl(220,70%,55%)" opacity="0.1" className="dark:hidden" />
          <rect width="120" height="80" fill="hsl(260,35%,14%)" className="hidden dark:block" />
          <g fill="none" strokeWidth="0.5" opacity="0.25">
            <ellipse cx="80" cy="40" rx="35" ry="38" className="stroke-white dark:stroke-violet-400" />
            <ellipse cx="81" cy="39" rx="28" ry="30" className="stroke-white dark:stroke-violet-400" />
            <ellipse cx="82" cy="38" rx="21" ry="22" className="stroke-white dark:stroke-violet-400" />
            <ellipse cx="83" cy="37" rx="14" ry="14" className="stroke-white dark:stroke-violet-400" />
            <ellipse cx="84" cy="36" rx="7" ry="7" className="stroke-white dark:stroke-violet-400" />
            <path d="M60,10 C70,5 85,8 95,15 C105,22 110,12 120,18" className="stroke-white dark:stroke-violet-400" />
            <path d="M65,20 C75,15 88,18 98,25 C108,32 113,22 120,28" className="stroke-white dark:stroke-violet-400" />
          </g>
        </svg>
      )}

      {bg === "none" && (
        <div className={cn(base, "flex items-center justify-center")}>
          <span
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 9, letterSpacing: "0.1em" }}
          >
            Plain
          </span>
        </div>
      )}
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

const BG_OPTIONS: { value: BackgroundPattern; label: string; description: string }[] = [
  { value: "none", label: "None", description: "Clean background" },
  { value: "hexagons", label: "Hexagons", description: "Isometric cubes, blue to pink" },
  { value: "softWaves", label: "Soft Waves", description: "Gentle flowing blue curves" },
  { value: "neonFlow", label: "Neon Flow", description: "Glowing energy waves" },
  { value: "topoMesh", label: "Topo Mesh", description: "Organic contour lines" },
];

// ─────────────────────────────────────────────────────────────
// Selection tile — warm-paper card with a (possibly non-warm-paper)
// preview inset, a mono-uppercase label, and a description. Copper
// accent ring when the option is active.
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
  const { theme, background, glass, palette, setTheme, setBackground, setGlass, setPalette } = useAppearance();

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

        {/* Background */}
        <SettingsPanel
          kicker="Background"
          title="Decorative pattern"
          description="Pick a full-page decorative background, or leave it plain (recommended for warm-paper). The previews below intentionally display the native style of each option; they are NOT rendered in the warm-paper palette."
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BG_OPTIONS.map((opt) => (
              <SelectionTile
                key={opt.value}
                active={background === opt.value}
                onClick={() => setBackground(opt.value)}
                label={opt.label}
                description={opt.description}
              >
                <BgPreview bg={opt.value} />
              </SelectionTile>
            ))}
          </div>
        </SettingsPanel>

        {/* Glass effect */}
        <SettingsPanel
          kicker="Glass"
          title="Frosted card intensity"
          description="Controls how translucent cards and the sidebar appear when a decorative background is active. No visible effect when Background is set to None."
        >
          <div className="space-y-5">
            <ToggleGroup<GlassEffect>
              value={glass}
              onChange={setGlass}
              options={[
                { value: "subtle", label: "Subtle" },
                { value: "medium", label: "Medium" },
                { value: "strong", label: "Strong" },
              ]}
            />
            <div className="grid grid-cols-3 gap-3">
              {(["subtle", "medium", "strong"] as GlassEffect[]).map((level) => (
                <SelectionTile
                  key={level}
                  active={glass === level}
                  onClick={() => setGlass(level)}
                  label={level}
                >
                  <GlassPreview level={level} />
                </SelectionTile>
              ))}
            </div>
          </div>
        </SettingsPanel>
      </div>
    </div>
  );
}
