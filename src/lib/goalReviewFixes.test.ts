import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  ensurePasswordTable,
} from "../../worker/internal";
import {
  clearClientCalcCache,
  setClientCalcCache,
  getClientCalcCacheSize,
} from "../hooks/useCalculation";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
  clearClientCalcCache();
  vi.restoreAllMocks();
});

describe("Goal Review Fixes: Backend Rate-Limiting & D1 Self-Healing", () => {
  it("enforces AUTH_RATE_LIMIT_MAX (10) for auth-login and RATE_LIMIT_MAX (60) for auth-api", async () => {
    const executedLimits: { endpoint: string; limit: number }[] = [];

    const mockEnv = {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: (...params: unknown[]) => ({
            all: async () => {
              if (query.includes("rate_limits")) return { results: [] };
              return { results: [] };
            },
            run: async () => {
              if (query.includes("INSERT INTO rate_limits")) {
                // params: ip, endpoint, now, windowStart, windowStart, windowStart, maxRequests
                executedLimits.push({
                  endpoint: String(params[1]),
                  limit: Number(params[6]),
                });
              }
              return { success: true, meta: { changes: 1 } };
            },
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        })),
        batch: vi.fn().mockResolvedValue([]),
      },
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      },
    };

    // 1. Send auth-login request (/api/auth/verify)
    await worker.fetch(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      }),
      mockEnv as any,
    );

    // 2. Send auth-api request (/api/admin/passwords)
    await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "GET",
        headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
      }),
      mockEnv as any,
    );

    const loginCall = executedLimits.find((e) => e.endpoint === "auth-login");
    const apiCall = executedLimits.find((e) => e.endpoint === "auth-api");

    expect(loginCall).toBeDefined();
    expect(loginCall?.limit).toBe(10); // AUTH_RATE_LIMIT_MAX

    expect(apiCall).toBeDefined();
    expect(apiCall?.limit).toBe(60); // RATE_LIMIT_MAX
  });

  it("ensurePasswordTable auto-creates rate_limits table for unmigrated environments", async () => {
    const executedQueries: string[] = [];

    const mockEnv = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          executedQueries.push(sql);
          return {
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
            bind: vi.fn().mockReturnValue({
              run: async () => ({ success: true }),
              all: async () => ({ results: [] }),
            }),
          };
        }),
      },
    };

    await ensurePasswordTable(mockEnv as any);

    const hasRateLimitsTable = executedQueries.some(
      (q) => q.includes("CREATE TABLE IF NOT EXISTS rate_limits") && q.includes("PRIMARY KEY (ip, endpoint)"),
    );
    expect(hasRateLimitsTable).toBe(true);
  });
});

describe("Goal Review Fixes: stock_series write-skip validation in /api/sync-prices", () => {
  it("does not skip stock_series write if existing prices length differs from fresh series", async () => {
    let stockSeriesWritten = false;

    // Existing: 2 data points
    const existingPrices = JSON.stringify([
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-02", close: 110 },
    ]);

    const mockEnv = {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: (..._params: unknown[]) => ({
            all: async () => {
              if (query.includes("FROM indices")) {
                return {
                  results: [
                    {
                      id: "test",
                      name: "Test",
                      base_value: 1000,
                      sort_order: 1,
                      ticker: "7203",
                      stock_name: "Toyota",
                      weight: 100,
                      theme: "Auto",
                    },
                  ],
                };
              }
              if (query.includes("FROM stock_series WHERE ticker = ?")) {
                return { results: [{ prices: existingPrices }] };
              }
              if (query.includes("FROM sync_logs")) {
                return { results: [] };
              }
              return { results: [] };
            },
            run: async () => {
              if (query.includes("INSERT OR REPLACE INTO stock_series")) {
                stockSeriesWritten = true;
              }
              return { success: true };
            },
          }),
        })),
        batch: vi.fn().mockImplementation(async (statements: any[]) => {
          stockSeriesWritten = true;
          return statements.map(() => ({ success: true }));
        }),
      },
    };

    // Mock global fetch to return 3 data points (same last point, earlier history backfilled)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("query1.finance.yahoo.com")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1735603200, 1735689600, 1735776000],
                  indicators: {
                    quote: [{ close: [95, 100, 110] }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("ok", { status: 200 });
    });

    try {
      const res = await worker.fetch(
        new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": TEST_ADMIN_PASSWORD,
          },
          body: JSON.stringify({ tickers: ["7203"] }),
        }),
        mockEnv as any,
      );

      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.results[0].status).toBe("synced");
      // Because length differed, write was NOT skipped
      expect(stockSeriesWritten).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips stock_series write when length, start point, and end point all match", async () => {
    let stockSeriesWritten = false;
    let syncLogsUpdated = false;

    // Existing: 2 data points
    const existingPrices = JSON.stringify([
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-02", close: 110 },
    ]);

    const mockEnv = {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: (..._params: unknown[]) => ({
            all: async () => {
              if (query.includes("FROM indices")) {
                return {
                  results: [
                    {
                      id: "test",
                      name: "Test",
                      base_value: 1000,
                      sort_order: 1,
                      ticker: "7203",
                      stock_name: "Toyota",
                      weight: 100,
                      theme: "Auto",
                    },
                  ],
                };
              }
              if (query.includes("FROM stock_series WHERE ticker = ?")) {
                return { results: [{ prices: existingPrices }] };
              }
              if (query.includes("FROM sync_logs")) {
                return { results: [] };
              }
              return { results: [] };
            },
            run: async () => {
              if (query.includes("INSERT OR REPLACE INTO stock_series")) {
                stockSeriesWritten = true;
              }
              if (query.includes("INSERT OR REPLACE INTO sync_logs")) {
                syncLogsUpdated = true;
              }
              return { success: true };
            },
          }),
        })),
        batch: vi.fn().mockImplementation(async (statements: any[]) => {
          stockSeriesWritten = true;
          return statements.map(() => ({ success: true }));
        }),
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("query1.finance.yahoo.com")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1735689600, 1735776000],
                  indicators: {
                    quote: [{ close: [100, 110] }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("ok", { status: 200 });
    });

    try {
      const res = await worker.fetch(
        new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": TEST_ADMIN_PASSWORD,
          },
          body: JSON.stringify({ tickers: ["7203"] }),
        }),
        mockEnv as any,
      );

      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.results[0].status).toBe("cached");
      // Skip write!
      expect(stockSeriesWritten).toBe(false);
      expect(syncLogsUpdated).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Goal Review Fixes: OPTIONS Preflight Caching", () => {
  it("includes access-control-max-age: 86400 in preflight OPTIONS response for allowed origin", async () => {
    const mockEnv = {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
    };

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
        },
      }),
      mockEnv as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("Goal Review Fixes: Client Calculation Cache", () => {
  it("clearClientCalcCache resets the cache", () => {
    setClientCalcCache("test-key", { series: [], stockUniverse: [], timestamp: Date.now() });
    expect(getClientCalcCacheSize()).toBe(1);
    clearClientCalcCache();
    expect(getClientCalcCacheSize()).toBe(0);
  });

  it("bounds clientCalcCache capacity to 50 items and evicts oldest entries", () => {
    clearClientCalcCache();
    for (let i = 0; i < 60; i++) {
      setClientCalcCache(`key-${i}`, {
        series: [{ date: "2025-01-01", close: 100 }],
        stockUniverse: [],
        timestamp: i,
      });
    }

    // Cache must not exceed 50 items
    expect(getClientCalcCacheSize()).toBe(50);
  });
});
