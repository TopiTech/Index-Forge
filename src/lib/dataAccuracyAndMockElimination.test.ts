import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getStockFundamentals } from "./marketDataService";
import {
  fetchLiveStockFundamentals,
  fetchLiveScreenerUniverse,
  fetchLiveMarketCalendarAsync,
  resetYahooCrumbCache,
} from "../../worker/internal";

/**
 * Deterministic Yahoo Finance test double.
 *
 * The screener universe used to be built from the real Yahoo API, so the
 * assertions depended on network egress (and on Yahoo's rate limiter). The
 * stub answers every quote request with a deterministic payload so the
 * universe is reproducible on every machine.
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
            return {
              symbol,
              regularMarketPrice: 1000 + (seed % 4000),
              regularMarketChange: (seed % 21 - 10) / 10,
              regularMarketChangePercent: (seed % 21 - 10) / 100,
              regularMarketPreviousClose: 1000 + (seed % 4000),
              // A per-symbol market cap so the synthetic-revenue check below
              // compares against a distinct value for every row.
              marketCap: 3_000_000_000_000 + seed * 10_000_000,
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

describe("Data Accuracy & Mock Elimination Comprehensive Tests", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    vi.unstubAllGlobals();
    stubYahooFinance();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. Screener Universe Data Accuracy & Mock Elimination", () => {
    it("never produces synthetic mock financials with marketCap * 0.72 multiplier", async () => {
      const universe = await fetchLiveScreenerUniverse();
      expect(universe.length).toBeGreaterThan(0);

      // Precondition: the universe must actually carry financial history and
      // market caps large enough for the synthetic-revenue check to be
      // meaningful. Previously both were hidden behind `if` guards, so the
      // assertion could silently disappear.
      const rowsWithFinances = universe.filter((stock) => stock.historicalFinances.length > 0);
      expect(rowsWithFinances.length).toBeGreaterThan(0);

      const comparableRows = rowsWithFinances.filter((stock) => stock.marketCap > 10000);
      expect(comparableRows.length).toBeGreaterThan(0);

      for (const stock of comparableRows) {
        const syntheticRev = Math.round(stock.marketCap * 0.72);
        // Disclosed revenue for real anchors should not equal marketCap * 0.72 exactly
        for (const f of stock.historicalFinances) {
          expect(f.revenue).not.toBe(syntheticRev);
        }
      }
    });

    it("does not hardcode equityRatio to 45% or 55% when actual balance data is unavailable", async () => {
      // Mock quote with no balance sheet data and no debtToEquity
      const mockQuote = {
        quoteResponse: {
          result: [
            {
              symbol: "7203.T",
              regularMarketPrice: 3000,
              regularMarketChange: 15,
              regularMarketChangePercent: 0.5,
              regularMarketPreviousClose: 2985,
              regularMarketVolume: 5000000,
              marketCap: 30000000000000,
            },
          ],
        },
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: any) => {
          const u = String(url);
          if (u.includes("fc.yahoo.com")) {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "A=B;" },
            });
          }
          if (u.includes("getcrumb")) {
            return new Response("mock-crumb", { status: 200 });
          }
          if (u.includes("v7/finance/quote")) {
            return new Response(JSON.stringify(mockQuote), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("{}", { status: 404 });
        }),
      );

      const universe = await fetchLiveScreenerUniverse(null);
      const toyota = universe.find((s) => s.ticker === "7203");
      expect(toyota).toBeDefined();
      // equityRatio should be null when not provided in raw quote (not forced to 55)
      expect(toyota?.equityRatio).toBeNull();
    });

    it("uses authentic sparklines instead of synthetic [prevClose * 0.995, prevClose * 1.002] curves", async () => {
      const universe = await fetchLiveScreenerUniverse();
      const toyota = universe.find((s) => s.ticker === "7203");
      expect(toyota).toBeDefined();
      expect(toyota!.sparkline).toBeDefined();
      expect(toyota!.sparkline?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
  });

  describe("2. Individual Stock Fundamentals Real-Data Pipeline", () => {
    it("computes accurate equityRatio directly from balanceSheetHistory (totalStockholderEquity / totalAssets)", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 2500 },
                regularMarketChange: { raw: 25 },
                regularMarketChangePercent: { raw: 0.01 },
                regularMarketPreviousClose: { raw: 2475 },
                regularMarketVolume: { raw: 2000000 },
                marketCap: { raw: 2500000000000 },
              },
              defaultKeyStatistics: {
                forwardPE: { raw: 12.5 },
                trailingEps: { raw: 200 },
                debtToEquity: { raw: 50.0 }, // would yield 66.7% via approximation
              },
              summaryDetail: {
                forwardPE: { raw: 12.5 },
              },
              financialData: {
                returnOnEquity: { raw: 0.15 },
              },
              balanceSheetHistory: {
                balanceSheetStatements: [
                  {
                    // Official balance sheet: 1.2T equity on 2.0T total assets = 60.0%
                    totalStockholderEquity: { raw: 1200000000000 },
                    totalAssets: { raw: 2000000000000 },
                  },
                ],
              },
            },
          ],
        },
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: any) => {
          const u = String(url);
          if (u.includes("fc.yahoo.com")) {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "A=B;" },
            });
          }
          if (u.includes("getcrumb")) {
            return new Response("mock-crumb", { status: 200 });
          }
          if (u.includes("quoteSummary")) {
            return new Response(JSON.stringify(mockSummary), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("{}", { status: 404 });
        }),
      );

      const fundamentals = await fetchLiveStockFundamentals("7203");
      // Official balance sheet calculation takes priority: 1.2T / 2.0T * 100 = 60.0% (not 66.7%)
      expect(fundamentals.equityRatio).toBe(60.0);
    });

    it("faithfully extracts disclosed operatingIncome and never multiplies netIncome by 1.25", async () => {
      const mockSummary = {
        quoteSummary: {
          result: [
            {
              price: {
                regularMarketPrice: { raw: 1500 },
                regularMarketChange: { raw: 0 },
                regularMarketChangePercent: { raw: 0 },
                regularMarketPreviousClose: { raw: 1500 },
                regularMarketVolume: { raw: 100000 },
                marketCap: { raw: 500000000000 },
              },
              financialData: {},
              incomeStatementHistory: {
                incomeStatementHistory: [
                  {
                    endDate: { fmt: "2024-03-31" },
                    totalRevenue: { raw: 80000000000 }, // 800億円
                    operatingIncome: { raw: -5000000000 }, // -50億円 (営業赤字)
                    netIncome: { raw: 2000000000 }, // 20億円 (純黒字)
                    dilutedEPS: { raw: -25.5 },
                  },
                ],
              },
            },
          ],
        },
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: any) => {
          const u = String(url);
          if (u.includes("fc.yahoo.com")) {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "A=B;" },
            });
          }
          if (u.includes("getcrumb")) {
            return new Response("mock-crumb", { status: 200 });
          }
          if (u.includes("quoteSummary")) {
            return new Response(JSON.stringify(mockSummary), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("{}", { status: 404 });
        }),
      );

      const fundamentals = await fetchLiveStockFundamentals("6723");
      expect(fundamentals.historicalFinances.length).toBe(1);
      const row = fundamentals.historicalFinances[0];
      expect(row.revenue).toBe(800);
      // Operating loss is preserved faithfully as -50 (not net * 1.25 = 25)
      expect(row.operatingIncome).toBe(-50);
      expect(row.netIncome).toBe(20);
      expect(row.eps).toBe(-25.5);
    });
  });

  describe("3. Financial Calendar Earnings Event Scaling", () => {
    it("queries earnings announcements across all popular universe tickers", async () => {
      let queriedSymbolsCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: any) => {
          const u = String(url);
          if (u.includes("fc.yahoo.com")) {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "A=B;" },
            });
          }
          if (u.includes("getcrumb")) {
            return new Response("mock-crumb", { status: 200 });
          }
          if (u.includes("v7/finance/quote") && u.includes("symbols=")) {
            const params = new URL(u).searchParams;
            const symbols = (params.get("symbols") || "").split(",");
            queriedSymbolsCount = symbols.length;
            return new Response(
              JSON.stringify({
                quoteResponse: {
                  result: [
                    {
                      symbol: "7203.T",
                      displayName: "トヨタ自動車",
                      earningsTimestamp: Math.floor(Date.now() / 1000) + 86400 * 10,
                    },
                  ],
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response("{}", { status: 404 });
        }),
      );

      const events = await fetchLiveMarketCalendarAsync();
      // Should query broad universe tickers (not only 14 hardcoded tickers)
      expect(queriedSymbolsCount).toBeGreaterThanOrEqual(40);
      expect(events.some((e) => e.type === "EARNINGS" && e.ticker === "7203")).toBe(true);
    });
  });

  describe("4. Static Fallback getStockFundamentals Authenticity", () => {
    it("does not manufacture fake random PBR, yield, ROE or synthetic finances for unanchored tickers", () => {
      const unknown = getStockFundamentals("UNKNOWN_XYZ_9999");
      expect(unknown.isDemoData).toBe(true);
      expect(unknown.per).toBeNull();
      expect(unknown.pbr).toBeNull();
      expect(unknown.dividendYield).toBeNull();
      expect(unknown.roe).toBeNull();
      expect(unknown.equityRatio).toBeNull();
      expect(unknown.historicalFinances).toEqual([]);
    });

    it("faithfully preserves disclosed figures for established anchor stocks", () => {
      const toyota = getStockFundamentals("7203");
      expect(toyota.isDemoData).toBeFalsy();
      expect(toyota.price).toBe(2910.5);
      expect(toyota.per).toBe(8.3);
      expect(toyota.pbr).toBe(0.92);
      expect(toyota.roe).toBe(12.4);
      expect(toyota.equityRatio).toBe(46.5);
      expect(toyota.historicalFinances.length).toBe(4);
    });
  });
});
