import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../../worker/index";
import type { AssetsBinding, D1Database } from "../../worker/internal";
import {
  setAllowMemoryCacheInTest,
  clearMemoryCache,
  clearMemoryRateLimits,
  fetchLiveMarketOverview,
  fetchLiveStockFundamentals,
  fetchLiveScreenerUniverse,
  fetchLiveMarketCalendar,
  resetLastKnownMarketOverview,
  resetLastKnownScreenerUniverse,
  resetYahooCrumbCache,
} from "../../worker/internal";
import {
  fetchMarketOverview,
  fetchStockFundamentals,
  clearStockFundamentalsClientCache,
  clearScreenerUniverseClientCache,
  fetchScreenerStocks,
  fetchUpcomingEvents,
  getCachedStockFundamentals,
  getStockFundamentals,
  formatMarketCapDisplay,
  resetMarketOverviewEndpointProbe,
  DEFAULT_MARKET_OVERVIEW,
  runStockScreener,
} from "./marketDataService";
import { calculatePortfolioSummary, type PortfolioPosition } from "./portfolioStorage";

/**
 * Deterministic Yahoo Finance test double.
 *
 * Every helper in this file used to talk to the real Yahoo Finance API, so
 * the suite was neither hermetic nor reproducible: on a machine without egress
 * it silently asserted the fallback path, and on a machine with egress it hit
 * Yahoo (and could be rate-limited). All Yahoo URLs are now answered from a
 * fixed table:
 *
 * - `/v7/finance/quote` returns a deterministic quote per requested symbol, so
 *   the market overview and the screener universe get real numbers instead of
 *   the static fallback.
 * - `/v10/finance/quoteSummary`, `/v8/finance/chart` and `/v7/finance/spark`
 *   return empty payloads, so the fundamentals helpers keep exercising their
 *   documented anchor fallback.
 */
function stubYahooFinance(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://fc.yahoo.com")) {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "A1=test-cookie; Path=/; Domain=.yahoo.com" },
      });
    }
    if (url.includes("/v1/test/getcrumb")) {
      return new Response("test-crumb", { status: 200 });
    }
    if (url.includes("/v7/finance/quote")) {
      const symbols = (new URL(url).searchParams.get("symbols") || "")
        .split(",")
        .filter(Boolean);
      return jsonResponse({
        quoteResponse: {
          result: symbols.map((symbol) => {
            const seed = deterministicSeed(symbol);
            const price = 1000 + (seed % 4000);
            const change = (seed % 21 - 10) / 10;
            return {
              symbol,
              regularMarketPrice: price,
              regularMarketChange: change,
              regularMarketChangePercent: change / 10,
              regularMarketPreviousClose: price - change,
            };
          }),
        },
      });
    }
    if (url.includes("/v10/finance/quoteSummary/")) {
      return jsonResponse({ quoteSummary: { result: [] } });
    }
    if (url.includes("/v8/finance/chart/")) {
      return jsonResponse({ chart: { result: [] } });
    }
    if (url.includes("/v7/finance/spark")) {
      return jsonResponse({ spark: { result: [] } });
    }
    if (url.includes("/v1/finance/search")) {
      return jsonResponse({ news: [] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Stable 31-based hash so the generated quotes never change between runs. */
function deterministicSeed(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) & 0xffff;
  }
  return hash;
}

function createMockEnv() {
  return {
    ASSETS: { fetch: async () => new Response("OK") } as unknown as AssetsBinding,
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    } as unknown as D1Database,
  };
}

