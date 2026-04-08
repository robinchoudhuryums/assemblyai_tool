import { describe, it, expect } from "vitest";
import { ROLE_CONFIG, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from "./constants";

describe("constants", () => {
  describe("ROLE_CONFIG", () => {
    it("defines config for all three roles", () => {
      expect(ROLE_CONFIG).toHaveProperty("viewer");
      expect(ROLE_CONFIG).toHaveProperty("manager");
      expect(ROLE_CONFIG).toHaveProperty("admin");
    });

    it("each role has non-empty label, badgeClass, and color strings", () => {
      for (const [role, config] of Object.entries(ROLE_CONFIG)) {
        expect(typeof config.label, `${role}.label not a string`).toBe("string");
        expect(config.label.length, `${role}.label is empty`).toBeGreaterThan(0);
        expect(typeof config.badgeClass, `${role}.badgeClass not a string`).toBe("string");
        expect(config.badgeClass.length, `${role}.badgeClass is empty`).toBeGreaterThan(0);
        // badgeClass should reference at least one Tailwind color utility.
        expect(config.badgeClass, `${role}.badgeClass missing color class`).toMatch(/(bg|text)-/);
        expect(config.color, `${role}.color missing text- prefix`).toMatch(/^text-/);
      }
    });

    it("labels are human-readable", () => {
      expect(ROLE_CONFIG.viewer.label).toBe("Viewer");
      expect(ROLE_CONFIG.admin.label).toBe("Admin");
    });
  });

  describe("pagination", () => {
    it("PAGE_SIZE_OPTIONS contains valid sizes", () => {
      expect(PAGE_SIZE_OPTIONS.length).toBeGreaterThan(0);
      for (const size of PAGE_SIZE_OPTIONS) {
        expect(size).toBeGreaterThan(0);
      }
    });

    it("DEFAULT_PAGE_SIZE is in PAGE_SIZE_OPTIONS", () => {
      expect((PAGE_SIZE_OPTIONS as readonly number[]).includes(DEFAULT_PAGE_SIZE)).toBe(true);
    });
  });
});
