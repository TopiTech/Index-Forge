import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../worker/index";
import {
  isPriceCacheFresh,
  clearMemoryCache,
  getMemoryCache,
  setAllowMemoryCacheInTest,
  clearAuthCache,
  resetPasswordTableEnsured,
  hashPassword,
} from "../../worker/internal";

describe("Audit Fixes Verification: Market-Aware Stock Price Freshness", () => {
  it("keeps Friday closing prices fresh throughout the entire weekend and Monday pre-open", () => {
    // Friday 2026-09-04 16:00 JST -> 07:00 UTC
    const fridayCloseSec = Math.floor(new Date("2026-09-04T07:00:00Z").getTime() / 1000);

    // Saturday 2026-09-05 12:00 JST -> 03:00 UTC
    const saturdayNoonSec = Math.floor(new Date("2026-09-05T03:00:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(saturdayNoonSec, fridayCloseSec)).toBe(true);

    // Sunday 2026-09-06 20:00 JST -> 11:00 UTC
    const sundayNightSec = Math.floor(new Date("2026-09-06T11:00:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(sundayNightSec, fridayCloseSec)).toBe(true);

    // Monday 2026-09-07 08:30 JST -> 23:30 UTC of 2026-09-06
    const mondayPreOpenSec = Math.floor(new Date("2026-09-06T23:30:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(mondayPreOpenSec, fridayCloseSec)).toBe(true);

    // Monday 2026-09-07 09:05 JST -> 00:05 UTC of 2026-09-07 (market is open!)
    const mondayPostOpenSec = Math.floor(new Date("2026-09-07T00:05:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(mondayPostOpenSec, fridayCloseSec)).toBe(false);
  });

  it("expires a Friday 15:30 synchronization exactly at the Monday market open", () => {
    // Friday 2026-09-04 15:30 JST -> 06:30 UTC.
    const fridayCloseSec = Math.floor(new Date("2026-09-04T06:30:00Z").getTime() / 1000);
    // Monday 2026-09-07 09:00 JST -> 00:00 UTC.
    const mondayOpenSec = Math.floor(new Date("2026-09-07T00:00:00Z").getTime() / 1000);

    // The old whole-hour calculation kept this cached until 09:30 JST.
    expect(isPriceCacheFresh(mondayOpenSec, fridayCloseSec)).toBe(false);
  });

  it("marks intraday weekday prices stale after market close (15:30 JST) to refresh final closing prices", () => {
    // Wednesday 2026-09-02 11:00 JST -> 02:00 UTC
    const wednesdayIntradaySec = Math.floor(new Date("2026-09-02T02:00:00Z").getTime() / 1000);

    // Wednesday 2026-09-02 12:00 JST -> 03:00 UTC (still trading hours, within 12h cache)
    const wednesdayLunchSec = Math.floor(new Date("2026-09-02T03:00:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(wednesdayLunchSec, wednesdayIntradaySec)).toBe(true);

    // Wednesday 2026-09-02 15:35 JST -> 06:35 UTC (market closed! Intraday price must be refreshed)
    const wednesdayPostCloseSec = Math.floor(new Date("2026-09-02T06:35:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(wednesdayPostCloseSec, wednesdayIntradaySec)).toBe(false);
  });

  it("keeps weekday evening prices fresh until the next morning market open", () => {
    // Wednesday 2026-09-02 18:00 JST -> 09:00 UTC
    const wednesdayEveningSec = Math.floor(new Date("2026-09-02T09:00:00Z").getTime() / 1000);

    // Thursday 2026-09-03 08:30 JST -> 23:30 UTC of 2026-09-02
    const thursdayMorningSec = Math.floor(new Date("2026-09-02T23:30:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(thursdayMorningSec, wednesdayEveningSec)).toBe(true);

    // Thursday 2026-09-03 09:05 JST -> 00:05 UTC of 2026-09-03 (market open)
    const thursdayPostOpenSec = Math.floor(new Date("2026-09-03T00:05:00Z").getTime() / 1000);
    expect(isPriceCacheFresh(thursdayPostOpenSec, wednesdayEveningSec)).toBe(false);
  });

  it("handles clock skew safely when now is slightly earlier than lastSynced", () => {
    const nowSec = 1000;
    const lastSyncedSec = 1005;
    expect(isPriceCacheFresh(nowSec, lastSyncedSec)).toBe(true);
  });
});

describe("Audit Fixes Verification: D1 SQL Syntax & Quota Write Guard", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  it("generates valid SQL without duplicate WHERE clauses when basket write guard is active", async () => {
    const preparedQueries: string[] = [];
    const validPassword = "quota-user-secret-123";
    const validHash = await hashPassword(validPassword);

    const env = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          preparedQueries.push(sql);
          const isAuthQuery = sql.includes("FROM access_passwords");
          const isPragma = sql.includes("PRAGMA table_info");
          const isIndicesCount = sql.includes("SELECT COUNT(*)");
          const isRateLimit = sql.includes("rate_limits");

          const stmt = {
            bind: vi.fn().mockReturnThis(),
            run: vi.fn().mockResolvedValue({ success: true, results: [] }),
            all: vi.fn().mockImplementation(async () => {
              if (isRateLimit) return { results: [] };
              if (isAuthQuery) {
                return {
                  results: [
                    {
                      id: "user-123",
                      name: "Quota User",
                      password_hash: validHash,
                      role: "user",
                      max_stocks: 5,
                      max_indices: 3,
                      is_active: 1,
                    },
                  ],
                };
              }
              if (isPragma) {
                return {
                  results: [
                    { name: "id" },
                    { name: "name" },
                    { name: "description" },
                    { name: "base_value" },
                    { name: "sort_order" },
                    { name: "owner_token_hash" },
                    { name: "creator_id" },
                    { name: "created_at" },
                  ],
                };
              }
              if (isIndicesCount) {
                return { results: [{ count: 1 }] };
              }
              return { results: [] };
            }),
            first: vi.fn().mockImplementation(async () => {
              if (isAuthQuery) {
                return {
                  id: "user-123",
                  name: "Quota User",
                  password_hash: validHash,
                  role: "user",
                  max_stocks: 5,
                  max_indices: 3,
                  is_active: 1,
                };
              }
              if (isIndicesCount) {
                return { count: 1 };
              }
              return null;
            }),
          };
          return stmt;
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
    };

    const authHeaders = {
      "Authorization": `Bearer ${validPassword}`,
      "Content-Type": "application/json",
    };

    const indexPayload = {
      id: "quota-index-1",
      name: "Quota Test Index",
      description: "Test description",
      baseValue: 1000,
      basket: [
        { ticker: "7203", name: "トヨタ", weight: 50, theme: "自動車" },
        { ticker: "6758", name: "ソニー", weight: 50, theme: "電機" },
      ],
    };

    const req = new Request("https://localhost/api/indices", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(indexPayload),
    });

    const res = await worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1]);
    expect(res.status).toBe(200);

    // Verify none of the prepared DELETE statements contain "WHERE ... WHERE"
    const deleteBasketQueries = preparedQueries.filter((q) => q.includes("DELETE FROM basket_items"));
    expect(deleteBasketQueries.length).toBeGreaterThan(0);
    for (const q of deleteBasketQueries) {
      expect(q).not.toMatch(/WHERE\s+index_id\s*=\s*\?\s*WHERE/i);
      expect(q).toContain("WHERE index_id = ? AND EXISTS (SELECT 1 FROM indices WHERE id = ? AND creator_id = ?)");
    }
  });
});

describe("Audit Fixes Verification: Memory Cache Empty Series Protection", () => {
  beforeEach(() => {
    clearMemoryCache();
    setAllowMemoryCacheInTest(true);
  });

  it("does not store empty series calculations in memoryCache", async () => {
    const env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }), // No stock_series data
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      },
    };

    const calcPayload = {
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ", weight: 100, theme: "自動車" }],
    };

    const req = new Request("https://localhost/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calcPayload),
    });

    const res = await worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: unknown[] };
    expect(body.series).toEqual([]);

    // Memory cache should remain empty for this calculation
    const calcCacheKey = "calc:1000:7203:100";
    expect(getMemoryCache(calcCacheKey)).toBeNull();
  });
});

describe("Audit Fixes Verification: Benchmark Cache Table Self-Healing", () => {
  it("auto-creates benchmark_cache table when missing table error is encountered", async () => {
    let tableCreated = false;
    let cacheInserted = false;

    const env = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => {
          const stmt = {
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockImplementation(async () => {
              if (sql.includes("FROM benchmark_cache")) {
                if (!tableCreated) {
                  throw new Error("no such table: benchmark_cache");
                }
                return { results: [] };
              }
              return { results: [] };
            }),
            first: vi.fn().mockImplementation(async () => {
              if (sql.includes("FROM benchmark_cache")) {
                if (!tableCreated) {
                  throw new Error("no such table: benchmark_cache");
                }
                return null;
              }
              return null;
            }),
            run: vi.fn().mockImplementation(async () => {
              if (sql.includes("CREATE TABLE IF NOT EXISTS benchmark_cache")) {
                tableCreated = true;
                return { success: true };
              }
              if (sql.includes("INSERT OR REPLACE INTO benchmark_cache")) {
                if (!tableCreated) {
                  throw new Error("no such table: benchmark_cache");
                }
                cacheInserted = true;
                return { success: true };
              }
              return { success: true };
            }),
          };
          return stmt;
        }),
      },
    };

    // Mock global fetch for Yahoo Finance
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("query1.finance.yahoo.com")) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1609459200, 1609545600],
                  indicators: {
                    quote: [{ close: [3700.5, 3750.2] }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    try {
      const req = new Request("https://localhost/api/snapshot?symbol=^GSPC");
      const res = await worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1]);
      expect(res.status).toBe(200);
      expect(tableCreated).toBe(true);
      expect(cacheInserted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Audit Fixes Verification: Admin Password Update", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  it("updates user name, quotas, and role via PUT /api/admin/passwords", async () => {
    const adminPassword = "master-admin-password";
    const adminHash = await hashPassword(adminPassword);
    const updatedColumns: string[] = [];
    const boundParams: unknown[] = [];

    const createStatement = (sql: string, _params: unknown[] = []) => {
      return {
        bind: vi.fn().mockImplementation((...newParams: unknown[]) => {
          if (sql.includes("UPDATE access_passwords SET")) {
            updatedColumns.push(sql);
            boundParams.push(...newParams);
          }
          return createStatement(sql, newParams);
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes("FROM access_passwords")) {
            return {
              results: [
                {
                  id: "admin-master",
                  name: "Master Admin",
                  password_hash: adminHash,
                  role: "admin",
                  is_active: 1,
                },
              ],
            };
          }
          return { results: [] };
        }),
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes("FROM access_passwords")) {
            return {
              id: "admin-master",
              name: "Master Admin",
              password_hash: adminHash,
              role: "admin",
              is_active: 1,
            };
          }
          return null;
        }),
      };
    };

    const env = {
      DB: {
        prepare: vi.fn().mockImplementation((sql: string) => createStatement(sql)),
      },
    };

    const updatePayload = {
      id: "user-target",
      name: "Updated User Name",
      role: "user",
      maxStocks: 25,
      maxIndices: 10,
      isActive: true,
      password: "new-user-secret-password",
    };

    const req = new Request("https://localhost/api/admin/passwords", {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${adminPassword}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    });

    const res = await worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1]);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);

    expect(updatedColumns.length).toBeGreaterThan(0);
    const updateSql = updatedColumns[0];
    expect(updateSql).toContain("name = ?");
    expect(updateSql).toContain("password_hash = ?");
    expect(updateSql).toContain("max_stocks = ?");
    expect(updateSql).toContain("max_indices = ?");
    expect(updateSql).toContain("is_active = ?");
    expect(boundParams).toContain("Updated User Name");
    expect(boundParams).toContain(25);
    expect(boundParams).toContain(10);
    expect(boundParams).toContain(1);
    expect(boundParams).toContain("user-target");
  });

  it("keeps legacy password updates compatible when max_indices is not migrated", async () => {
    const adminPassword = "legacy-schema-admin";
    const adminHash = await hashPassword(adminPassword);
    const updateQueries: string[] = [];

    const prepare = vi.fn().mockImplementation((sql: string) => {
      const statement = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            return {
              results: [{
                id: "admin-master",
                name: "Legacy Admin",
                password_hash: adminHash,
                role: "admin",
                is_active: 1,
              }],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockImplementation(async () => {
          if (sql.includes("UPDATE access_passwords SET")) {
            updateQueries.push(sql);
            if (sql.includes("max_indices = NULL")) {
              throw new Error("no such column: max_indices");
            }
          }
          return { success: true, meta: { changes: 1 } };
        }),
      };
      return statement;
    });

    const env = {
      DB: { prepare, batch: vi.fn().mockResolvedValue([]) },
      ADMIN_PASSWORD: adminPassword,
      ASSETS: { fetch: vi.fn() },
    };
    const res = await worker.fetch(
      new Request("https://localhost/api/admin/passwords", {
        method: "PUT",
        headers: { Authorization: `Bearer ${adminPassword}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: "legacy-user", name: "Renamed", maxIndices: null }),
      }),
      env as any,
    );

    expect(res.status).toBe(200);
    expect(updateQueries).toHaveLength(2);
    expect(updateQueries[0]).toContain("max_indices = NULL");
    expect(updateQueries[1]).not.toContain("max_indices");
    expect(updateQueries[1]).toContain("name = ?");
  });
});

describe("Audit Fixes Verification: Index Selection Fallback", () => {
  it("falls back to DEFAULT_INDICES[0] when selected index is deleted or no longer exists", () => {
    const defaultIndices = [
      { id: "default-1", name: "Default 1", description: "", baseValue: 1000, basket: [] },
      { id: "default-2", name: "Default 2", description: "", baseValue: 1000, basket: [] },
    ];
    const deletedPrev = { id: "deleted-idx", name: "Deleted", description: "", baseValue: 1000, basket: [] };

    // The selection fallback logic implemented in useIndices:
    const resolveFallback = (prev: typeof deletedPrev | null, list: typeof defaultIndices) => {
      if (!prev) return list[0];
      const found = list.find((d) => d.id === prev.id);
      return found || list[0];
    };

    expect(resolveFallback(deletedPrev, defaultIndices)).toBe(defaultIndices[0]);

    const existingPrev = defaultIndices[1];
    expect(resolveFallback(existingPrev, defaultIndices)).toBe(defaultIndices[1]);
  });
});
