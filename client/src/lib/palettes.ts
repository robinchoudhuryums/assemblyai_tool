/**
 * Accent palette registry for the warm-paper design system.
 *
 * Originally just two tokens (`--copper`, `--copper-soft`) controlled
 * every accent surface. The RAG sibling app (ums-knowledge-reference)
 * extended that pattern to ALSO recolor the paper-tone background
 * per-palette — cool-paper for blues, green-tinted for sage, etc. —
 * so users who pick a non-default accent get a harmonized surface
 * rather than just the accent bolted onto the same cream paper.
 *
 * This file ports the wider schema. `tokens` (accent pair) remains
 * the core contract; new OPTIONAL `lightPaper` + `darkPaper` fields
 * let a palette also override paper / ink / hairline. When unset, the
 * baseline warm-paper values in index.css apply (current behavior).
 *
 * Design rule for picking paper-tone values: in light mode keep L ≥ 95%
 * and C ≤ 0.02 so the surface still reads as "paper" rather than "tinted
 * page". Hue is pulled from the accent family. Dark mode stays cool-
 * neutral to avoid a muddy warm-tinted dark surface.
 *
 * NOTE: the CSS variable names still say `--copper` / `--copper-soft`
 * even when the resolved value is blue/green. Historical artifact;
 * rename to `--accent-source` etc. is a deferred mechanical refactor.
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

/**
 * Full surface recolor — maps to CSS `--paper`, `--paper-2`,
 * `--paper-card`, `--ink`, `--muted-ink`, `--hairline`. Optional per
 * palette; absent = baseline warm-paper values apply.
 */
export interface PaperTokens {
  /** Page canvas — dominant warm-paper surface. */
  paper: string;
  /** Secondary surface — muted panels, filter bars. Slightly tinted. */
  paper2: string;
  /** Elevated surface — cards, popovers. Usually ~white in light. */
  paperCard: string;
  /** Primary text color on paper. */
  ink: string;
  /** Muted text (kickers, timestamps, helper copy). */
  mutedInk: string;
  /** Hairline border color. */
  hairline: string;
}

export interface PaletteDef {
  id: PaletteId;
  label: string;
  description: string;
  tokens: PaletteTokens;
  /** Optional per-palette light-mode paper recolor. */
  lightPaper?: PaperTokens;
  /** Optional per-palette dark-mode paper recolor. Usually unused — a
   *  shared cool-neutral dark surface looks good across accent hues. */
  darkPaper?: PaperTokens;
}

