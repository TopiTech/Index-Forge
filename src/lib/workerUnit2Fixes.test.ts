import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import type { AssetsBinding, D1Database } from "../../worker/internal";
import {
  clearAuthCache,
  clearMemoryCache,
  clearMemoryRateLimits,
  fetchLiveMacroEventsFromApiAsync,
  fetchLiveMarketCalendar,
  fetchLiveStockFundamentals,
  hashPassword,
  resetLastKnownCalendarEvents,
  resetPasswordTableEnsured,
  resetYahooCrumbCache,
  setAllowMemoryCacheInTest,
  setMemoryCache,
} from "../../worker/internal";
import { BOJ_MEETING_SCHEDULE, FOMC_MEETING_SCHEDULE, getNextScheduledMeetings } from "../data/macroSchedule";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const TEST_ADMIN_PASSWORD = "unit2-admin-password-2026";

function createAdminMockDb(masterHash: string): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: () => stmt,
        all: async () => {
          if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
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
          if (sql.includes("COUNT(*) as count FROM access_passwords")) {
            return {
              results: [
                { role: "admin", is_active: 1, count: 1 },
                { role: "user", is_active: 1, count: 2 },
              ],
            };
          }
          if (sql.includes("COUNT(*) as count FROM indices")) {
            return { results: [{ count: 1 }] };
          }
          if (sql.includes("COUNT(*) as count FROM basket_items")) {
            return { results: [{ count: 3 }] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
        first: async () => null,
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function createWorkerEnv(db: D1Database, assetsFetch?: AssetsBinding["fetch"]): WorkerEnv {
  return {
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    DB: db,
    ASSETS: {
      fetch:
        assetsFetch ??
        (async () => new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } })),
    } as unknown as AssetsBinding,
  } as unknown as WorkerEnv;
}

describe("Worker Unit 2 behavioral fixes and edge cases", () => {
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

  it("never sets immutable cache headers on 4xx/5xx /assets/* responses", async () => {
    const mockDb = createAdminMockDb("unused");

    const env404 = createWorkerEnv(
      mockDb,
      async () =>
        new Response("Missing chunk", {
          status: 404,
          headers: { "content-type": "application/javascript" },
        }),
    );
    const res404 = await worker.fetch(new Request("http://localhost/assets/missing-123.js"), env404);
    expect(res404.status).toBe(404);
    expect(res404.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");

    const env500 = createWorkerEnv(
      mockDb,
      async () =>
        new Response("Upstream failure", {
          status: 500,
          headers: { "content-type": "text/css" },
        }),
    );
    const res500 = await worker.fetch(new Request("http://localhost/assets/broken-123.css"), env500);
    expect(res500.status).toBe(500);
    expect(res500.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  });

  it("falls back to /v7/finance/quote when quoteSummary returns an empty result array", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.startsWith("https://fc.yahoo.com")) {
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "A1=test-cookie; Path=/; Domain=.yahoo.com" },
          });
        }
        if (url.includes("/v1/test/getcrumb")) {
          return new Response("crumb-token", { status: 200 });
        }
        if (url.includes("/v10/finance/quoteSummary/")) {
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [],
                error: null,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "7203.T",
                    regularMarketPrice: 3125,
                    regularMarketChange: 25,
                    regularMarketChangePercent: 0.81,
                    regularMarketPreviousClose: 3100,
                    trailingPE: 11.4,
                    priceToBook: 1.25,
                    marketCap: 49_000_000_000_000,
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

    const data = await fetchLiveStockFundamentals("7203");
    expect(requestedUrls.some((u) => u.includes("/v10/finance/quoteSummary/"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("/v7/finance/quote"))).toBe(true);
    expect(data.price).toBe(3125);
    expect(data.per).toBe(11.4);
    expect(data.pbr).toBe(1.25);
    expect(data.roe).toBeNull();
    expect(data.equityRatio).toBeNull();
  });

  it("preserves FX priceDecimals on D1 fallback change calculation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const fxDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("FROM stock_series")) {
              return {
                prices: JSON.stringify([
                  { date: "2026-10-13", close: 1.0801 },
                  { date: "2026-10-14", close: 1.0842 },
                ]),
              };
            }
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    } as unknown as D1Database;

    const env = createWorkerEnv(fxDb);
    const data = await fetchLiveStockFundamentals("EURUSD=X", env);
    expect(data.price).toBe(1.0842);
    expect(data.change).toBe(0.0041);
  });

  it("rejects non-integer, boolean, and array limits in POST and PUT /api/admin/passwords", async () => {
    const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
    const env = createWorkerEnv(createAdminMockDb(masterHash));

    for (const badMaxStocks of [true, false, [10], 5.9, "5.9", "10abc", -1, 501]) {
      const postRes = await worker.fetch(
        new Request("http://localhost/api/admin/passwords", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-auth-password": TEST_ADMIN_PASSWORD,
          },
          body: JSON.stringify({
            name: "テスト",
            password: "valid-user-pass-123",
            maxStocks: badMaxStocks,
          }),
        }),
        env,
      );
      expect(postRes.status).toBe(400);
    }

    for (const badMaxIndices of [true, false, [2], 2.5, "2.5", "3xyz", 101]) {
      const putRes = await worker.fetch(
        new Request("http://localhost/api/admin/passwords", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-auth-password": TEST_ADMIN_PASSWORD,
          },
          body: JSON.stringify({
            id: "pwd-123",
            maxIndices: badMaxIndices,
          }),
        }),
        env,
      );
      expect(putRes.status).toBe(400);
    }
  });

  it("counts calcMemoryCache entries in /api/admin/system-stats memoryCacheSize", async () => {
    setAllowMemoryCacheInTest(true);
    setMemoryCache("general:test", { ok: true }, 60_000);
    setMemoryCache("calc:test-index", { series: [] }, 60_000);

    const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
    const env = createWorkerEnv(createAdminMockDb(masterHash));

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/system-stats", {
        method: "GET",
        headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      stats: { cacheStats: { memoryCacheSize: number } };
    };
    expect(json.stats.cacheStats.memoryCacheSize).toBe(2);
  });

  it("uses JST calendar dates across UTC midnight boundaries for meetings, fallback calendar, and macro API window", async () => {
    // 2025-03-19T16:00:00Z === 2025-03-20 01:00:00 JST (past the 2025-03-19 BOJ/FOMC meetings)
    const jstNextDayRef = new Date(Date.UTC(2025, 2, 19, 16, 0, 0));

    const [nextBoj] = getNextScheduledMeetings(BOJ_MEETING_SCHEDULE, jstNextDayRef, 1);
    expect(nextBoj.getFullYear()).toBe(2025);
    expect(nextBoj.getMonth()).toBe(4); // May (0-indexed)
    expect(nextBoj.getDate()).toBe(1);

    const [nextFomc] = getNextScheduledMeetings(FOMC_MEETING_SCHEDULE, jstNextDayRef, 1);
    expect(nextFomc.getFullYear()).toBe(2025);
    expect(nextFomc.getMonth()).toBe(4); // May
    expect(nextFomc.getDate()).toBe(7);

    const fallbackEvents = fetchLiveMarketCalendar(undefined, jstNextDayRef);
    const bojEvents = fallbackEvents.filter((e) => e.id.startsWith("macro-boj"));
    expect(bojEvents.some((e) => e.fullDate === "2025-03-19")).toBe(false);
    expect(bojEvents[0]?.fullDate).toBe("2025-05-01");

    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    await fetchLiveMacroEventsFromApiAsync(jstNextDayRef);
    expect(requestedUrls[0]).toContain("from=2025-03-06&to=2025-06-18");
  });
});
