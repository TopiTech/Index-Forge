import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getSavedDimensions } from "../components/TradingViewChartModal";

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

describe("TradingView Widget & Chart Modal Stability Enhancements", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createStorageMock();
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. CSS Resize Conflict Elimination & Responsive Maximize", () => {
    const cssPath = resolve(__dirname, "../index.css");
    const css = readFileSync(cssPath, "utf8");

    it("does not include 'resize: both;' on .tv-chart-popover-card to prevent native grip collision", () => {
      // Find the rule block for .tv-chart-popover-card before modifiers
      const cardMatch = css.match(/\.tv-chart-popover-card\s*\{([^}]+)\}/);
      expect(cardMatch).not.toBeNull();
      const cardRules = cardMatch![1];
      expect(cardRules).not.toContain("resize: both;");
    });

    it("has dedicated .tv-chart-loading-overlay and spinner styles for smooth loading UX", () => {
      expect(css).toContain(".tv-chart-loading-overlay");
      expect(css).toContain(".tv-chart-loading-spinner");
      expect(css).toContain("@keyframes tvSpin");
    });

    it("ensures .is-maximized uses viewport-relative sizing for fluid window adaptation", () => {
      expect(css).toMatch(/\.tv-chart-popover-card\.is-maximized\s*\{[^}]*width:\s*min\(96vw,\s*1600px\)\s*!important/);
      expect(css).toMatch(/\.tv-chart-popover-card\.is-maximized\s*\{[^}]*height:\s*94vh\s*!important/);
    });
  });

  describe("2. Modal Component Event Synchronization & Performance", () => {
    const tsxPath = resolve(__dirname, "../components/TradingViewChartModal.tsx");
    const tsx = readFileSync(tsxPath, "utf8");

    it("implements requestAnimationFrame for smooth 60fps drag tracking without re-render thrashing", () => {
      expect(tsx).toContain("requestAnimationFrame");
      expect(tsx).toContain("cancelAnimationFrame");
      expect(tsx).toContain("pendingDimensionsRef");
    });

    it("guards ResizeObserver during active pointer resizing to eliminate duplicate state commits", () => {
      expect(tsx).toContain("isResizingRef");
      expect(tsx).toContain("if (isResizingRef.current) return;");
    });

    it("dispatches window resize events to inform TradingView Canvas of container dimension changes", () => {
      expect(tsx).toContain("notifyTradingViewResize");
      expect(tsx).toMatch(/window\.dispatchEvent\(\s*new\s+Event\(["']resize["']\)\s*\)/);
    });

    it("provides retry capability and loading state indicator for resilient external script loading", () => {
      expect(tsx).toContain("handleRetry");
      expect(tsx).toContain("reloadKey");
      expect(tsx).toContain("isLoading");
      expect(tsx).toContain("tv-chart-loading-overlay");
    });

    it("clamps dimensions safely when restoring from maximize mode", () => {
      expect(tsx).toContain("preMaximizedSizeRef.current");
      expect(tsx).toContain("Math.min(maxW, Math.max(minW, preMaximizedSizeRef.current.width))");
    });
  });

  describe("3. Saved Dimensions Consistency", () => {
    it("returns default size when window is undefined or clean desktop state", () => {
      vi.stubGlobal("window", {
        innerWidth: 1280,
        innerHeight: 800,
      });
      const dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);
    });

    it("clamps stored values correctly within min/max bounds on small mobile screens", () => {
      mockStorage.setItem(
        "tv_chart_popup_custom_size",
        JSON.stringify({ width: 1200, height: 900 }),
      );
      vi.stubGlobal("window", {
        innerWidth: 360,
        innerHeight: 640,
      });
      const dims = getSavedDimensions();
      expect(dims.width).toBeLessThanOrEqual(360);
      expect(dims.height).toBeLessThanOrEqual(640);
    });
  });
});
