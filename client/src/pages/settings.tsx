import { Gear, Sun, Moon, GridFour, DotsNine, Waves, Subtract } from "@phosphor-icons/react";
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
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
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

      {/* Background Pattern */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Background Pattern</CardTitle>
          <CardDescription>Add a subtle pattern behind the gradient background</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleGroup<BackgroundPattern>
            value={background}
            onChange={setBackground}
            options={[
              { value: "none", label: "None", icon: <Subtract className="w-4 h-4" /> },
              { value: "grid", label: "Grid", icon: <GridFour className="w-4 h-4" /> },
              { value: "dots", label: "Dots", icon: <DotsNine className="w-4 h-4" /> },
              { value: "waves", label: "Waves", icon: <Waves className="w-4 h-4" /> },
            ]}
          />
          <div className="grid grid-cols-4 gap-2 mt-2">
            {(["none", "grid", "dots", "waves"] as BackgroundPattern[]).map((bg) => (
              <button
                key={bg}
                onClick={() => setBackground(bg)}
                className={cn(
                  "relative h-16 rounded-lg overflow-hidden border-2 transition-all",
                  background === bg ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-sky-100 via-slate-100 to-blue-200 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950" />
                {bg === "grid" && (
                  <div className="absolute inset-0" style={{
                    backgroundImage: "linear-gradient(rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.15) 1px, transparent 1px)",
                    backgroundSize: "12px 12px",
                  }} />
                )}
                {bg === "dots" && (
                  <div className="absolute inset-0" style={{
                    backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.25) 1px, transparent 1px)",
                    backgroundSize: "8px 8px",
                  }} />
                )}
                {bg === "waves" && (
                  <div className="absolute inset-0" style={{
                    backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(148,163,184,0.1) 6px, rgba(148,163,184,0.1) 7px)",
                  }} />
                )}
                <span className="absolute bottom-0.5 inset-x-0 text-center text-[9px] font-medium text-foreground/60 capitalize">{bg}</span>
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
