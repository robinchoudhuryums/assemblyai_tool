import { describe, it, expect } from "vitest";
import { ROLE_CONFIG, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from "./constants";

describe("constants", () => {
  describe("ROLE_CONFIG", () => {
    it("defines config for all three roles", () => {
      expect(ROLE_CONFIG).toHaveProperty("viewer");
      expect(ROLE_CONFIG).toHaveProperty("manager");
      expect(ROLE_CONFIG).toHaveProperty("admin");
    });

    it("each role has label, badgeClass, and color", () => {
      for (const [role, config] of Object.entries(ROLE_CONFIG)) {
        expect(config.label).toBeTruthy();
        expect(config.badgeClass).toBeTruthy();
        expect(config.color).toBeTruthy();
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
