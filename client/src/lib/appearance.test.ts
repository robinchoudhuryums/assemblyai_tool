import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAppearance,
  saveAppearance,
  type AppearancePrefs,
} from "./appearance";

describe("appearance", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadAppearance", () => {
    it("returns defaults when nothing saved", () => {
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("light");
      expect(prefs.palette).toBe("copper");
      expect(prefs.paperTone).toBe("accent");
    });

    it("loads saved preferences", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark", palette: "medicalBlue",
      }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.palette).toBe("medicalBlue");
    });

    it("loads saved paperTone", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", palette: "sage", paperTone: "classic",
      }));
      const prefs = loadAppearance();
      expect(prefs.paperTone).toBe("classic");
    });

    it("defaults paperTone to 'accent' on prefs blobs without the field (back-compat)", () => {
      // Pre-existing prefs in localStorage from before this field shipped
      // must continue to load with the default tone, preserving the
      // accent-recolors-paper behavior they had before.
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark", palette: "medicalBlue",
      }));
      expect(loadAppearance().paperTone).toBe("accent");
    });

    it("validates paperTone against whitelist", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", palette: "copper", paperTone: "rainbow",
      }));
      expect(loadAppearance().paperTone).toBe("accent"); // falls back
    });

    it("migrates from legacy theme key", () => {
      localStorage.setItem("theme", "dark");
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.palette).toBe("copper"); // default
    });

    it("validates palette against whitelist", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", palette: "notAPalette",
      }));
      const prefs = loadAppearance();
      expect(prefs.palette).toBe("copper"); // falls back to default
    });

    it("silently drops legacy background + glass fields", () => {
      // Prior versions stored `background` and `glass` for the
      // decorative-background + frosted-card features that were removed
      // once the warm-paper system replaced them. Saved prefs from that
      // era must still load cleanly with the extra fields ignored.
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark",
        palette: "skyBlue",
        background: "hexagons",
        glass: "medium",
      }));
      const prefs = loadAppearance() as AppearancePrefs & { background?: unknown; glass?: unknown };
      expect(prefs.theme).toBe("dark");
      expect(prefs.palette).toBe("skyBlue");
      expect(prefs.background).toBeUndefined();
      expect(prefs.glass).toBeUndefined();
    });

    it("handles missing palette field on minimal saved prefs", () => {
      localStorage.setItem("appearance", JSON.stringify({ theme: "dark" }));
      const prefs = loadAppearance();
      expect(prefs.palette).toBe("copper"); // missing → default
      expect(prefs.theme).toBe("dark"); // other fields unaffected
    });

    it("handles corrupted localStorage", () => {
      localStorage.setItem("appearance", "not json{{{");
      const prefs = loadAppearance();
      expect(prefs).toEqual({ theme: "light", palette: "copper", paperTone: "accent" });
    });

    it("forces theme to light or dark only", () => {
      localStorage.setItem("appearance", JSON.stringify({ theme: "blue" }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("light"); // not "blue"
    });
  });

  describe("saveAppearance", () => {
    it("persists to localStorage", () => {
      const prefs: AppearancePrefs = { theme: "dark", palette: "corporateBlue", paperTone: "accent" };
      saveAppearance(prefs);

      const raw = localStorage.getItem("appearance");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe("dark");
      expect(parsed.palette).toBe("corporateBlue");
      expect(parsed.paperTone).toBe("accent");
    });

    it("does NOT write the legacy 'theme' key (A23)", () => {
      // The legacy key is read once for migration in loadAppearance and
      // then never touched again; saveAppearance must not keep mirroring it,
      // or the two keys can drift on partial writes.
      saveAppearance({ theme: "dark", palette: "copper", paperTone: "accent" });
      expect(localStorage.getItem("theme")).toBeNull();
    });

    it("round-trips through load", () => {
      const prefs: AppearancePrefs = { theme: "dark", palette: "skyBlue", paperTone: "classic" };
      saveAppearance(prefs);
      expect(loadAppearance()).toEqual(prefs);
    });
  });
});
