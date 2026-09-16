import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, {
  clearAuthCache,
  clearMemoryCache,
  getMemoryCache,
  hashToken,
  resetPasswordTableEnsured,
  setAllowMemoryCacheInTest,
  setMemoryCache,
} from "../../worker/index";
import { calculateRiskMetrics } from "./analytics";
import { getMarketAwareCacheDuration } from "./marketCache";
import { filterByTimeframe } from "./timeframe";
import { createTreemapLayout } from "./treemap";
import type { PricePoint } from "../types";

beforeEach(() => {
  clearAuthCache();
  clearMemoryCache();
  resetPasswordTableEnsured();
  setAllowMemoryCacheInTest(false);
});

function createMockDb(handlers: {
  all?: (query: string, params: unknown[]) => Promise<{ results: any[] }> | { results: any[] };
  first?: (query: string, params: unknown[]) => Promise<any> | any;
  run?: (
    query: string,
    params: unknown[],
  ) => Promise<{ meta: { changes: number } }> | { meta: { changes: number } };
}) {
  const prepare = vi.fn().mockImplementation((query: string) => {
    let boundParams: unknown[] = [];
    const stmt = {
      query,
      bind: vi.fn().mockImplementation((...params: unknown[]) => {
        boundParams = params;
        return stmt;
      }),
      all: vi.fn().mockImplementation(async () => {
        if (handlers.all) return handlers.all(query, boundParams);
        return { results: [] };
      }),
      first: vi.fn().mockImplementation(async () => {
        if (handlers.first) return handlers.first(query, boundParams);
        return null;
      }),
      run: vi.fn().mockImplementation(async () => {
        if (handlers.run) return handlers.run(query, boundParams);
        return { meta: { changes: 1 } };
      }),
    };
    return stmt;
  });

  return { prepare, batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]) };
}

