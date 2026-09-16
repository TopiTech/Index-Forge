import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, {
  getMarketAwareCacheDuration,
  setAllowMemoryCacheInTest,
  clearMemoryCache,
  clearAuthCache,
  clearMemoryRateLimits,
  resetPasswordTableEnsured,
  authenticatePassword,
} from "../../worker/index";
import {
  isTseMarketOpen,
  getTickerPollingInterval,
} from "../components/TradingViewTickerTape";

const TEST_ADMIN_PASSWORD = "test-admin-password";

type SyncLogRow = { ticker: string; last_synced_at: number };
type StockSeriesRow = { ticker: string; prices: string; updated_at: number };

interface SavingsTestEnv {
  ASSETS: { fetch: ReturnType<typeof vi.fn> };
  ADMIN_PASSWORD: string;
  DB: {
    prepare: ReturnType<typeof vi.fn>;
    batch: ReturnType<typeof vi.fn>;
  };
  _syncLogs: Map<string, SyncLogRow>;
  _stockSeries: Map<string, StockSeriesRow>;
  _stockPrices: Map<string, { ticker: string; date: string; price: number }>;
  _indices: any[];
  _prepareCalls: string[];
}

function createSavingsTestEnv(): SavingsTestEnv {
  const env: SavingsTestEnv = {
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    _syncLogs: new Map(),
    _stockSeries: new Map(),
    _stockPrices: new Map(),
    _indices: [
      {
        id: "ai-semi",
        name: "AI・半導体強化指数",
        description: "テスト用",
        base_value: 1000,
        sort_order: 1,
        ticker: "9984",
        stock_name: "ソフトバンクG",
        weight: 50,
        theme: "AI",
      },
      {
        id: "ai-semi",
        name: "AI・半導体強化指数",
        description: "テスト用",
        base_value: 1000,
        sort_order: 1,
        ticker: "8035",
        stock_name: "東京エレクトロン",
        weight: 50,
        theme: "半導体",
      },
    ],
    _prepareCalls: [],
    DB: undefined as unknown as SavingsTestEnv["DB"],
  };

  const execute = (query: string, params: unknown[]): { results: unknown[] } => {
    env._prepareCalls.push(query);

    if (query.includes("FROM rate_limits")) {
      return { results: [] };
    }
    if (query.includes("INSERT INTO rate_limits")) {
      return { results: [] };
    }
    if (query.includes("FROM sync_logs") && query.includes("SELECT")) {
      const tickers = params as string[];
      const rows: SyncLogRow[] = [];
      for (const t of tickers) {
        const r = env._syncLogs.get(t);
        if (r) rows.push(r);
      }
      return { results: rows };
    }
    if (query.includes("INSERT") && query.includes("sync_logs")) {
      const [ticker, lastSyncedAt] = params as [string, number];
      env._syncLogs.set(ticker, { ticker, last_synced_at: lastSyncedAt });
      return { results: [] };
    }
    if (query.includes("SELECT prices FROM stock_series WHERE ticker = ?")) {
      const [ticker] = params as [string];
      const r = env._stockSeries.get(ticker);
      return { results: r ? [r] : [] };
    }
    if (query.includes("FROM stock_series WHERE ticker IN")) {
      const tickers = params as string[];
      const rows: StockSeriesRow[] = [];
      for (const t of tickers) {
        const r = env._stockSeries.get(t);
        if (r) rows.push(r);
      }
      return { results: rows };
    }
    if (query.includes("INSERT") && query.includes("stock_series")) {
      const [ticker, prices, updatedAt] = params as [string, string, number];
      env._stockSeries.set(ticker, { ticker, prices, updated_at: updatedAt });
      return { results: [] };
    }
    if (query.includes("FROM indices i")) {
      return { results: env._indices };
    }
    if (query.includes("FROM snapshot_cache")) {
      return {
        results: [
          {
            data: JSON.stringify({
              snapshot: {
                symbol: "^N225",
                label: "日経225",
                current: 39000,
                change: 0,
                changePct: 0,
              },
              series: [{ date: "2026-09-01", close: 39000 }],
            }),
            cached_at: Math.floor(Date.now() / 1000),
          },
        ],
      };
    }
    return { results: [] };
  };

  const prepareMock = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation((...params: any[]) => {
        return {
          all: () => Promise.resolve(execute(query, params)),
          run: () => Promise.resolve({ ...execute(query, params), success: true }),
        };
      }),
      all: () => Promise.resolve(execute(query, [])),
      run: () => Promise.resolve({ ...execute(query, []), success: true }),
    };
  });

  const batchMock = vi.fn().mockImplementation((statements: any[]) => {
    return Promise.all(statements.map((s: any) => (s.run ? s.run() : Promise.resolve())));
  });

  env.DB = {
    prepare: prepareMock,
    batch: batchMock,
  };

  return env;
}

