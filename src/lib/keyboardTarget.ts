/**
 * Keyboard-target helpers shared by modal search/keyboard navigation code.
 *
 * Global keydown handlers must not hijack Enter (or arrows) while focus sits
 * on an interactive control inside the dialog: calling preventDefault() on
 * Enter cancels the control's activation, which made per-row actions
 * unreachable with the keyboard.
 */

const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [role='option'], [contenteditable='true']";

/**
 * Returns true when the event target is (or is inside) an interactive control
 * that should keep its own keyboard behavior.
 *
 * `exempt` allows the primary control of the handler (e.g. the search input
 * that owns arrow/Enter navigation) to keep the global behavior.
 */
export function isInteractiveKeyTarget(target: unknown, exempt?: unknown): boolean {
  if (!target || target === exempt) return false;
  const element = target as { closest?: (selector: string) => unknown };
  if (typeof element.closest !== "function") return false;
  try {
    return element.closest(INTERACTIVE_SELECTOR) !== null;
  } catch {
    return false;
  }
}
