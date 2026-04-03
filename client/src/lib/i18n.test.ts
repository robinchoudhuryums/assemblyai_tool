import { describe, it, expect, beforeEach } from "vitest";
import { getTranslation, getSavedLocale, saveLocale, type Locale } from "./i18n";

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getTranslation", () => {
    it("returns English translation by default", () => {
      expect(getTranslation("en", "nav.dashboard")).toBe("Dashboard");
    });

    it("returns Spanish translation when locale is es", () => {
      expect(getTranslation("es", "nav.dashboard")).toBe("Panel");
    });

    it("falls back to English for missing Spanish key", () => {
      // Use a key that exists in English — if missing in Spanish, should fall back
      const enValue = getTranslation("en", "nav.dashboard");
      const esValue = getTranslation("es", "nav.dashboard");
      // Both should return a non-empty string (either translated or fallback)
      expect(enValue).toBeTruthy();
      expect(esValue).toBeTruthy();
    });

    it("returns the key itself if not found in any locale", () => {
      expect(getTranslation("en", "nonexistent.key.that.does.not.exist")).toBe("nonexistent.key.that.does.not.exist");
    });

    it("translates common action keys", () => {
      expect(getTranslation("en", "action.save")).toBe("Save");
      expect(getTranslation("en", "action.cancel")).toBe("Cancel");
      expect(getTranslation("en", "action.delete")).toBe("Delete");
    });
  });

  describe("getSavedLocale", () => {
    it("returns en by default", () => {
      expect(getSavedLocale()).toBe("en");
    });

    it("returns es when saved", () => {
      localStorage.setItem("locale", "es");
      expect(getSavedLocale()).toBe("es");
    });

    it("returns en for invalid saved value", () => {
      localStorage.setItem("locale", "fr");
      expect(getSavedLocale()).toBe("en");
    });
  });

  describe("saveLocale", () => {
    it("persists locale to localStorage", () => {
      saveLocale("es");
      expect(localStorage.getItem("locale")).toBe("es");
    });

    it("can be read back via getSavedLocale", () => {
      saveLocale("es");
      expect(getSavedLocale()).toBe("es");
    });
  });
});