// Baseline dark paper — cool neutral, shared across non-default
// palettes by default so dark mode doesn't develop dissonant warm
// undertones from accent-family hues.
const SHARED_DARK_PAPER: PaperTokens = {
  paper: "hsl(220, 28%, 7%)",
  paper2: "hsl(220, 25%, 11%)",
  paperCard: "hsl(220, 25%, 9%)",
  ink: "hsl(36, 20%, 92%)",
  mutedInk: "hsl(30, 10%, 60%)",
  hairline: "hsl(220, 18%, 18%)",
};

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
    description: "Clean and clinical. Cool-tinted paper.",
    tokens: {
      accent: "oklch(55% 0.15 230)",
      accentSoft: "oklch(94% 0.04 230)",
      accentDark: "oklch(72% 0.13 230)",
      accentSoftDark: "oklch(32% 0.07 230)",
    },
    lightPaper: {
      paper: "oklch(97% 0.008 230)",
      paper2: "oklch(94% 0.012 230)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 230)",
      mutedInk: "oklch(52% 0.018 230)",
      hairline: "oklch(89% 0.012 230)",
    },
    darkPaper: SHARED_DARK_PAPER,
  },
  corporateBlue: {
    id: "corporateBlue",
    label: "Corporate Blue",
    description: "Muted business-classic with cool paper.",
    tokens: {
      accent: "oklch(52% 0.13 240)",
      accentSoft: "oklch(94% 0.04 240)",
      accentDark: "oklch(70% 0.13 240)",
      accentSoftDark: "oklch(30% 0.07 240)",
    },
    lightPaper: {
      paper: "oklch(97% 0.007 240)",
      paper2: "oklch(94% 0.010 240)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 240)",
      mutedInk: "oklch(52% 0.018 240)",
      hairline: "oklch(89% 0.010 240)",
    },
    darkPaper: SHARED_DARK_PAPER,
  },
  skyBlue: {
    id: "skyBlue",
    label: "Sky Blue",
    description: "Lighter, airier paper with soft sky accent.",
    tokens: {
      accent: "oklch(60% 0.10 220)",
      accentSoft: "oklch(95% 0.03 220)",
      accentDark: "oklch(76% 0.10 220)",
      accentSoftDark: "oklch(30% 0.05 220)",
    },
    lightPaper: {
      paper: "oklch(97% 0.006 220)",
      paper2: "oklch(95% 0.009 220)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 220)",
      mutedInk: "oklch(52% 0.018 220)",
      hairline: "oklch(89% 0.010 220)",
    },
    darkPaper: SHARED_DARK_PAPER,
  },
  indigo: {
    id: "indigo",
    label: "Deep Indigo",
    description: "Richer paper with saturated indigo accent.",
    tokens: {
      accent: "oklch(48% 0.15 250)",
      accentSoft: "oklch(94% 0.04 250)",
      accentDark: "oklch(70% 0.13 250)",
      accentSoftDark: "oklch(30% 0.07 250)",
    },
    lightPaper: {
      paper: "oklch(97% 0.008 250)",
      paper2: "oklch(94% 0.012 250)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 250)",
      mutedInk: "oklch(52% 0.018 250)",
      hairline: "oklch(89% 0.012 250)",
    },
    darkPaper: SHARED_DARK_PAPER,
  },
  sage: {
    id: "sage",
    label: "Sage Forest",
    description: "Calm green-tinted paper with sage accent.",
    tokens: {
      accent: "oklch(52% 0.11 150)",
      accentSoft: "oklch(94% 0.05 150)",
      accentDark: "oklch(68% 0.10 150)",
      accentSoftDark: "oklch(30% 0.06 150)",
    },
    lightPaper: {
      paper: "oklch(97% 0.008 150)",
      paper2: "oklch(94% 0.012 150)",
      paperCard: "hsl(0, 0%, 100%)",
      ink: "oklch(20% 0.02 150)",
      mutedInk: "oklch(52% 0.018 150)",
      hairline: "oklch(89% 0.012 150)",
    },
    darkPaper: SHARED_DARK_PAPER,
  },
};

export const VALID_PALETTES: PaletteId[] = Object.keys(PALETTES) as PaletteId[];
export const DEFAULT_PALETTE: PaletteId = "copper";

/**
 * Returns the CSS text to inject into <style id="palette-override">.
 * Returns an empty string for the default palette (copper) because the
 * baseline values already live in index.css — no override needed.
 *
 * When a palette defines `lightPaper` / `darkPaper`, the emitted CSS
 * redefines the full paper-tone token set alongside the accent pair so
 * every downstream alias (`--background`, `--card`, `--border`, etc.)
 * updates. Palettes without paper overrides emit just the accent pair
 * (preserving the pre-widening behavior).
 */
export function paletteCss(id: PaletteId): string {
  if (id === DEFAULT_PALETTE) return "";
  const p = PALETTES[id];
  const lines: string[] = [":root{"];
  lines.push(`--copper:${p.tokens.accent};`);
  lines.push(`--copper-soft:${p.tokens.accentSoft};`);
  if (p.lightPaper) {
    lines.push(`--paper:${p.lightPaper.paper};`);
    lines.push(`--paper-2:${p.lightPaper.paper2};`);
    lines.push(`--paper-card:${p.lightPaper.paperCard};`);
    lines.push(`--ink:${p.lightPaper.ink};`);
    lines.push(`--muted-ink:${p.lightPaper.mutedInk};`);
    lines.push(`--hairline:${p.lightPaper.hairline};`);
  }
  lines.push("}");
  lines.push(".dark{");
  lines.push(`--copper:${p.tokens.accentDark};`);
  lines.push(`--copper-soft:${p.tokens.accentSoftDark};`);
  if (p.darkPaper) {
    lines.push(`--paper:${p.darkPaper.paper};`);
    lines.push(`--paper-2:${p.darkPaper.paper2};`);
    lines.push(`--paper-card:${p.darkPaper.paperCard};`);
    lines.push(`--ink:${p.darkPaper.ink};`);
    lines.push(`--muted-ink:${p.darkPaper.mutedInk};`);
    lines.push(`--hairline:${p.darkPaper.hairline};`);
  }
  lines.push("}");
  return lines.join("");
}
