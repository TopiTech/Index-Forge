/**
 * Regression tests for the shared keyboard-target guard.
 *
 * Global Enter handlers in dialogs (e.g. GlobalSearchModal) must not hijack
 * Enter while focus is on an interactive control: preventDefault() cancels the
 * control's activation, which made per-row action buttons unreachable with the
 * keyboard while the handler navigated to the highlighted result instead.
 */
import { describe, expect, it } from "vitest";
import { isInteractiveKeyTarget } from "./keyboardTarget";

/** Minimal fake Element: closest() returns itself for matching selectors. */
function fakeElement(matches: string[]): { closest: (selector: string) => unknown } {
  return {
    closest: (selector: string) =>
      matches.some((m) => selector.includes(m)) ? { tag: "matched" } : null,
  };
}

describe("isInteractiveKeyTarget", () => {
  it("treats buttons, links, inputs and role=button targets as interactive", () => {
    expect(isInteractiveKeyTarget(fakeElement(["button"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["a"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["input"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["select"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["textarea"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["[role='button']"]))).toBe(true);
    expect(isInteractiveKeyTarget(fakeElement(["[role='option']"]))).toBe(true);
  });

  it("exempts the handler's own control (e.g. the search input)", () => {
    const input = fakeElement(["input"]);
    expect(isInteractiveKeyTarget(input, input)).toBe(false);
  });

  it("ignores non-element targets and missing closest()", () => {
    expect(isInteractiveKeyTarget(null)).toBe(false);
    expect(isInteractiveKeyTarget(undefined)).toBe(false);
    expect(isInteractiveKeyTarget({})).toBe(false);
    expect(isInteractiveKeyTarget("body")).toBe(false);
  });

  it("returns false for non-interactive elements", () => {
    expect(isInteractiveKeyTarget(fakeElement([]))).toBe(false);
  });

  it("fails safe when closest() throws", () => {
    const throwing = {
      closest: () => {
        throw new Error("detached");
      },
    };
    expect(isInteractiveKeyTarget(throwing)).toBe(false);
  });
});
