/**
 * Manages tutorial completion state and determines whether the tutorial should be shown on initial launch.
 */

export const TUTORIAL_STORAGE_KEY = "indexforge_tutorial_seen_v1";

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface WindowLike {
  localStorage?: StorageLike;
  location?: {
    pathname: string;
    search: string;
  };
}

function getGlobalWindow(): WindowLike | undefined {
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return (globalThis as unknown as { window?: WindowLike }).window;
  }
  return undefined;
}

/**
 * Checks if localStorage is available in the current environment.
 */
function isStorageAvailable(): boolean {
  try {
    const win = getGlobalWindow();
    return typeof win !== "undefined" && typeof win.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Returns whether the tutorial has already been completed or dismissed.
 */
export function isTutorialCompleted(): boolean {
  if (!isStorageAvailable()) return false;
  try {
    const win = getGlobalWindow();
    return win?.localStorage?.getItem(TUTORIAL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Updates the tutorial completion state in localStorage.
 */
export function setTutorialCompleted(completed: boolean = true): void {
  if (!isStorageAvailable()) return;
  try {
    const win = getGlobalWindow();
    if (completed) {
      win?.localStorage?.setItem(TUTORIAL_STORAGE_KEY, "true");
    } else {
      win?.localStorage?.removeItem(TUTORIAL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage write errors (e.g. private mode quota limit)
  }
}

/**
 * Resets the tutorial completion state (useful for debugging, testing, or "replay tutorial" feature).
 */
export function resetTutorialStatus(): void {
  setTutorialCompleted(false);
}

export interface LaunchConditionOptions {
  pathname?: string;
  search?: string;
}

/**
 * Determines whether the tutorial page should be displayed upon launch.
 *
 * Rules:
 * 1. If explicit query (?tutorial=1, ?tutorial=true, ?page=tutorial) or path (/tutorial) is present, returns true.
 * 2. If explicit suppression (?tutorial=0, ?tutorial=false) is present, returns false.
 * 3. If explicit other page is requested (/admin, /builder, /portfolio, /disclaimer), returns false.
 * 4. Otherwise (default entry /), returns true ONLY IF the tutorial has NOT yet been completed.
 */
export function shouldShowTutorialOnLaunch(options?: LaunchConditionOptions): boolean {
  const win = getGlobalWindow();
  const pathname = options?.pathname ?? win?.location?.pathname ?? "/";
  const search = options?.search ?? win?.location?.search ?? "";

  const params = new URLSearchParams(search);
  const tutorialParam = params.get("tutorial");
  const pageParam = params.get("page");

  // Explicit suppression query
  if (tutorialParam === "0" || tutorialParam === "false" || tutorialParam === "none") {
    return false;
  }

  // Explicit activation query or path
  if (
    tutorialParam === "1" ||
    tutorialParam === "true" ||
    pageParam === "tutorial" ||
    pathname === "/tutorial"
  ) {
    return true;
  }

  // If another explicit subpage is requested by path or page param, don't interrupt with tutorial
  if (
    pathname === "/admin" ||
    pathname === "/builder" ||
    pathname === "/simulator" ||
    pathname === "/portfolio" ||
    pathname === "/profile" ||
    pathname === "/disclaimer" ||
    pageParam === "admin" ||
    pageParam === "builder" ||
    pageParam === "portfolio" ||
    pageParam === "disclaimer"
  ) {
    return false;
  }

  // Standard initial launch: show only if not completed yet
  return !isTutorialCompleted();
}
