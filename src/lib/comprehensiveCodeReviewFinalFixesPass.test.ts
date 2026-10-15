import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import worker from "../../worker/index";
import {
  setAllowMemoryCacheInTest,
  clearMemoryCache,
  setMemoryCache,
} from "../../worker/internal";

describe("Comprehensive Code Review Final Fixes & Hardening Tests", () => {
  beforeEach(() => {
    setAllowMemoryCacheInTest(true);
    clearMemoryCache();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    clearMemoryCache();
    vi.restoreAllMocks();
  });

  describe("1. Worker Force-Refresh Cache Bypass on Read Endpoints", () => {
    it("bypasses memory cache on GET /api/stock/fundamentals when Cache-Control: no-cache is provided", async () => {
      // Seed memory cache with identifiable mock entry
      const cachedPayload = {
        ticker: "7203",
        name: "CACHED_TOYOTA",
        market: "PRIME",
        price: 9999,
        change: 0,
        changePercent: 0,
        volume: 1000,
        previousClose: 9999,
        dayHigh: 10000,
        dayLow: 9900,
        yearHigh: 12000,
        yearLow: 8000,
        marketCap: 400000,
        per: 10,
        pbr: 1.1,
        dividendYield: 2.5,
        roe: 12,
        equityRatio: 50,
        eps: 300,
        dps: 80,
        sparkline: [9999, 9999],
        technicalSignal: "BUY" as const,
        historicalFinances: [],
      };
      setMemoryCache("stock:7203", cachedPayload, 300);

      // Verify normal request hits the memory cache
      const normalReq = new Request("https://example.com/api/stock/fundamentals?ticker=7203");
      const normalRes = await worker.fetch(normalReq, {} as any);
      expect(normalRes.status).toBe(200);
      const normalData = (await normalRes.json()) as any;
      expect(normalData.name).toBe("CACHED_TOYOTA");

      // Verify request with Cache-Control: no-cache bypasses memory cache
      const freshReq = new Request("https://example.com/api/stock/fundamentals?ticker=7203", {
        headers: { "Cache-Control": "no-cache" },
      });
      const freshRes = await worker.fetch(freshReq, {} as any);
      expect(freshRes.status).toBe(200);
      const freshData = (await freshRes.json()) as any;
      // Fresh data should resolve authentic name (トヨタ自動車), not CACHED_TOYOTA
      expect(freshData.name).not.toBe("CACHED_TOYOTA");
      expect(freshData.ticker).toBe("7203");
    });

    it("bypasses memory cache on GET /api/market/overview when refresh query or no-cache is supplied", async () => {
      const mockOverview = {
        dataSource: "fallback" as const,
        dataAsOf: new Date().toISOString(),
        indices: [],
        forex: [],
        commodities: [],
        crypto: [],
        sectors: [],
        marketBreadth: { gainers: 10, losers: 10, unchanged: 10, sentimentScore: 50 },
        news: [{ id: "mock-news", title: "CACHED_MARKET_NEWS", source: "test", publishedAt: "10:00" }],
      };
      setMemoryCache("overview:market", mockOverview, 300);

      // Normal request receives cached payload
      const normalReq = new Request("https://example.com/api/market/overview");
      const normalRes = await worker.fetch(normalReq, {} as any);
      expect(normalRes.status).toBe(200);
      const normalJson = (await normalRes.json()) as any;
      expect(normalJson.news?.[0]?.title).toBe("CACHED_MARKET_NEWS");

      // Request with refresh parameter triggers live fetch and bypasses cache
      const freshReq = new Request("https://example.com/api/market/overview?refresh=true");
      const freshRes = await worker.fetch(freshReq, {} as any);
      expect(freshRes.status).toBe(200);
      const freshJson = (await freshRes.json()) as any;
      expect(freshJson.news?.[0]?.title).not.toBe("CACHED_MARKET_NEWS");
    });

    it("bypasses memory cache on GET /api/stocks/screener when requested with no-cache", async () => {
      const mockUniverse = [
        {
          ticker: "MOCK",
          name: "CACHED_MOCK_STOCK",
          market: "PRIME",
          price: 100,
          change: 0,
          changePercent: 0,
          volume: 100,
          previousClose: 100,
          dayHigh: 100,
          dayLow: 100,
          yearHigh: 100,
          yearLow: 100,
          marketCap: 100,
          per: 10,
          pbr: 1,
          dividendYield: 2,
          roe: 5,
          equityRatio: 50,
          eps: 10,
          dps: 2,
          sparkline: [100, 100],
          technicalSignal: "NEUTRAL" as const,
          historicalFinances: [],
        },
      ];
      setMemoryCache("screener:universe", mockUniverse, 300);

      // Normal request returns mock
      const normalReq = new Request("https://example.com/api/stocks/screener");
      const normalRes = await worker.fetch(normalReq, {} as any);
      expect(normalRes.status).toBe(200);
      const normalJson = (await normalRes.json()) as any[];
      expect(normalJson[0]?.name).toBe("CACHED_MOCK_STOCK");

      // Force refresh bypasses mock
      const freshReq = new Request("https://example.com/api/stocks/screener", {
        headers: { Pragma: "no-cache" },
      });
      const freshRes = await worker.fetch(freshReq, {} as any);
      expect(freshRes.status).toBe(200);
      const freshJson = (await freshRes.json()) as any[];
      expect(freshJson[0]?.name).not.toBe("CACHED_MOCK_STOCK");
    });

    it("bypasses memory cache on GET /api/ticker-prices with Pragma or Cache-Control no-cache", async () => {
      const mockQuotes = {
        updatedAt: new Date().toISOString(),
        quotes: [{ proName: "TSE:MOCK", title: "MOCK", price: "999", change: "+0", changePercent: "+0.00%", stale: false }],
      };
      setMemoryCache("ticker:quotes", mockQuotes, 300);

      const normalReq = new Request("https://example.com/api/ticker-prices");
      const normalRes = await worker.fetch(normalReq, {} as any);
      expect(normalRes.status).toBe(200);
      const normalJson = (await normalRes.json()) as any;
      expect(normalJson.quotes?.[0]?.title).toBe("MOCK");

      const freshReq = new Request("https://example.com/api/ticker-prices", {
        headers: { "Cache-Control": "max-age=0" },
      });
      const freshRes = await worker.fetch(freshReq, {} as any);
      expect(freshRes.status).toBe(200);
      const freshJson = (await freshRes.json()) as any;
      expect(freshJson.quotes?.[0]?.title).not.toBe("MOCK");
    });
  });

  describe("2. StockAnalysisPage Component Integration & Accessibility", () => {
    const stockAnalysisPath = resolve(__dirname, "../components/StockAnalysisPage.tsx");
    const stockAnalysisTsx = readFileSync(stockAnalysisPath, "utf-8");

    it("integrates interactive index and portfolio quick-add actions into stock cards", () => {
      expect(stockAnalysisTsx).toContain("onAddToIndex &&");
      expect(stockAnalysisTsx).toContain("onAddToPortfolio &&");
      expect(stockAnalysisTsx).toContain('aria-label={`${stock.name}を指数に追加`}');
      expect(stockAnalysisTsx).toContain('aria-label={`${stock.name}をポートフォリオに追加`}');
      expect(stockAnalysisTsx).toContain("stock-card-cap");
    });

    it("improves search suggestion dropdown with outside-click and Escape key dismissal", () => {
      expect(stockAnalysisTsx).toContain("isSearchDropdownOpen");
      expect(stockAnalysisTsx).toContain("searchFormRef");
      expect(stockAnalysisTsx).toContain('e.key === "Escape"');
      expect(stockAnalysisTsx).toContain("handleClickOutside");
      expect(stockAnalysisTsx).toContain("setIsSearchDropdownOpen(false)");
    });
  });

  describe("3. Yahoo Quote Summary Interface & SEC Edgar XBRL Typing Contracts", () => {
    const workerImplPath = resolve(__dirname, "../../worker/internal-impl.ts");
    const workerImplTs = readFileSync(workerImplPath, "utf-8");

    it("declares all required properties in YahooQuoteSummaryResponse to prevent TS compilation breaks", () => {
      expect(workerImplTs).toContain("volume?: { raw?: number };");
      expect(workerImplTs).toContain("dayHigh?: { raw?: number };");
      expect(workerImplTs).toContain("dayLow?: { raw?: number };");
      expect(workerImplTs).toContain("marketCap?: { raw?: number };");
      expect(workerImplTs).toContain("trailingPE?: { raw?: number };");
      expect(workerImplTs).toContain("forwardPE?: { raw?: number };");
      expect(workerImplTs).toContain("lastDividendValue?: { raw?: number };");
      expect(workerImplTs).toContain("debtToEquity?: { raw?: number };");
    });
  });
});
