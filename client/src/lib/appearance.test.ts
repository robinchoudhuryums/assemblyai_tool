import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAppearance,
  saveAppearance,
  VALID_BACKGROUNDS,
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
      expect(prefs.background).toBe("none");
      expect(prefs.glass).toBe("strong");
      expect(prefs.palette).toBe("copper");
    });

    it("loads saved preferences", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark", background: "hexagons", glass: "medium", palette: "medicalBlue",
      }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.background).toBe("hexagons");
      expect(prefs.glass).toBe("medium");
      expect(prefs.palette).toBe("medicalBlue");
    });

    it("migrates from legacy theme key", () => {
      localStorage.setItem("theme", "dark");
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.background).toBe("none"); // default
      expect(prefs.palette).toBe("copper"); // default
    });

    it("validates background against whitelist", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", background: "invalidPattern", glass: "strong",
      }));
      const prefs = loadAppearance();
      expect(prefs.background).toBe("none"); // falls back to default
    });

    it("validates glass effect", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", background: "none", glass: "extreme",
      }));
      const prefs = loadAppearance();
      expect(prefs.glass).toBe("strong"); // falls back to default
    });

    it("validates palette against whitelist", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "light", background: "none", glass: "strong", palette: "notAPalette",
      }));
      const prefs = loadAppearance();
      expect(prefs.palette).toBe("copper"); // falls back to default
    });

    it("handles missing palette field on legacy saved prefs", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark", background: "hexagons", glass: "medium",
      }));
      const prefs = loadAppearance();
      expect(prefs.palette).toBe("copper"); // missing → default
      expect(prefs.theme).toBe("dark"); // other fields unaffected
    });

    it("handles corrupted localStorage", () => {
      localStorage.setItem("appearance", "not json{{{");
      const prefs = loadAppearance();
      expect(prefs).toEqual({ theme: "light", background: "none", glass: "strong", palette: "copper" });
    });

    it("forces theme to light or dark only", () => {
      localStorage.setItem("appearance", JSON.stringify({ theme: "blue" }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("light"); // not "blue"
    });
  });

  describe("saveAppearance", () => {
    it("persists to localStorage", () => {
      const prefs: AppearancePrefs = { theme: "dark", background: "softWaves", glass: "subtle", palette: "corporateBlue" };
      saveAppearance(prefs);

      const raw = localStorage.getItem("appearance");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe("dark");
      expect(parsed.background).toBe("softWaves");
      expect(parsed.palette).toBe("corporateBlue");
    });

    it("does NOT write the legacy 'theme' key (A23)", () => {
      // The legacy key is read once for migration in loadAppearance and
      // then never touched again; saveAppearance must not keep mirroring it,
      // or the two keys can drift on partial writes.
      saveAppearance({ theme: "dark", background: "none", glass: "strong", palette: "copper" });
      expect(localStorage.getItem("theme")).toBeNull();
    });

    it("round-trips through load", () => {
      const prefs: AppearancePrefs = { theme: "dark", background: "neonFlow", glass: "medium", palette: "skyBlue" };
      saveAppearance(prefs);
      expect(loadAppearance()).toEqual(prefs);
    });
  });

  describe("VALID_BACKGROUNDS", () => {
    it("matches the BackgroundPattern union exactly", () => {
      // If the union grows or shrinks, this should fail loudly so the
      // schema, the runtime list, and the validator all stay in sync.
      expect([...VALID_BACKGROUNDS].sort()).toEqual(
        ["hexagons", "neonFlow", "none", "softWaves", "topoMesh"].sort(),
      );
    });
  });
});
