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
    });

    it("loads saved preferences", () => {
      localStorage.setItem("appearance", JSON.stringify({
        theme: "dark", background: "hexagons", glass: "medium",
      }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.background).toBe("hexagons");
      expect(prefs.glass).toBe("medium");
    });

    it("migrates from legacy theme key", () => {
      localStorage.setItem("theme", "dark");
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("dark");
      expect(prefs.background).toBe("none"); // default
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

    it("handles corrupted localStorage", () => {
      localStorage.setItem("appearance", "not json{{{");
      const prefs = loadAppearance();
      expect(prefs).toEqual({ theme: "light", background: "none", glass: "strong" });
    });

    it("forces theme to light or dark only", () => {
      localStorage.setItem("appearance", JSON.stringify({ theme: "blue" }));
      const prefs = loadAppearance();
      expect(prefs.theme).toBe("light"); // not "blue"
    });
  });

  describe("saveAppearance", () => {
    it("persists to localStorage", () => {
      const prefs: AppearancePrefs = { theme: "dark", background: "softWaves", glass: "subtle" };
      saveAppearance(prefs);

      const raw = localStorage.getItem("appearance");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe("dark");
      expect(parsed.background).toBe("softWaves");
    });

    it("keeps legacy theme key in sync", () => {
      saveAppearance({ theme: "dark", background: "none", glass: "strong" });
      expect(localStorage.getItem("theme")).toBe("dark");
    });

    it("round-trips through load", () => {
      const prefs: AppearancePrefs = { theme: "dark", background: "neonFlow", glass: "medium" };
      saveAppearance(prefs);
      expect(loadAppearance()).toEqual(prefs);
    });
  });

  describe("VALID_BACKGROUNDS", () => {
    it("includes expected patterns", () => {
      expect(VALID_BACKGROUNDS).toContain("none");
      expect(VALID_BACKGROUNDS).toContain("hexagons");
      expect(VALID_BACKGROUNDS).toContain("softWaves");
    });

    it("has at least 3 options", () => {
      expect(VALID_BACKGROUNDS.length).toBeGreaterThanOrEqual(3);
    });
  });
});
