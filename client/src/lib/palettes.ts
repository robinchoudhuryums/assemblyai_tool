/**
 * Accent palette registry for the warm-paper design system.
 *
 * The entire accent palette (buttons, links, active nav chips, score
 * tier colors, chart primaries, sidebar stripes, etc.) resolves from
 * just two CSS custom properties in `client/src/index.css`:
 *
 *   --copper        (accent)
 *   --copper-soft   (accent tint)
 *
 * Both have separate values in `:root` (light mode) and `.dark`. Every
 * downstream alias — `--primary`, `--accent`, `--ring`, `--chart-1`,
 * `--sidebar-primary`, `--sidebar-accent` — derives from them.
 *
 * Switching palettes therefore only requires overriding those four
 * values. AppearanceProvider injects a <style id="palette-override">
 * block with the new values when the user picks a non-default palette.
 *
 * NOTE: the variable names still say "copper" even when the resolved
 * value is blue/green/etc. This is a historical artifact — the warm-
 * paper system was designed around copper as the default accent. A
 * future rename to `--accent-source` / `--accent-soft-source` is a
 * mechanical find-replace across ~15 files; deferred to avoid a large
 * diff in this cycle.
 */

export type PaletteId =
  | "copper"
  | "medicalBlue"
  | "corporateBlue"
  | "skyBlue"
  | "indigo"
  | "sage";

export interface PaletteTokens {
  /** --copper in :root (light mode) */
  accent: string;
  /** --copper-soft in :root (light mode) */
  accentSoft: string;
  /** --copper in .dark (dark mode) */
  accentDark: string;
  /** --copper-soft in .dark (dark mode) */
  accentSoftDark: string;
}

export interface PaletteDef {
  id: PaletteId;
  label: string;
  description: string;
  tokens: PaletteTokens;
}

export const PALETTES: Record<PaletteId, PaletteDef> = {
  copper: {
    id: "copper",
    label: "Warm Copper",
    description: "Default. Warm-paper aesthetic.",
    tokens: {
      accent: "oklch(62% 0.12 52)",
      accentSoft: "oklch(92% 0.05 55)",
      accentDark: "oklch(70% 0.12 52)",
      accentSoftDark: "oklch(30% 0.06 52)",
    },
  },
  medicalBlue: {
    id: "medicalBlue",
    label: "Medical Blue",
    description: "Clean and clinical. Cool cast.",
    tokens: {
      accent: "oklch(55% 0.15 230)",
      accentSoft: "oklch(94% 0.04 230)",
      accentDark: "oklch(72% 0.13 230)",
      accentSoftDark: "oklch(32% 0.07 230)",
    },
  },
  corporateBlue: {
    id: "corporateBlue",
    label: "Corporate Blue",
    description: "Muted. Business-classic.",
    tokens: {
      accent: "oklch(52% 0.13 240)",
      accentSoft: "oklch(94% 0.04 240)",
      accentDark: "oklch(70% 0.13 240)",
      accentSoftDark: "oklch(30% 0.07 240)",
    },
  },
  skyBlue: {
    id: "skyBlue",
    label: "Sky Blue",
    description: "Lighter, airier, softer.",
    tokens: {
      accent: "oklch(60% 0.10 220)",
      accentSoft: "oklch(95% 0.03 220)",
      accentDark: "oklch(76% 0.10 220)",
      accentSoftDark: "oklch(30% 0.05 220)",
    },
  },
  indigo: {
    id: "indigo",
    label: "Deep Indigo",
    description: "Richer, more saturated.",
    tokens: {
      accent: "oklch(48% 0.15 250)",
      accentSoft: "oklch(94% 0.04 250)",
      accentDark: "oklch(70% 0.13 250)",
      accentSoftDark: "oklch(30% 0.07 250)",
    },
  },
  sage: {
    id: "sage",
    label: "Sage Forest",
    description: "Calm green. Pairs with warm paper.",
    tokens: {
      accent: "oklch(52% 0.11 150)",
      accentSoft: "oklch(94% 0.05 150)",
      accentDark: "oklch(68% 0.10 150)",
      accentSoftDark: "oklch(30% 0.06 150)",
    },
  },
};

export const VALID_PALETTES: PaletteId[] = Object.keys(PALETTES) as PaletteId[];
export const DEFAULT_PALETTE: PaletteId = "copper";

/**
 * Returns the CSS text to inject into <style id="palette-override">.
 * Returns an empty string for the default palette (copper) because the
 * baseline values already live in index.css — no override needed.
 */
export function paletteCss(id: PaletteId): string {
  if (id === DEFAULT_PALETTE) return "";
  const p = PALETTES[id];
  return [
    ":root{",
    `--copper:${p.tokens.accent};`,
    `--copper-soft:${p.tokens.accentSoft};`,
    "}",
    ".dark{",
    `--copper:${p.tokens.accentDark};`,
    `--copper-soft:${p.tokens.accentSoftDark};`,
    "}",
  ].join("");
}
