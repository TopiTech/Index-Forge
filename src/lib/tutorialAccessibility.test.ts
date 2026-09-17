import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TUTORIAL_STEPS,
  TUTORIAL_KEYBOARD_SHORTCUTS,
  getSystemPrefersReducedMotion,
  formatAccessibilityAnnouncement,
} from "./tutorialAccessibility";

describe("tutorialAccessibility", () => {
  it("defines all 4 core tutorial steps with complete required fields", () => {
    expect(TUTORIAL_STEPS).toHaveLength(4);
    TUTORIAL_STEPS.forEach((step, index) => {
      expect(step.id).toBe(index + 1);
      expect(step.title).toBeTruthy();
      expect(step.subtitle).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(step.keyAction).toBeTruthy();
      expect(step.sceneDescription).toBeTruthy();
      expect(step.ariaAnnouncement).toContain(`ステップ${index + 1}`);
    });
  });

  it("contains navigation, 3D camera, and accessibility keyboard shortcuts", () => {
    const categories = new Set(TUTORIAL_KEYBOARD_SHORTCUTS.map((s) => s.category));
    expect(categories.has("navigation")).toBe(true);
    expect(categories.has("3d_camera")).toBe(true);
    expect(categories.has("accessibility")).toBe(true);

    const keys = TUTORIAL_KEYBOARD_SHORTCUTS.map((s) => s.key);
    expect(keys.some((k) => k.includes("Esc"))).toBe(true);
    expect(keys.some((k) => k.includes("R"))).toBe(true);
    expect(keys.some((k) => k.includes("M"))).toBe(true);
  });

  describe("getSystemPrefersReducedMotion", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns false in non-browser or when matchMedia matches false", () => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      });
      expect(getSystemPrefersReducedMotion()).toBe(false);
    });

    it("returns true when system prefers-reduced-motion matches", () => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn().mockImplementation((query) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
        })),
      });
      expect(getSystemPrefersReducedMotion()).toBe(true);
    });
  });

  describe("formatAccessibilityAnnouncement", () => {
    it("formats standard step announcement", () => {
      const step = TUTORIAL_STEPS[0];
      const announcement = formatAccessibilityAnnouncement(step);
      expect(announcement).toBe(step.ariaAnnouncement);
    });

    it("appends reduced motion note when enabled", () => {
      const step = TUTORIAL_STEPS[1];
      const announcement = formatAccessibilityAnnouncement(step, { isReducedMotion: true });
      expect(announcement).toContain("3Dアニメーションは軽減・静止モードです");
    });

    it("appends paused auto-rotate note when paused without reduced motion", () => {
      const step = TUTORIAL_STEPS[2];
      const announcement = formatAccessibilityAnnouncement(step, { isAutoRotatePaused: true });
      expect(announcement).toContain("3D自動回転は一時停止中です");
    });
  });
});
