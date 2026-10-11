import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDashboardParams, buildDashboardQuery } from "./navigation";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  loadWatchlist,
  saveWatchlist,
} from "./portfolioStorage";

const cssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const marketOverviewSource = readFileSync(
  new URL("../components/MarketOverviewPage.tsx", import.meta.url),
  "utf8",
);
const footerSource = readFileSync(new URL("../components/Footer.tsx", import.meta.url), "utf8");

describe("Goal Platform Integration & Accessibility Verification", () => {
  describe("CSS Responsive Layout Verification", () => {
    it("scopes desktop hiding of header mobile menu button to min-width: 1081px", () => {
      // Must not hide header-mobile-menu-btn globally or between 769px and 1080px (iPad/tablet lockout)
      expect(cssSource).toMatch(
        /@media\s*\(\s*min-width:\s*1081px\s*\)\s*\{[\s\S]*?\.header-mobile-menu-btn[\s\S]*?display:\s*none\s*!important/s,
      );
    });

    it("hides global sidebar drawer and backdrop by default on desktop", () => {
      // Ensures mobile drawer does not intrude into desktop layout grid
      expect(cssSource).toMatch(
        /\.global-sidebar-drawer,\s*\n\s*\.global-sidebar-backdrop\s*\{\s*\n\s*display:\s*none;/,
      );
    });
  });

  describe("App Shell Desktop Resize Auto-Close", () => {
    it("listens to mediaQuery changes to close the drawer when resizing to desktop", () => {
      expect(appSource).toMatch(
        /const mediaQuery = window\.matchMedia\(MOBILE_LAYOUT_QUERY\);[\s\S]*?if \(!mediaQuery\.matches\) \{\s*setIsNavOpen\(false\);/,
      );
    });

    it("handles dashboard searchParams in navigateTo including indexId, benchmark, timeframe", () => {
      expect(appSource).toMatch(
        /if \(view === "dashboard" && searchParams\) \{[\s\S]*?parseDashboardParams\(searchParams\)[\s\S]*?params\.indexId[\s\S]*?selectIndex/,
      );
    });

    it("resolves pending indexId when indices finish loading", () => {
      expect(appSource).toMatch(
        /pendingIndexIdRef\.current = params\.indexId;[\s\S]*?indices\.find\(\(idx\) => idx\.id === pendingIndexIdRef\.current\)/,
      );
    });
  });

  describe("MarketOverviewPage News Item Accessibility", () => {
    it("adds role='button', tabIndex={0}, and aria-label to news items with relatedTicker", () => {
      expect(marketOverviewSource).toContain('role={item.relatedTicker ? "button" : undefined}');
      expect(marketOverviewSource).toContain("tabIndex={item.relatedTicker ? 0 : undefined}");
      expect(marketOverviewSource).toContain(
        "aria-label={\n                  item.relatedTicker\n                    ? `${item.title} (${item.relatedTicker}の銘柄分析を開く)`\n                    : undefined\n                }",
      );
    });

    it("handles Enter and Space key activation for keyboard accessibility", () => {
      expect(marketOverviewSource).toMatch(
        /onKeyDown=\{\(e\) => \{\s*if \(item\.relatedTicker && \(e\.key === "Enter" \|\| e\.key === " "\)\) \{\s*e\.preventDefault\(\);\s*onOpenStockDetail\(item\.relatedTicker\);/,
      );
    });
  });

  describe("Footer Unified Platform Navigation Links", () => {
    it("renders navigation links for all unified platform pages", () => {
      const requiredViews = [
        'view="market"',
        'view="stock"',
        'view="calendar"',
        'view="screener"',
        'view="dashboard"',
        'view="builder"',
        'view="portfolio"',
        'view="tutorial"',
        'view="disclaimer"',
      ];
      for (const view of requiredViews) {
        expect(footerSource).toContain(view);
      }
    });

    it("uses appropriate descriptive labels and Lucide icons", () => {
      expect(footerSource).toContain('label="マーケット概観"');
      expect(footerSource).toContain('label="銘柄分析"');
      expect(footerSource).toContain('label="カレンダー"');
      expect(footerSource).toContain('label="スクリーナー"');
      expect(footerSource).toContain('label="指数スタジオ"');
      expect(footerSource).toContain('label="保有ポートフォリオ"');
    });
  });

  describe("Portfolio Storage Empty State Round-Trip", () => {
    it("persists deliberate empty positions without reverting to presets", () => {
      const store = new Map<string, string>();
      const mockStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      };
      const origLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        configurable: true,
      });

      try {
        savePortfolioPositions([]);
        expect(loadPortfolioPositions()).toEqual([]);

        saveWatchlist([]);
        expect(loadWatchlist()).toEqual([]);
      } finally {
        Object.defineProperty(globalThis, "localStorage", {
          value: origLocalStorage,
          configurable: true,
        });
      }
    });
  });

  describe("Dashboard Parameter URL Synchronisation", () => {
    it("parses index, benchmark, and timeframe from search params", () => {
      const params = parseDashboardParams("?index=idx-high-yield&bm=%5ESPX&tf=3M");
      expect(params.indexId).toBe("idx-high-yield");
      expect(params.benchmark).toBe("^SPX");
      expect(params.timeframe).toBe("3M");
    });

    it("builds query maintaining existing search params", () => {
      const query = buildDashboardQuery("?theme=ai", {
        indexId: "idx-semicon",
        benchmark: "^N225",
        timeframe: "1Y",
      });
      expect(query).toContain("index=idx-semicon");
      expect(query).toContain("bm=%5EN225");
      expect(query).toContain("tf=1Y");
      expect(query).toContain("theme=ai");
    });
  });
});