describe("Live Market and Stock Data Endpoints & Services", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    clearStockFundamentalsClientCache();
    clearScreenerUniverseClientCache();
    resetLastKnownMarketOverview();
    resetLastKnownScreenerUniverse();
    resetYahooCrumbCache();
    // Hermetic: no request in this file may reach the network.
    stubYahooFinance();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("GET /api/market/overview", () => {
    it("returns market overview with all asset classes, sectors, breadth and news", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/market/overview", {
          method: "GET",
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(res.headers.get("cache-control")).toContain("public");

        const data = await res.json();
        expect(Array.isArray(data.indices)).toBe(true);
        expect(data.indices.length).toBeGreaterThanOrEqual(6);
        expect(Array.isArray(data.forex)).toBe(true);
        expect(data.forex.length).toBeGreaterThanOrEqual(3);
        expect(Array.isArray(data.commodities)).toBe(true);
        expect(data.commodities.length).toBeGreaterThanOrEqual(3);
        expect(Array.isArray(data.crypto)).toBe(true);
        expect(data.crypto.length).toBeGreaterThanOrEqual(2);
        expect(Array.isArray(data.sectors)).toBe(true);
        expect(data.sectors.length).toBeGreaterThan(0);
        expect(data.marketBreadth).toBeDefined();
        expect(typeof data.marketBreadth.sentimentScore).toBe("number");
        expect(Array.isArray(data.news)).toBe(true);
        expect(data.news.length).toBeGreaterThan(0);

        // Check Nikkei quote structure
        const nikkei = data.indices.find((i: any) => i.symbol === "^N225");
        expect(nikkei).toBeDefined();
        expect(nikkei.name).toContain("日経平均");
        expect(typeof nikkei.price).toBe("number");
        expect(nikkei.price).toBeGreaterThan(0);

        // Check USD/JPY forex quote
        const usdjpy = data.forex.find((f: any) => f.symbol === "USDJPY=X");
        expect(usdjpy).toBeDefined();
        expect(typeof usdjpy.price).toBe("number");
        expect(usdjpy.price).toBeGreaterThan(100);

        // ETag revalidation. The precondition is asserted first, so a missing
        // ETag fails the test instead of skipping the whole 304 block.
        const etag = res.headers.get("etag");
        expect(etag).toBeTruthy();
        expect(typeof etag).toBe("string");

        const cachedReq = new Request("http://localhost/api/market/overview", {
          method: "GET",
          headers: { "if-none-match": etag! },
        });
        const cachedRes = await worker.fetch(cachedReq, env as any);
        expect(cachedRes.status).toBe(304);
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });

    it("fetchLiveMarketOverview helper returns well-structured live data", async () => {
      const data = await fetchLiveMarketOverview();
      expect(data.indices.length).toBeGreaterThanOrEqual(6);
      expect(data.forex.length).toBeGreaterThanOrEqual(3);
      expect(data.commodities.length).toBeGreaterThanOrEqual(3);
      expect(data.crypto.length).toBeGreaterThanOrEqual(2);
      expect(data.sectors.length).toBeGreaterThan(0);
      expect(data.marketBreadth.gainers).toBeGreaterThan(0);
      expect(data.marketBreadth.losers).toBeGreaterThan(0);
    });

    it("fetchLiveMarketOverview derives the breadth from the quoted sector samples", async () => {
      const data = await fetchLiveMarketOverview();
      expect(data.marketBreadth.unchanged).toBeGreaterThanOrEqual(0);
      expect(data.marketBreadth.gainers + data.marketBreadth.losers).toBeGreaterThan(0);
      // Every sector is derived from the sampled quotes, never from a constant.
      expect(data.sectors.every((sector) => Number.isFinite(sector.changePercent))).toBe(true);
    });
  });

  describe("GET /api/stock/fundamentals", () => {
    it("returns 400 when ticker query parameter is missing", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/api/stock/fundamentals", {
        method: "GET",
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("ティッカー");
    });

    it("returns 400 when ticker format is invalid or oversized", async () => {
      const env = createMockEnv();
      const invalidCharsReq = new Request(
        "http://localhost/api/stock/fundamentals?ticker=evil<script>",
        {
          method: "GET",
        },
      );
      const invalidRes = await worker.fetch(invalidCharsReq, env as any);
      expect(invalidRes.status).toBe(400);
      const invalidData = await invalidRes.json();
      expect(invalidData.error).toContain("ティッカーの形式が正しくありません");

      const oversizedReq = new Request(
        "http://localhost/api/stock/fundamentals?ticker=TOOLONGTICKERSYMBOLOVER20CHARS",
        {
          method: "GET",
        },
      );
      const oversizedRes = await worker.fetch(oversizedReq, env as any);
      expect(oversizedRes.status).toBe(400);
    });

    it("returns complete fundamentals for a Japanese stock (7203)", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/stock/fundamentals?ticker=7203", {
          method: "GET",
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");

        const data = await res.json();
        expect(data.ticker).toBe("7203");
        expect(data.market).toBe("PRIME");
        expect(typeof data.price).toBe("number");
        expect(data.price).toBeGreaterThan(0);
        expect(typeof data.dayHigh).toBe("number");
        expect(typeof data.dayLow).toBe("number");
        expect(typeof data.yearHigh).toBe("number");
        expect(typeof data.yearLow).toBe("number");
        expect(typeof data.marketCap).toBe("number");
        expect(data.marketCap).toBeGreaterThan(0);
        expect(Array.isArray(data.historicalFinances)).toBe(true);
        expect(data.historicalFinances.length).toBe(4);

        // ETag revalidation check. The precondition is asserted first, so the
        // 304 block can no longer be skipped silently.
        const etag = res.headers.get("etag");
        expect(etag).toBeTruthy();
        expect(typeof etag).toBe("string");

        const cachedReq = new Request("http://localhost/api/stock/fundamentals?ticker=7203", {
          method: "GET",
          headers: { "if-none-match": etag! },
        });
        const cachedRes = await worker.fetch(cachedReq, env as any);
        expect(cachedRes.status).toBe(304);
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });

    it("returns complete fundamentals for a US stock (NVDA)", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/stock/fundamentals?ticker=NVDA", {
          method: "GET",
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.ticker).toBe("NVDA");
        expect(data.market).toBe("US");
        expect(typeof data.price).toBe("number");
        expect(data.price).toBeGreaterThan(0);
        expect(Array.isArray(data.historicalFinances)).toBe(true);
        expect(data.historicalFinances.length).toBeGreaterThan(0);
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });

    it("fetchLiveStockFundamentals helper returns realistic data for known tickers", async () => {
      const data = await fetchLiveStockFundamentals("8035");
      expect(data.ticker).toBe("8035");
      expect(data.name).toContain("東京エレクトロン");
      expect(data.price).toBeGreaterThan(0);
      expect(data.marketCap).toBeGreaterThan(10000);
    });

    it("fetchLiveStockFundamentals serves the declared anchor when Yahoo has no valuation data", async () => {
      // The stub answers the quote batch but never the quoteSummary, so the
      // helper must fall back to the curated anchor instead of inventing
      // numbers.
      const anchor = getStockFundamentals("7203");
      const data = await fetchLiveStockFundamentals("7203");

      expect(data.ticker).toBe("7203");
      expect(data.price).toBe(anchor.price);
      expect(data.marketCap).toBe(anchor.marketCap);
      expect(data.historicalFinances.length).toBe(anchor.historicalFinances.length);
      expect(data.historicalFinances.map((h) => h.revenue)).toEqual(
        anchor.historicalFinances.map((h) => h.revenue),
      );
    });
  });

  describe("Client-side fetchStockFundamentals Service", () => {
    it("returns real or baseline fundamentals for ticker", async () => {
      const data = await fetchStockFundamentals("7203");
      expect(data.ticker).toBe("7203");
      expect(data.name).toContain("トヨタ");
      expect(data.price).toBeGreaterThan(0);
      expect(data.per).toBeGreaterThan(0);
      expect(data.pbr).toBeGreaterThan(0);
    });

    it("uses in-memory client cache on repeated calls and respects forceRefresh", async () => {
      const first = await fetchStockFundamentals("NVDA");
      const second = await fetchStockFundamentals("NVDA");
      expect(first).toBe(second);

      const refreshed = await fetchStockFundamentals("NVDA", true);
      expect(refreshed.ticker).toBe("NVDA");
    });

    it("getStockFundamentals provides accurate anchor baselines", () => {
      const toyota = getStockFundamentals("7203");
      expect(toyota.price).toBe(2910.5);
      expect(toyota.per).toBe(8.3);
      expect(toyota.pbr).toBe(0.92);
      expect(toyota.dividendYield).toBe(3.45);

      const nvda = getStockFundamentals("NVDA");
      expect(nvda.price).toBe(229.28);
      expect(nvda.per).toBe(29.0);
      expect(nvda.marketCap).toBeGreaterThan(5000000);
    });

    it("fetchMarketOverview returns baseline and supports probe reset", async () => {
      resetMarketOverviewEndpointProbe();
      const overview = await fetchMarketOverview();
      // The baseline payload is returned with fallback metadata disclosing
      // that live data could not be fetched (data authenticity requirement).
      expect(overview).toEqual({
        ...DEFAULT_MARKET_OVERVIEW,
        dataSource: "fallback",
        dataAsOf: expect.any(String),
      });
      expect(overview.indices.length).toBeGreaterThan(0);
      expect(overview.forex.length).toBeGreaterThan(0);
      expect(overview.marketBreadth.gainers).toBeGreaterThan(0);
    });

    it("formatMarketCapDisplay formats Japanese and US stocks accurately", () => {
      expect(formatMarketCapDisplay(344657, "PRIME")).toBe("34.5 兆円");
      expect(formatMarketCapDisplay(71200, "PRIME")).toBe("7.1 兆円");
      expect(formatMarketCapDisplay(3500, "STANDARD")).toBe("3,500 億円");
      expect(formatMarketCapDisplay(5536424, "US")).toBe("5.54 兆ドル");
      // marketCap for US stocks is stored in millions of USD: $45B is
      // 45,000 $M = 450 億ドル (not 45 億ドル, which would be $4.5B).
      expect(formatMarketCapDisplay(45000, "US")).toBe("450 億ドル");
      expect(formatMarketCapDisplay(1000, "US")).toBe("10 億ドル");
      expect(formatMarketCapDisplay(850, "US")).toBe("850 百万ドル");
      expect(formatMarketCapDisplay(-1, "US")).toBe("--");
    });

    it("runStockScreener supports sector in searchQuery matching", () => {
      const results = runStockScreener({ searchQuery: "輸送用機器" });
      expect(results.some((s) => s.ticker === "7203")).toBe(true);
    });

    it("getCachedStockFundamentals falls back to baseline or cached data", () => {
      const baseline = getCachedStockFundamentals("7203");
      expect(baseline.ticker).toBe("7203");
      expect(baseline.price).toBeGreaterThan(0);
    });

    it("calculatePortfolioSummary applies live quotes when provided", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
          acquiredAt: "2026-01-01",
        },
      ];

      const customQuotes = new Map([
        ["7203", { price: 3200, change: 50, dps: 110, name: "トヨタ自動車" }],
      ]);

      const summary = calculatePortfolioSummary(positions, customQuotes);
      expect(summary.totalMarketValue).toBe(320000);
      expect(summary.totalCost).toBe(250000);
      expect(summary.totalProfit).toBe(70000);
      expect(summary.dailyTotalChange).toBe(5000);
      expect(summary.totalAnnualDividend).toBe(11000);
    });
  });

  describe("GET /api/stocks/screener", () => {
    it("returns screener universe with complete fundamentals for popular stocks", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/stocks/screener", {
          method: "GET",
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");

        const universe = await res.json();
        expect(Array.isArray(universe)).toBe(true);
        expect(universe.length).toBeGreaterThanOrEqual(50);

        const toyota = universe.find((s: any) => s.ticker === "7203");
        expect(toyota).toBeDefined();
        expect(toyota.price).toBeGreaterThan(0);
        expect(toyota.marketCap).toBeGreaterThan(0);

        // ETag revalidation check. The precondition is asserted first, so the
        // 304 block can no longer be skipped silently.
        const etag = res.headers.get("etag");
        expect(etag).toBeTruthy();
        expect(typeof etag).toBe("string");

        const cachedReq = new Request("http://localhost/api/stocks/screener", {
          method: "GET",
          headers: { "if-none-match": etag! },
        });
        const cachedRes = await worker.fetch(cachedReq, env as any);
        expect(cachedRes.status).toBe(304);
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });

    it("fetchLiveScreenerUniverse helper returns all universe stocks with valid prices", async () => {
      const data = await fetchLiveScreenerUniverse();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(50);
      for (const item of data.slice(0, 5)) {
        expect(item.price).toBeGreaterThan(0);
        expect(item.name).toBeTruthy();
        expect(item.theme).toBeTruthy();
      }
    });

    it("fetchLiveScreenerUniverse serves the deterministic stubbed quotes", async () => {
      const data = await fetchLiveScreenerUniverse();
      const toyota = data.find((s) => s.ticker === "7203");
      expect(toyota).toBeDefined();
      expect(toyota!.price).toBeGreaterThan(0);
      expect(toyota!.change).not.toBe(0);
      expect(toyota!.previousClose).toBeGreaterThan(0);
    });
  });

  describe("GET /api/market/calendar", () => {
    it("returns financial calendar events with both macro and earnings categories", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/market/calendar", {
          method: "GET",
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);

        const events = await res.json();
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeGreaterThan(0);

        const hasMacro = events.some((e: any) => e.type === "MACRO");
        const hasEarnings = events.some((e: any) => e.type === "EARNINGS");
        expect(hasMacro).toBe(true);
        expect(hasEarnings).toBe(true);
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });

    it("fetchLiveMarketCalendar helper generates dynamic events with current dates", () => {
      const events = fetchLiveMarketCalendar();
      expect(events.length).toBeGreaterThanOrEqual(5);
      const toyotaEvent = events.find((e) => e.ticker === "7203");
      expect(toyotaEvent).toBeDefined();
      expect(toyotaEvent?.type).toBe("EARNINGS");
    });
  });

  describe("Client Service Helpers", () => {
    it("fetchScreenerStocks falls back to runStockScreener when API is unavailable or returns results", async () => {
      const results = await fetchScreenerStocks({ maxPer: 50 });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      for (const stock of results) {
        expect(stock.per).not.toBeNull();
        expect(stock.per!).toBeLessThanOrEqual(50);
      }
    });

    it("fetchUpcomingEvents returns calendar events", async () => {
      const events = await fetchUpcomingEvents();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