describe("Comprehensive Review Fixes", () => {
  describe("[CRIT-01] Quota Bypass Prevention on Existing Index Updates", () => {
    it("rejects an update exceeding creator max_stocks even when caller only provides ownerToken (no password)", async () => {
      const validToken = "user-owner-token-123";
      const validHash = await hashToken(validToken);

      const db = createMockDb({
        all: (query) => {
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return {
              results: [
                {
                  id: "idx-user-1",
                  owner_token_hash: validHash,
                  creator_id: "user-creator-abc",
                },
              ],
            };
          }
          if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
            return { results: [{ max_stocks: 2 }] };
          }
          return { results: [] };
        },
      });

      const env = {
        ASSETS: { fetch: vi.fn() },
        DB: db,
        ADMIN_PASSWORD: "test-admin-password",
      };

      // Request with ownerToken and 3 stocks (exceeds creator's max_stocks: 2), but NO password header
      const request = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": validToken,
        },
        body: JSON.stringify({
          id: "idx-user-1",
          name: "Updated Index Name",
          description: "Testing quota",
          baseValue: 1000,
          basket: [
            { ticker: "7203", name: "Toyota", weight: 40 },
            { ticker: "9984", name: "SoftBank", weight: 30 },
            { ticker: "8035", name: "Tokyo Electron", weight: 30 },
          ],
        }),
      });

      const res = await worker.fetch(request, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("最大2銘柄までに制限されています");
    });

    it("allows admin to update an existing user index even if basket exceeds creator max_stocks", async () => {
      const validToken = "user-owner-token-123";
      const validHash = await hashToken(validToken);

      const db = createMockDb({
        all: (query) => {
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return {
              results: [
                {
                  id: "idx-user-1",
                  owner_token_hash: validHash,
                  creator_id: "user-creator-abc",
                },
              ],
            };
          }
          return { results: [] };
        },
        first: (query) => {
          if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
            return { max_stocks: 2 };
          }
          return null;
        },
      });

      const env = {
        ASSETS: { fetch: vi.fn() },
        DB: db,
        ADMIN_PASSWORD: "test-admin-password",
      };

      const request = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": "test-admin-password",
        },
        body: JSON.stringify({
          id: "idx-user-1",
          name: "Admin Updated",
          description: "Admin override",
          baseValue: 1000,
          basket: [
            { ticker: "7203", name: "Toyota", weight: 40 },
            { ticker: "9984", name: "SoftBank", weight: 30 },
            { ticker: "8035", name: "Tokyo Electron", weight: 30 },
          ],
        }),
      });

      const res = await worker.fetch(request, env as any);
      expect(res.status).toBe(200);
      expect(db.batch).toHaveBeenCalled();
    });

    it("fails closed when the creator quota cannot be read", async () => {
      const validToken = "user-owner-token-123";
      const validHash = await hashToken(validToken);
      const db = createMockDb({
        all: (query) => {
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return {
              results: [
                {
                  id: "idx-user-1",
                  owner_token_hash: validHash,
                  creator_id: "user-creator-abc",
                },
              ],
            };
          }
          if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
            throw new Error("D1 temporarily unavailable");
          }
          return { results: [] };
        },
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const res = await worker.fetch(
          new Request("http://localhost/api/indices", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-owner-token": validToken,
            },
            body: JSON.stringify({
              id: "idx-user-1",
              name: "Updated Index Name",
              baseValue: 1000,
              basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
            }),
          }),
          { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: "test-admin-password" } as any,
        );

        expect(res.status).toBe(503);
        expect(db.batch).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("enforces the original creator's stock cap when another user has the owner token", async () => {
      const ownerToken = "shared-owner-token";
      const operatorPassword = "higher-quota-operator";
      const [ownerHash, operatorHash] = await Promise.all([
        hashToken(ownerToken),
        hashToken(operatorPassword),
      ]);
      const db = createMockDb({
        all: (query) => {
          if (query.includes("WHERE id = 'admin-master'")) return { results: [] };
          if (query.includes("WHERE is_active = 1 AND id != 'admin-master'")) {
            return {
              results: [
                {
                  id: "operator-user",
                  name: "Operator",
                  role: "user",
                  max_stocks: 500,
                  max_indices: null,
                  is_active: 1,
                  password_hash: operatorHash,
                },
              ],
            };
          }
          if (query.includes("SELECT ticker FROM basket_items WHERE index_id = ?")) {
            return { results: [{ ticker: "7203" }, { ticker: "9984" }] };
          }
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return {
              results: [
                {
                  id: "idx-user-1",
                  owner_token_hash: ownerHash,
                  creator_id: "limited-creator",
                },
              ],
            };
          }
          if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
            return { results: [{ max_stocks: 2 }] };
          }
          return { results: [] };
        },
      });

      const res = await worker.fetch(
        new Request("http://localhost/api/indices/stock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-password": operatorPassword,
            "x-owner-token": ownerToken,
          },
          body: JSON.stringify({
            indexId: "idx-user-1",
            stock: { ticker: "8035", name: "Tokyo Electron", theme: "Semi", weight: 10 },
          }),
        }),
        { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: "test-admin-password" } as any,
      );

      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("作成者の設定により最大2銘柄");
    });

    it("rejects an atomic constituent insert when a concurrent request consumed the final slot", async () => {
      const adminPassword = "atomic-slot-admin";
      const db = createMockDb({
        all: (query) => {
          if (query.includes("WHERE id = 'admin-master'")) return { results: [] };
          if (query.includes("SELECT ticker FROM basket_items WHERE index_id = ?")) {
            return {
              results: Array.from({ length: 499 }, (_, index) => ({ ticker: `T${index}` })),
            };
          }
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return { results: [{ id: "atomic-index", owner_token_hash: null, creator_id: null }] };
          }
          return { results: [] };
        },
        run: (query) => {
          if (
            query.includes("INSERT OR REPLACE INTO basket_items") &&
            query.includes("SELECT ?, ?, ?, ?, ?")
          ) {
            // D1 reports no change when the conditional INSERT sees that a
            // concurrent request has already filled the final permitted slot.
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 1 } };
        },
      });

      const res = await worker.fetch(
        new Request("http://localhost/api/indices/stock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-password": adminPassword,
          },
          body: JSON.stringify({
            indexId: "atomic-index",
            stock: { ticker: "NEW", name: "New Stock", theme: "Test", weight: 10 },
          }),
        }),
        { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: adminPassword } as any,
      );

      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain("同時更新により銘柄数上限に達しました");
    });
  });

  describe("[HIGH-03] Large Basket D1 Batching", () => {
    it("chunks a quota-guarded 500-stock save within D1's statement parameter and invocation budgets", async () => {
      const password = "limited-user-password";
      const passwordHash = await hashToken(password);
      const db = createMockDb({
        all: (query) => {
          if (query.includes("WHERE id = 'admin-master'")) return { results: [] };
          if (query.includes("WHERE is_active = 1 AND id != 'admin-master'")) {
            return {
              results: [
                {
                  id: "limited-user",
                  name: "Limited User",
                  role: "user",
                  max_stocks: 500,
                  max_indices: 5,
                  is_active: 1,
                  password_hash: passwordHash,
                },
              ],
            };
          }
          if (query.includes("SELECT id, owner_token_hash, creator_id FROM indices")) {
            return { results: [] };
          }
          if (query.includes("SELECT COUNT(*) as count FROM indices WHERE creator_id = ?")) {
            return { results: [{ count: 0 }] };
          }
          return { results: [] };
        },
      });
      const basket = Array.from({ length: 500 }, (_, index) => ({
        ticker: `T${index}`,
        name: `Stock ${index}`,
        theme: "Test",
        weight: 1,
      }));

      const res = await worker.fetch(
        new Request("http://localhost/api/indices", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-password": password },
          body: JSON.stringify({ id: "large-index", name: "Large Index", baseValue: 1000, basket }),
        }),
        { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: "test-admin-password" } as any,
      );

      expect(res.status).toBe(200);
      const statements = db.batch.mock.calls[0][0] as Array<{ query: string }>;
      const basketWrites = statements.filter((statement) =>
        statement.query.includes("INSERT OR REPLACE INTO basket_items"),
      );
      expect(statements).toHaveLength(29); // upsert + delete + ceil(500 / 19) writes
      expect(basketWrites).toHaveLength(27);
      expect(statements.length).toBeLessThanOrEqual(50);
      for (const statement of basketWrites) {
        expect((statement.query.match(/\?/g) || []).length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("[HIGH-01] Snapshot Stale Fallback Headers and Payload", () => {
    it("attaches x-data-stale header and stale: true in JSON payload on stale fallback", async () => {
      const cachedSnapshotData = {
        snapshot: { symbol: "^N225", current: 39000, change: 100, changePct: 0.25 },
        series: [
          { date: "2026-03-01", close: 38900 },
          { date: "2026-03-02", close: 39000 },
        ],
      };

      const db = createMockDb({
        all: (query) => {
          if (query.includes("FROM benchmark_cache") || query.includes("FROM snapshot_cache")) {
            return {
              results: [
                {
                  data: JSON.stringify(cachedSnapshotData),
                  cached_at: Math.floor(Date.now() / 1000) - 7 * 86400, // 7 days old (reliably stale across all trading and non-trading hours)
                },
              ],
            };
          }
          return { results: [] };
        },
      });

      // Mock fetch to simulate Yahoo Finance failure
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Yahoo Finance 503"));

      try {
        const env = {
          ASSETS: { fetch: vi.fn() },
          DB: db,
          ADMIN_PASSWORD: "unused",
        };

        const request = new Request("http://localhost/api/snapshot?symbol=%5EN225");
        const res = await worker.fetch(request, env as any);

        expect(res.status).toBe(200);
        expect(res.headers.get("x-data-stale")).toBe("true");
        const body = await res.json();
        expect(body.stale).toBe(true);
        expect(body.snapshot.symbol).toBe("^N225");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("serves fresh Yahoo data even when the legacy snapshot cache write fails", async () => {
      const db = createMockDb({
        run: (query) => {
          if (query.includes("INSERT OR REPLACE INTO snapshot_cache")) {
            throw new Error("D1 write unavailable");
          }
          return { meta: { changes: 1 } };
        },
      });
      const originalFetch = globalThis.fetch;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  timestamp: [1788566400, 1788652800],
                  indicators: { quote: [{ close: [39000, 39100] }] },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      try {
        const res = await worker.fetch(
          new Request("http://localhost/api/snapshot?symbol=%5EN225"),
          { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: "test-admin-password" } as any,
        );

        expect(res.status).toBe(200);
        expect((await res.json()).snapshot.current).toBe(39100);
      } finally {
        globalThis.fetch = originalFetch;
        consoleError.mockRestore();
      }
    });

    it("returns 502 instead of exposing a structurally invalid stale snapshot payload", async () => {
      const db = createMockDb({
        all: (query) => {
          if (query.includes("FROM benchmark_cache") || query.includes("FROM snapshot_cache")) {
            return {
              results: [
                {
                  data: JSON.stringify({
                    snapshot: { symbol: "^N225", current: 39000, change: 100, changePct: 0.25 },
                    series: [],
                  }),
                  cached_at: Math.floor(Date.now() / 1000) - 7 * 86400,
                },
              ],
            };
          }
          return { results: [] };
        },
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Yahoo Finance unavailable"));

      try {
        const res = await worker.fetch(
          new Request("http://localhost/api/snapshot?symbol=%5EN225"),
          { ASSETS: { fetch: vi.fn() }, DB: db, ADMIN_PASSWORD: "unused" } as any,
        );

        expect(res.status).toBe(502);
        expect((await res.json()).error).toContain("No data available");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("[HIGH-02] Dynamic Calc Cache Partitioning", () => {
    it("stores calc entries separately without evicting general system cache entries", () => {
      setAllowMemoryCacheInTest(true);

      // Set general system cache entry
      setMemoryCache("api:indices", [{ id: "test-idx" }], 300);

      // Flooding calc cache entries (over 100 entries)
      for (let i = 0; i < 150; i++) {
        setMemoryCache(`calc:fingerprint_${i}`, { result: i }, 300);
      }

      // General cache entry must NOT be evicted by calc floods
      expect(getMemoryCache("api:indices")).toEqual([{ id: "test-idx" }]);

      // Recent calc entry is present
      expect(getMemoryCache("calc:fingerprint_149")).toEqual({ result: 149 });

      // Oldest calc entry was evicted due to calc cap (100)
      expect(getMemoryCache("calc:fingerprint_0")).toBeNull();

      // clearMemoryCache("calc:") only clears calc cache
      clearMemoryCache("calc:");
      expect(getMemoryCache("calc:fingerprint_149")).toBeNull();
      expect(getMemoryCache("api:indices")).toEqual([{ id: "test-idx" }]);
    });
  });

  describe("[MED-02] Security Headers (HSTS)", () => {
    it("includes Strict-Transport-Security header on json responses", async () => {
      const env = {
        ASSETS: { fetch: vi.fn() },
        DB: { prepare: vi.fn(), batch: vi.fn() },
        ADMIN_PASSWORD: "test",
      };

      const res = await worker.fetch(new Request("http://localhost/api/health"), env as any);
      expect(res.headers.get("strict-transport-security")).toBe(
        "max-age=31536000; includeSubDomains; preload",
      );
    });
  });

  describe("[C-1] Friday Morning TSE Market Cache Expiration", () => {
    it("expires Friday 08:30 JST at 09:00 JST (1800s), NOT 72 hours later", () => {
      // Friday 08:30 JST -> 2026-04-17T08:30:00+09:00 is 2026-04-16T23:30:00Z
      const fridayMorning = new Date("2026-04-16T23:30:00.000Z");
      const duration = getMarketAwareCacheDuration(fridayMorning);
      // 30 minutes = 1800 seconds
      expect(duration).toBe(1800);
    });

    it("expires Friday 16:00 JST on Monday 09:00 JST", () => {
      // Friday 16:00 JST -> 2026-04-17T16:00:00+09:00 is 2026-04-17T07:00:00Z
      const fridayAfterClose = new Date("2026-04-17T07:00:00.000Z");
      const duration = getMarketAwareCacheDuration(fridayAfterClose);
      // Friday 16:00 to Monday 09:00 = 65 hours = 234,000 seconds
      expect(duration).toBe(65 * 3600);
    });
  });

  describe("[C-2] Squarified Treemap Layout", () => {
    it("creates bounded 2D layouts using alternating slicing directions", () => {
      const items = [
        { key: "A", value: 40 },
        { key: "B", value: 30 },
        { key: "C", value: 20 },
        { key: "D", value: 10 },
      ];

      const layouts = createTreemapLayout(items);
      expect(layouts).toHaveLength(4);

      let totalArea = 0;
      for (const layout of layouts) {
        expect(layout.x).toBeGreaterThanOrEqual(0);
        expect(layout.y).toBeGreaterThanOrEqual(0);
        expect(layout.x + layout.width).toBeLessThanOrEqual(1.0001);
        expect(layout.y + layout.height).toBeLessThanOrEqual(1.0001);
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
        totalArea += layout.width * layout.height;
      }
      expect(totalArea).toBeCloseTo(1.0, 3);
    });
  });

  describe("[C-3 & H-1] Analytics CAGR and Holiday-Tolerant Beta", () => {
    it("uses linear annualization for short periods (<250 days) preventing CAGR exponential explosion", () => {
      // 5 days of data (+5% return in 1 week)
      const series: PricePoint[] = [
        { date: "2026-04-01", close: 100 },
        { date: "2026-04-02", close: 101 },
        { date: "2026-04-03", close: 102 },
        { date: "2026-04-04", close: 103 },
        { date: "2026-04-05", close: 105 },
      ];

      const metrics = calculateRiskMetrics(series, []);
      // With linear annualization: totalReturn (0.05) * (250 / 4) * 100 = 312.5%
      // With geometric CAGR: (1.05)^62.5 - 1 = 2038% (exponential explosion)
      expect(metrics.annualReturn).toBeLessThan(500);
      expect(metrics.annualReturn).toBeGreaterThan(0);
    });

    it("forward-fills benchmark across dates so foreign market holidays do not drop paired returns", () => {
      // Japanese series has 4 dates
      const custom: PricePoint[] = [
        { date: "2026-05-01", close: 100 },
        { date: "2026-05-02", close: 100 }, // holiday in US, no movement in Japan either
        { date: "2026-05-03", close: 105 }, // both jump together
        { date: "2026-05-04", close: 110 }, // both continue up
      ];
      // US Benchmark was closed on 2026-05-02 (holiday)
      const bench: PricePoint[] = [
        { date: "2026-05-01", close: 5000 },
        // 2026-05-02 missing (US holiday)
        { date: "2026-05-03", close: 5250 },
        { date: "2026-05-04", close: 5500 },
      ];

      const metrics = calculateRiskMetrics(custom, bench);
      expect(Number.isFinite(metrics.beta)).toBe(true);
      expect(metrics.beta).toBeGreaterThan(0);
    });
  });

  describe("[M-6] Timeframe YTD boundaries", () => {
    it("does not mix prior-year points when current year has fewer than 2 points", () => {
      const currentYear = new Date().getFullYear().toString();
      const pastYear = (new Date().getFullYear() - 1).toString();

      const data = [
        ...Array.from({ length: 30 }, (_, i) => ({
          date: `${pastYear}-12-${String(i + 1).padStart(2, "0")}`,
          close: 1000 + i,
        })),
        { date: `${currentYear}-01-04`, close: 1050 }, // Only 1 point in current year
      ];

      const result = filterByTimeframe(data, "YTD");
      expect(result).toEqual([{ date: `${currentYear}-01-04`, close: 1050 }]);
    });

    it("returns YTD data when 2 or more points exist in current year", () => {
      const currentYear = new Date().getFullYear().toString();
      const pastYear = (new Date().getFullYear() - 1).toString();

      const data = [
        { date: `${pastYear}-12-30`, close: 1000 },
        { date: `${currentYear}-01-04`, close: 1010 },
        { date: `${currentYear}-01-05`, close: 1020 },
      ];

      const result = filterByTimeframe(data, "YTD");
      expect(result.length).toBe(2);
      expect(result[0].date).toBe(`${currentYear}-01-04`);
    });
  });
});
