import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  ensurePasswordTable,
} from "../../worker/internal";
import { calculateStockDetails } from "./analytics";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
  vi.restoreAllMocks();
});

describe("Comprehensive Review Goal Fixes", () => {
  describe("Signed zero and near-zero contribution formatting in calculateStockDetails", () => {
    it("sanitizes -0 and tiny sub-cent changes to clean 0 with no signed zero", () => {
      const basket = [
        { ticker: "TEST1", name: "Zero Change Stock", weight: 50, theme: "Test" },
        { ticker: "TEST2", name: "Tiny Change Stock", weight: 50, theme: "Test" },
      ];
      const universe = [
        {
          ticker: "TEST1",
          name: "Zero Change Stock",
          theme: "Test",
          sector: "Test",
          latestPrice: 100,
          series: [
            { date: "2026-09-01", close: 100 },
            { date: "2026-09-02", close: 100 },
          ],
        },
        {
          ticker: "TEST2",
          name: "Tiny Change Stock",
          theme: "Test",
          sector: "Test",
          latestPrice: 100,
          series: [
            { date: "2026-09-01", close: 100 },
            { date: "2026-09-02", close: 100.001 },
          ],
        },
      ];

      const details = calculateStockDetails(basket, universe, 1000, [
        { date: "2026-09-01", close: 1000, value: 1000 },
        { date: "2026-09-02", close: 1000, value: 1000 },
      ]);

      const test1 = details.find((d) => d.ticker === "TEST1")!;
      expect(test1.change).toBe(0);
      expect(Object.is(test1.change, -0)).toBe(false);
      expect(test1.changePct).toBe(0);
      expect(Object.is(test1.changePct, -0)).toBe(false);
      expect(test1.contributionPt).toBe(0);
      expect(Object.is(test1.contributionPt, -0)).toBe(false);
      expect(test1.contributionPct).toBe(0);

      const test2 = details.find((d) => d.ticker === "TEST2")!;
      expect(test2.change).toBe(0);
      expect(test2.changePct).toBe(0);
      expect(test2.contributionPt).toBe(0);
      expect(test2.contributionPct).toBe(0);
    });
  });

  describe("Fresh / Unmigrated D1 resilience for POST /api/sync-prices and ensurePasswordTable", () => {
    it("ensurePasswordTable creates sync_logs and snapshot_cache tables", async () => {
      const createdTables: string[] = [];
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockImplementation((sql: string) => {
            const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
            if (match) {
              createdTables.push(match[1]);
            }
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

      expect(createdTables).toContain("sync_logs");
      expect(createdTables).toContain("snapshot_cache");
      expect(createdTables).toContain("benchmark_cache");
      expect(createdTables).toContain("rate_limits");
      expect(createdTables).toContain("access_passwords");
    });

    it("POST /api/sync-prices survives unmigrated database where sync_logs table is missing", async () => {
      // Mock Yahoo Finance
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            chart: {
              result: [
                {
                  timestamp: [1700000000],
                  indicators: { quote: [{ close: [2500] }] },
                },
              ],
            },
          }),
        }),
      );

      try {
        const missing = new Set(["sync_logs", "stock_series"]);
        const mockEnv = {
          DB: {
            prepare: vi.fn().mockImplementation((query: string) => {
              if (query.includes("sync_logs") && missing.has("sync_logs")) {
                return {
                  bind: () => ({
                    all: () => Promise.reject(new Error("no such table: sync_logs")),
                    run: () => Promise.reject(new Error("no such table: sync_logs")),
                  }),
                  all: () => Promise.reject(new Error("no such table: sync_logs")),
                  run: () => Promise.reject(new Error("no such table: sync_logs")),
                };
              }
              return {
                bind: () => ({
                  all: () => Promise.resolve({ results: [] }),
                  run: () => Promise.resolve({ success: true }),
                }),
                all: () => Promise.resolve({ results: [] }),
                run: () => Promise.resolve({ success: true }),
              };
            }),
            batch: vi.fn().mockImplementation((_statements: any[]) => {
              // Simulate missing stock_series or sync_logs in batch
              return Promise.reject(new Error("no such table: stock_series"));
            }),
          },
        };

        const req = new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: ["7203"] }),
        });

        const res = await worker.fetch(req, mockEnv as any);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { results: { ticker: string; status: string }[] };
        expect(data.results).toBeDefined();
        expect(data.results[0].ticker).toBe("7203");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("GET /api/indices NULL handling", () => {
    it("safely falls back to id and ticker when name or stock_name is NULL in DB", async () => {
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: "custom-idx-1",
                  name: null, // NULL in DB
                  description: null,
                  base_value: 1000,
                  sort_order: null,
                  ticker: "7203",
                  stock_name: null, // NULL in DB
                  weight: 50,
                  theme: null,
                },
              ],
            }),
          }),
        },
      };

      const req = new Request("http://localhost/api/indices", { method: "GET" });
      const res = await worker.fetch(req, mockEnv as any);

      expect(res.status).toBe(200);
      const data = (await res.json()) as any[];
      expect(data).toHaveLength(1);
      // Must not coerce to "null" string
      expect(data[0].name).toBe("custom-idx-1");
      expect(data[0].basket[0].name).toBe("7203");
    });
  });
});
