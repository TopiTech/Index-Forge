// Mark a browser reload so the UI can suppress its entry animation.
//
// This lives outside index.html so the production Content Security Policy can
// keep script-src limited to same-origin external scripts (no 'unsafe-inline').
// The script is loaded synchronously from <head> so the class is applied
// before the first paint of the application shell.
(() => {
  try {
    const performance = window.performance;
    const navigationEntries =
      performance && performance.getEntriesByType
        ? performance.getEntriesByType("navigation")
        : null;
    const isReload =
      (navigationEntries && navigationEntries.length > 0 && navigationEntries[0].type === "reload") ||
      (performance && performance.navigation && performance.navigation.type === 1);
    if (isReload) {
      document.documentElement.classList.add("is-reload-suppressed");
    }
  } catch {
    // A browser without the Navigation Timing API simply gets no suppression.
  }
})();
