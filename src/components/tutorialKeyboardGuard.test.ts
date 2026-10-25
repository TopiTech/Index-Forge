import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * U-8 P-3: the tutorial page's global keydown handler must not hijack keys
 * that belong to a focused form control.
 *
 * The page owns single-letter shortcuts ("m" toggles reduced motion, "r"
 * resets the camera) and reuses Space/arrows for step navigation. Skipping
 * only INPUT/TEXTAREA/contentEditable left SELECT behind: pressing "m" with
 * a focused select both type-ahead-searched its options *and* toggled motion
 * state, and preventDefault() swallowed the keystroke. The guard now names
 * the whole editable family, so this test pins every member of it.
 */
const tutorialPageSource = readFileSync(new URL("./TutorialPage.tsx", import.meta.url), "utf8");

describe("tutorial page keyboard guard (U-8 P-3)", () => {
  it("skips shortcut handling for every natively editable focus target", () => {
    for (const tag of ['tagName === "INPUT"', 'tagName === "TEXTAREA"', 'tagName === "SELECT"']) {
      expect(tutorialPageSource).toContain(tag);
    }
    expect(tutorialPageSource).toContain("isContentEditable");
    expect(tutorialPageSource).toContain("if (isInputFocused) return;");
  });

  it("still lets focused buttons keep their native Enter/Space activation", () => {
    // Buttons are deliberately *not* part of the early return above: the
    // per-key branches carve them out so a focused button activates instead
    // of advancing the tutorial.
    expect(tutorialPageSource).toContain('target.tagName !== "BUTTON"');
  });
});
