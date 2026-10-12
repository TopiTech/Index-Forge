import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isIndexAsset,
  isMacroAsset,
  getStockFundamentals,
  fetchMarketOverview,
  DEFAULT_MARKET_OVERVIEW,
} from "./marketDataService";
import { resolveTradingViewSymbol } from "../components/StockTechnicalChart";
import { getStockCurrency } from "./currency";
import { POPULAR_STOCKS, PRESET_STOCKS, searchPopularStocks } from "../data/popularStocks";

describe("System Hardening & Inconsistency Fixes", () => {
  describe("Macro & Index Asset Consistency Guards", () => {
    it("correctly identifies index assets", () => {
      expect(isIndexAsset("^GSPC")).toBe(true);
      expect(isIndexAsset("^N225")).toBe(true);
      expect(isIndexAsset("^IXIC")).toBe(true);
      expect(isIndexAsset("^TOPX")).toBe(true);
      expect(isIndexAsset("^DJI")).toBe(true);
      expect(isIndexAsset("7203")).toBe(false);
      expect(isIndexAsset("AAPL")).toBe(false);
    });

    it("correctly identifies macro assets (indices, forex, commodities, crypto)", () => {
      expect(isMacroAsset("^GSPC")).toBe(true);
      expect(isMacroAsset("USDJPY=X")).toBe(true);
      expect(isMacroAsset("EURUSD=X")).toBe(true);
      expect(isMacroAsset("BTC-USD")).toBe(true);
      expect(isMacroAsset("GC=F")).toBe(true);
      expect(isMacroAsset("7203")).toBe(false);
      expect(isMacroAsset("AAPL")).toBe(false);
    });

    it("does not attach dummy individual stock metrics to macro index assets", () => {
      const sp500 = getStockFundamentals("^GSPC");
      expect(sp500.ticker).toBe("^GSPC");
      expect(sp500.name).toContain("S&P 500");
      // Individual stock valuation metrics should be null or 0 for macro index
      expect(sp500.per).toBeNull();
      expect(sp500.pbr).toBeNull();
      expect(sp500.dividendYield).toBeNull();
      expect(sp500.roe).toBeNull();
      expect(sp500.marketCap).toBe(0);
      expect(sp500.historicalFinances).toEqual([]);
    });

    it("does not attach dummy metrics to forex currency pairs", () => {
      const usdjpy = getStockFundamentals("USDJPY=X");
      expect(usdjpy.ticker).toBe("USDJPY=X");
      expect(usdjpy.per).toBeNull();
      expect(usdjpy.pbr).toBeNull();
      expect(usdjpy.dividendYield).toBeNull();
      expect(usdjpy.roe).toBeNull();
      expect(usdjpy.marketCap).toBe(0);
      expect(usdjpy.historicalFinances).toEqual([]);
    });

    it("maintains valid financial fundamentals for normal equity stocks", () => {
      const toyota = getStockFundamentals("7203");
      expect(toyota.ticker).toBe("7203");
      expect(toyota.name).toBe("トヨタ自動車");
      expect(toyota.per).toBeGreaterThan(0);
      expect(toyota.pbr).toBeGreaterThan(0);
      expect(toyota.dividendYield).toBeGreaterThan(0);
      expect(toyota.roe).toBeGreaterThan(0);
      expect(toyota.marketCap).toBeGreaterThan(0);
      expect(toyota.historicalFinances?.length).toBeGreaterThan(0);
    });
  });

  describe("TradingView Symbol Resolver & Auto-Fallback", () => {
    it("resolves major market indices to accurate TradingView symbols", () => {
      expect(resolveTradingViewSymbol("^GSPC", true)).toEqual({
        symbol: "FOREXCOM:SPXUSD",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("^IXIC", true)).toEqual({
        symbol: "NASDAQ:IXIC",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("^DJI", true)).toEqual({
        symbol: "FOREXCOM:DJI",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("^N225", false)).toEqual({
        symbol: "INDEX:NKY",
        isSupported: true,
      });
    });

    it("resolves forex and crypto pairs correctly", () => {
      expect(resolveTradingViewSymbol("USDJPY=X", false)).toEqual({
        symbol: "FX:USDJPY",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("EURUSD=X", true)).toEqual({
        symbol: "FX:EURUSD",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("BTC-USD", true)).toEqual({
        symbol: "COINBASE:BTCUSD",
        isSupported: true,
      });
    });

    it("formats standard Japanese stocks with TSE: prefix and US stocks as ticker", () => {
      expect(resolveTradingViewSymbol("7203", false)).toEqual({
        symbol: "TSE:7203",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("AAPL", true)).toEqual({
        symbol: "AAPL",
        isSupported: true,
      });
      expect(resolveTradingViewSymbol("NVDA", true)).toEqual({
        symbol: "NVDA",
        isSupported: true,
      });
    });
  });

  describe("Market Overview Fallback Cooldown & Resilience", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns default overview with fallback metadata on simulated worker outage", async () => {
      // Mock fetch to simulate 500 or network failure
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network offline"));

      try {
        const overview = await fetchMarketOverview(true);
        expect(overview).toBeDefined();
        expect(overview.dataSource).toBe("fallback");
        expect(overview.indices.length).toBeGreaterThan(0);
        expect(overview.forex.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Portfolio Custom Ticker & Currency Clarity", () => {
    it("differentiates currencies accurately between US and Japanese stocks", () => {
      expect(getStockCurrency("AAPL")).toBe("$");
      expect(getStockCurrency("MSFT")).toBe("$");
      expect(getStockCurrency("NVDA")).toBe("$");
      expect(getStockCurrency("7203")).toBe("¥");
      expect(getStockCurrency("6758")).toBe("¥");
      expect(getStockCurrency("9984")).toBe("¥");
    });

    it("provides popular stock search and preset stock list", () => {
      const results = searchPopularStocks("トヨタ");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].ticker).toBe("7203");

      const appleResults = searchPopularStocks("AAPL");
      expect(appleResults.length).toBeGreaterThan(0);
      expect(appleResults[0].ticker).toBe("AAPL");

      expect(PRESET_STOCKS.length).toBeGreaterThanOrEqual(10);
      expect(PRESET_STOCKS.some((s) => s.ticker === "7203")).toBe(true);
      expect(PRESET_STOCKS.some((s) => s.ticker === "6758")).toBe(true);
    });
  });

  describe("Global Search Macro Integration", () => {
    it("includes major market indices and currencies in DEFAULT_MARKET_OVERVIEW", () => {
      const n225 = DEFAULT_MARKET_OVERVIEW.indices.find((i) => i.symbol === "^N225");
      const sp500 = DEFAULT_MARKET_OVERVIEW.indices.find((i) => i.symbol === "^GSPC");
      const usdjpy = DEFAULT_MARKET_OVERVIEW.forex.find((f) => f.symbol === "USDJPY=X");

      expect(n225).toBeDefined();
      expect(n225?.name).toContain("日経");
      expect(sp500).toBeDefined();
      expect(sp500?.name).toContain("S&P 500");
      expect(usdjpy).toBeDefined();
      expect(usdjpy?.name).toContain("ドル");
    });
  });
});
