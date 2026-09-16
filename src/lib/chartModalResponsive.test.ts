import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("TradingViewChartModal Responsive & Mobile Accessibility", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createStorageMock();
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. getSavedDimensions on Mobile Viewports", () => {
    it("safely clamps default dimensions on narrow mobile screens (e.g. iPhone SE 375px)", () => {
      vi.stubGlobal("window", {
        innerWidth: 375,
        innerHeight: 667,
      });

      const dims = getSavedDimensions();
      // Must not exceed screen width (375px)
      expect(dims.width).toBeLessThanOrEqual(375);
      expect(dims.width).toBeGreaterThanOrEqual(320);
      expect(dims.height).toBeLessThanOrEqual(667);
    });

    it("safely clamps default dimensions on modern smartphone screens (e.g. 390px)", () => {
      vi.stubGlobal("window", {
        innerWidth: 390,
        innerHeight: 844,
      });

      const dims = getSavedDimensions();
      expect(dims.width).toBeLessThanOrEqual(390);
      expect(dims.width).toBeGreaterThanOrEqual(320);
    });

    it("clamps stored large desktop dimensions when reopened on a mobile screen", () => {
      mockStorage.setItem(
        "tv_chart_popup_custom_size",
        JSON.stringify({ width: 920, height: 600 }),
      );

      vi.stubGlobal("window", {
        innerWidth: 390,
        innerHeight: 844,
      });

      const dims = getSavedDimensions();
      // Even with 920 stored, must clamp to mobile screen viewport
      expect(dims.width).toBeLessThanOrEqual(390);
      expect(dims.width).toBe(Math.floor(390 * 0.94));
    });

    it("uses default generous dimensions on desktop screens (e.g. 1440px)", () => {
      vi.stubGlobal("window", {
        innerWidth: 1440,
        innerHeight: 900,
      });

      const dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);
    });
  });

  describe("2. CSS Responsive Rules and Mobile Media Query", () => {
    it("uses min(480px, 94vw) in index.css to prevent mobile card overflow", () => {
      const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      expect(css).toContain("min-width: min(480px, 94vw)");
      expect(css).toContain("min-height: min(380px, 85vh)");
    });

    it("includes mobile media query (@media (max-width: 640px)) with card fit and hidden resize handle", () => {
      const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      expect(css).toContain("@media (max-width: 640px)");
      expect(css).toMatch(/\.tv-chart-popover-card\s*\{[^}]*width:\s*95vw\s*!important/);
      expect(css).toMatch(/\.tv-resize-handle\s*\{[^}]*display:\s*none\s*!important/);
      expect(css).toContain(".tv-chart-popover-header");
      expect(css).toContain(".tv-chart-popover-footer");
    });
  });

  describe("3. Modal Accessibility & Resize Handling", () => {
    it("has aria-hidden on decorative resize handle SVG", () => {
      const tsx = readFileSync(
        resolve(__dirname, "../components/TradingViewChartModal.tsx"),
        "utf8",
      );
      expect(tsx).toContain('aria-hidden="true"');
      expect(tsx).toContain("handleWindowResize");
      expect(tsx).toContain("tv-resize-handle");
    });

    it("has responsive bounds in pointer drag handlers", () => {
      const tsx = readFileSync(
        resolve(__dirname, "../components/TradingViewChartModal.tsx"),
        "utf8",
      );
      expect(tsx).toContain("isMobile");
      expect(tsx).toContain("handleResetSize");
      expect(tsx).toContain("handleResizePointerMove");
    });
  });
});
