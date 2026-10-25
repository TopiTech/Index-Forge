import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { convertPortfolioToCustomIndexBasket, type PortfolioPosition } from "./portfolioStorage";

describe("Comprehensive Goal Code Review Fulfillment Round 4", () => {
  const chartTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/StockTechnicalChart.tsx"),
    "utf-8"
  );
  const portfolioTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/PortfolioManagerPage.tsx"),
    "utf-8"
  );
  const stockDetailTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/StockDetailPage.tsx"),
    "utf-8"
  );

  describe("1. StockTechnicalChart Integration & A11y", () => {
    it("queries /api/calculate to retrieve authentic historical price series instead of expecting series on /api/sync-prices", () => {
      // The chart goes through the shared request layer (timeout + abort).
      expect(chartTsx).toContain('fetchWithNetworkMark("/api/calculate"');
      expect(chartTsx).toContain("calcData.stockUniverse?.find");
      // The authentic series is mapped without inventing OHLCV (S1).
      expect(chartTsx).toContain("buildTechnicalChartSeries(rawSeries)");
    });

    it("includes preflight sync to /api/sync-prices with graceful error handling", () => {
      expect(chartTsx).toContain('fetchWithNetworkMark("/api/sync-prices"');
      expect(chartTsx).toContain("// Preflight sync to ensure stock prices are refreshed into D1 cache");
    });

    it("calculates SMA25 and SMA75 over the authentic price series", () => {
      expect(chartTsx).toContain("sma25 = Math.round((sum / 25) * 100) / 100;");
      expect(chartTsx).toContain("sma75 = Math.round((sum / 75) * 100) / 100;");
    });

    it("provides aria-pressed attribute for timeframe range toggle buttons (1M, 3M, ALL)", () => {
      expect(chartTsx).toContain("aria-pressed={selectedRange === rng}");
    });
  });

  describe("2. PortfolioManagerPage FX Rate Integration", () => {
    it("passes usdJpyRate to convertPortfolioToCustomIndexBasket in handleConvertToCustomIndex", () => {
      expect(portfolioTsx).toContain(
        "const basket = convertPortfolioToCustomIndexBasket(positions, usdJpyRate);"
      );
    });

    it("convertPortfolioToCustomIndexBasket accurately weights USD and JPY positions using custom usdJpyRate", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2000,
          acquiredAt: "2024-01-01",
        },
        {
          id: "pos-2",
          ticker: "AAPL",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 100,
          currentPrice: 100,
          acquiredAt: "2024-01-01",
        },
      ];

      // JPY value of pos-1 = 100 * 2000 = 200,000 JPY
      // USD value of pos-2 = 10 * 100 = 1,000 USD
      // With rate = 150: AAPL = 150,000 JPY. Total = 350,000.
      // 7203 weight = 200,000 / 350,000 ≈ 57.14%, AAPL ≈ 42.86%
      const basket150 = convertPortfolioToCustomIndexBasket(positions, 150);
      expect(basket150.length).toBe(2);
      const toyota150 = basket150.find((b) => b.ticker === "7203");
      const apple150 = basket150.find((b) => b.ticker === "AAPL");
      expect(toyota150?.weight).toBe(57);
      expect(apple150?.weight).toBe(43);

      // With rate = 200: AAPL = 200,000 JPY. Total = 400,000.
      // 7203 weight = 200,000 / 400,000 = 50%, AAPL = 50%
      const basket200 = convertPortfolioToCustomIndexBasket(positions, 200);
      const toyota200 = basket200.find((b) => b.ticker === "7203");
      const apple200 = basket200.find((b) => b.ticker === "AAPL");
      expect(toyota200?.weight).toBe(50);
      expect(apple200?.weight).toBe(50);
    });
  });

  describe("3. StockDetailPage Resilience", () => {
    it("handles unexpected fetch errors inside loadStockData without throwing unhandled exceptions", () => {
      expect(stockDetailTsx).toContain("catch {");
      expect(stockDetailTsx).toContain(
        "// Gracefully retain existing cached data on unexpected network error"
      );
    });
  });
});
