import { safeSet } from "./safe-storage";

export type Theme = "light" | "dark";
export type BackgroundPattern = "none" | "hexagons" | "softWaves" | "neonFlow" | "topoMesh";
export type GlassEffect = "subtle" | "medium" | "strong";

export const VALID_BACKGROUNDS: BackgroundPattern[] = ["none", "hexagons", "softWaves", "neonFlow", "topoMesh"];

export interface AppearancePrefs {
  theme: Theme;
  background: BackgroundPattern;
  glass: GlassEffect;
}

const STORAGE_KEY = "appearance";

const defaults: AppearancePrefs = {
  theme: "light",
  background: "none",
  glass: "strong",
};

export function loadAppearance(): AppearancePrefs {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate from old "theme" key if present
      const oldTheme = localStorage.getItem("theme");
      if (oldTheme === "dark" || oldTheme === "light") {
        return { ...defaults, theme: oldTheme };
      }
      // Respect OS dark mode preference
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        return { ...defaults, theme: "dark" };
      }
      return defaults;
    }
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      background: VALID_BACKGROUNDS.includes(parsed.background) ? parsed.background : "none",
      glass: ["subtle", "medium", "strong"].includes(parsed.glass) ? parsed.glass : "strong",
    };
  } catch {
    return defaults;
  }
}

export function saveAppearance(prefs: AppearancePrefs): void {
  safeSet(STORAGE_KEY, JSON.stringify(prefs));
  // Keep old key in sync for backwards compat
  safeSet("theme", prefs.theme);
}
