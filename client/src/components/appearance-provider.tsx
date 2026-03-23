import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  type Theme,
  type BackgroundPattern,
  type GlassEffect,
  type AppearancePrefs,
  loadAppearance,
  saveAppearance,
} from "@/lib/appearance";

interface AppearanceContextValue {
  theme: Theme;
  background: BackgroundPattern;
  glass: GlassEffect;
  setTheme: (t: Theme) => void;
  setBackground: (b: BackgroundPattern) => void;
  setGlass: (g: GlassEffect) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}

export default function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppearancePrefs>(loadAppearance);

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  // Apply glass level as data attribute on <html>
  useEffect(() => {
    document.documentElement.dataset.glass = prefs.glass;
  }, [prefs.glass]);

  // Apply background pattern as data attribute on <html>
  useEffect(() => {
    document.documentElement.dataset.bg = prefs.background;
  }, [prefs.background]);

  const update = useCallback((partial: Partial<AppearancePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveAppearance(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((t: Theme) => update({ theme: t }), [update]);
  const setBackground = useCallback((b: BackgroundPattern) => update({ background: b }), [update]);
  const setGlass = useCallback((g: GlassEffect) => update({ glass: g }), [update]);

  return (
    <AppearanceContext.Provider value={{ theme: prefs.theme, background: prefs.background, glass: prefs.glass, setTheme, setBackground, setGlass }}>
      {children}
    </AppearanceContext.Provider>
  );
}
