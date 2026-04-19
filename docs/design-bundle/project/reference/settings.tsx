import { Gear, Sun, Moon } from "@phosphor-icons/react";
import { useAppearance } from "@/components/appearance-provider";
import type { Theme, BackgroundPattern, GlassEffect } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
            value === opt.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GlassPreview({ level }: { level: GlassEffect }) {
  const blurMap = { subtle: "backdrop-blur-sm", medium: "backdrop-blur-md", strong: "backdrop-blur-xl" };
  const alphaMap = { subtle: "bg-white/60 dark:bg-slate-800/60", medium: "bg-white/45 dark:bg-slate-800/50", strong: "bg-white/30 dark:bg-slate-800/35" };
  return (
    <div className="relative w-full h-20 rounded-lg overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-indigo-300 to-cyan-400 dark:from-blue-600 dark:via-indigo-500 dark:to-cyan-600" />
      <div className={cn("absolute inset-2 rounded-md border border-white/40 dark:border-white/10 flex items-center justify-center", blurMap[level], alphaMap[level])}>
        <span className="text-xs font-medium text-foreground/80">Card preview</span>
      </div>
    </div>
  );
}

/** Mini SVG thumbnails for each background option */
function BgPreview({ bg }: { bg: BackgroundPattern }) {
  const base = "absolute inset-0";
  return (
    <div className="relative w-full h-full overflow-hidden rounded-md">
      {/* Base color */}
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
          <span className="text-[9px] text-muted-foreground">Plain</span>
        </div>
      )}
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

export default function SettingsPage() {
  const { theme, background, glass, setTheme, setBackground, setGlass } = useAppearance();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 relative z-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Gear className="w-6 h-6" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">Customize the look and feel of your dashboard</p>
      </div>

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <CardDescription>Switch between light and dark mode</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup<Theme>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
              { value: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
            ]}
          />
        </CardContent>
      </Card>

      {/* Background */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Background</CardTitle>
          <CardDescription>Choose a decorative background pattern</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setBackground(opt.value)}
                className={cn(
                  "rounded-lg border-2 transition-all overflow-hidden text-left",
                  background === opt.value ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="h-20 relative">
                  <BgPreview bg={opt.value} />
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-foreground">{opt.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Glass Effect */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Glass Effect</CardTitle>
          <CardDescription>Control the frosted glass intensity on cards and panels</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <button
                key={level}
                onClick={() => setGlass(level)}
                className={cn(
                  "rounded-lg border-2 transition-all overflow-hidden",
                  glass === level ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/30"
                )}
              >
                <GlassPreview level={level} />
                <p className="text-xs font-medium text-center py-1.5 capitalize text-muted-foreground">{level}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
