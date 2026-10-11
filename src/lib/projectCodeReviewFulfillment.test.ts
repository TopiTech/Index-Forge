import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";
import { runStockScreener } from "./marketDataService";

describe("Project Code Review Fulfillment Tests", () => {
  const rootDir = process.cwd();
  const screenerTsx = readFileSync(
    resolve(rootDir, "src/components/ScreenerPage.tsx"),
    "utf-8"
  );
  const portfolioTsx = readFileSync(
    resolve(rootDir, "src/components/PortfolioManagerPage.tsx"),
    "utf-8"
  );
  const stockDetailTsx = readFileSync(
    resolve(rootDir, "src/components/StockDetailPage.tsx"),
    "utf-8"
  );
  const sidebarTsx = readFileSync(
    resolve(rootDir, "src/components/Sidebar.tsx"),
    "utf-8"
  );

  describe("1. Portfolio Multi-Lot Aggregation for Index Conversion", () => {
    it("aggregates multiple positions of the same stock into a single unique constituent", () => {
      const positions: PortfolioPosition[] = [
        { id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2500 },
        { id: "p2", ticker: "7203", name: "トヨタ自動車", shares: 200, averageCost: 2600 },
        { id: "p3", ticker: "8035", name: "東京エレクトロン", shares: 10, averageCost: 24000 },
        { id: "p4", ticker: "8306", name: "三菱UFJ FG", shares: 500, averageCost: 1200 },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions);

      // 4 positions should reduce to 3 unique constituents
      expect(basket).toHaveLength(3);
      const tickers = basket.map((b) => b.ticker);
      expect(tickers).toEqual(["7203", "8035", "8306"]);

      // Guarantee no duplicate tickers that would cause 400 Bad Request on Worker API
      expect(new Set(tickers).size).toBe(tickers.length);

      // Total weights must add up to exactly 100
      const totalWeight = basket.reduce((sum, item) => sum + item.weight, 0);
      expect(totalWeight).toBe(100);
      expect(basket.every((item) => item.weight >= 1)).toBe(true);
    });

    it("handles multiple lots where one stock has 3 separate acquisitions", () => {
      const positions: PortfolioPosition[] = [
        { id: "a1", ticker: "6758", name: "ソニーグループ", shares: 50, averageCost: 12000 },
        { id: "a2", ticker: "6758", name: "ソニーグループ", shares: 50, averageCost: 12500 },
        { id: "a3", ticker: "6758", name: "ソニーグループ", shares: 100, averageCost: 13000 },
        { id: "b1", ticker: "9984", name: "ソフトバンクグループ", shares: 100, averageCost: 8000 },
      ];

      const basket = convertPortfolioToCustomIndexBasket(positions);
      expect(basket).toHaveLength(2);
      expect(basket.map((b) => b.ticker)).toEqual(["6758", "9984"]);
      expect(basket.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    });
  });

  describe("2. Screener Metric Sorting & Null Safety", () => {
    it("sorts null/missing metrics to the end in ascending order", () => {
      const results = runStockScreener({ sortBy: "per", sortOrder: "asc" });
      expect(results.length).toBeGreaterThan(0);

      // The top result must be a valid positive PER number, not null
      expect(results[0].per).not.toBeNull();
      expect(typeof results[0].per).toBe("number");
      expect(results[0].per).toBeGreaterThan(0);

      // Check that all valid PERs appear before any null PERs
      let seenNull = false;
      for (const item of results) {
        if (item.per === null) {
          seenNull = true;
        } else if (seenNull) {
          expect(item.per).toBeNull();
        }
      }
    });

    it("sorts null/missing metrics to the end in descending order", () => {
      const results = runStockScreener({ sortBy: "dividendYield", sortOrder: "desc" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].dividendYield).not.toBeNull();

      let seenNull = false;
      for (const item of results) {
        if (item.dividendYield === null) {
          seenNull = true;
        } else if (seenNull) {
          expect(item.dividendYield).toBeNull();
        }
      }
    });
  });

  describe("3. Screener Keyboard Accessibility & Event Isolation", () => {
    it("enables keyboard sorting on table column headers with tabIndex and onKeyDown", () => {
      expect(screenerTsx).toContain("tabIndex={0}");
      expect(screenerTsx).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[^}]*handleSortColumn/);
      expect(screenerTsx).toContain('aria-sort');
    });

    it("stops Space and Enter keydown bubbling on row selection checkboxes to prevent unwanted detail navigation", () => {
      // Must call stopPropagation inside onKeyDown on the selection checkbox button
      expect(screenerTsx).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[^}]*e\.stopPropagation\(\)[^}]*handleToggleSelect/);
    });

    it("cleans up unused imports without warnings", () => {
      expect(screenerTsx).not.toContain("AnimatePresence");
    });
  });

  describe("4. StockDetailPage Zero-Revenue Division Guard", () => {
    it("guards operating margin calculation against division by zero", () => {
      expect(stockDetailTsx).toMatch(/f\.revenue\s*>\s*0\s*\?\s*Number\(\(\(f\.operatingIncome\s*\/\s*f\.revenue\)\s*\*\s*100\)\.toFixed\(1\)\)\s*:\s*0/);
    });
  });

  describe("5. Sidebar Locked Badge Styling Integration", () => {
    it("attaches the nav-lock-badge class to the locked badge element", () => {
      expect(sidebarTsx).toContain("nav-lock-badge");
    });
  });

  describe("6. PortfolioManagerPage Auth & Synchronization", () => {
    it("does not bind unused session variable from useAuth", () => {
      expect(portfolioTsx).not.toMatch(/const\s*\{[^}]*session[^}]*\}\s*=\s*useAuth\(\)/);
    });

    it("synchronizes positions and watchlist immediately upon successful inline login", () => {
      expect(portfolioTsx).toContain("setPositions(loadPortfolioPositions())");
      expect(portfolioTsx).toContain("setWatchlist(loadWatchlist())");
    });
  });
});