describe("Cloudflare Quota Savings: Market-Aware Cache Duration", () => {
  it("extends TTL during weekend (Saturday JST) to save D1 quota until Monday open", () => {
    // 2026-09-05 is Saturday. 12:00 JST -> 03:00 UTC
    const saturdayNoon = new Date("2026-09-05T03:00:00Z");
    const ttl = getMarketAwareCacheDuration(saturdayNoon);
    // Saturday noon to Monday 9:00 is approx 45 hours = 162,000s
    expect(ttl).toBeGreaterThanOrEqual(40 * 3600);
  });

  it("extends TTL during weekend (Sunday JST) to save D1 quota until Monday open", () => {
    // 2026-09-06 is Sunday. 12:00 JST -> 03:00 UTC
    const sundayNoon = new Date("2026-09-06T03:00:00Z");
    const ttl = getMarketAwareCacheDuration(sundayNoon);
    expect(ttl).toBeGreaterThanOrEqual(20 * 3600);
  });

  it("extends TTL after Friday market close (Friday 18:00 JST) until Monday morning", () => {
    // 2026-09-04 is Friday. 18:00 JST -> 09:00 UTC
    const fridayEvening = new Date("2026-09-04T09:00:00Z");
    const ttl = getMarketAwareCacheDuration(fridayEvening);
    expect(ttl).toBeGreaterThanOrEqual(60 * 3600);
  });

  it("extends TTL after weekday market close (Wednesday 18:00 JST) until next morning", () => {
    // 2026-09-02 is Wednesday. 18:00 JST -> 09:00 UTC
    const wednesdayEvening = new Date("2026-09-02T09:00:00Z");
    const ttl = getMarketAwareCacheDuration(wednesdayEvening);
    expect(ttl).toBeGreaterThanOrEqual(14 * 3600);
  });

  it("caches until settlement during regular trading hours (Wednesday 11:00 JST)", () => {
    // 2026-09-02 is Wednesday. 11:00 JST -> 02:00 UTC
    // Settlement: 15:30 + 0:30 = 16:00 JST. Duration: 5h = 18000s
    const wednesdayTrading = new Date("2026-09-02T02:00:00Z");
    const ttl = getMarketAwareCacheDuration(wednesdayTrading);
    expect(ttl).toBe(5 * 3600);
  });

  it("sets TTL until 9:00 AM market open before weekday trading hours (Wednesday 08:30 JST)", () => {
    // 2026-09-02 is Wednesday. 08:30 JST -> 23:30 UTC of previous day (2026-09-01)
    const wednesdayPreOpen = new Date("2026-09-01T23:30:00Z");
    const ttl = getMarketAwareCacheDuration(wednesdayPreOpen);
    // 30 minutes to open = 1800s. Must NOT be locked for 12 hours (43200s)!
    expect(ttl).toBe(30 * 60);
    expect(ttl).toBeLessThan(3600);
  });
});

