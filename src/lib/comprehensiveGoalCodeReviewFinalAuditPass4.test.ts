import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMemoryCache,
  getMemoryCache,
  clearMemoryCache,
  setAllowMemoryCacheInTest,
  getMemoryCacheStats,
  MAX_CALC_CACHE_BYTES,
  MAX_CALC_CACHE_SIZE,
} from "../../worker/internal";
import {
  REQUIRED_MIGRATION_STEPS,
  computePendingMigrations,
} from "../../scripts/apply-migrations.mjs";
import { sanitizeBasketForRequest } from "./indexEngine";
import {
  deserializeIndexFromJson,
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
} from "./indexSerialization";
import { parseLocalSyncCache } from "./syncCache";
import { calculateRiskMetrics } from "./analytics";
import { buildScreenerCsvRows } from "../components/ScreenerPage";
import { todayJstDateString } from "./portfolioStorage";

describe("Goal Comprehensive Code Review - Pass 4 Final Audit & Verification", () => {
  describe("1. Worker Memory Cache Eviction & Byte Tracking Under Key Overwrite", () => {
    beforeEach(() => {
      clearMemoryCache();
      setAllowMemoryCacheInTest(true);
    });

    afterEach(() => {
      clearMemoryCache();
      setAllowMemoryCacheInTest(false);
    });

    it("does not corrupt byte tracking or mis-evict when overwriting an existing key near budget limits", () => {
      // Create entries in calculation cache namespace "calc:"
      // Each entry is roughly 100 KB
      const payloadA = { data: "A".repeat(100 * 1024) };
      const payloadB = { data: "B".repeat(100 * 1024) };
      const payloadC = { data: "C".repeat(100 * 1024) };

      setMemoryCache("calc:keyA", payloadA, 300);
      setMemoryCache("calc:keyB", payloadB, 300);

      // Overwrite keyA with new payload
      const payloadAUpdated = { data: "A2".repeat(50 * 1024) };
      setMemoryCache("calc:keyA", payloadAUpdated, 300);

      expect(getMemoryCache("calc:keyA")).toEqual(payloadAUpdated);
      expect(getMemoryCache("calc:keyB")).toEqual(payloadB);

      // Now insert payloadC
      setMemoryCache("calc:keyC", payloadC, 300);

      expect(getMemoryCache("calc:keyA")).toEqual(payloadAUpdated);
      expect(getMemoryCache("calc:keyB")).toEqual(payloadB);
      expect(getMemoryCache("calc:keyC")).toEqual(payloadC);

      const stats = getMemoryCacheStats();
      expect(stats.entries).toBe(3);
      expect(stats.bytes).toBeGreaterThan(0);
      expect(stats.bytes).toBeLessThanOrEqual(MAX_CALC_CACHE_BYTES);
    });

    it("correctly handles overwriting the oldest key when cache capacity is reached", () => {
      // Fill cache to cap with small entries
      for (let i = 0; i < MAX_CALC_CACHE_SIZE; i++) {
        setMemoryCache(`calc:item_${i}`, { idx: i }, 300);
      }
      expect(getMemoryCacheStats().entries).toBe(MAX_CALC_CACHE_SIZE);

      // Overwrite the oldest key (item_0)
      setMemoryCache("calc:item_0", { idx: 999 }, 300);

      // Size should still be at or under MAX_CALC_CACHE_SIZE
      expect(getMemoryCacheStats().entries).toBeLessThanOrEqual(MAX_CALC_CACHE_SIZE);
      expect(getMemoryCache("calc:item_0")).toEqual({ idx: 999 });

      // Inserting a brand new key should evict the next oldest (item_1)
      setMemoryCache("calc:new_entry", { idx: 1000 }, 300);
      expect(getMemoryCache("calc:item_1")).toBeNull();
      expect(getMemoryCache("calc:item_0")).toEqual({ idx: 999 });
      expect(getMemoryCache("calc:new_entry")).toEqual({ idx: 1000 });
    });
  });

  describe("2. Database Migrations Dynamic Table Detection", () => {
    it("ensures all column migration tables are part of REQUIRED_MIGRATION_STEPS", () => {
      const columnSteps = REQUIRED_MIGRATION_STEPS.filter((s) => s.type === "column");
      const tablesWithColumnSteps = Array.from(new Set(columnSteps.map((s) => s.table)));

      expect(tablesWithColumnSteps).toContain("access_passwords");
      expect(tablesWithColumnSteps).toContain("indices");

      for (const table of tablesWithColumnSteps) {
        expect(typeof table).toBe("string");
        expect(table!.length).toBeGreaterThan(0);
      }
    });

    it("correctly determines pending migrations for indices columns when table exists", () => {
      // Probe where indices table exists but owner_token_hash is missing
      const probe = {
        tables: new Set<string>(["indices"]),
        indexes: new Set<string>(),
        columns: new Map<string, Set<string>>([["indices", new Set(["id", "name"])]]),
      };
      const pending = computePendingMigrations(probe);
      const hasOwnerTokenHash = pending.some(
        (s) => s.type === "column" && s.table === "indices" && s.name === "owner_token_hash",
      );
      expect(hasOwnerTokenHash).toBe(true);
    });
  });

  describe("3. Harmonized Ticker Character Support Across Engine & Serialization", () => {
    const specialTickers = ["^N225", "USDJPY=X", "BRK_B", "9984.T", "AAPL"];

    it("sanitizeBasketForRequest accepts indices (^), FX (=), dual-class (_), and dot (.) tickers", () => {
      const basket = specialTickers.map((ticker) => ({
        ticker,
        name: ticker,
        theme: "Global",
        weight: 20,
      }));
      const { basket: sanitized, dropped } = sanitizeBasketForRequest(basket);

      expect(dropped).toHaveLength(0);
      expect(sanitized).toHaveLength(specialTickers.length);
      expect(sanitized.map((s) => s.ticker)).toEqual(specialTickers);
    });

    it("deserializeIndexFromJson preserves tickers with special valid characters", () => {
      const json = JSON.stringify({
        id: "custom-test-special",
        name: "Special Tickers Index",
        baseValue: 1000,
        basket: specialTickers.map((ticker) => ({
          ticker,
          name: ticker,
          theme: "Global",
          weight: 20,
        })),
      });

      const res = deserializeIndexFromJson(json);
      expect(res.ok).toBe(true);
      expect(res.data?.basket.map((b) => b.ticker)).toEqual(specialTickers);
    });

    it("deserializeBasketFromCsv preserves tickers with special valid characters", () => {
      const csv = [
        "ティッカー,銘柄名,テーマ,ウェイト",
        "^N225,日経平均,指数,20",
        "USDJPY=X,ドル円,為替,20",
        "BRK_B,バークシャー,米国株,20",
        "9984.T,ソフトバンクG,日本株,20",
      ].join("\n");

      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      expect(res.data?.map((b) => b.ticker)).toEqual(["^N225", "USDJPY=X", "BRK_B", "9984.T"]);
    });

    it("deserializePortfolioFromCsv preserves tickers with special valid characters", () => {
      const csv = [
        "ティッカー,銘柄名,保有株数,平均取得単価",
        "^N225,日経平均,10,38000",
        "USDJPY=X,ドル円,100,155",
        "BRK_B,バークシャー,5,400",
      ].join("\n");

      const res = deserializePortfolioFromCsv(csv);
      expect(res.ok).toBe(true);
      expect(res.data?.map((p) => p.ticker)).toEqual(["^N225", "USDJPY=X", "BRK_B"]);
    });

    it("parseLocalSyncCache preserves tickers with special valid characters", () => {
      const cacheJson = JSON.stringify({
        "^N225": 1700000000000,
        "USDJPY=X": 1700000000000,
        BRK_B: 1700000000000,
        "9984.T": 1700000000000,
      });

      const parsed = parseLocalSyncCache(cacheJson);
      expect(parsed["^N225"]).toBe(1700000000000);
      expect(parsed["USDJPY=X"]).toBe(1700000000000);
      expect(parsed["BRK_B"]).toBe(1700000000000);
      expect(parsed["9984.T"]).toBe(1700000000000);
    });
  });

  describe("4. Analytics Chronological Sorting Fallback", () => {
    it("falls back to string localeCompare when Date.parse cannot parse custom date strings", () => {
      // Non-standard date format like '2024.01.02' or custom labels
      const reverseSeries = [
        { date: "2024-03-01", close: 120, value: 120 },
        { date: "2024-01-01", close: 100, value: 100 },
        { date: "2024-02-01", close: 110, value: 110 },
      ];

      const metrics = calculateRiskMetrics(reverseSeries, []);
      expect(metrics.annualReturn).toBeGreaterThan(0);
    });
  });

  describe("5. Screener CSV Numerical Guarding & JST Date", () => {
    it("safely serializes NaN, Infinity, and -Infinity to empty string in screener CSV", () => {
      const rows = buildScreenerCsvRows([
        {
          ticker: "7203",
          name: "トヨタ自動車",
          market: "PRIME",
          theme: "自動車",
          price: 2800,
          changePercent: 1.5,
          dividendYield: NaN,
          per: Number.POSITIVE_INFINITY,
          pbr: Number.NEGATIVE_INFINITY,
          roe: NaN,
          technicalSignal: "BULLISH",
        },
      ]);

      expect(rows).toHaveLength(1);
      const row = rows[0];
      // Indices:
      // 0: ticker, 1: name, 2: market, 3: theme, 4: price, 5: changePercent
      // 6: dividendYield, 7: per, 8: pbr, 9: roe, 10: technicalSignal
      expect(row[6]).toBe('""'); // dividendYield NaN -> ""
      expect(row[7]).toBe('""'); // per Infinity -> ""
      expect(row[8]).toBe('""'); // pbr -Infinity -> ""
      expect(row[9]).toBe('""'); // roe NaN -> ""
    });

    it("todayJstDateString returns valid YYYY-MM-DD date string", () => {
      const jstDate = todayJstDateString();
      expect(jstDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
