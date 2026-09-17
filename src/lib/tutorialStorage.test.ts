import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TUTORIAL_STORAGE_KEY,
  isTutorialCompleted,
  setTutorialCompleted,
  resetTutorialStatus,
  shouldShowTutorialOnLaunch,
} from "./tutorialStorage";

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

describe("tutorialStorage", () => {
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

  describe("completion flag handling", () => {
    it("returns false initially when no key exists", () => {
      expect(isTutorialCompleted()).toBe(false);
    });

    it("returns true after setTutorialCompleted(true)", () => {
      setTutorialCompleted(true);
      expect(isTutorialCompleted()).toBe(true);
      expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe("true");
    });

    it("resets back to false with resetTutorialStatus()", () => {
      setTutorialCompleted(true);
      expect(isTutorialCompleted()).toBe(true);

      resetTutorialStatus();
      expect(isTutorialCompleted()).toBe(false);
      expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
    });

    it("handles storage write exceptions gracefully", () => {
      vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      expect(() => setTutorialCompleted(true)).not.toThrow();
    });
  });

  describe("shouldShowTutorialOnLaunch", () => {
    it("returns true on initial visit to root '/' when tutorial is not completed", () => {
      expect(isTutorialCompleted()).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "" })).toBe(true);
    });

    it("returns false on root '/' once tutorial is marked completed", () => {
      setTutorialCompleted(true);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "" })).toBe(false);
    });

    it("returns true if explicit query ?tutorial=1 or ?tutorial=true is provided even if completed", () => {
      setTutorialCompleted(true);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?tutorial=1" })).toBe(true);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?tutorial=true" })).toBe(true);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?page=tutorial" })).toBe(true);
    });

    it("returns true if pathname is /tutorial even if completed", () => {
      setTutorialCompleted(true);
      expect(shouldShowTutorialOnLaunch({ pathname: "/tutorial", search: "" })).toBe(true);
    });

    it("returns false if explicit suppression query ?tutorial=0 or ?tutorial=false is provided", () => {
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?tutorial=0" })).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?tutorial=false" })).toBe(false);
    });

    it("returns false if specific subpages like /admin or /builder are accessed directly on first visit", () => {
      expect(isTutorialCompleted()).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/admin", search: "" })).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/builder", search: "" })).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/portfolio", search: "" })).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/disclaimer", search: "" })).toBe(false);
      expect(shouldShowTutorialOnLaunch({ pathname: "/", search: "?page=admin" })).toBe(false);
    });
  });
});