describe("Cloudflare Quota Savings: No-Op Write Skip on Identical Price Data", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearMemoryCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearMemoryCache();
  });

  it("skips stock_series INSERT/DELETE writes when fetched data matches existing latest price", async () => {
    const env = createSavingsTestEnv();

    // Pre-populate existing stock_series with 2026-09-02 close 2500
    env._stockSeries.set("7203", {
      ticker: "7203",
      prices: JSON.stringify([
        { date: "2026-09-01", close: 2480 },
        { date: "2026-09-02", close: 2500 },
      ]),
      updated_at: Math.floor(Date.now() / 1000) - 3600,
    });

    // Yahoo Finance returns the exact same latest price (no change)
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: [1788220800, 1788307200],
                indicators: { quote: [{ close: [2480, 2500] }] },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const initialBatchCalls = (env.DB.batch as any).mock.calls.length;

    const res = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ tickers: ["7203"] }),
      }),
      env as any,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].status).toBe("cached");

    // D1 batch write to stock_series must NOT have been called!
    expect((env.DB.batch as any).mock.calls.length).toBe(initialBatchCalls);

    // Only sync_logs was updated to prevent repeated fetch
    expect(env._syncLogs.has("7203")).toBe(true);
  });

  it("writes corrected intermediate prices even when the first and last prices are unchanged", async () => {
    const env = createSavingsTestEnv();
    env._stockSeries.set("7203", {
      ticker: "7203",
      prices: JSON.stringify([
        { date: "2026-09-01", close: 2480 },
        { date: "2026-09-02", close: 2520 },
        { date: "2026-09-03", close: 2500 },
      ]),
      updated_at: Math.floor(Date.now() / 1000) - 3600,
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: [1788220800, 1788307200, 1788393600],
                indicators: { quote: [{ close: [2480, 2490, 2500] }] },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const initialBatchCalls = (env.DB.batch as any).mock.calls.length;
    const res = await worker.fetch(
      new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ tickers: ["7203"] }),
      }),
      env as any,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].status).toBe("synced");
    expect((env.DB.batch as any).mock.calls.length).toBeGreaterThan(initialBatchCalls);
    expect(JSON.parse(env._stockSeries.get("7203")!.prices)[1].close).toBe(2490);
  });
});

describe("Cloudflare Quota Savings: In-Memory Calculation Cache", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearMemoryCache();
    setAllowMemoryCacheInTest(true);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearMemoryCache();
    setAllowMemoryCacheInTest(false);
  });

  it("returns cached calculation result on subsequent request without re-querying D1", async () => {
    const env = createSavingsTestEnv();

    env._stockSeries.set("9984", {
      ticker: "9984",
      prices: JSON.stringify([
        { date: "2026-09-01", close: 8000 },
        { date: "2026-09-02", close: 8200 },
      ]),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const basket = [{ ticker: "9984", name: "SoftBank", theme: "AI", weight: 100 }];

    // First request: cache miss, queries D1
    const res1 = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get("x-cache")).toBeNull();

    const d1CallsAfterFirst = env._prepareCalls.filter((q) => q.includes("stock_series")).length;
    expect(d1CallsAfterFirst).toBeGreaterThan(0);

    // Second request: cache hit! No additional D1 queries made
    const res2 = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-cache")).toBe("HIT");

    const d1CallsAfterSecond = env._prepareCalls.filter((q) => q.includes("stock_series")).length;
    // Exactly zero additional D1 reads for the second calculate call!
    expect(d1CallsAfterSecond).toBe(d1CallsAfterFirst);
  });

  it("does not reuse a calculation payload when only display metadata changes", async () => {
    const env = createSavingsTestEnv();
    env._stockSeries.set("9984", {
      ticker: "9984",
      prices: JSON.stringify([{ date: "2026-09-01", close: 8000 }]),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const originalBasket = [{ ticker: "9984", name: "SoftBank", theme: "AI", weight: 100 }];
    const renamedBasket = [{ ticker: "9984", name: "SoftBank Group", theme: "Telecom", weight: 100 }];

    const first = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket: originalBasket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(first.status).toBe(200);

    const second = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket: renamedBasket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBeNull();
    const data = await second.json();
    expect(data.stockUniverse[0]).toMatchObject({ name: "SoftBank Group", theme: "Telecom" });
  });

  it("bypasses an isolate-local calculation cache when the caller requests fresh prices", async () => {
    const env = createSavingsTestEnv();
    env._stockSeries.set("9984", {
      ticker: "9984",
      prices: JSON.stringify([
        { date: "2026-09-01", close: 8000 },
        { date: "2026-09-02", close: 8200 },
      ]),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const basket = [{ ticker: "9984", name: "SoftBank", theme: "AI", weight: 100 }];
    const first = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(first.status).toBe(200);

    const d1CallsAfterFirst = env._prepareCalls.filter((q) => q.includes("stock_series")).length;
    env._stockSeries.set("9984", {
      ticker: "9984",
      prices: JSON.stringify([
        { date: "2026-09-01", close: 8000 },
        { date: "2026-09-02", close: 9000 },
      ]),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const second = await worker.fetch(
      new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ basket, baseValue: 1000 }),
      }),
      env as any,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBeNull();
    const data = (await second.json()) as { series: Array<{ value: number }> };
    expect(data.series[data.series.length - 1]?.value).toBe(1125);

    const d1CallsAfterSecond = env._prepareCalls.filter((q) => q.includes("stock_series")).length;
    expect(d1CallsAfterSecond).toBeGreaterThan(d1CallsAfterFirst);
  });
});

describe("Cloudflare Quota Savings: ETag and 304 Not Modified Support", () => {
  beforeEach(() => {
    clearMemoryCache();
  });
  afterEach(() => {
    clearMemoryCache();
  });

  it("returns ETag header on /api/indices and responds with 304 when If-None-Match matches", async () => {
    const env = createSavingsTestEnv();

    // 1st call: GET /api/indices returns 200 with ETag
    const res1 = await worker.fetch(new Request("http://localhost/api/indices"), env as any);
    expect(res1.status).toBe(200);
    const etag = res1.headers.get("etag");
    expect(etag).toBeDefined();
    expect(etag?.startsWith('"')).toBe(true);

    // 2nd call: with matching If-None-Match returns 304 Not Modified (empty body)
    const res2 = await worker.fetch(
      new Request("http://localhost/api/indices", {
        headers: { "if-none-match": etag! },
      }),
      env as any,
    );
    expect(res2.status).toBe(304);
    const text = await res2.text();
    expect(text).toBe("");
  });

  it("returns ETag header on /api/snapshot and responds with 304 when If-None-Match matches", async () => {
    const env = createSavingsTestEnv();

    const res1 = await worker.fetch(new Request("http://localhost/api/snapshot?symbol=%5EN225"), env as any);
    expect(res1.status).toBe(200);
    const etag = res1.headers.get("etag");
    expect(etag).toBeDefined();

    const res2 = await worker.fetch(
      new Request("http://localhost/api/snapshot?symbol=%5EN225", {
        headers: { "if-none-match": etag! },
      }),
      env as any,
    );
    expect(res2.status).toBe(304);
  });
});

describe("Cloudflare Quota Savings: Auth and Password Table Caching", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });
  afterEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  it("caches successful auth result to skip redundant D1 queries in authenticatePassword", async () => {
    const prepareCalls: string[] = [];
    const env: any = {
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => {
          prepareCalls.push(query);
          return {
            bind: vi.fn().mockReturnValue({
              all: () => Promise.resolve({ results: [] }),
              run: () => Promise.resolve({ success: true }),
            }),
            all: () => Promise.resolve({ results: [] }),
            run: () => Promise.resolve({ success: true }),
          };
        }),
      },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    };

    const req = new Request("http://localhost/api/admin/passwords", {
      headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
    });

    // 1st auth call: queries D1
    const auth1 = await authenticatePassword(req, env);
    expect(auth1.authenticated).toBe(true);
    const countAfterFirst = prepareCalls.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    // 2nd auth call with same password: hits authCache, 0 additional D1 calls!
    const auth2 = await authenticatePassword(req, env);
    expect(auth2.authenticated).toBe(true);
    expect(prepareCalls.length).toBe(countAfterFirst);
  });
});

