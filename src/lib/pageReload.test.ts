import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPageReload,
  applyReloadSuppressionClass,
  removeReloadSuppressionClass,
  isReloadSuppressed,
  type MinimalDocument,
  type MinimalWindow,
} from "./pageReload";
import fs from "fs";
import path from "path";

describe("Page Reload Animation Suppression", () => {
  describe("isPageReload Detection", () => {
    it("returns false when window or performance is undefined", () => {
      expect(isPageReload(undefined)).toBe(false);
      expect(isPageReload({})).toBe(false);
    });

    it("returns true when Navigation Timing Level 2 entry type is 'reload'", () => {
      const getEntriesByType = vi.fn((type: string) => {
        if (type === "navigation") {
          return [{ type: "reload" }];
        }
        return [];
      });
      const mockWin = { performance: { getEntriesByType } } satisfies MinimalWindow;

      expect(isPageReload(mockWin)).toBe(true);
      expect(getEntriesByType).toHaveBeenCalledWith("navigation");
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
      } satisfies MinimalWindow;

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
      } satisfies MinimalWindow;

      expect(isPageReload(mockWin)).toBe(false);
    });

    it("falls back to legacy performance.navigation.type === 1 (reload)", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => []),
          navigation: { type: 1 },
        },
      } satisfies MinimalWindow;

      expect(isPageReload(mockWin)).toBe(true);
    });

    it("returns false when legacy performance.navigation.type === 0 (navigate)", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => []),
          navigation: { type: 0 },
        },
      } satisfies MinimalWindow;

      expect(isPageReload(mockWin)).toBe(false);
    });

    it("gracefully catches exceptions and returns false", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn(() => {
            throw new Error("SecurityError");
          }),
        },
      } satisfies MinimalWindow;

      expect(isPageReload(mockWin)).toBe(false);
    });
  });

  describe("DOM Suppression Class Management", () => {
    let mockDoc: MinimalDocument;

    beforeEach(() => {
      const classList = new Set<string>();
      mockDoc = {
        documentElement: {
          classList: {
            add: vi.fn((cls: string) => {
              classList.add(cls);
            }),
            remove: vi.fn((cls: string) => {
              classList.delete(cls);
            }),
            contains: vi.fn((cls: string) => classList.has(cls)),
          },
        },
      };
    });

    it("adds is-reload-suppressed class and checks status", () => {
      const mockWin = {
        performance: {
          getEntriesByType: vi.fn((type: string) =>
            type === "navigation" ? [{ type: "reload" }] : []
          ),
        },
      } satisfies MinimalWindow;

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
      } satisfies MinimalWindow;

      const applied = applyReloadSuppressionClass(mockDoc, mockWin);
      expect(applied).toBe(false);
      expect(isReloadSuppressed(mockDoc)).toBe(false);
    });
  });

  describe("HTML & CSS Integration Verification", () => {
    it("index.html loads the early reload detection script from /reload-suppress.js in head", () => {
      // SEC-07: the inline IIFE moved out of index.html so the production CSP
      // can drop 'unsafe-inline' from script-src. The head must reference the
      // external file, and that file must carry the suppression logic.
      const htmlPath = path.resolve(__dirname, "../../index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");
      expect(html).toContain('<script src="/reload-suppress.js"></script>');

      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
      expect(head).toContain('<script src="/reload-suppress.js"></script>');

      const scriptPath = path.resolve(__dirname, "../../public/reload-suppress.js");
      const script = fs.readFileSync(scriptPath, "utf-8");
      expect(script).toContain("is-reload-suppressed");
      expect(script).toContain("navigation");
      expect(script).toContain("reload");
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
