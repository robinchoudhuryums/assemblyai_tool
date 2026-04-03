import { describe, it, expect, beforeEach } from "vitest";
import { loadSavedFilters, saveSavedFilter, deleteSavedFilter } from "./saved-filters";

describe("saved-filters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty array when no filters saved", () => {
    expect(loadSavedFilters()).toEqual([]);
  });

  it("saves and loads a filter", () => {
    const saved = saveSavedFilter({ name: "Test", status: "completed", sentiment: "positive", employee: "all" });
    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe("Test");
    expect(saved.createdAt).toBeTruthy();

    const loaded = loadSavedFilters();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Test");
  });

  it("saves multiple filters", () => {
    saveSavedFilter({ name: "Filter 1", status: "all", sentiment: "all", employee: "all" });
    saveSavedFilter({ name: "Filter 2", status: "failed", sentiment: "negative", employee: "all" });

    const loaded = loadSavedFilters();
    expect(loaded).toHaveLength(2);
  });

  it("deletes a filter by id", () => {
    const saved = saveSavedFilter({ name: "Delete Me", status: "all", sentiment: "all", employee: "all" });
    saveSavedFilter({ name: "Keep Me", status: "all", sentiment: "all", employee: "all" });

    deleteSavedFilter(saved.id);
    const loaded = loadSavedFilters();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Keep Me");
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("saved-call-filters", "not valid json{{{");
    expect(loadSavedFilters()).toEqual([]);
  });

  it("deleting non-existent id is a no-op", () => {
    saveSavedFilter({ name: "Survivor", status: "all", sentiment: "all", employee: "all" });
    deleteSavedFilter("non-existent-id");
    expect(loadSavedFilters()).toHaveLength(1);
  });
});