describe("Cloudflare Quota Savings: In-Memory Rate Limiting for High-Frequency Endpoints", () => {
  beforeEach(() => {
    clearMemoryRateLimits();
    clearMemoryCache();
  });
  afterEach(() => {
    clearMemoryRateLimits();
    clearMemoryCache();
  });

  it("never executes D1 INSERT/UPDATE rate_limits writes for /api/snapshot requests", async () => {
    const env = createSavingsTestEnv();
    const req = new Request("http://localhost/api/snapshot?symbol=%5EN225", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    const rateLimitWrites = env._prepareCalls.filter((q) =>
      q.includes("rate_limits") && q.includes("INSERT"),
    );
    expect(rateLimitWrites.length).toBe(0);
  });

  it("never executes D1 INSERT/UPDATE rate_limits writes for /api/calculate requests", async () => {
    const env = createSavingsTestEnv();
    env._stockSeries.set("9984", {
      ticker: "9984",
      prices: JSON.stringify([{ date: "2026-09-01", close: 8000 }]),
      updated_at: Math.floor(Date.now() / 1000),
    });

    const req = new Request("http://localhost/api/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({
        basket: [{ ticker: "9984", name: "SoftBank", theme: "AI", weight: 100 }],
        baseValue: 1000,
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    const rateLimitWrites = env._prepareCalls.filter((q) =>
      q.includes("rate_limits") && q.includes("INSERT"),
    );
    expect(rateLimitWrites.length).toBe(0);
  });

  it("enforces in-memory rate limit of 60 req/min for high-frequency endpoints without D1 writes", async () => {
    const env = createSavingsTestEnv();
    const makeReq = () =>
      new Request("http://localhost/api/snapshot?symbol=%5EN225", {
        headers: { "cf-connecting-ip": "5.6.7.8" },
      });

    // Send 60 requests: all admitted in memory
    for (let i = 0; i < 60; i++) {
      const res = await worker.fetch(makeReq(), env as any);
      expect(res.status).toBe(200);
    }

    // 61st request: blocked by in-memory rate limit with 429
    const res61 = await worker.fetch(makeReq(), env as any);
    expect(res61.status).toBe(429);

    // D1 rate_limits writes must STILL be exactly zero!
    const rateLimitWrites = env._prepareCalls.filter((q) =>
      q.includes("rate_limits") && q.includes("INSERT"),
    );
    expect(rateLimitWrites.length).toBe(0);
  });
});

describe("Cloudflare Quota Savings: Market-Aware Snapshot TTL for TSE Hours", () => {
  it("reuses cached snapshot data beyond 5 minutes when market is closed (weekend)", async () => {
    const env = createSavingsTestEnv();
    // Pre-populate snapshot_cache with a Saturday timestamp (2 hours ago)
    // 2026-09-05 10:00 JST -> 01:00 UTC
    const saturday10am = Math.floor(new Date("2026-09-05T01:00:00Z").getTime() / 1000);
    const twoHoursLater = Math.floor(new Date("2026-09-05T03:00:00Z").getTime() / 1000);

    env._prepareCalls = [];
    const originalNow = Date.now;
    try {
      Date.now = () => twoHoursLater * 1000;

      // Mock DB returning cache from 2 hours ago (7200s ago, well past former 300s TTL)
      env.DB.prepare = vi.fn().mockImplementation((query: string) => {
        env._prepareCalls.push(query);
        if (query.includes("FROM snapshot_cache")) {
          return {
            bind: vi.fn().mockReturnThis(),
            all: () =>
              Promise.resolve({
                results: [
                  {
                    data: JSON.stringify({
                      snapshot: {
                        symbol: "^N225",
                        label: "日経225",
                        current: 39000,
                        change: 100,
                        changePct: 0.26,
                      },
                      series: [{ date: "2026-09-04", close: 39000 }],
                    }),
                    cached_at: saturday10am,
                  },
                ],
              }),
            run: () => Promise.resolve({ success: true }),
          };
        }
        return {
          bind: vi.fn().mockReturnThis(),
          all: () => Promise.resolve({ results: [] }),
          run: () => Promise.resolve({ success: true }),
        };
      });

      const res = await worker.fetch(
        new Request("http://localhost/api/snapshot?symbol=%5EN225"),
        env as any,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.snapshot.current).toBe(39000);

      // Must NOT have written to snapshot_cache because the weekend cache is still fresh!
      const snapshotWrites = env._prepareCalls.filter(
        (q) => q.includes("snapshot_cache") && q.includes("INSERT"),
      );
      expect(snapshotWrites.length).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("Cloudflare Quota Savings: Smart Ticker Polling Interval", () => {
  it("detects TSE regular session (Wednesday 11:00 JST) as open with 60s interval", () => {
    // 2026-09-02 (Wednesday) 11:00 JST -> 02:00 UTC
    const wednesdayTrading = new Date("2026-09-02T02:00:00Z");
    expect(isTseMarketOpen(wednesdayTrading)).toBe(true);
    expect(getTickerPollingInterval(wednesdayTrading)).toBe(60_000);
  });

  it("detects TSE closed session (Wednesday 20:00 JST) as closed with 15m interval", () => {
    // 2026-09-02 (Wednesday) 20:00 JST -> 11:00 UTC
    const wednesdayNight = new Date("2026-09-02T11:00:00Z");
    expect(isTseMarketOpen(wednesdayNight)).toBe(false);
    expect(getTickerPollingInterval(wednesdayNight)).toBe(15 * 60_000);
  });

  it("detects weekend (Saturday 14:00 JST) as closed with 15m interval", () => {
    // 2026-09-05 (Saturday) 14:00 JST -> 05:00 UTC
    const saturday = new Date("2026-09-05T05:00:00Z");
    expect(isTseMarketOpen(saturday)).toBe(false);
    expect(getTickerPollingInterval(saturday)).toBe(15 * 60_000);
  });
});
