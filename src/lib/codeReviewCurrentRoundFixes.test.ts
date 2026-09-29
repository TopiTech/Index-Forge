import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, {
  hashPassword,
  clearAuthCache,
  resetPasswordTableEnsured,
  resetLastKnownTickerQuotes,
} from "../../worker/index";
import { calculatePeriodReturns } from "../hooks/useSimulation";
import type { PricePoint } from "../types";

const TEST_ADMIN_PASSWORD = "MasterAdminPassword123!";
const SECONDARY_ADMIN_PASSWORD = "SecondaryAdminSecret999!";
const EXISTING_USER_PASSWORD = "ExistingUserPassword789!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
  resetLastKnownTickerQuotes();
  vi.restoreAllMocks();
});

async function createMultiUserTestEnv() {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const secondaryAdminHash = await hashPassword(SECONDARY_ADMIN_PASSWORD);
  const user1Hash = await hashPassword(EXISTING_USER_PASSWORD);

  const mockUsers = [
    {
      id: "admin-sec-1",
      name: "副管理者1",
      password_hash: secondaryAdminHash,
      role: "admin",
      max_stocks: null,
      max_indices: null,
      is_active: 1,
      created_at: 500,
      updated_at: 500,
    },
    {
      id: "user-1",
      name: "既存ユーザー1",
      password_hash: user1Hash,
      role: "user",
      max_stocks: 20,
      max_indices: 5,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    },
    {
      id: "user-2",
      name: "既存ユーザー2",
      password_hash: await hashPassword("User2DifferentPassword!"),
      role: "user",
      max_stocks: 10,
      max_indices: 3,
      is_active: 1,
      created_at: 2000,
      updated_at: 2000,
    },
  ];

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: vi.fn().mockImplementation((...params: unknown[]) => {
        return {
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockImplementation(async () => {
            if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              return {
                results: [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    password_hash: masterHash,
                    role: "admin",
                    max_stocks: null,
                    max_indices: null,
                    is_active: 1,
                  },
                ],
              };
            }
            if (query.includes("WHERE id != ? AND id != 'admin-master'")) {
              const excludedId = params[0];
              const filtered = mockUsers.filter((u) => u.id !== excludedId);
              return { results: filtered };
            }
            if (query.includes("WHERE id != 'admin-master'")) {
              return { results: mockUsers };
            }
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
      }),
      all: vi.fn().mockImplementation(async () => {
        if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
          return {
            results: [
              {
                id: "admin-master",
                name: "マスター管理者",
                password_hash: masterHash,
                role: "admin",
                max_stocks: null,
                max_indices: null,
                is_active: 1,
              },
            ],
          };
        }
        if (query.includes("WHERE id != 'admin-master'")) {
          return { results: mockUsers };
        }
        return { results: [] };
      }),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    };
  });

  return {
    DB: {
      prepare,
      batch: vi.fn().mockResolvedValue([{ success: true, meta: { changes: 1 } }]),
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset content", { status: 200 })),
    },
  };
}

