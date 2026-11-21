import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import type { AssetsBinding, D1Database } from "../../worker/internal";
import { createStockQuote } from "../test-helpers/quote";
import {
  clearAuthCache,
  clearMemoryCache,
  clearMemoryRateLimits,
  fetchLiveMarketCalendarAsync,
  fetchLiveMarketOverview,
  fetchLiveStockFundamentals,
  hashPassword,
  resetLastKnownCalendarEvents,
  resetPasswordTableEnsured,
  resetYahooCrumbCache,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const ADMIN_PASSWORD = "hardening-admin-password-2026";

function createAdminEnv(masterHash: string, onBatchError?: Error): WorkerEnv {
  const db = {
    prepare: (sql: string) => {
      const stmt = {
        bind: () => stmt,
        all: async () => {
          if (sql.includes("FROM access_passwords WHERE id = 'admin-master'") || sql.includes("FROM access_passwords")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "マスター管理者",
                  role: "admin",
                  is_active: 1,
                  password_hash: masterHash,
                },
              ],
            };
          }
          if (sql.includes("FROM sqlite_master")) {
            return {
              results: [
                { type: "table", name: "access_passwords" },
                { type: "table", name: "indices" },
                { type: "table", name: "basket_items" },
              ],
            };
          }
          if (sql.startsWith("PRAGMA table_info(indices)")) {
            return {
              results: [
                { name: "id" },
                { name: "name" },
                { name: "description" },
                { name: "base_value" },
                { name: "sort_order" },
                { name: "owner_token_hash" },
                { name: "owner_token_issued_at" },
                { name: "creator_id" },
                { name: "created_at" },
              ],
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => null,
      };
      return stmt;
    },
    batch: async () => {
      if (onBatchError) throw onBatchError;
      return [{ success: true, meta: { changes: 1 } }];
    },
  } as unknown as D1Database;

  return {
    ADMIN_PASSWORD,
    DB: db,
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 }),
    } as unknown as AssetsBinding,
  } as unknown as WorkerEnv;
}

