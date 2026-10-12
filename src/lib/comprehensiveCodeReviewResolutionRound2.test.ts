import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS,
  checkRateLimit,
  clearMemoryRateLimits,
  fetchLiveStockFundamentals,
  fetchLiveMarketOverview,
  getYahooCrumb,
  resetYahooCrumbCache,
} from "../../worker/internal";
import { normalizeMarketOverview } from "./marketDataService";

describe("Comprehensive Code Review Resolution Round 2", () => {
  beforeEach(() => {
    clearMemoryRateLimits();
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  describe("D1 Write Quota Protection via HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS", () => {
    it("contains all high-frequency read and computation endpoints", () => {
      const requiredEndpoints = [
        "snapshot",
        "ticker-prices",
        "calculate",
        "market-overview",
        "stock-fundamentals",
        "stocks-screener",
        "market-calendar",
      ];
      for (const ep of requiredEndpoints) {
        expect(HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS.has(ep)).toBe(true);
      }
    });

    it("routes high-frequency endpoints to memory rate limiting without executing D1 writes", async () => {
      const prepareMock = vi.fn();
      const mockEnv = {
        DB: {
          prepare: prepareMock,
        },
      } as any;

      const endpointsToTest = [
        "market-overview",
        "stock-fundamentals",
        "stocks-screener",
        "market-calendar",
      ];

      for (const endpoint of endpointsToTest) {
        const allowed = await checkRateLimit(mockEnv, "192.168.1.100", endpoint, 60);
        expect(allowed).toBe(true);
      }

      // Memory-bypassed endpoints must NEVER call env.DB.prepare (zero D1 writes)
      expect(prepareMock).not.toHaveBeenCalled();
    });

    it("mutating endpoints still use D1 rate limiting for persistent tracking", async () => {
      const runMock = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      const bindMock = vi.fn().mockReturnValue({ run: runMock });
      const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
      const mockEnv = {
        DB: {
          prepare: prepareMock,
        },
      } as any;

      const allowed = await checkRateLimit(mockEnv, "192.168.1.100", "indices", 60);
      expect(allowed).toBe(true);
      expect(prepareMock).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO rate_limits")
      );
    });
  });

  describe("fetchLiveStockFundamentals Authenticity & Symbol Resolution", () => {
    it("flags isDemoData: true when Yahoo Finance quotes are unavailable or fail", async () => {
      // Mock fetch to simulate failure / network error
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response("Not Found", { status: 404 });
      });

      try {
        const data = await fetchLiveStockFundamentals("UNKNOWN123");
        expect(data.ticker).toBe("UNKNOWN123");
        expect(data.isDemoData).toBe(true);
        expect(typeof data.price).toBe("number");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("resolves and updates company name from priceObj shortName/longName for non-preset tickers", async () => {
      const mockQuoteSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                shortName: "Oracle Corporation",
                regularMarketPrice: { raw: 165.5 },
                regularMarketChange: { raw: 1.8 },
                regularMarketChangePercent: { raw: 0.011 },
                regularMarketPreviousClose: { raw: 163.7 },
                regularMarketVolume: { raw: 12000000 },
                regularMarketDayHigh: { raw: 166.5 },
                regularMarketDayLow: { raw: 164.2 },
                marketCap: { raw: 450000000000 },
              },
            },
          ],
        },
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (info: any) => {
        const url = typeof info === "string" ? info : info.url;
        if (url.includes("fc.yahoo.com")) {
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "A1=sample-cookie-val" },
          });
        }
        if (url.includes("getcrumb")) {
          return new Response("valid_crumb", { status: 200 });
        }
        if (url.includes("quoteSummary")) {
          return new Response(JSON.stringify(mockQuoteSummary), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      try {
        const data = await fetchLiveStockFundamentals("ORCL");
        expect(data.ticker).toBe("ORCL");
        expect(data.name).toBe("Oracle Corporation");
        expect(data.price).toBe(165.5);
        expect(data.isDemoData).toBeUndefined(); // Live data present, not demo
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("Market Overview Metadata Preservation", () => {
    it("normalizeMarketOverview preserves server dataSource and dataAsOf when present", () => {
      const serverPayload = {
        dataSource: "live" as const,
        dataAsOf: "2026-10-12T01:00:00.000Z",
        indices: [
          {
            symbol: "^N225",
            name: "日経平均株価",
            category: "INDEX",
            price: 39000,
            change: 150,
            changePercent: 0.38,
            currency: "JPY",
            sparkline: [38900, 39000],
            updatedAt: "15:00 JST",
          },
        ],
        forex: [],
        commodities: [],
        crypto: [],
        sectors: [],
        marketBreadth: { gainers: 100, losers: 50, unchanged: 10, sentimentScore: 65 },
        news: [],
      };

      const normalized = normalizeMarketOverview(serverPayload);
      expect(normalized).not.toBeNull();
      expect(normalized?.dataSource).toBe("live");
      expect(normalized?.dataAsOf).toBe("2026-10-12T01:00:00.000Z");
      expect(normalized?.indices.length).toBe(1);
    });

    it("normalizeMarketOverview leaves dataSource and dataAsOf undefined when absent", () => {
      const serverPayload = {
        indices: [
          {
            symbol: "^GSPC",
            name: "S&P 500",
            category: "INDEX",
            price: 5800,
            change: 10,
            changePercent: 0.17,
            currency: "USD",
            updatedAt: "-",
          },
        ],
        forex: [],
        commodities: [],
        crypto: [],
        sectors: [],
        marketBreadth: { gainers: 1, losers: 0, unchanged: 0, sentimentScore: 50 },
        news: [],
      };

      const normalized = normalizeMarketOverview(serverPayload);
      expect(normalized).not.toBeNull();
      expect(normalized?.dataSource).toBeUndefined();
      expect(normalized?.dataAsOf).toBeUndefined();
    });

    it("fetchLiveMarketOverview attaches dataSource and dataAsOf", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response("Service Unavailable", { status: 503 });
      });

      try {
        const overview = await fetchLiveMarketOverview();
        expect(overview.dataSource).toBe("fallback");
        expect(typeof overview.dataAsOf).toBe("string");
        expect(Number.isNaN(Date.parse(overview.dataAsOf as string))).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("getYahooCrumb Multi-Cookie Support", () => {
    it("preserves multiple Set-Cookie headers using getSetCookie when available", async () => {
      let cookieReceivedByGetcrumb = "";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (info: any, init?: any) => {
        const url = typeof info === "string" ? info : info.url;
        if (url.includes("fc.yahoo.com")) {
          const headers = new Headers();
          headers.append("set-cookie", "A1=val1; Path=/; Domain=.yahoo.com");
          headers.append("set-cookie", "A3=val3; Path=/; Domain=.yahoo.com");

          // Simulate modern getSetCookie support
          (headers as any).getSetCookie = () => [
            "A1=val1; Path=/; Domain=.yahoo.com",
            "A3=val3; Path=/; Domain=.yahoo.com",
          ];

          return new Response("", { status: 200, headers });
        }
        if (url.includes("getcrumb")) {
          cookieReceivedByGetcrumb = init?.headers?.Cookie || "";
          return new Response("multi_cookie_crumb", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const auth = await getYahooCrumb(true);
        expect(auth).not.toBeNull();
        expect(auth?.crumb).toBe("multi_cookie_crumb");
        expect(cookieReceivedByGetcrumb).toContain("A1=val1");
        expect(cookieReceivedByGetcrumb).toContain("A3=val3");
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
