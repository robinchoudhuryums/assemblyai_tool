import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  type Theme,
  type AppearancePrefs,
  loadAppearance,
  saveAppearance,
} from "@/lib/appearance";
import { type PaletteId, type PaperTone, paletteCss } from "@/lib/palettes";

interface AppearanceContextValue {
  theme: Theme;
  palette: PaletteId;
  paperTone: PaperTone;
  setTheme: (t: Theme) => void;
  setPalette: (p: PaletteId) => void;
  setPaperTone: (tone: PaperTone) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}

const PALETTE_STYLE_ID = "palette-override";

export default function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppearancePrefs>(loadAppearance);

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  // Apply palette override by injecting a <style> block that redefines
  // --copper + --copper-soft (always) and the paper-tone tokens (when
  // the palette defines them AND paperTone is "accent") for both :root
  // and .dark. The default palette ("copper") yields an empty string
  // and we remove the style element entirely so the baseline values
  // from index.css apply.
  useEffect(() => {
    const css = paletteCss(prefs.palette, prefs.paperTone);
    let styleEl = document.getElementById(PALETTE_STYLE_ID) as HTMLStyleElement | null;
    if (!css) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = PALETTE_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  }, [prefs.palette, prefs.paperTone]);

  const update = useCallback((partial: Partial<AppearancePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveAppearance(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t: Theme) => update({ theme: t }), [update]);
  const setPalette = useCallback((p: PaletteId) => update({ palette: p }), [update]);
  const setPaperTone = useCallback((tone: PaperTone) => update({ paperTone: tone }), [update]);

  return (
    <AppearanceContext.Provider
      value={{
        theme: prefs.theme,
        palette: prefs.palette,
        paperTone: prefs.paperTone,
        setTheme,
        setPalette,
        setPaperTone,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
