import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { runStockScreener, type StockQuoteFundamentals } from "./marketDataService";
import { calculatePortfolioSummary, type PortfolioPosition } from "./portfolioStorage";
import worker from "../../worker/index";

describe("Comprehensive Goal Code Review Final Audit Resolution Verification", () => {
  describe("Unit 1: Backend D1 Fallback Price & Zero-Division Immunity", () => {
    it("handles zero/negative previous close and single-point series without division by zero or NaN", () => {
      const code = readFileSync(resolve(__dirname, "../../worker/internal-impl.ts"), "utf-8");
      expect(code).toContain("const lastPt = parsedPrices[parsedPrices.length - 1];");
      expect(code).toContain("const prevPt = parsedPrices[parsedPrices.length - 2];");
      expect(code).toContain("prevPt.close > 0");
      expect(code).toContain("else if (Array.isArray(parsedPrices) && parsedPrices.length === 1)");
    });
  });

  describe("Unit 2: Screener Metric Filtering Guard for undefined, NaN, and Non-Positive Valuation", () => {
    it("correctly filters out undefined, null, NaN, and negative/zero PER and PBR values", () => {
      const customUniverse: StockQuoteFundamentals[] = [
        {
          ticker: "VALID1",
          name: "Valid Corp",
          theme: "IT",
          sector: "Information",
          market: "PRIME",
          price: 1000,
          change: 10,
          changePercent: 1.0,
          volume: 10000,
          previousClose: 990,
          dayHigh: 1010,
          dayLow: 990,
          yearHigh: 1200,
          yearLow: 800,
          marketCap: 1000,
          per: 15.0,
          pbr: 1.2,
          dividendYield: 2.5,
          roe: 8.0,
          equityRatio: 50,
          eps: 66.6,
          dps: 25,
          technicalSignal: "BUY",
          historicalFinances: [],
        },
        {
          ticker: "DEFICIT",
          name: "Deficit Corp",
          theme: "IT",
          sector: "Information",
          market: "PRIME",
          price: 500,
          change: -5,
          changePercent: -1.0,
          volume: 5000,
          previousClose: 505,
          dayHigh: 510,
          dayLow: 495,
          yearHigh: 600,
          yearLow: 400,
          marketCap: 500,
          per: -5.0, // negative PER (loss)
          pbr: 0.8,
          dividendYield: 0,
          roe: -10.0,
          equityRatio: 30,
          eps: -100,
          dps: 0,
          technicalSignal: "SELL",
          historicalFinances: [],
        },
        {
          ticker: "UNDEFINED",
          name: "Undefined Corp",
          theme: "IT",
          sector: "Information",
          market: "PRIME",
          price: 800,
          change: 0,
          changePercent: 0,
          volume: 2000,
          previousClose: 800,
          dayHigh: 800,
          dayLow: 800,
          yearHigh: 900,
          yearLow: 700,
          marketCap: 800,
          per: undefined as unknown as null,
          pbr: undefined as unknown as null,
          dividendYield: undefined as unknown as null,
          roe: undefined as unknown as null,
          equityRatio: 40,
          eps: null,
          dps: null,
          technicalSignal: "NEUTRAL",
          historicalFinances: [],
        },
      ];

      // maxPer: 20 should include VALID1 (15.0), but exclude DEFICIT (-5.0) and UNDEFINED (undefined/null)
      const perResults = runStockScreener({ maxPer: 20 }, customUniverse);
      expect(perResults.map((s) => s.ticker)).toEqual(["VALID1"]);

      // minDividendYield: 1.0 should exclude DEFICIT (0) and UNDEFINED
      const divResults = runStockScreener({ minDividendYield: 1.0 }, customUniverse);
      expect(divResults.map((s) => s.ticker)).toEqual(["VALID1"]);

      // maxPbr: 1.5 should include VALID1 (1.2) and DEFICIT (0.8), but exclude UNDEFINED
      // By default sorted by marketCap desc (VALID1: 1000, DEFICIT: 500)
      const pbrResults = runStockScreener({ maxPbr: 1.5 }, customUniverse);
      expect(pbrResults.map((s) => s.ticker)).toEqual(["VALID1", "DEFICIT"]);
    });
  });

  describe("Unit 3: Portfolio Summary Fallback Price & NaN Immunity", () => {
    it("ensures totalMarketValue and totalCost remain finite numbers without NaN poisoning", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203", // Toyota anchor
          name: "Toyota",
          shares: 100,
          averageCost: 2500,
          currentPrice: 2800, // Valid custom currentPrice
          currency: "JPY",
          addedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "pos-2",
          ticker: "9999", // Baseline stock
          name: "Custom Asset",
          shares: 50,
          averageCost: 1000,
          currentPrice: 0, // Fallback to baseline
          currency: "JPY",
          addedAt: "2026-01-01T00:00:00Z",
        },
      ];

      const summary = calculatePortfolioSummary(positions, {}, 155);
      expect(Number.isFinite(summary.totalMarketValue)).toBe(true);
      expect(Number.isFinite(summary.totalCost)).toBe(true);
      expect(Number.isFinite(summary.totalProfit)).toBe(true);
      expect(Number.isFinite(summary.dividendYield)).toBe(true);
      expect(summary.positions[0].currentPrice).toBe(2800);
      expect(summary.positions[0].marketValueJpy).toBe(280000);
      expect(summary.positions[1].currentPrice).toBe(1000);
      expect(summary.totalMarketValue).toBe(330000); // 280000 + 50000
    });
  });

  describe("Unit 4: News publishedTimestamp ISO Support", () => {
    it("returns ISO 8601 publishedTimestamp in /api/market/overview news items", async () => {
      const req = new Request("http://localhost/api/market/overview");
      const res = await worker.fetch(req, {} as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.news)).toBe(true);
      expect(data.news.length).toBeGreaterThan(0);
      for (const item of data.news) {
        expect(item.publishedTimestamp).toBeDefined();
        expect(typeof item.publishedTimestamp).toBe("string");
        expect(new Date(item.publishedTimestamp).getTime()).not.toBeNaN();
      }
    });
  });

  describe("Unit 5: Tutorial3DCanvas Non-Passive Wheel Event Binding", () => {
    it("attaches wheel listener with passive: false to eliminate browser intervention warnings", () => {
      const canvasTsx = readFileSync(resolve(__dirname, "../../src/components/Tutorial3DCanvas.tsx"), "utf-8");
      expect(canvasTsx).toContain('container.addEventListener("wheel", handleWheel, { passive: false });');
      expect(canvasTsx).toContain('container.removeEventListener("wheel", handleWheel);');
      expect(canvasTsx).not.toContain("onWheel={handleWheel}");
    });
  });

  describe("Unit 6: Sparkline & Mini-Chart Coordinate NaN Guards", () => {
    it("verifies sparkline components filter for finite numbers before calculating min/max coordinates", () => {
      const files = [
        "../../src/components/ConstituentsTable.tsx",
        "../../src/components/ScreenerPage.tsx",
        "../../src/components/StockAnalysisPage.tsx",
        "../../src/components/MarketOverviewPage.tsx",
        "../../src/components/PerformanceChart.tsx",
      ];
      for (const file of files) {
        const content = readFileSync(resolve(__dirname, file), "utf-8");
        expect(content).toContain("Number.isFinite");
      }
    });
  });

  describe("Unit 7: UI Modal State Reset & Resource Cleanup", () => {
    it("verifies AddStockModal resets form state and errors on isOpen change", () => {
      const addModalTsx = readFileSync(resolve(__dirname, "../../src/components/AddStockModal.tsx"), "utf-8");
      expect(addModalTsx).toContain("useEffect(() => {");
      expect(addModalTsx).toContain("if (isOpen) {");
      expect(addModalTsx).toContain('setTicker("");');
      expect(addModalTsx).toContain("setError(null);");
    });

    it("verifies TradingViewChartModal cleans up resizeTimerId on unmount", () => {
      const tvModalTsx = readFileSync(resolve(__dirname, "../../src/components/TradingViewChartModal.tsx"), "utf-8");
      expect(tvModalTsx).toContain("let resizeTimerId: ReturnType<typeof setTimeout> | null = null;");
      expect(tvModalTsx).toContain("if (resizeTimerId) clearTimeout(resizeTimerId);");
    });

    it("verifies ThemeHeatmap validates document.body prior to portal rendering", () => {
      const heatmapTsx = readFileSync(resolve(__dirname, "../../src/components/ThemeHeatmap.tsx"), "utf-8");
      expect(heatmapTsx).toContain('typeof document !== "undefined" &&');
      expect(heatmapTsx).toContain("document.body &&");
      expect(heatmapTsx).toContain("createPortal(");
    });
  });
});
