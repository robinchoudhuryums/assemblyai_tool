import { safeSet } from "./safe-storage";
import { VALID_PALETTES, DEFAULT_PALETTE, type PaletteId, type PaperTone } from "./palettes";

export type Theme = "light" | "dark";

export interface AppearancePrefs {
  theme: Theme;
  palette: PaletteId;
  /**
   * Whether a non-default palette also recolors the paper canvas.
   * "accent" (default, prior behavior) — paper hue follows accent family.
   * "classic" — accent shifts but paper stays the warm cream baseline.
   */
  paperTone: PaperTone;
}

const STORAGE_KEY = "appearance";

const defaults: AppearancePrefs = {
  theme: "light",
  palette: DEFAULT_PALETTE,
  paperTone: "accent",
};

const VALID_PAPER_TONES: PaperTone[] = ["accent", "classic"];

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
      palette: VALID_PALETTES.includes(parsed.palette) ? parsed.palette : DEFAULT_PALETTE,
      // Back-compat: prefs blobs from before this field existed have no
      // `paperTone` key; default to "accent" to preserve prior behavior.
      paperTone: VALID_PAPER_TONES.includes(parsed.paperTone) ? parsed.paperTone : "accent",
    };
  } catch {
    return defaults;
  }
}

export function saveAppearance(prefs: AppearancePrefs): void {
  safeSet(STORAGE_KEY, JSON.stringify(prefs));
  // The legacy "theme" key is read once at first load (see loadAppearance
  // migration branch above) and then never written again. Continuing to
  // sync it on every save risks the two keys drifting if a future code
  // path mutates one and not the other.
}
