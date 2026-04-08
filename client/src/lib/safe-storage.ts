/**
 * Safe wrappers around `localStorage` that swallow QuotaExceededError,
 * SecurityError (Safari private mode), and the various exceptions thrown
 * when localStorage is unavailable (SSR, blocked-cookie environments,
 * sandbox iframes).
 *
 * Use these wrappers — not raw `localStorage.setItem` — for any non-critical
 * preference persistence (theme, saved filters, dashboard layout, locale).
 * Failures are reported via `console.warn` so they remain debuggable but
 * never throw to the caller.
 */

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Persist a value to localStorage. Returns `true` on success, `false` if
 * the write was swallowed (quota, private mode, blocked storage, etc.).
 */
export function safeSet(key: string, value: string): boolean {
  if (!isStorageAvailable()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[safe-storage] Failed to persist '${key}':`, (err as Error).message);
    return false;
  }
}

/**
 * Read a value from localStorage. Returns `null` on any failure.
 */
export function safeGet(key: string): string | null {
  if (!isStorageAvailable()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Remove a key from localStorage. Returns `true` on success, `false` if
 * swallowed.
 */
export function safeRemove(key: string): boolean {
  if (!isStorageAvailable()) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[safe-storage] Failed to remove '${key}':`, (err as Error).message);
    return false;
  }
}
