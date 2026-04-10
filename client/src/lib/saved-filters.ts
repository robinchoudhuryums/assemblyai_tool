/**
 * Saved search filters — persisted to localStorage.
 * Users can save, load, and delete named filter presets.
 */
import { safeSet, safeGet } from "./safe-storage";

export interface SavedFilter {
  id: string;
  name: string;
  status: string;
  sentiment: string;
  employee: string;
  createdAt: string;
}

const STORAGE_KEY = "saved-call-filters";

export function loadSavedFilters(): SavedFilter[] {
  try {
    const saved = safeGet(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveSavedFilter(filter: Omit<SavedFilter, "id" | "createdAt">): SavedFilter {
  const filters = loadSavedFilters();
  const newFilter: SavedFilter = {
    ...filter,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  filters.push(newFilter);
  safeSet(STORAGE_KEY, JSON.stringify(filters));
  return newFilter;
}

export function deleteSavedFilter(id: string): void {
  const filters = loadSavedFilters().filter(f => f.id !== id);
  safeSet(STORAGE_KEY, JSON.stringify(filters));
}
