/**
 * Capability-safe media-query helpers (DOM boundary).
 *
 * Root cause: two App shell effects and the initial layout probe called
 * `window.matchMedia(...).addEventListener("change", ...)` unconditionally.
 * The shared chart component (`PerformanceChart`) and the accessibility
 * helper (`tutorialAccessibility`) already guard `matchMedia` existence and
 * prefer `addEventListener` with an `addListener` (Safari < 14) fallback, but
 * the App shell did not. On a runtime without `matchMedia` (very old browser,
 * exotic webview, or a test double exposing only `addListener`) the effect
 * threw during commit and the layout sync was lost; without the legacy
 * fallback a Safari < 14 `MediaQueryList` threw on subscribe.
 *
 * These helpers are the single source for that capability detection: missing
 * `matchMedia` degrades to a static `false` (desktop layout) instead of
 * throwing, and subscription prefers `addEventListener` with the legacy
 * `addListener`/`removeListener` fallback. Behaviour on modern browsers is
 * unchanged.
 */

export function getMediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

type LegacyMediaQueryList = {
  matches: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

/**
 * Subscribe to a media query, invoking `handler` with the current `matches`
 * value whenever it changes. Returns an unsubscribe function. Never throws:
 * when the platform cannot observe the query the returned cleanup is a
 * no-op and the handler is never called.
 */
export function subscribeMediaQuery(query: string, handler: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  let mql: LegacyMediaQueryList | null = null;
  try {
    mql = window.matchMedia(query) as unknown as LegacyMediaQueryList;
  } catch {
    return () => {};
  }
  if (!mql) return () => {};
  const listener = (): void => {
    try {
      handler(mql.matches);
    } catch {
      // A throwing consumer must not break the subscription itself.
    }
  };
  try {
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", listener);
      return () => {
        try {
          mql?.removeEventListener?.("change", listener);
        } catch {
          // Detach is best-effort on teardown.
        }
      };
    }
    if (typeof mql.addListener === "function") {
      mql.addListener(listener);
      return () => {
        try {
          mql?.removeListener?.(listener);
        } catch {
          // Detach is best-effort on teardown.
        }
      };
    }
  } catch {
    // Subscription unsupported on this platform.
  }
  return () => {};
}
