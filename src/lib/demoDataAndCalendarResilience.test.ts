import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchStockFundamentals,
  fetchUpcomingEvents,
  clearStockFundamentalsClientCache,
} from "./marketDataService";
import {
  clearMemoryCache,
  clearMemoryRateLimits,
  fetchLiveMarketCalendarAsync,
  fetchLiveStockFundamentals,
  resetLastKnownCalendarEvents,
  resetYahooCrumbCache,
} from "../../worker/internal";

describe("Demo Data Banner & Calendar Resilience Tests", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    resetLastKnownCalendarEvents();
    resetYahooCrumbCache();
    clearStockFundamentalsClientCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("window", globalThis);
  });

  describe("1. Stock Fundamentals: isDemoData clearing on success & enforcement on failure", () => {
    it("clears isDemoData when live API succeeds for unanchored tickers (e.g. 4063 Shin-Etsu)", async () => {
      // 4063 has no KNOWN_STOCK_ANCHORS entry, so baseline has isDemoData: true
      const mockLivePayload = {
        ticker: "4063",
        name: "信越化学工業",
        market: "PRIME",
        price: 4500,
        change: 50,
        changePercent: 1.12,
        marketCap: 115000,
        per: 22.5,
        pbr: 2.8,
        dividendYield: 2.1,
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/stock/fundamentals")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockLivePayload), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const data = await fetchStockFundamentals("4063", true);
      expect(data.price).toBe(4500);
      expect(data.ticker).toBe("4063");
      // CRITICAL: isDemoData must NOT remain true from baseline when live data was fetched
      expect(data.isDemoData).toBeUndefined();
    });

    it("ensures isDemoData: true is strictly set when API fails for anchored stocks (e.g. 7203 Toyota)", async () => {
      // 7203 is an anchor stock (baseline normally has no isDemoData: true)
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/stock/fundamentals")) {
          return Promise.resolve(
            new Response("Internal Server Error", { status: 500 }),
          );
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const data = await fetchStockFundamentals("7203", true);
      expect(data.ticker).toBe("7203");
      // When live fetch fails, even anchored stocks MUST be flagged as demo/fallback data
      expect(data.isDemoData).toBe(true);
    });

    it("ensures isDemoData: true is strictly set when API fails for unanchored stocks", async () => {
      const fetchMock = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error("Network connection lost"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const data = await fetchStockFundamentals("9999", true);
      expect(data.isDemoData).toBe(true);
    });

    it("worker fetchLiveStockFundamentals returns isDemoData: true when live quote fails", async () => {
      // Simulate Yahoo failure in worker
      const fetchMock = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error("Yahoo Finance 500"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const stock = await fetchLiveStockFundamentals("7203");
      expect(stock.ticker).toBe("7203");
      expect(stock.isDemoData).toBe(true);
    });
  });

  describe("2. Calendar: Fanuc (6954) query inclusion & error resilience", () => {
    it("includes 6954.T in the Yahoo quoteSymbols queried by fetchLiveMarketCalendarAsync", async () => {
      const refDate = new Date(2026, 9, 19);
      let capturedUrl = "";

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("fc.yahoo.com")) {
          return Promise.resolve(new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } }));
        }
        if (u.includes("getcrumb")) {
          return Promise.resolve(new Response("mock-crumb", { status: 200 }));
        }
        if (u.includes("v7/finance/quote")) {
          capturedUrl = u;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                quoteResponse: {
                  result: [
                    {
                      symbol: "6954.T",
                      shortName: "Fanuc Corp",
                      marketCap: 4000000000000,
                      earningsTimestamp: Math.floor(refDate.getTime() / 1000) + 86400 * 5,
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("OK", { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
      // Verify that 6954.T is part of the query URL symbols
      expect(capturedUrl).toContain("6954.T");

      // Verify Fanuc event is replaced with live data (no source: "fallback")
      const fanuc = events.find((e) => e.ticker === "6954");
      expect(fanuc).toBeDefined();
      expect(fanuc?.source).toBeUndefined();
    });

    it("leaves source: 'fallback' only on specific companies whose earnings dates are unavailable", async () => {
      const refDate = new Date(2026, 9, 19);

      // Only Toyota has live earnings data, Fanuc is not returned by Yahoo (e.g. date not yet announced)
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("fc.yahoo.com")) {
          return Promise.resolve(new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } }));
        }
        if (u.includes("getcrumb")) {
          return Promise.resolve(new Response("mock-crumb", { status: 200 }));
        }
        if (u.includes("v7/finance/quote")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                quoteResponse: {
                  result: [
                    {
                      symbol: "7203.T",
                      shortName: "Toyota",
                      marketCap: 35000000000000,
                      earningsTimestamp: Math.floor(refDate.getTime() / 1000) + 86400 * 2,
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("OK", { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);

      // Toyota has live data -> source is undefined
      const toyota = events.find((e) => e.ticker === "7203");
      expect(toyota).toBeDefined();
      expect(toyota?.source).toBeUndefined();

      // Fanuc was not in live results -> retained fallback with source: "fallback"
      const fanuc = events.find((e) => e.ticker === "6954");
      expect(fanuc).toBeDefined();
      expect(fanuc?.source).toBe("fallback");
    });

    it("marks all events as source: 'fallback' when calendar live fetch fails completely", async () => {
      const refDate = new Date(2026, 9, 19);
      const fetchMock = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error("Service Unavailable 503"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.source === "fallback")).toBe(true);
    });

    it("client fetchUpcomingEvents bypasses cache and returns fallback events on forceRefresh failure", async () => {
      const fetchMock = vi.fn().mockImplementation(() => {
        return Promise.reject(new Error("Network down"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const events = await fetchUpcomingEvents(true);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.source === "fallback")).toBe(true);
    });
  });
});
