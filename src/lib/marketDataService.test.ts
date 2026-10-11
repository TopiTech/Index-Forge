import { describe, it, expect } from "vitest";
import {
  getStockFundamentals,
  runStockScreener,
  fetchMarketOverview,
  UPCOMING_EVENTS,
} from "./marketDataService";

describe("MarketDataService", () => {
  describe("getStockFundamentals", () => {
    it("returns rich fundamentals for Japanese stock (7203)", () => {
      const data = getStockFundamentals("7203");
      expect(data.ticker).toBe("7203");
      expect(data.name).toContain("トヨタ");
      expect(data.market).toBe("PRIME");
      expect(data.price).toBeGreaterThan(0);
      expect(data.per).toBeGreaterThan(0);
      expect(data.pbr).toBeGreaterThan(0);
      expect(data.dividendYield).toBeGreaterThan(0);
      expect(data.historicalFinances.length).toBe(4);
    });

    it("returns rich fundamentals for US stock (NVDA)", () => {
      const data = getStockFundamentals("NVDA");
      expect(data.ticker).toBe("NVDA");
      expect(data.market).toBe("US");
      expect(data.price).toBeGreaterThan(0);
      expect(data.per).toBeGreaterThan(0);
      expect(data.historicalFinances.length).toBe(4);
    });
  });

  describe("runStockScreener", () => {
    it("filters stocks by market", () => {
      const usStocks = runStockScreener({ market: "US" });
      expect(usStocks.length).toBeGreaterThan(0);
      usStocks.forEach((s) => expect(s.market).toBe("US"));

      const jpStocks = runStockScreener({ market: "PRIME" });
      expect(jpStocks.length).toBeGreaterThan(0);
      jpStocks.forEach((s) => expect(s.market).toBe("PRIME"));
    });

    it("filters by dividend yield and sorts correctly", () => {
      const highDividend = runStockScreener({
        minDividendYield: 3.0,
        sortBy: "dividendYield",
        sortOrder: "desc",
      });
      expect(highDividend.length).toBeGreaterThan(0);
      highDividend.forEach((s) => expect(s.dividendYield).toBeGreaterThanOrEqual(3.0));

      // verify sort
      for (let i = 0; i < highDividend.length - 1; i++) {
        expect(highDividend[i].dividendYield!).toBeGreaterThanOrEqual(highDividend[i + 1].dividendYield!);
      }
    });

    it("searches by query", () => {
      const results = runStockScreener({ searchQuery: "半導体" });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((s) => {
        const matched =
          s.name.includes("半導体") || s.theme.includes("半導体") || s.ticker.includes("半導体");
        expect(matched).toBe(true);
      });
    });
  });

  describe("fetchMarketOverview", () => {
    it("returns baseline market overview data", async () => {
      const overview = await fetchMarketOverview();
      expect(overview.indices.length).toBeGreaterThan(0);
      expect(overview.forex.length).toBeGreaterThan(0);
      expect(overview.commodities.length).toBeGreaterThan(0);
      expect(overview.crypto.length).toBeGreaterThan(0);
      expect(overview.sectors.length).toBeGreaterThan(0);
      expect(overview.marketBreadth.sentimentScore).toBeGreaterThan(0);
    });
  });

  describe("UPCOMING_EVENTS", () => {
    it("contains upcoming earnings and macro events", () => {
      expect(UPCOMING_EVENTS.length).toBeGreaterThan(0);
      const macro = UPCOMING_EVENTS.filter((e) => e.type === "MACRO");
      const earnings = UPCOMING_EVENTS.filter((e) => e.type === "EARNINGS");
      expect(macro.length).toBeGreaterThan(0);
      expect(earnings.length).toBeGreaterThan(0);
    });
  });
});
