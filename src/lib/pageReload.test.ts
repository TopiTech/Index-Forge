import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isPageReload,
  applyReloadSuppressionClass,
  removeReloadSuppressionClass,
  isReloadSuppressed,
} from "./pageReload";
import fs from "fs";
import path from "path";

describe("Page Reload Animation Suppression", () => {
  describe("isPageReload Detection", () => {
    it("returns false when window or performance is undefined", () => {
      expect(isPageReload(undefined)).toBe(false);
      // @ts-expect-error test mock
      expect(isPageReload({})).toBe(false);
    });

    it("returns true when Navigation Timing Level 2 entry type is 'reload'", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) => {
            if (type === "navigation") {
              return [{ type: "reload" }];
            }
            return [];
          }),
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(true);
      expect(mockWin.performance.getEntriesByType).toHaveBeenCalledWith("navigation");
    });

    it("returns false when Navigation Timing Level 2 entry type is 'navigate'", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) => {
            if (type === "navigation") {
              return [{ type: "navigate" }];
            }
            return [];
          }),
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(false);
    });

    it("returns false when Navigation Timing Level 2 entry type is 'back_forward'", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) => {
            if (type === "navigation") {
              return [{ type: "back_forward" }];
            }
            return [];
          }),
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(false);
    });

    it("falls back to legacy performance.navigation.type === 1 (reload)", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => []),
          navigation: { type: 1 },
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(true);
    });

    it("returns false when legacy performance.navigation.type === 0 (navigate)", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => []),
          navigation: { type: 0 },
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(false);
    });

    it("gracefully catches exceptions and returns false", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => {
            throw new Error("SecurityError");
          }),
        },
      } as unknown as Window;

      expect(isPageReload(mockWin)).toBe(false);
    });
  });

  describe("DOM Suppression Class Management", () => {
    let mockDoc: Document;

    beforeEach(() => {
      const classList = new Set<string>();
      mockDoc = {
        documentElement: {
          classList: {
            add: vi.fn((cls: string) => classList.add(cls)),
            remove: vi.fn((cls: string) => classList.delete(cls)),
            contains: vi.fn((cls: string) => classList.has(cls)),
          },
        },
      } as unknown as Document;
    });

    it("adds is-reload-suppressed class and checks status", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) =>
            type === "navigation" ? [{ type: "reload" }] : []
          ),
        },
      } as unknown as Window;

      const applied = applyReloadSuppressionClass(mockDoc, mockWin);
      expect(applied).toBe(true);
      expect(isReloadSuppressed(mockDoc)).toBe(true);

      removeReloadSuppressionClass(mockDoc);
      expect(isReloadSuppressed(mockDoc)).toBe(false);
    });

    it("does not apply suppression class when not a reload", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) =>
            type === "navigation" ? [{ type: "navigate" }] : []
          ),
        },
      } as unknown as Window;

      const applied = applyReloadSuppressionClass(mockDoc, mockWin);
      expect(applied).toBe(false);
      expect(isReloadSuppressed(mockDoc)).toBe(false);
    });
  });

  describe("HTML & CSS Integration Verification", () => {
    it("index.html contains early reload detection script in head", () => {
      const htmlPath = path.resolve(__dirname, "../../index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");
      expect(html).toContain("is-reload-suppressed");
      expect(html).toContain("navigation");
      expect(html).toContain("reload");
    });

    it("src/index.css contains html.is-reload-suppressed animation overrides", () => {
      const cssPath = path.resolve(__dirname, "../index.css");
      const css = fs.readFileSync(cssPath, "utf-8");
      expect(css).toContain("html.is-reload-suppressed");
      expect(css).toContain("transition-duration: 0.01ms !important;");
      expect(css).toContain("animation-duration: 0.01ms !important;");
    });

    it("src/main.tsx configures RootApp with reload suppression", () => {
      const mainPath = path.resolve(__dirname, "../main.tsx");
      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("RootApp");
      expect(mainContent).toContain("isPageReload");
      expect(mainContent).toContain("reducedMotion={suppressAnimation ? \"always\" : \"user\"}");
    });

    it("src/components/PerformanceChart.tsx accepts isReloadSuppressed prop and disables line/area animations", () => {
      const chartPath = path.resolve(__dirname, "../components/PerformanceChart.tsx");
      const chartContent = fs.readFileSync(chartPath, "utf-8");
      expect(chartContent).toContain("isReloadSuppressed");
      expect(chartContent).toContain("isAnimationActive={!isReloadSuppressed}");
    });
  });
});
