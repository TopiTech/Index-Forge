/**
 * Utilities for detecting page reload and suppressing page-load animations specifically on reload.
 */

export interface MinimalPerformanceNavigationTiming {
  type?: string;
}

export interface MinimalPerformance {
  getEntriesByType?: (type: string) => MinimalPerformanceNavigationTiming[];
  navigation?: { type?: number };
}

export interface MinimalWindow {
  performance?: MinimalPerformance;
}

export interface MinimalDocument {
  documentElement: {
    classList: {
      add: (token: string) => void;
      remove: (token: string) => void;
      contains: (token: string) => boolean;
    };
  };
}

function resolveGlobalWindow(): MinimalWindow | undefined {
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return (globalThis as unknown as { window?: MinimalWindow }).window;
  }
  return undefined;
}

function resolveGlobalDocument(): MinimalDocument | undefined {
  if (typeof globalThis !== "undefined" && "document" in globalThis) {
    return (globalThis as unknown as { document?: MinimalDocument }).document;
  }
  return undefined;
}

/**
 * Checks whether the current page was loaded via a browser reload (F5, Ctrl+R, reload button, location.reload()).
 * Returns false on normal navigation (links, typing URL, bookmark, forward/back).
 */
export function isPageReload(win?: MinimalWindow): boolean {
  const currentWindow = win ?? resolveGlobalWindow();
  if (!currentWindow || !currentWindow.performance) {
    return false;
  }

  try {
    // Navigation Timing Level 2 (Modern browsers)
    if (typeof currentWindow.performance.getEntriesByType === "function") {
      const navEntries = currentWindow.performance.getEntriesByType("navigation");
      if (navEntries && navEntries.length > 0) {
        const navTiming = navEntries[0];
        return navTiming?.type === "reload";
      }
    }

    // Navigation Timing Level 1 fallback (Legacy browsers)
    const legacyNav = currentWindow.performance.navigation;
    if (legacyNav && typeof legacyNav.type === "number") {
      return legacyNav.type === 1; // TYPE_RELOAD
    }
  } catch {
    return false;
  }

  return false;
}

const SUPPRESSION_CLASS = "is-reload-suppressed";

/**
 * Applies the reload animation suppression CSS class to documentElement if it was a reload.
 */
export function applyReloadSuppressionClass(doc?: MinimalDocument, win?: MinimalWindow): boolean {
  const currentWindow = win ?? resolveGlobalWindow();
  const currentDoc = doc ?? resolveGlobalDocument();
  if (!currentDoc || !isPageReload(currentWindow)) {
    return false;
  }

  currentDoc.documentElement.classList.add(SUPPRESSION_CLASS);
  return true;
}

/**
 * Removes the reload animation suppression CSS class once initial rendering is complete.
 */
export function removeReloadSuppressionClass(doc?: MinimalDocument): void {
  const currentDoc = doc ?? resolveGlobalDocument();
  if (currentDoc) {
    currentDoc.documentElement.classList.remove(SUPPRESSION_CLASS);
  }
}

/**
 * Checks if the reload suppression class is currently applied.
 */
export function isReloadSuppressed(doc?: MinimalDocument): boolean {
  const currentDoc = doc ?? resolveGlobalDocument();
  if (!currentDoc) return false;
  return currentDoc.documentElement.classList.contains(SUPPRESSION_CLASS);
}
