import { describe, it, expect } from "vitest";
import {
  STAGES,
  deriveStage,
  deriveSource,
  categoryMeta,
  growthCopyForCategory,
  dueDaysFromIso,
} from "./primitives";

describe("coaching primitives — derivation helpers", () => {
  describe("deriveStage", () => {
    it("maps pending → open", () => {
      expect(deriveStage({ status: "pending", actionPlan: [] })).toBe("open");
    });

    it("maps completed → signed-off", () => {
      expect(deriveStage({ status: "completed", actionPlan: [] })).toBe("signed-off");
    });

    it("maps dismissed → null so callers can filter it out", () => {
      expect(deriveStage({ status: "dismissed", actionPlan: [] })).toBeNull();
    });

    it("maps in_progress with no action items → plan", () => {
      expect(deriveStage({ status: "in_progress", actionPlan: [] })).toBe("plan");
      expect(deriveStage({ status: "in_progress", actionPlan: undefined })).toBe("plan");
    });

    it("maps in_progress with zero completed action items → plan", () => {
      expect(
        deriveStage({
          status: "in_progress",
          actionPlan: [
            { task: "a", completed: false },
            { task: "b", completed: false },
          ],
        }),
      ).toBe("plan");
    });

    it("maps in_progress with some (but not all) completed → practice", () => {
      expect(
        deriveStage({
          status: "in_progress",
          actionPlan: [
            { task: "a", completed: true },
            { task: "b", completed: false },
          ],
        }),
      ).toBe("practice");
    });

    it("maps in_progress with all completed → evidence", () => {
      expect(
        deriveStage({
          status: "in_progress",
          actionPlan: [
            { task: "a", completed: true },
            { task: "b", completed: true },
          ],
        }),
      ).toBe("evidence");
    });
  });

  describe("deriveSource", () => {
    it("returns 'ai' for System-prefixed assignedBy", () => {
      expect(deriveSource("System (AI Coaching Plan)")).toBe("ai");
      expect(deriveSource("system")).toBe("ai");
      expect(deriveSource("  System Auto Generator  ")).toBe("ai");
    });

    it("returns 'manager' for human names", () => {
      expect(deriveSource("Jordan Kim")).toBe("manager");
      expect(deriveSource("alex@ums.example")).toBe("manager");
    });

    it("returns 'manager' for null / undefined / empty", () => {
      expect(deriveSource(null)).toBe("manager");
      expect(deriveSource(undefined)).toBe("manager");
      expect(deriveSource("")).toBe("manager");
    });
  });

  describe("categoryMeta", () => {
    it("returns dedicated meta for known categories", () => {
      expect(categoryMeta("compliance").label).toBe("Compliance");
      expect(categoryMeta("customer_experience").label).toBe("Empathy");
      expect(categoryMeta("recognition").glyph).toBe("◉");
    });

    it("falls back to generic meta for unknown / null / undefined", () => {
      expect(categoryMeta("unknown_value").label).toBe("General");
      expect(categoryMeta(null).label).toBe("General");
      expect(categoryMeta(undefined).label).toBe("General");
    });

    it("returns hue values within OKLCH range", () => {
      for (const cat of ["compliance", "customer_experience", "communication", "resolution", "performance", "recognition", "general"]) {
        const m = categoryMeta(cat);
        expect(m.hue).toBeGreaterThanOrEqual(0);
        expect(m.hue).toBeLessThanOrEqual(360);
      }
    });
  });

  describe("growthCopyForCategory", () => {
    it("returns canned warm-framing for known categories", () => {
      expect(growthCopyForCategory("compliance")).toContain("habit");
      expect(growthCopyForCategory("customer_experience")).toContain("heard");
      expect(growthCopyForCategory("recognition")).toContain("Excellent");
    });

    it("returns empty string for general (caller hides line)", () => {
      expect(growthCopyForCategory("general")).toBe("");
    });

    it("returns empty string for unknown / null", () => {
      expect(growthCopyForCategory("unknown")).toBe("");
      expect(growthCopyForCategory(null)).toBe("");
    });
  });

  describe("dueDaysFromIso", () => {
    it("returns 0 for a date that's today", () => {
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      expect(dueDaysFromIso(today.toISOString())).toBe(0);
    });

    it("returns positive int for future dates", () => {
      const future = new Date();
      future.setDate(future.getDate() + 7);
      expect(dueDaysFromIso(future.toISOString())).toBe(7);
    });

    it("returns negative int for past dates (overdue)", () => {
      const past = new Date();
      past.setDate(past.getDate() - 3);
      expect(dueDaysFromIso(past.toISOString())).toBe(-3);
    });

    it("returns null for missing / malformed dates", () => {
      expect(dueDaysFromIso(null)).toBeNull();
      expect(dueDaysFromIso(undefined)).toBeNull();
      expect(dueDaysFromIso("")).toBeNull();
      expect(dueDaysFromIso("not-a-date")).toBeNull();
    });
  });

  describe("STAGES", () => {
    it("has exactly 5 stages in lifecycle order", () => {
      expect(STAGES).toHaveLength(5);
      expect(STAGES.map((s) => s.id)).toEqual([
        "open",
        "plan",
        "practice",
        "evidence",
        "signed-off",
      ]);
    });
  });
});
