import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TUTORIAL_STEPS,
  TUTORIAL_KEYBOARD_SHORTCUTS,
  formatAccessibilityAnnouncement,
} from "./tutorialAccessibility";
import {
  isTutorialCompleted,
  setTutorialCompleted,
  resetTutorialStatus,
  shouldShowTutorialOnLaunch,
} from "./tutorialStorage";
import { parseViewFromLocation, getViewPath } from "./navigation";

function createStorageMock(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("Tutorial End-to-End Integration & Accessibility Audit", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createStorageMock();
    vi.stubGlobal("localStorage", mockStorage);
    vi.stubGlobal("window", {
      localStorage: mockStorage,
      location: {
        pathname: "/",
        search: "",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("First Launch Detection & Flow", () => {
    it("routes initial user directly to tutorial on fresh launch", () => {
      // Clean storage (first launch)
      resetTutorialStatus();
      expect(isTutorialCompleted()).toBe(false);

      // shouldShowTutorialOnLaunch returns true
      const shouldShow = shouldShowTutorialOnLaunch({ pathname: "/", search: "" });
      expect(shouldShow).toBe(true);
    });

    it("marks completed when user finishes or skips, suppressing future auto-shows", () => {
      // Simulate completion
      setTutorialCompleted(true);
      expect(isTutorialCompleted()).toBe(true);

      // On next visit to root, shouldShowTutorialOnLaunch returns false
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "" })).toBe(false);
      expect(parseViewFromLocation("/")).toBe("dashboard");
    });

    it("allows existing user to explicitly re-enter tutorial via URL or menu", () => {
      setTutorialCompleted(true);

      // Query param ?tutorial=1
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?tutorial=1" })).toBe(true);
      // Path /tutorial
      expect(parseViewFromLocation("/tutorial")).toBe("tutorial");
      expect(getViewPath("tutorial")).toBe("/tutorial");
    });
  });

  describe("Accessibility & Screen Reader Content Verification", () => {
    it("ensures each step has a comprehensive aria-live announcement", () => {
      TUTORIAL_STEPS.forEach((step, index) => {
        expect(step.id).toBe(index + 1);
        expect(step.ariaAnnouncement).toMatch(new RegExp(`ステップ${index + 1}`));
        expect(step.sceneDescription).toBeTruthy();

        const normalAnnouncement = formatAccessibilityAnnouncement(step);
        expect(normalAnnouncement).toBe(step.ariaAnnouncement);

        const reducedAnnouncement = formatAccessibilityAnnouncement(step, { isReducedMotion: true });
        expect(reducedAnnouncement).toContain("軽減・静止モード");

        const pausedAnnouncement = formatAccessibilityAnnouncement(step, { isAutoRotatePaused: true });
        expect(pausedAnnouncement).toContain("一時停止中");
      });
    });

    it("verifies keyboard shortcuts for all accessibility categories", () => {
      const keys = TUTORIAL_KEYBOARD_SHORTCUTS.map((s) => s.key);
      expect(keys.some((k) => k.includes("Esc"))).toBe(true);
      expect(keys.some((k) => k.includes("Enter"))).toBe(true);
      expect(keys.some((k) => k.includes("M"))).toBe(true);
      expect(keys.some((k) => k.includes("R"))).toBe(true);
      expect(keys.some((k) => k.includes("Space"))).toBe(true);
    });
  });
});
