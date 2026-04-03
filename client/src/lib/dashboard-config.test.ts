import { describe, it, expect, beforeEach } from "vitest";
import {
  loadWidgetConfig,
  saveWidgetConfig,
  moveWidget,
  toggleWidget,
  DEFAULT_WIDGETS,
} from "./dashboard-config";

describe("dashboard-config", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadWidgetConfig", () => {
    it("returns defaults when nothing saved", () => {
      const config = loadWidgetConfig();
      expect(config).toHaveLength(DEFAULT_WIDGETS.length);
      expect(config[0].id).toBe("metrics");
      expect(config[0].visible).toBe(true);
    });

    it("loads saved config and merges with defaults", () => {
      const custom = [{ id: "metrics", label: "Custom Metrics", visible: false, order: 0 }];
      localStorage.setItem("dashboard-widgets", JSON.stringify(custom));

      const config = loadWidgetConfig();
      expect(config).toHaveLength(DEFAULT_WIDGETS.length); // all widgets present
      const metrics = config.find(w => w.id === "metrics");
      expect(metrics?.visible).toBe(false); // saved override applied
      expect(metrics?.label).toBe("Custom Metrics");
    });

    it("handles corrupted localStorage gracefully", () => {
      localStorage.setItem("dashboard-widgets", "broken json!!!");
      const config = loadWidgetConfig();
      expect(config).toEqual(DEFAULT_WIDGETS);
    });

    it("includes new default widgets missing from saved config", () => {
      // Save only one widget — rest should come from defaults
      const partial = [{ id: "metrics", label: "Metrics", visible: true, order: 0 }];
      localStorage.setItem("dashboard-widgets", JSON.stringify(partial));

      const config = loadWidgetConfig();
      expect(config.length).toBe(DEFAULT_WIDGETS.length);
      expect(config.some(w => w.id === "calls")).toBe(true); // not in saved, from defaults
    });
  });

  describe("saveWidgetConfig", () => {
    it("persists config to localStorage", () => {
      saveWidgetConfig(DEFAULT_WIDGETS);
      const raw = localStorage.getItem("dashboard-widgets");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(DEFAULT_WIDGETS.length);
    });
  });

  describe("moveWidget", () => {
    it("moves a widget up", () => {
      const result = moveWidget(DEFAULT_WIDGETS, "alerts", "up");
      expect(result[0].id).toBe("alerts");
      expect(result[1].id).toBe("metrics");
    });

    it("moves a widget down", () => {
      const result = moveWidget(DEFAULT_WIDGETS, "metrics", "down");
      expect(result[0].id).toBe("alerts");
      expect(result[1].id).toBe("metrics");
    });

    it("does nothing when moving first widget up", () => {
      const result = moveWidget(DEFAULT_WIDGETS, "metrics", "up");
      expect(result[0].id).toBe("metrics");
    });

    it("does nothing when moving last widget down", () => {
      const last = DEFAULT_WIDGETS[DEFAULT_WIDGETS.length - 1];
      const result = moveWidget(DEFAULT_WIDGETS, last.id, "down");
      expect(result[result.length - 1].id).toBe(last.id);
    });

    it("does nothing for non-existent widget id", () => {
      const result = moveWidget(DEFAULT_WIDGETS, "nonexistent", "up");
      expect(result).toEqual(DEFAULT_WIDGETS);
    });

    it("updates order numbers after move", () => {
      const result = moveWidget(DEFAULT_WIDGETS, "alerts", "up");
      result.forEach((w, i) => {
        expect(w.order).toBe(i);
      });
    });
  });

  describe("toggleWidget", () => {
    it("toggles visibility off", () => {
      const result = toggleWidget(DEFAULT_WIDGETS, "metrics");
      const metrics = result.find(w => w.id === "metrics");
      expect(metrics?.visible).toBe(false);
    });

    it("toggles visibility on", () => {
      const hidden = DEFAULT_WIDGETS.map(w => w.id === "metrics" ? { ...w, visible: false } : w);
      const result = toggleWidget(hidden, "metrics");
      const metrics = result.find(w => w.id === "metrics");
      expect(metrics?.visible).toBe(true);
    });

    it("does not affect other widgets", () => {
      const result = toggleWidget(DEFAULT_WIDGETS, "metrics");
      const alerts = result.find(w => w.id === "alerts");
      expect(alerts?.visible).toBe(true); // unchanged
    });
  });
});