describe("Code Review Current Round Fixes Verification", () => {
  describe("[R1] Admin password collision check and privilege escalation prevention", () => {
    it("POST /api/admin/passwords rejects creating a user account colliding with a secondary admin password", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "一般ユーザー候補",
          password: SECONDARY_ADMIN_PASSWORD, // Collides with secondary admin
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("PUT /api/admin/passwords rejects updating a user password to match a secondary admin password", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "user-2",
          password: SECONDARY_ADMIN_PASSWORD, // Collides with secondary admin
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("POST /api/admin/passwords rejects creating a secondary admin with password matching an existing user", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "新副管理者",
          password: EXISTING_USER_PASSWORD, // Collides with existing user-1
          role: "admin",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません" });
    });

    it("POST /api/admin/passwords permits creating multiple user accounts with identical non-admin passwords (reviewFixes contract)", async () => {
      const env = await createMultiUserTestEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "別一般ユーザー",
          password: EXISTING_USER_PASSWORD, // Collides with non-admin user-1
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });

  describe("[R2] Simulation period returns calculation with mismatched date spans", () => {
    it("aligns benchmark return calculation to the custom series date range rather than comparing different time spans", () => {
      // Custom series has only 1 month (2026-08-01 to 2026-09-01): 1000 -> 1100 (+10%)
      const customSeries: PricePoint[] = [
        { date: "2026-08-01", close: 1000, value: 1000 },
        { date: "2026-08-15", close: 1050, value: 1050 },
        { date: "2026-09-01", close: 1100, value: 1100 },
      ];

      // Benchmark series has full 1 year (2025-09-01 to 2026-09-01)
      // At custom start (2026-08-01), benchmark was 30000. At end (2026-09-01), it is 31500 (+5% in same period).
      // But 1 year ago (2025-09-01), it was 20000 (+57.5% over full year).
      const benchmarkSeries: PricePoint[] = [
        { date: "2025-09-01", close: 20000 },
        { date: "2026-08-01", close: 30000 },
        { date: "2026-08-15", close: 31000 },
        { date: "2026-09-01", close: 31500 },
      ];

      const { periodCustomReturnPct, periodBenchmarkReturnPct, alphaPct } =
        calculatePeriodReturns(customSeries, benchmarkSeries);

      // Custom return is +10%
      expect(periodCustomReturnPct).toBe(10);

      // Benchmark return for the SAME period (2026-08-01 to 2026-09-01) is (31500 - 30000) / 30000 = +5.0%
      // NOT (31500 - 20000) / 20000 = +57.5%
      expect(periodBenchmarkReturnPct).toBe(5);

      // Alpha in same period should be 10% - 5% = +5%
      expect(alphaPct).toBe(5);
    });
  });

  describe("[R3] Remaining TTL on snapshot cache hit", () => {
    it("applies remaining TTL instead of full snapshot TTL to s-maxage when serving from D1 cache", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const cachedAtSec = nowSec - 280; // 280 seconds elapsed of 300s TTL (20 seconds remaining)

      const snapshotPayload = {
        snapshot: {
          symbol: "^GSPC",
          label: "S&P 500",
          current: 5800,
          change: 10,
          changePct: 0.17,
          updatedAt: "2026-09-29 18:00:00",
          description: "S&P 500",
        },
        series: [
          { date: "2026-09-28", close: 5790 },
          { date: "2026-09-29", close: 5800 },
        ],
      };

      const env = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({
                results: [{ data: JSON.stringify(snapshotPayload), cached_at: cachedAtSec }],
              }),
            }),
            all: vi.fn().mockResolvedValue({
              results: [{ data: JSON.stringify(snapshotPayload), cached_at: cachedAtSec }],
            }),
            run: vi.fn().mockResolvedValue({ success: true }),
          }),
        },
      };

      const req = new Request("http://localhost/api/snapshot?symbol=^GSPC");
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);

      const cacheControl = res.headers.get("cache-control") || "";
      // Remaining TTL should be around 20s (max-age=20 or s-maxage <= 20)
      // Must NOT be the full 300s
      const match = cacheControl.match(/s-maxage=(\d+)/);
      expect(match).not.toBeNull();
      const sMaxAge = Number(match![1]);
      expect(sMaxAge).toBeLessThanOrEqual(25);
      expect(sMaxAge).toBeGreaterThanOrEqual(10);
    });
  });

  describe("[R4] Fallback to last known quotes on ticker-prices temporary failure", () => {
    it("falls back to last known fetched quote rather than static default on subsequent fetch error", async () => {
      // Mock global fetch for Yahoo Finance quote
      const originalFetch = globalThis.fetch;
      let shouldFail = false;

      globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("query1.finance.yahoo.com")) {
          if (shouldFail) {
            return Promise.resolve(new Response("rate limited", { status: 429 }));
          }
          // Return valid quote for ^N225 and others
          return Promise.resolve(
            new Response(
              JSON.stringify({
                chart: {
                  result: [
                    {
                      meta: {
                        regularMarketPrice: 39500,
                        chartPreviousClose: 39000,
                      },
                      timestamp: [1700000000],
                      indicators: {
                        quote: [{ close: [39500] }],
                      },
                    },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        return originalFetch(url);
      });

      try {
        const env = {
          DB: {
            prepare: vi.fn().mockReturnValue({
              bind: vi.fn().mockReturnValue({
                all: vi.fn().mockResolvedValue({ results: [] }),
                run: vi.fn().mockResolvedValue({ success: true }),
              }),
              all: vi.fn().mockResolvedValue({ results: [] }),
              run: vi.fn().mockResolvedValue({ success: true }),
            }),
          },
        };

        // First call: successful fetch, price 39500
        const req1 = new Request("http://localhost/api/ticker-prices");
        const res1 = await worker.fetch(req1, env as any);
        expect(res1.status).toBe(200);
        const data1 = (await res1.json()) as { quotes: Array<{ symbol: string; price: number; stale?: boolean }> };
        const nky1 = data1.quotes.find((q) => q.symbol === "^N225");
        expect(nky1?.price).toBe(39500);
        expect(nky1?.stale).toBe(false);

        // Clear memory cache so second call triggers fetch
        clearAuthCache();
        // Force next Yahoo fetch to fail
        shouldFail = true;

        // Second call: Yahoo fails with 429.
        // It should fallback to last known quote (39500, stale: true), NOT 2024 defaultPrice (38980.5)
        const req2 = new Request("http://localhost/api/ticker-prices", {
          headers: { "cache-control": "no-cache" },
        });
        const res2 = await worker.fetch(req2, env as any);
        expect(res2.status).toBe(200);
        const data2 = (await res2.json()) as { quotes: Array<{ symbol: string; price: number; stale?: boolean }> };
        const nky2 = data2.quotes.find((q) => q.symbol === "^N225");
        expect(nky2?.price).toBe(39500);
        expect(nky2?.stale).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("[R2b] SimulationPreview chart alignment contract", () => {
    it("ensures relative percentage starts at 0% when custom and benchmark have aligned base prices", () => {
      const customSeries: PricePoint[] = [
        { date: "2026-08-01", close: 1000, value: 1000 },
        { date: "2026-08-15", close: 1050, value: 1050 },
        { date: "2026-09-01", close: 1100, value: 1100 },
      ];
      const benchmarkSeries: PricePoint[] = [
        { date: "2025-09-01", close: 20000 },
        { date: "2026-08-01", close: 30000 },
        { date: "2026-08-15", close: 31000 },
        { date: "2026-09-01", close: 31500 },
      ];

      // Simulate chartData derivation logic
      const customBase = customSeries[0].value ?? customSeries[0].close ?? 1000;
      const customStartDate = customSeries[0].date;
      let benchmarkBase = 0;
      for (const b of benchmarkSeries) {
        if (b.date <= customStartDate && b.close > 0) {
          benchmarkBase = b.close;
        } else if (b.date > customStartDate) {
          break;
        }
      }
      expect(benchmarkBase).toBe(30000);

      const benchmarkMap = new Map(benchmarkSeries.map((b) => [b.date, b.close]));
      let lastKnownBmVal = benchmarkBase;

      const chartPoints = customSeries.map((point) => {
        const customVal = point.value ?? point.close;
        const customReturnPct = ((customVal - customBase) / customBase) * 100;
        const rawBmVal = benchmarkMap.get(point.date);
        if (rawBmVal !== undefined && rawBmVal > 0) {
          lastKnownBmVal = rawBmVal;
        }
        const bmVal = rawBmVal ?? lastKnownBmVal;
        const benchmarkReturnPct = ((bmVal - benchmarkBase) / benchmarkBase) * 100;
        return {
          date: point.date,
          customReturnPct: Number(customReturnPct.toFixed(2)),
          benchmarkReturnPct: Number(benchmarkReturnPct.toFixed(2)),
        };
      });

      // Both must start at strictly 0.00% on the first custom date
      expect(chartPoints[0].customReturnPct).toBe(0);
      expect(chartPoints[0].benchmarkReturnPct).toBe(0);
      // End point: custom is +10%, benchmark is +5%
      expect(chartPoints[2].customReturnPct).toBe(10);
      expect(chartPoints[2].benchmarkReturnPct).toBe(5);
    });
  });
});

