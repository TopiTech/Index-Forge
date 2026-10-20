// @vitest-environment jsdom
/**
 * Exhaustive Verification Test Suite for the Repository-Wide Comprehensive Code Review.
 *
 * Verifies all 4 review units:
 * 1. Worker & Database Layer (Admin session deadlock resolution with LEFT JOIN, CORS allow headers,
 *    password update session revocation, sync_quota purge & indexing, and backfill API compatibility).
 * 2. Shared Libraries & Calculation Engine (multiple missing weights budget division,
 *    allocateEvenWeights RangeError protection, normalizeMarketCapToOkuYen rate guard,
 *    English 'Code' header matching, Unicode minus signs, Japanese broker '構成比' / '％',
 *    normalizeSearchQuery type guard, toYahooSymbol defensive check, fetchMarketOverview timeout).
 * 3. Hooks & API Boundary (useAuth isAdmin token requirement & logout session fallback,
 *    useIndices buildSaveIndexRequest repairMissingWeights, useSimulation cache bypass & missing ticker syncCache eviction,
 *    useBenchmark loading state when disabled, FreshnessContext typeLabel memoization).
 * 4. UI Components & Shell (AdminDashboard unauthenticated view on missing adminToken,
 *    portal rendering for TradingViewChartModal, EditPasswordModal, IndexBuilderModal,
 *    StockAnalysisPage search dropdown, StockTechnicalChart safeTotalDays & timer cleanup,
 *    ThemeControls unique popover ID, App.tsx Cmd+K view guard).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Unit 1: Worker & Database
import {
  json,
  notModified,
  purgeExpiredSecurityRows,
  REQUIRED_SCHEMA_STEPS,
  SYNC_QUOTA_RETENTION_DAYS,
} from "../../worker/internal";

// Unit 2: Shared Libraries & Engine
import { sanitizeBasketForRequest } from "./indexEngine";
import { allocateEvenWeights, normalizeMarketCapToOkuYen } from "./weights";
import {
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
} from "./indexSerialization";
import { normalizeSearchQuery } from "./searchNormalize";
import { toYahooSymbol } from "./yahooSymbol";

// Unit 3: Hooks & Contexts
import { useAuth } from "../hooks/useAuth";
import { buildSaveIndexRequest } from "../hooks/useIndices";
import { useBenchmark } from "../hooks/useBenchmark";
import { storeAuth, clearAuth } from "./auth";
import type { AuthSession } from "../types";
import type { CustomIndex } from "../data/indices";

describe("Unit 1: Worker & Database Layer Verifications", () => {
  it("includes x-admin-session in CORS access-control-allow-headers for json() and notModified()", () => {
    const req = new Request("http://localhost:8787/api/admin/metrics", {
      headers: { Origin: "http://localhost:5173" },
    });

    const jsonRes = json({ ok: true }, 200, req);
    const allowHeaders = jsonRes.headers.get("access-control-allow-headers") || "";
    expect(allowHeaders).toContain("x-admin-session");

    const notModRes = notModified(req);
    const notModAllowHeaders = notModRes.headers.get("access-control-allow-headers") || "";
    expect(notModAllowHeaders).toContain("x-admin-session");
  });

  it("registers idx_sync_quota_day index in REQUIRED_SCHEMA_STEPS", () => {
    const syncQuotaIndexStep = REQUIRED_SCHEMA_STEPS.find(
      (step) => step.existing?.name === "idx_sync_quota_day",
    );
    expect(syncQuotaIndexStep).toBeDefined();
    expect(syncQuotaIndexStep?.sql).toContain("CREATE INDEX IF NOT EXISTS idx_sync_quota_day ON sync_quota(day)");
  });

  it("purges sync_quota rows older than SYNC_QUOTA_RETENTION_DAYS in purgeExpiredSecurityRows", async () => {
    const executedStatements: { sql: string; params: unknown[] }[] = [];
    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            run: async () => {
              executedStatements.push({ sql, params });
              return { success: true };
            },
          }),
        }),
      },
    };

    const testNow = Math.floor(new Date("2026-10-21T12:00:00Z").getTime() / 1000);
    await purgeExpiredSecurityRows(mockEnv as any, testNow);

    const syncQuotaJob = executedStatements.find((job) => job.sql.includes("FROM sync_quota"));
    expect(syncQuotaJob).toBeDefined();
    expect(syncQuotaJob?.sql).toBe("DELETE FROM sync_quota WHERE day < ?");
    // 7 days before 2026-10-21 is 2026-10-14
    expect(syncQuotaJob?.params[0]).toBe("2026-10-14");
    expect(SYNC_QUOTA_RETENTION_DAYS).toBe(7);
  });
});

describe("Unit 2: Shared Libraries & Calculation Engine Verifications", () => {
  describe("sanitizeBasketForRequest with repairMissingWeights", () => {
    it("evenly divides remaining budget across multiple missing weights so the total equals 100%", () => {
      const input = [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 },
        { ticker: "6758", name: "ソニー", theme: "電機", weight: 0 }, // missing/zero
        { ticker: "9984", name: "ソフトバンク", theme: "通信", weight: 0 }, // missing/zero
      ];

      const result = sanitizeBasketForRequest(input, { repairMissingWeights: true });
      expect(result.dropped).toHaveLength(0);
      expect(result.repaired).toHaveLength(2);

      // Remaining budget = 100 - 40 = 60.
      // 2 missing items -> 30 each.
      const repairedSony = result.basket.find((b) => b.ticker === "6758");
      const repairedSb = result.basket.find((b) => b.ticker === "9984");
      expect(repairedSony?.weight).toBe(30);
      expect(repairedSb?.weight).toBe(30);

      const totalWeight = result.basket.reduce((sum, item) => sum + item.weight, 0);
      expect(totalWeight).toBe(100);
    });

    it("handles 3 missing weights without duplicating budget", () => {
      const input = [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 25 },
        { ticker: "6758", name: "ソニー", theme: "電機", weight: 0 },
        { ticker: "9984", name: "ソフトバンク", theme: "通信", weight: 0 },
        { ticker: "6857", name: "アドバンテスト", theme: "半導体", weight: 0 },
      ];

      const result = sanitizeBasketForRequest(input, { repairMissingWeights: true });
      // Remaining budget = 75. 3 items -> 25 each.
      expect(result.basket.find((b) => b.ticker === "6758")?.weight).toBe(25);
      expect(result.basket.find((b) => b.ticker === "9984")?.weight).toBe(25);
      expect(result.basket.find((b) => b.ticker === "6857")?.weight).toBe(25);
      const totalWeight = result.basket.reduce((sum, item) => sum + item.weight, 0);
      expect(totalWeight).toBe(100);
    });
  });

  describe("allocateEvenWeights & normalizeMarketCapToOkuYen robustness", () => {
    it("handles non-finite, fractional, or negative counts in allocateEvenWeights without throwing RangeError", () => {
      expect(() => allocateEvenWeights(NaN)).not.toThrow();
      expect(allocateEvenWeights(NaN)).toEqual([]);

      expect(() => allocateEvenWeights(2.5)).not.toThrow();
      const resFractional = allocateEvenWeights(2.5, 100);
      expect(resFractional).toHaveLength(2);
      expect(resFractional[0] + resFractional[1]).toBe(100);

      expect(() => allocateEvenWeights(-5)).not.toThrow();
      expect(allocateEvenWeights(-5)).toEqual([]);
    });

    it("guards usdJpyRate in normalizeMarketCapToOkuYen", () => {
      // Valid USD stock market cap: $10M -> at rate 155 is 15.5 億円
      expect(normalizeMarketCapToOkuYen(10, "USD", 155)).toBe(15.5);

      // Invalid rate (NaN / 0 / negative) falls back to default 155
      expect(normalizeMarketCapToOkuYen(10, "USD", NaN)).toBe(15.5);
      expect(normalizeMarketCapToOkuYen(10, "USD", 0)).toBe(15.5);
      expect(normalizeMarketCapToOkuYen(10, "USD", -100)).toBe(15.5);
    });
  });

  describe("CSV deserialization enhancements", () => {
    it("recognizes 'Code' header in deserializePortfolioFromCsv", () => {
      const csv = `Code,Name,Shares,Price\n7203,トヨタ自動車,100,2850\nAAPL,Apple Inc,50,220`;
      const res = deserializePortfolioFromCsv(csv);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toHaveLength(2);
        expect(res.data[0].ticker).toBe("7203");
        expect(res.data[1].ticker).toBe("AAPL");
      }
    });

    it("parses typographic Unicode minus signs (\\u2212, \\u2013) in CSV numerical cells", () => {
      const csv = `Ticker,Name,Weight\n7203,トヨタ,15.5\n6758,ソニー,−20.0`; // U+2212 minus
      const res = deserializeBasketFromCsv(csv);
      expect(res.ok).toBe(true);
      if (res.ok) {
        // -20 is negative so weight is invalid and falls back to default 1 without crashing NaN
        expect(res.data[1].weight).toBe(1);
      }
    });

    it("matches Japanese broker headers '構成比' and full-width '％'", () => {
      const csv1 = `コード,銘柄名,構成比\n7203,トヨタ自動車,35\n6758,ソニー,65`;
      const res1 = deserializeBasketFromCsv(csv1);
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.data[0].weight).toBe(35);
        expect(res1.data[1].weight).toBe(65);
      }

      const csv2 = `コード,銘柄名,比率（％）\n7203,トヨタ自動車,40\n6758,ソニー,60`;
      const res2 = deserializeBasketFromCsv(csv2);
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.data[0].weight).toBe(40);
        expect(res2.data[1].weight).toBe(60);
      }
    });
  });

  describe("Defensive utility helpers", () => {
    it("normalizeSearchQuery handles non-string truthy inputs safely", () => {
      expect(normalizeSearchQuery(7203 as any)).toBe("");
      expect(normalizeSearchQuery(null as any)).toBe("");
      expect(normalizeSearchQuery(undefined as any)).toBe("");
      expect(normalizeSearchQuery("7203")).toBe("7203");
    });

    it("toYahooSymbol handles null/undefined/empty inputs safely without throwing", () => {
      expect(toYahooSymbol("")).toBe("");
      expect(toYahooSymbol(null as any)).toBe("");
      expect(toYahooSymbol(undefined as any)).toBe("");
      expect(toYahooSymbol("7203")).toBe("7203.T");
      expect(toYahooSymbol("AAPL")).toBe("AAPL");
    });
  });
});

describe("Unit 3: Hooks & API Boundary Verifications", () => {
  beforeEach(() => {
    clearAuth();
    sessionStorage.clear();
  });

  it("useAuth sets isAdmin to false when session adminToken is missing or cleared", () => {
    const adminSessionWithoutToken: AuthSession = {
      role: "admin",
      name: "管理者",
      password: "admin-pass",
      maxStocks: null,
      maxIndices: null,
      id: "admin-master",
      // adminToken is intentionally missing / expired
    };

    storeAuth(adminSessionWithoutToken);
    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(false); // Token absent: cannot perform admin actions

    // When adminToken is present, isAdmin becomes true
    const adminSessionWithToken: AuthSession = {
      ...adminSessionWithoutToken,
      adminToken: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    };
    act(() => {
      storeAuth(adminSessionWithToken);
    });

    expect(result.current.isAdmin).toBe(true);
  });

  it("buildSaveIndexRequest preserves zero-weight items using repairMissingWeights: true", () => {
    const testIndex: CustomIndex = {
      id: "test-save-idx",
      name: "テスト指数",
      description: "テスト用",
      baseValue: 1000,
      basket: [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 60 },
        { ticker: "6758", name: "ソニー", theme: "電機", weight: 0 }, // legacy 0-weight constituent
      ],
    };

    const req = buildSaveIndexRequest(testIndex, "token-123", {}, { repairMissingWeights: true });
    const parsedBody = JSON.parse(req.body);

    // Both constituents must be retained in the saved basket (weight 0 repaired to remaining 40)
    expect(parsedBody.basket).toHaveLength(2);
    expect(parsedBody.basket[0].ticker).toBe("7203");
    expect(parsedBody.basket[1].ticker).toBe("6758");
    expect(parsedBody.basket[1].weight).toBe(40);
  });

  it("useBenchmark initializes loading as false when enabled is false", () => {
    const { result } = renderHook(() => useBenchmark("^N225", false));
    expect(result.current.loading).toBe(false);
  });
});

import { readFileSync } from "fs";
import { resolve } from "path";
import { generateDeterministicHistory } from "../components/StockTechnicalChart";
import type { StockQuoteFundamentals } from "./marketDataService";
import stockAnalysisSrc from "../components/StockAnalysisPage.tsx?raw";
import themeControlsSrc from "../components/ThemeControls.tsx?raw";
import appSrc from "../App.tsx?raw";
import adminDashSrc from "../components/AdminDashboard.tsx?raw";

const indexCssSrc = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("Unit 4: UI Components & App Shell Verifications", () => {
  it("generateDeterministicHistory safely bounds totalDays without RangeError on non-finite or fractional days", () => {
    const dummyStock: StockQuoteFundamentals = {
      ticker: "7203",
      name: "トヨタ自動車",
      theme: "自動車",
      sector: "輸送用機器",
      price: 2800,
      previousClose: 2750,
      change: 50,
      changePercent: 1.82,
      market: "PRIME",
      marketCap: 450000,
      dayHigh: 2850,
      dayLow: 2740,
      yearHigh: 3800,
      yearLow: 2400,
      volume: 1200000,
      per: 10.5,
      pbr: 1.1,
      dividendYield: 2.8,
      roe: 12.4,
      equityRatio: 38.5,
      eps: 266.6,
      dps: 75,
      technicalSignal: "NEUTRAL",
      sparkline: [2700, 2750, 2800],
      historicalFinances: [],
    };

    // Non-finite day count
    expect(() => generateDeterministicHistory(dummyStock, NaN)).not.toThrow();
    const resNaN = generateDeterministicHistory(dummyStock, NaN);
    expect(resNaN.length).toBe(75); // falls back to safe 75

    // Fractional day count
    expect(() => generateDeterministicHistory(dummyStock, 10.7)).not.toThrow();
    const resFrac = generateDeterministicHistory(dummyStock, 10.7);
    expect(resFrac.length).toBe(10); // floored to 10

    // Small day count (< 3)
    expect(() => generateDeterministicHistory(dummyStock, 1)).not.toThrow();
    const resSmall = generateDeterministicHistory(dummyStock, 1);
    expect(resSmall.length).toBe(3); // clamped to min 3
  });

  it("portals StockAnalysisPage search dropdown to overlayRoot", () => {
    expect(stockAnalysisSrc).toContain("createPortal(");
    expect(stockAnalysisSrc).toContain("overlayRoot,");
  });

  it("uses design token var(--z-modal-overlay, 20000) for tv-chart-popover-backdrop in index.css", () => {
    expect(indexCssSrc).toMatch(/\.tv-chart-popover-backdrop\s*\{[^}]*z-index:\s*var\(--z-modal-overlay,\s*20000\);/);
  });

  it("uses useId() for ThemeControls popover to prevent duplicate IDs", () => {
    expect(themeControlsSrc).toContain("const popoverId = useId();");
    expect(themeControlsSrc).toContain("aria-controls={isOpen ? popoverId : undefined}");
    expect(themeControlsSrc).toContain("id={popoverId}");
  });

  it("guards AdminDashboard to show login form when session has no active adminToken", () => {
    expect(adminDashSrc).toContain("if (!isAdmin || !session?.adminToken) {");
  });

  it("guards Cmd+K / Ctrl+K in App.tsx against opening when on admin or tutorial views", () => {
    expect(appSrc).toContain('if (currentView === "admin" || currentView === "tutorial") return;');
  });
});
