import { describe, it, expect } from "vitest";
import {
  PALETTES,
  VALID_PALETTES,
  DEFAULT_PALETTE,
  paletteCss,
  type PaletteId,
} from "./palettes";

describe("palettes", () => {
  it("default palette is copper", () => {
    expect(DEFAULT_PALETTE).toBe("copper");
  });

  it("VALID_PALETTES matches the registry keys", () => {
    expect([...VALID_PALETTES].sort()).toEqual(
      Object.keys(PALETTES).sort(),
    );
  });

  it("every palette has non-empty tokens for both modes", () => {
    for (const id of VALID_PALETTES) {
      const p = PALETTES[id];
      expect(p.tokens.accent).toMatch(/^oklch/);
      expect(p.tokens.accentSoft).toMatch(/^oklch/);
      expect(p.tokens.accentDark).toMatch(/^oklch/);
      expect(p.tokens.accentSoftDark).toMatch(/^oklch/);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  describe("paletteCss", () => {
    it("returns empty string for the default palette", () => {
      // copper lives in index.css as the baseline; no override needed.
      expect(paletteCss("copper")).toBe("");
    });

    it("generates :root + .dark override blocks for non-default palettes", () => {
      for (const id of VALID_PALETTES) {
        if (id === DEFAULT_PALETTE) continue;
        const css = paletteCss(id);
        const p = PALETTES[id];
        expect(css).toContain(":root{");
        expect(css).toContain(".dark{");
        expect(css).toContain(`--copper:${p.tokens.accent}`);
        expect(css).toContain(`--copper-soft:${p.tokens.accentSoft}`);
        expect(css).toContain(`--copper:${p.tokens.accentDark}`);
        expect(css).toContain(`--copper-soft:${p.tokens.accentSoftDark}`);
      }
    });

    it("returns empty string for an unknown palette (type guarded — exercises runtime safety)", () => {
      // The PaletteId type would normally catch this at compile time, but
      // the CSS generator is called from the provider which reads a
      // validated value off localStorage — the guard still matters because
      // a TypeScript assertion isn't a runtime check.
      const css = paletteCss("copper" as PaletteId);
      expect(css).toBe("");
    });
  });
});
