/**
 * Dashboard widget configuration — persisted to localStorage.
 * Users can toggle visibility and reorder widgets.
 */
import { safeSet } from "./safe-storage";

export interface WidgetConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
}

const STORAGE_KEY = "dashboard-widgets";

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "metrics", label: "Metrics Overview", visible: true, order: 0 },
  { id: "alerts", label: "Flagged Calls", visible: true, order: 1 },
  { id: "trend", label: "Sentiment Trend (30 Days)", visible: true, order: 2 },
  { id: "upload", label: "File Upload", visible: true, order: 3 },
  { id: "sentiment", label: "Sentiment Analysis", visible: true, order: 4 },
  { id: "performers", label: "Top Performers", visible: true, order: 5 },
  { id: "calls", label: "Recent Calls Table", visible: true, order: 6 },
];

export function loadWidgetConfig(): WidgetConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_WIDGETS;
    const parsed = JSON.parse(saved) as WidgetConfig[];
    // Merge with defaults (in case new widgets were added)
    const savedMap = new Map(parsed.map(w => [w.id, w]));
    return DEFAULT_WIDGETS.map(d => savedMap.get(d.id) || d)
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export function saveWidgetConfig(config: WidgetConfig[]): void {
  safeSet(STORAGE_KEY, JSON.stringify(config));
}

export function moveWidget(config: WidgetConfig[], id: string, direction: "up" | "down"): WidgetConfig[] {
  const idx = config.findIndex(w => w.id === id);
  if (idx < 0) return config;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= config.length) return config;

  const next = [...config];
  [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
  return next.map((w, i) => ({ ...w, order: i }));
}

export function toggleWidget(config: WidgetConfig[], id: string): WidgetConfig[] {
  return config.map(w => w.id === id ? { ...w, visible: !w.visible } : w);
}
