// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { runStockScreener, type StockQuoteFundamentals } from "./marketDataService";
import { buildScreenerCsvRows } from "../components/ScreenerPage";
import { createStockQuote } from "../test-helpers/quote";
import modalSrc from "../components/TradingViewChartModal.tsx?raw";

describe("Comprehensive Goal Code Review - Exhaustive System Verification", () => {
  describe("Unit 1: Financial Valuation Multiples Ranking & Display", () => {
    const mockStock = (
      ticker: string,
      per: number | null,
      pbr: number | null,
    ): StockQuoteFundamentals =>
      createStockQuote({
        ticker,
        name: `Company ${ticker}`,
        per,
        pbr,
      });

    it("sorts PER in ascending order by placing positive low multiples first and deficit (negative/zero/null) at the end", () => {
      const stocks: StockQuoteFundamentals[] = [
        mockStock("LOSS1", -15.5, 1.2),
        mockStock("CHEAP", 6.8, 0.9),
        mockStock("ZERO", 0, 1.0),
        mockStock("GROWTH", 35.0, 4.5),
        mockStock("NULLPER", null, 1.1),
        mockStock("FAIR", 14.2, 1.5),
      ];

      const sortedAsc = runStockScreener(
        {
          sortBy: "per",
          sortOrder: "asc",
        },
        stocks,
      );

      const tickersAsc = sortedAsc.map((s) => s.ticker);
      // CHEAP (6.8) < FAIR (14.2) < GROWTH (35.0), followed by non-positive/null
      expect(tickersAsc[0]).toBe("CHEAP");
      expect(tickersAsc[1]).toBe("FAIR");
      expect(tickersAsc[2]).toBe("GROWTH");

      // Non-positive (LOSS1, ZERO) and null (NULLPER) must be at the end
      const trailing = tickersAsc.slice(3);
      expect(trailing).toContain("LOSS1");
      expect(trailing).toContain("ZERO");
      expect(trailing).toContain("NULLPER");
    });

    it("sorts PBR in ascending order by placing positive low multiples first and non-positive at the end", () => {
      const stocks: StockQuoteFundamentals[] = [
        mockStock("NEGPBR", 15.0, -0.5),
        mockStock("LOWPBR", 18.0, 0.65),
        mockStock("HIGHPBR", 12.0, 3.8),
        mockStock("NULLPBR", 10.0, null),
      ];

      const sorted = runStockScreener(
        {
          sortBy: "pbr",
          sortOrder: "asc",
        },
        stocks,
      );

      expect(sorted[0].ticker).toBe("LOWPBR");
      expect(sorted[1].ticker).toBe("HIGHPBR");
      expect(sorted[2].ticker).toBe("NEGPBR");
      expect(sorted[3].ticker).toBe("NULLPBR");
    });

    it("builds screener CSV rows formatting non-positive PER and PBR as empty strings", () => {
      const stocks: StockQuoteFundamentals[] = [
        mockStock("VALID", 15.2, 1.45),
        mockStock("DEFICIT", -8.4, -0.2),
        mockStock("ZEROVAL", 0, 0),
      ];

      const csvRows = buildScreenerCsvRows(stocks);
      expect(csvRows.length).toBe(3);

      // VALID: column 7 is PER ("15.2"), column 8 is PBR ("1.45")
      expect(csvRows[0][7]).toBe('"15.2"');
      expect(csvRows[0][8]).toBe('"1.45"');

      // DEFICIT: negative PER and PBR become empty strings
      expect(csvRows[1][7]).toBe('""');
      expect(csvRows[1][8]).toBe('""');

      // ZEROVAL: 0 PER and 0 PBR become empty strings
      expect(csvRows[2][7]).toBe('""');
      expect(csvRows[2][8]).toBe('""');
    });
  });

  // The WebGL context-loss lifecycle used to be asserted here against the
  // component source; it is now driven through the component itself in
  // `src/components/Tutorial3DCanvas.test.tsx`.

  describe("Unit 3: TradingViewChartModal Window Resize & Maximize Dimension Clamping", () => {
    it("handles window resize when maximized by calculating clamped viewport bounds", () => {
      expect(modalSrc).toContain("if (isMaximized)");
      expect(modalSrc).toContain("Math.floor(window.innerWidth * 0.96)");
      expect(modalSrc).toContain("Math.floor(window.innerHeight * 0.94)");
      expect(modalSrc).toContain("notifyTradingViewResize()");
    });
  });
});