describe("Worker hardening regressions", () => {
  beforeEach(() => {
    clearAuthCache();
    clearMemoryCache();
    clearMemoryRateLimits();
    resetLastKnownCalendarEvents();
    resetPasswordTableEnsured();
    resetYahooCrumbCache();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("assigns distinct ids and titles to US CPI and Core CPI on the same date without starving next month", async () => {
    const refDate = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
    const macroFeed = [
      {
        time: "2026-10-14T12:30:00Z",
        countryCode: "US",
        name: "CPI y/y",
        unit: "percent",
        multiplier: "none",
        digits: 1,
        actual: null,
        forecast: 2.5,
        previous: 2.4,
      },
      {
        time: "2026-10-14T12:30:00Z",
        countryCode: "US",
        name: "Core CPI y/y",
        unit: "percent",
        multiplier: "none",
        digits: 1,
        actual: null,
        forecast: 3.1,
        previous: 3.0,
      },
      {
        time: "2026-11-12T13:30:00Z",
        countryCode: "US",
        name: "CPI y/y",
        unit: "percent",
        multiplier: "none",
        digits: 1,
        actual: null,
        forecast: 2.6,
        previous: 2.5,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("biquote.io")) {
          return new Response(JSON.stringify(macroFeed), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
    const apiCpiEvents = events.filter((e) => e.id.startsWith("macro-api-cpi-"));
    const ids = apiCpiEvents.map((e) => e.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("macro-api-cpi-2026-10-14");
    expect(ids).toContain("macro-api-cpi-core-2026-10-14");
    expect(ids).toContain("macro-api-cpi-2026-11-12");

    const coreEvent = apiCpiEvents.find((e) => e.id === "macro-api-cpi-core-2026-10-14");
    expect(coreEvent?.title).toContain("Core CPI");
  });

  it("classifies alphanumeric TSE tickers like 285A as TSE even when Yahoo omits .T suffix", async () => {
    const refDate = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
    const earnTs = Math.floor(Date.UTC(2026, 9, 20, 6, 0, 0) / 1000);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("fc.yahoo.com")) {
          return new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } });
        }
        if (url.includes("getcrumb")) {
          return new Response("crumb", { status: 200 });
        }
        if (url.includes("/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "285A",
                    shortName: "キオクシアHD",
                    marketCap: 2_000_000_000_000,
                    earningsTimestamp: earnTs,
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

    const events = await fetchLiveMarketCalendarAsync(
      [
        createStockQuote({
          ticker: "285A",
          name: "キオクシアHD",
          market: "PRIME",
          theme: "半導体",
          price: 2000,
          marketCap: 20000,
        }),
      ],
      refDate,
    );

    const kioxia = events.find((e) => e.ticker === "285A");
    expect(kioxia).toBeDefined();
    expect(kioxia?.market).toBe("TSE");
    expect(kioxia?.marketCap).toBe(20000);
    expect(kioxia?.time).toContain("東証");
  });

  it("preserves 4-decimal FX precision in synthetic overview sparklines for sub-2 currency pairs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("fc.yahoo.com")) {
          return new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } });
        }
        if (url.includes("getcrumb")) {
          return new Response("crumb", { status: 200 });
        }
        if (url.includes("/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "EURUSD=X",
                    regularMarketPrice: 1.0842,
                    regularMarketChange: 0.0021,
                    regularMarketChangePercent: 0.194,
                    regularMarketPreviousClose: 1.0821,
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ chart: { result: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const overview = await fetchLiveMarketOverview();
    const eurusd = overview.forex.find((q) => q.symbol === "EURUSD=X");
    expect(eurusd).toBeDefined();
    expect(eurusd?.price).toBe(1.0842);
    expect(eurusd?.sparkline).toEqual([1.0799, 1.0832, 1.0832, 1.0842]);
  });

  it("preserves fractional US EPS fallback precision for non-latest historical statements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("fc.yahoo.com")) {
          return new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } });
        }
        if (url.includes("getcrumb")) {
          return new Response("crumb", { status: 200 });
        }
        if (url.includes("quoteSummary")) {
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [
                  {
                    price: { regularMarketPrice: { raw: 50 }, currency: "USD" },
                    summaryDetail: {
                      trailingAnnualDividendRate: { raw: 0.5 },
                      dividendYield: { raw: 0.01 },
                    },
                    defaultKeyStatistics: { trailingEps: { raw: 1.49 } },
                    incomeStatementHistory: {
                      incomeStatementHistory: [
                        {
                          endDate: { fmt: "2025-12-31" },
                          totalRevenue: { raw: 500_000_000 },
                          netIncome: { raw: 50_000_000 },
                        },
                        {
                          endDate: { fmt: "2024-12-31" },
                          totalRevenue: { raw: 450_000_000 },
                          netIncome: { raw: 40_000_000 },
                        },
                      ],
                    },
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

    const fund = await fetchLiveStockFundamentals("USFRAC");
    expect(fund.historicalFinances).toHaveLength(2);
    expect(fund.historicalFinances[0]?.eps).toBe(1.49);
    expect(fund.historicalFinances[1]?.eps).toBe(1.49);
  });

  it("rejects invalid name, role, and whitespace-only password in PUT /api/admin/passwords", async () => {
    const masterHash = await hashPassword(ADMIN_PASSWORD);
    const env = createAdminEnv(masterHash);

    for (const payload of [
      { id: "pwd-1", name: "   ", maxStocks: 5 },
      { id: "pwd-1", name: 123, maxStocks: 5 },
      { id: "pwd-1", role: "superadmin", maxStocks: 5 },
      { id: "pwd-1", password: "   ", maxStocks: 5 },
      { id: "pwd-1", password: 12345678, maxStocks: 5 },
    ]) {
      const res = await worker.fetch(
        new Request("http://localhost/api/admin/passwords", {
          method: "PUT",
          headers: { "content-type": "application/json", "x-auth-password": ADMIN_PASSWORD },
          body: JSON.stringify(payload),
        }),
        env,
      );
      expect(res.status).toBe(400);
    }
  });

  it("returns 409 Conflict instead of 500 on concurrent duplicate explicit index creation", async () => {
    const masterHash = await hashPassword(ADMIN_PASSWORD);
    const env = createAdminEnv(
      masterHash,
      new Error("D1_ERROR: sqlite_error: UNIQUE constraint failed: indices.id"),
    );

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-password": ADMIN_PASSWORD },
        body: JSON.stringify({
          id: "idx-race-1",
          name: "競合テスト指数",
          baseValue: 1000,
          basket: [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(409);
  });
});
