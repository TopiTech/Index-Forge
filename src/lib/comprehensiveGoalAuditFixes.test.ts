import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetPasswordTableEnsured,
  ensurePasswordTable,
} from "../../worker/index";
import { DEFAULT_INDICES, SYSTEM_INDICES } from "../data/indices";
import { getTickerBasePrice } from "../hooks/useSimulation";

beforeEach(() => {
  resetPasswordTableEnsured();
  vi.restoreAllMocks();
});

describe("Comprehensive Goal Audit Fixes: D1 Self-Healing Schema", () => {
  it("ensures stock_series table is created if not exists during ensurePasswordTable", async () => {
    const executedQueries: string[] = [];

    const mockEnv = {
      ADMIN_PASSWORD: "test-admin-password",
      DB: {
        prepare: vi.fn().mockImplementation((query: string) => ({
          bind: vi.fn().mockReturnValue({
            all: async () => ({ results: [] }),
            run: async () => {
              executedQueries.push(query.trim());
              return { success: true };
            },
          }),
          all: async () => ({ results: [] }),
          run: async () => {
            executedQueries.push(query.trim());
            return { success: true };
          },
        })),
        batch: vi.fn().mockResolvedValue([]),
      },
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      },
    };

    // @ts-expect-error Mock env
    await ensurePasswordTable(mockEnv);

    const hasStockSeries = executedQueries.some((q) =>
      q.includes("CREATE TABLE IF NOT EXISTS stock_series"),
    );
    expect(hasStockSeries).toBe(true);

    const stockSeriesQuery = executedQueries.find((q) =>
      q.includes("CREATE TABLE IF NOT EXISTS stock_series"),
    );
    expect(stockSeriesQuery).toContain("ticker TEXT PRIMARY KEY");
    expect(stockSeriesQuery).toContain("prices TEXT NOT NULL");
    expect(stockSeriesQuery).toContain("updated_at INTEGER NOT NULL");
  });
});

describe("Comprehensive Goal Audit Fixes: DEFAULT_INDICES & SYSTEM_INDICES Parity", () => {
  it("preserves DEFAULT_INDICES[0] as ai-semi for backward compatibility", () => {
    expect(DEFAULT_INDICES[0].id).toBe("ai-semi");
  });

  it("includes eroge-index in DEFAULT_INDICES matching SYSTEM_INDICES", () => {
    const erogeIndex = DEFAULT_INDICES.find((idx) => idx.id === "eroge-index");
    expect(erogeIndex).toBeDefined();
    expect(erogeIndex?.name).toBe("完全エロゲ指数（EROGE Index）");
    expect(erogeIndex?.baseValue).toBe(1000);
    expect(erogeIndex?.basket).toHaveLength(7);

    const totalWeight = erogeIndex?.basket.reduce(
      (sum, item) => sum + item.weight,
      0,
    );
    expect(totalWeight).toBe(100);

    const tickers = erogeIndex?.basket.map((item) => item.ticker);
    expect(tickers).toEqual([
      "2681",
      "7803",
      "3657",
      "3791",
      "2652",
      "9468",
      "4751",
    ]);
  });

  it("ensures all SYSTEM_INDICES exist in DEFAULT_INDICES", () => {
    const defaultIds = new Set(DEFAULT_INDICES.map((idx) => idx.id));

    for (const sysId of SYSTEM_INDICES) {
      expect(defaultIds.has(sysId)).toBe(true);
    }
  });

  it("ensures all DEFAULT_INDICES have valid weights and components", () => {
    for (const index of DEFAULT_INDICES) {
      expect(index.id).toBeTruthy();
      expect(index.name).toBeTruthy();
      expect(index.baseValue).toBeGreaterThan(0);
      expect(index.basket.length).toBeGreaterThan(0);

      const totalWeight = index.basket.reduce((s, c) => s + c.weight, 0);
      expect(totalWeight).toBeGreaterThan(0);

      for (const c of index.basket) {
        expect(c.ticker).toBeTruthy();
        expect(c.name).toBeTruthy();
        expect(c.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("Comprehensive Goal Audit Fixes: useSimulation getTickerBasePrice Normalization", () => {
  it("resolves known ticker base prices accurately", () => {
    expect(getTickerBasePrice("7203")).toBe(2850);
    expect(getTickerBasePrice("9984")).toBe(9150);
    expect(getTickerBasePrice("6758")).toBe(3220);
    expect(getTickerBasePrice("6920")).toBe(21500);
  });

  it("normalizes .T suffix, whitespace, and lowercase characters", () => {
    expect(getTickerBasePrice("7203.T")).toBe(2850);
    expect(getTickerBasePrice(" 7203.t ")).toBe(2850);
    expect(getTickerBasePrice("9984.T")).toBe(9150);
    expect(getTickerBasePrice(" 6758 ")).toBe(3220);
  });

  it("deterministically calculates base price for unknown tickers within expected bounds", () => {
    const price1 = getTickerBasePrice("9999");
    const price2 = getTickerBasePrice(" 9999.T ");
    expect(price1).toBe(price2);
    expect(price1).toBeGreaterThanOrEqual(1000);
    expect(price1).toBeLessThan(5000);
  });
});
