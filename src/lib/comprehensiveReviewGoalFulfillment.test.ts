import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, {
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { escapeCsvCell } from "./csv";
import { calculateRiskMetrics } from "./analytics";
import { normalizeTicker } from "./indexEngine";
import { calculateConstituentPerformance } from "../hooks/useSimulation";
import type { BasketItem, PricePoint, StockSeries } from "../types";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
  vi.restoreAllMocks();
});

describe("Comprehensive Review Goal Fulfillment Suite", () => {
  describe("CSV Formula Injection Protection", () => {
    it("neutralizes pipe-prefixed commands and formulas alongside =, +, -, @", () => {
      expect(escapeCsvCell("|' /C calc'!A0")).toBe("\"'|' /C calc'!A0\"");
      expect(escapeCsvCell("  |cmd.exe")).toBe("\"'  |cmd.exe\"");
      expect(escapeCsvCell("\t|test")).toBe("\"'\t|test\"");
      expect(escapeCsvCell("\uFEFF|formula")).toBe("\"'\uFEFF|formula\"");
    });

    it("leaves plain numbers (negative, positive, zero) intact without apostrophe prefix", () => {
      expect(escapeCsvCell(-2.56)).toBe('"-2.56"');
      expect(escapeCsvCell("-2.56")).toBe('"-2.56"');
      expect(escapeCsvCell(0)).toBe('"0"');
      expect(escapeCsvCell("0")).toBe('"0"');
      expect(escapeCsvCell(100.45)).toBe('"100.45"');
      expect(escapeCsvCell((-5.25).toFixed(2))).toBe('"-5.25"');
    });

    it("neutralizes non-numeric hyphen or plus prefixed text", () => {
      expect(escapeCsvCell("-cmd")).toBe("\"'-cmd\"");
      expect(escapeCsvCell("+SUM(B1:B10)")).toBe("\"'+SUM(B1:B10)\"");
    });
  });

  describe("Analytics: Beta Calculation Numerical Stability", () => {
    it("returns beta = null when benchmark variance is zero", () => {
      const custom: PricePoint[] = [
        { date: "2026-09-01", close: 100, value: 100 },
        { date: "2026-09-02", close: 105, value: 105 },
        { date: "2026-09-03", close: 110, value: 110 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-09-01", close: 38000 },
        { date: "2026-09-02", close: 38000 },
        { date: "2026-09-03", close: 38000 },
      ];

      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics.beta).toBeNull();
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
    });

    it("returns beta = null when benchmark variance is infinitesimal (bVar < 1e-12) to avoid overflow", () => {
      const custom: PricePoint[] = [
        { date: "2026-09-01", close: 100, value: 100 },
        { date: "2026-09-02", close: 105, value: 105 },
        { date: "2026-09-03", close: 110, value: 110 },
      ];
      // Microscopic jitter in benchmark returns
      const bench: PricePoint[] = [
        { date: "2026-09-01", close: 38000.00000000000 },
        { date: "2026-09-02", close: 38000.00000000001 },
        { date: "2026-09-03", close: 38000.00000000000 },
      ];

      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics.beta).toBeNull();
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
    });

    it("calculates realistic beta when benchmark has normal variance", () => {
      const custom: PricePoint[] = [
        { date: "2026-09-01", close: 100, value: 100 },
        { date: "2026-09-02", close: 102, value: 102 }, // +2%
        { date: "2026-09-03", close: 100, value: 100 }, // -1.96%
        { date: "2026-09-04", close: 104, value: 104 }, // +4%
      ];
      const bench: PricePoint[] = [
        { date: "2026-09-01", close: 38000 },
        { date: "2026-09-02", close: 38380 }, // +1%
        { date: "2026-09-03", close: 38000 }, // -0.99%
        { date: "2026-09-04", close: 38760 }, // +2%
      ];

      const metrics = calculateRiskMetrics(custom, bench);
      // Custom moves with roughly twice the magnitude of bench -> beta ~ 2.0
      expect(metrics.beta).not.toBeNull();
      expect(typeof metrics.beta).toBe("number");
      expect(metrics.beta!).toBeGreaterThan(1.5);
      expect(metrics.beta!).toBeLessThan(2.5);
    });
  });

  describe("Ticker Normalization Consistency in Engine & Simulation", () => {
    it("normalizeTicker trims whitespace and converts to uppercase", () => {
      expect(normalizeTicker("  7203 ")).toBe("7203");
      expect(normalizeTicker("AAPL ")).toBe("AAPL");
      expect(normalizeTicker("\tmsft\n")).toBe("MSFT");
    });

    it("calculateConstituentPerformance matches tickers despite casing and whitespace variations", () => {
      const basket: BasketItem[] = [
        { ticker: " 7203 ", name: "Toyota", weight: 50, theme: "Auto" },
        { ticker: "nvda", name: "Nvidia", weight: 50, theme: "Tech" },
      ];

      const stockUniverse: StockSeries[] = [
        {
          ticker: "7203",
          name: "Toyota",
          theme: "Auto",
          sector: "Auto",
          latestPrice: 3000,
          series: [
            { date: "2026-09-01", close: 2800 },
            { date: "2026-09-02", close: 3000 },
          ],
        },
        {
          ticker: "NVDA",
          name: "Nvidia",
          theme: "Tech",
          sector: "Tech",
          latestPrice: 120,
          series: [
            { date: "2026-09-01", close: 100 },
            { date: "2026-09-02", close: 120 },
          ],
        },
      ];

      const perf = calculateConstituentPerformance(basket, stockUniverse, "1M");
      expect(perf).toHaveLength(2);

      const toyota = perf.find((p) => p.ticker === "7203");
      expect(toyota).toBeDefined();
      expect(toyota!.startPrice).toBe(2800);
      expect(toyota!.latestPrice).toBe(3000);
      expect(toyota!.periodReturnPct).toBeGreaterThan(0);

      const nvidia = perf.find((p) => p.ticker === "NVDA");
      expect(nvidia).toBeDefined();
      expect(nvidia!.startPrice).toBe(100);
      expect(nvidia!.latestPrice).toBe(120);
      expect(nvidia!.periodReturnPct).toBe(20);
    });
  });

  describe("Worker: POST /api/sync-prices Benchmark Symbols Support", () => {
    it("accepts valid benchmark tickers such as ^N225 and USDJPY=X", async () => {
      const executedQueries: string[] = [];
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            executedQueries.push(query);
            return {
              bind: () => ({
                all: () => Promise.resolve({ results: [] }),
                run: () => Promise.resolve({ success: true }),
                first: () => Promise.resolve(null),
              }),
              all: () => Promise.resolve({ results: [] }),
              run: () => Promise.resolve({ success: true }),
              first: () => Promise.resolve(null),
            };
          }),
        },
      };

      // Mock Yahoo Finance to prevent outbound network calls
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            chart: {
              result: [
                {
                  timestamp: [1700000000],
                  indicators: { quote: [{ close: [38000] }] },
                },
              ],
            },
          }),
        }),
      );

      const res = await worker.fetch(
        new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers: ["^N225", "USDJPY=X", "7203.T"],
          }),
        }),
        mockEnv as any,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.results)).toBe(true);
    });

    it("rejects malicious or invalid ticker characters", async () => {
      const mockEnv = { DB: { prepare: vi.fn() } };
      const res = await worker.fetch(
        new Request("http://localhost/api/sync-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers: ["7203; DROP TABLE stock_prices"],
          }),
        }),
        mockEnv as any,
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toBe("Invalid ticker value");
    });
  });

  describe("Worker: Admin Quota Clearing Support for '0' and 0", () => {
    it("treats '0' string in PUT /api/admin/passwords as unsetting the limit (NULL)", async () => {
      const executedSql: string[] = [];
      const boundParams: unknown[][] = [];

      const mockEnv = {
        ADMIN_PASSWORD: "MasterAdminPassword123!",
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            executedSql.push(query);
            return {
              bind: (...args: unknown[]) => {
                boundParams.push(args);
                return {
                  all: () => Promise.resolve({ results: [] }),
                  run: () => Promise.resolve({ success: true }),
                  first: () => Promise.resolve(null),
                };
              },
              all: () => Promise.resolve({ results: [] }),
              run: () => Promise.resolve({ success: true }),
              first: () => Promise.resolve(null),
            };
          }),
        },
      };

      const res = await worker.fetch(
        new Request("http://localhost/api/admin/passwords", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-auth-password": "MasterAdminPassword123!",
          },
          body: JSON.stringify({
            id: "pwd-user-1",
            maxStocks: "0",
            maxIndices: "0",
          }),
        }),
        mockEnv as any,
      );

      expect(res.status).toBe(200);
      const updateQuery = executedSql.find((q) => q.includes("UPDATE access_passwords"));
      expect(updateQuery).toBeDefined();
      expect(updateQuery).toContain("max_stocks = NULL");
      expect(updateQuery).toContain("max_indices = NULL");
    });

    it("treats '0' string in POST /api/admin/passwords as unlimited (NULL)", async () => {
      let insertedMaxStocks: unknown = "not-called";
      let insertedMaxIndices: unknown = "not-called";

      const mockEnv = {
        ADMIN_PASSWORD: "MasterAdminPassword123!",
        DB: {
          prepare: vi.fn().mockImplementation((query: string) => {
            return {
              bind: (...args: unknown[]) => {
                if (query.includes("INSERT INTO access_passwords")) {
                  // Arguments: id, name, password_hash, assignedRole, maxStockLimit, maxIndexLimit, now, now
                  insertedMaxStocks = args[4];
                  insertedMaxIndices = args[5];
                }
                return {
                  all: () => Promise.resolve({ results: [] }),
                  run: () => Promise.resolve({ success: true }),
                  first: () => Promise.resolve(null),
                };
              },
              all: () => Promise.resolve({ results: [] }),
              run: () => Promise.resolve({ success: true }),
              first: () => Promise.resolve(null),
            };
          }),
        },
      };

      const res = await worker.fetch(
        new Request("http://localhost/api/admin/passwords", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-password": "MasterAdminPassword123!",
          },
          body: JSON.stringify({
            name: "Test Client",
            password: "SecurePassword123!",
            maxStocks: "0",
            maxIndices: "0",
          }),
        }),
        mockEnv as any,
      );

      expect(res.status).toBe(201);
      expect(insertedMaxStocks).toBeNull();
      expect(insertedMaxIndices).toBeNull();
    });
  });
});
