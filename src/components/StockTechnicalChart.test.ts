import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { detectStockCurrency } from "../lib/currency";
import { createStockQuote } from "../test-helpers/quote";

describe("StockTechnicalChart & StockDetailPage Integration", () => {
  const chartTsx = fs.readFileSync(
    path.resolve(__dirname, "StockTechnicalChart.tsx"),
    "utf-8"
  );
  const detailTsx = fs.readFileSync(
    path.resolve(__dirname, "StockDetailPage.tsx"),
    "utf-8"
  );

  describe("Hybrid Chart Engine Branching & Resilience", () => {
    it("distinguishes US and JP stocks for chart engine selection", () => {
      expect(detectStockCurrency("7203", "PRIME")).toBe("JPY");
      expect(detectStockCurrency("NVDA", "US")).toBe("USD");
      expect(detectStockCurrency("AAPL")).toBe("USD");
      expect(detectStockCurrency("9984")).toBe("JPY");
    });

    it("includes TradingView Advanced Chart script embed with timeout handling", () => {
      expect(chartTsx).toContain("embed-widget-advanced-chart.js");
      expect(chartTsx).toContain("setTimeout");
      expect(chartTsx).toContain("tvTimedOut");
      expect(chartTsx).toContain("script.onerror");
    });

    it("includes Recharts technical chart with SMA25 and SMA75 for local rendering", () => {
      expect(chartTsx).toContain("ResponsiveContainer");
      expect(chartTsx).toContain("ComposedChart");
      expect(chartTsx).toContain("dataKey=\"sma25\"");
      expect(chartTsx).toContain("dataKey=\"sma75\"");
      expect(chartTsx).toContain("dataKey=\"volume\"");
    });

    it("includes regulatory notice and official TradingView link for Japanese stocks", () => {
      expect(chartTsx).toContain("JPXマーケットデータ規約に基づき高機能ローカル日足チャートを描画しています");
      expect(chartTsx).toContain("TSE-");
      expect(chartTsx).toContain("jp.tradingview.com/symbols/");
    });

    it("provides fallback to local chart when TradingView encounters timeout or error", () => {
      expect(chartTsx).toContain("ローカル高機能チャートで表示");
      expect(chartTsx).toContain("再読み込み");
    });
  });

  describe("StockDetailPage Integration", () => {
    it("imports and renders StockTechnicalChart in the CHART tab", () => {
      expect(detailTsx).toContain("import { StockTechnicalChart } from \"./StockTechnicalChart\";");
      expect(detailTsx).toContain("<StockTechnicalChart stock={stock} theme={theme} />");
    });

    it("uses hardened currency formatting for hero price and range", () => {
      expect(detailTsx).toMatch(/minimumFractionDigits:\s*stock\.market === "US" \? 2 :/);
      expect(detailTsx).toContain("formatStockPrice(stock.previousClose, stock.ticker");
      expect(detailTsx).toContain("formatUsdWithJpyEstimate");
      expect(detailTsx).toContain("formatStockChange");
    });
  });

  describe("generateDeterministicHistory Date Consistency", () => {
    it("ensures date and displayDate represent the exact same calendar day", async () => {
      const { generateDeterministicHistory } = await import("./StockTechnicalChart");
      const mockStock = createStockQuote({
        ticker: "7203",
        name: "トヨタ自動車",
        market: "PRIME",
        theme: "自動車",
        price: 2850,
        change: 15,
        changePercent: 0.53,
        previousClose: 2835,
        dayHigh: 2870,
        dayLow: 2830,
        yearHigh: 3200,
        yearLow: 2400,
        volume: 12000000,
        sparkline: [2800, 2820, 2810, 2835, 2850],
      });

      // Test with a fixed date
      const testBase = new Date(2026, 9, 15, 3, 30, 0); // Oct 15, 2026, 03:30 local
      const history = generateDeterministicHistory(mockStock, 20, testBase);

      expect(history.length).toBe(20);
      for (const pt of history) {
        const [y, m, d] = pt.date.split("-").map(Number);
        const expectedDisplay = `${m}/${d}`;
        expect(pt.displayDate).toBe(expectedDisplay);
        expect(y).toBeGreaterThanOrEqual(2025);
      }
    });
  });
});
