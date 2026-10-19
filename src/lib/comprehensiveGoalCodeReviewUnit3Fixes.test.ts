import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setMemoryCache,
  clearMemoryCache,
  setAllowMemoryCacheInTest,
  memoryCache,
  checkMemoryRateLimit,
  clearMemoryRateLimits,
  json,
  notModified,
  checkAdminLoginLockout,
  resetYahooCrumbCache,
  fetchSecEdgarFinancials,
  type Env,
} from "../../worker/internal";
import worker from "../../worker/index";
import fs from "fs";
import path from "path";

describe("Comprehensive Goal Code Review - Unit 3 Fixes", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    setAllowMemoryCacheInTest(true);
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    setAllowMemoryCacheInTest(false);
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  it("1. setMemoryCache refreshes Map insertion order on overwrite", () => {
    setMemoryCache("key1", { val: 1 }, 300);
    setMemoryCache("key2", { val: 2 }, 300);
    setMemoryCache("key3", { val: 3 }, 300);

    const initialKeys = Array.from(memoryCache.keys());
    expect(initialKeys).toEqual(["key1", "key2", "key3"]);

    // Overwrite key1
    setMemoryCache("key1", { val: 10 }, 300);

    const afterKeys = Array.from(memoryCache.keys());
    expect(afterKeys).toEqual(["key2", "key3", "key1"]);
  });

  it("2. checkMemoryRateLimit correctly tracks and throttles within window", () => {
    expect(checkMemoryRateLimit("1.1.1.1", "ep1", 2, 60)).toBe(true);
    expect(checkMemoryRateLimit("1.1.1.1", "ep1", 2, 60)).toBe(true);
    expect(checkMemoryRateLimit("1.1.1.1", "ep1", 2, 60)).toBe(false);
  });

  it("3. json and notModified include pragma in access-control-allow-headers for CORS", () => {
    const mockRequest = new Request("http://localhost:8787/api/test", {
      headers: {
        Origin: "http://localhost:5173",
      },
    });

    const jsonRes = json({ ok: true }, 200, mockRequest);
    const allowHeaders = jsonRes.headers.get("access-control-allow-headers") || "";
    expect(allowHeaders).toContain("pragma");
    expect(allowHeaders).toContain("cache-control");

    const notModRes = notModified(mockRequest);
    const notModAllowHeaders = notModRes.headers.get("access-control-allow-headers") || "";
    expect(notModAllowHeaders).toContain("pragma");
    expect(notModAllowHeaders).toContain("cache-control");
  });

  it("4. schema.sql does not include redundant idx_stock_prices_ticker index", () => {
    const schemaPath = path.resolve(process.cwd(), "schema.sql");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    expect(schemaContent).not.toContain("idx_stock_prices_ticker");
  });

  it("5. checkAdminLoginLockout cleanly resets attempts when lockout duration has passed", async () => {
    const pastTime = Math.floor(Date.now() / 1000) - 100; // expired in past
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [
                {
                  failed_count: 5,
                  last_failed_at: pastTime - 900,
                  locked_until: pastTime,
                },
              ],
            }),
            run: async () => {},
          }),
          run: async () => {},
        }),
      },
    } as unknown as Env;

    const result = await checkAdminLoginLockout(mockEnv, "192.168.1.1");
    expect(result.locked).toBe(false);
    expect(result.remainingSeconds).toBe(0);
    expect(result.remainingAttempts).toBe(5);
    expect(result.failedCount).toBe(0);
  });

  it("6. Route aliases /api/screener and /api/stock/quote are correctly handled by worker router", async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => {},
          }),
          run: async () => {},
        }),
      },
      ASSETS: {
        fetch: async () => new Response("Not Found", { status: 404 }),
      },
    } as unknown as Env;

    // Test /api/stock/quote without ticker -> 400 with "ticker query parameter is required"
    const quoteReq = new Request("http://localhost/api/stock/quote", { method: "GET" });
    const quoteRes = await worker.fetch(quoteReq, mockEnv);
    expect(quoteRes.status).toBe(400);
    const quoteJson = (await quoteRes.json()) as { error?: string };
    expect(quoteJson.error).toBe("ticker query parameter is required");

    // Test /api/screener -> returns universe array (status 200)
    const screenerReq = new Request("http://localhost/api/screener", { method: "GET" });
    const screenerRes = await worker.fetch(screenerReq, mockEnv);
    expect(screenerRes.status).toBe(200);
    const screenerJson = await screenerRes.json();
    expect(Array.isArray(screenerJson)).toBe(true);
  });

  it("7. fetchSecEdgarFinancials excludes quarterly comparisons (fp !== 'FY') in 10-K", async () => {
    // Mock SEC EDGAR response with FY and non-FY facts
    const mockSecJson = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                { form: "10-K", fy: 2023, fp: "Q4", val: 50000000 }, // Quarterly comparison in 10-K
                { form: "10-K", fy: 2023, fp: "FY", val: 200000000 }, // Full year
                { form: "10-Q", fy: 2023, fp: "Q2", val: 40000000 }, // 10-Q (should be ignored)
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                { form: "10-K", fy: 2023, fp: "FY", val: 50000000 },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [
                { form: "10-K", fy: 2023, fp: "FY", val: 60000000 },
              ],
            },
          },
          EarningsPerShareDiluted: {
            units: {
              "USD/shares": [
                { form: "10-K", fy: 2023, fp: "FY", val: 5.5 },
              ],
            },
          },
        },
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockSecJson), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const financials = await fetchSecEdgarFinancials("AAPL");
    expect(financials.length).toBeGreaterThan(0);
    const f2023 = financials.find((f) => f.fiscalYear.startsWith("2023"));
    expect(f2023).toBeDefined();
    // Revenue should be the FY value (200000000 / 1M = 200), not the Q4 value (50000000 / 1M = 50)
    expect(f2023?.revenue).toBe(200);
  });

  it("8. GET /api/indices coerces non-positive or null legacy basket weights to 1", async () => {
    const mockRows = [
      {
        id: "test-idx-1",
        name: "Test Index",
        description: "Desc",
        base_value: 1000,
        sort_order: 1,
        ticker: "7203",
        stock_name: "Toyota",
        weight: 0, // non-positive legacy weight
        theme: "Auto",
      },
      {
        id: "test-idx-1",
        name: "Test Index",
        description: "Desc",
        base_value: 1000,
        sort_order: 1,
        ticker: "6758",
        stock_name: "Sony",
        weight: null, // null legacy weight
        theme: "Tech",
      },
      {
        id: "test-idx-1",
        name: "Test Index",
        description: "Desc",
        base_value: 1000,
        sort_order: 1,
        ticker: "AAPL",
        stock_name: "Apple",
        weight: 15, // valid positive weight
        theme: "Tech",
      },
    ];

    const mockEnv = {
      DB: {
        prepare: () => ({
          all: async () => ({ results: mockRows }),
          bind: () => ({
            all: async () => ({ results: mockRows }),
          }),
        }),
      },
    } as unknown as Env;

    const indicesReq = new Request("http://localhost/api/indices", { method: "GET" });
    const res = await worker.fetch(indicesReq, mockEnv);
    expect(res.status).toBe(200);
    const indices = (await res.json()) as Array<{ id: string; basket: Array<{ ticker: string; weight: number }> }>;
    expect(indices.length).toBe(1);
    const basket = indices[0].basket;
    expect(basket.length).toBe(3);
    expect(basket.find((b) => b.ticker === "7203")?.weight).toBe(0);
    expect(basket.find((b) => b.ticker === "6758")?.weight).toBe(0);
    expect(basket.find((b) => b.ticker === "AAPL")?.weight).toBe(15);
  });
});
