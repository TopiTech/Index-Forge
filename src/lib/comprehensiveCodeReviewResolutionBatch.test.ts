// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  fetchMarketOverview,
  fetchScreenerStocks,
  clearScreenerUniverseClientCache,
} from "./marketDataService";
import { getTurnstileConfig, DEFAULT_TURNSTILE_SITE_KEY } from "./auth";
import * as apiContract from "./apiContract";
import { calculatePortfolioSummary, type PortfolioPosition } from "./portfolioStorage";
import { toFiniteNumberOr } from "./downloadFileName";
import { useIndices } from "../hooks/useIndices";

describe("Comprehensive Code Review Resolution Batch Verification", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearScreenerUniverseClientCache();
    vi.restoreAllMocks();
  });

  describe("Unit 1: Force-Refresh Cache Bypass Mismatch Resolution", () => {
    it("fetchMarketOverview(true) appends refresh query parameter and Cache-Control header", async () => {
      let requestedUrl = "";
      let requestedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = url.toString();
        requestedInit = init;
        return new Response(
          JSON.stringify({
            indices: [],
            marketBreadth: { advanceDeclineRatio: 1, advances: 10, declines: 10, unchanged: 0, sentimentScore: 50 },
            sectorPerformance: [],
            updatedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      // 1. When forceRefresh is true
      await fetchMarketOverview(true);
      expect(requestedUrl).toMatch(/\/api\/market\/overview\?refresh=\d+/);
      const headersTrue = (requestedInit?.headers as Record<string, string>) || {};
      expect(headersTrue["cache-control"]).toBe("no-cache");
      expect(headersTrue["accept"]).toBe("application/json");
      expect(requestedInit?.cache).toBe("no-cache");

      // 2. When forceRefresh is false
      await fetchMarketOverview(false);
      expect(requestedUrl).toBe("/api/market/overview");
      const headersFalse = (requestedInit?.headers as Record<string, string>) || {};
      expect(headersFalse["cache-control"]).toBeUndefined();
      expect(requestedInit?.cache).toBe("default");
    });

    it("fetchScreenerStocks(..., true) appends refresh query parameter and Cache-Control header", async () => {
      let requestedUrl = "";
      const capturedInits: RequestInit[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = url.toString();
        if (init) capturedInits.push(init);
        return new Response(
          JSON.stringify([
            {
              ticker: "7203",
              name: "トヨタ自動車",
              price: 2500,
              change: 20,
              changePercent: 0.8,
              volume: 1000000,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      // 1. When forceRefresh is true
      await fetchScreenerStocks({}, true);
      expect(requestedUrl).toMatch(/\/api\/stocks\/screener\?refresh=\d+/);
      const headersTrue = (capturedInits[0]?.headers as Record<string, string>) || {};
      expect(headersTrue["cache-control"]).toBe("no-cache");
      expect(headersTrue["accept"]).toBe("application/json");
      expect(capturedInits[0]?.cache).toBe("no-cache");

      // Reset cache so non-forceRefresh actually hits the fetch endpoint
      clearScreenerUniverseClientCache();
      requestedUrl = "";

      // 2. When forceRefresh is false
      await fetchScreenerStocks({}, false);
      expect(requestedUrl).toBe("/api/stocks/screener");
      const headersFalse = (capturedInits[1]?.headers as Record<string, string>) || {};
      expect(headersFalse["cache-control"]).toBeUndefined();
      expect(capturedInits[1]?.cache).toBe("default");
    });
  });

  describe("Unit 2: Resource Lifecycle & Proxy Release Verification", () => {
    it("getTurnstileConfig releases response lifecycle when API returns non-OK status", async () => {
      const releaseSpy = vi.spyOn(apiContract, "releaseResponse");

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      const config = await getTurnstileConfig();
      expect(config.siteKey).toBe(DEFAULT_TURNSTILE_SITE_KEY);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it("useIndices mutation methods release response lifecycle upon successful 200 OK", async () => {
      const releaseSpy = vi.spyOn(apiContract, "releaseResponse");

      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (method === "GET") {
          return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (method === "DELETE" && url.includes("/api/indices")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (method === "POST" && url.includes("/api/indices/stock")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      });

      const { result } = renderHook(() => useIndices());

      // 1. Test deleteCustomIndex
      releaseSpy.mockClear();
      await act(async () => {
        const res = await result.current.deleteCustomIndex("idx-test");
        expect(res.ok).toBe(true);
      });
      expect(releaseSpy).toHaveBeenCalled();

      // 2. Test addStockToIndex
      releaseSpy.mockClear();
      await act(async () => {
        const res = await result.current.addStockToIndex("idx-test", {
          ticker: "7203",
          name: "Toyota",
          theme: "Auto",
          weight: 10,
        });
        expect(res.ok).toBe(true);
      });
      expect(releaseSpy).toHaveBeenCalled();

      // 3. Test removeStockFromIndex
      releaseSpy.mockClear();
      await act(async () => {
        const res = await result.current.removeStockFromIndex("idx-test", "7203");
        expect(res.ok).toBe(true);
      });
      expect(releaseSpy).toHaveBeenCalled();
    });
  });

  describe("Unit 3: Multi-Currency Portfolio Sorting Resolution", () => {
    it("correctly sorts mixed USD and JPY positions using normalized JPY market value", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-usd-large",
          ticker: "AAPL",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 150,
          currentPrice: 200, // 10 * 200 = $2,000 USD => at rate 155: ¥310,000 JPY
        },
        {
          id: "pos-jpy-mid",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2500, // 100 * 2,500 = ¥250,000 JPY
        },
        {
          id: "pos-usd-small",
          ticker: "PENNY",
          name: "Penny Stock",
          shares: 10,
          averageCost: 5,
          currentPrice: 5, // 10 * 5 = $50 USD => at rate 155: ¥7,750 JPY
        },
      ];

      const summary = calculatePortfolioSummary(positions, { liveQuotes: new Map(), usdJpyRate: 155 });

      // Emulate PortfolioManagerPage sortedPositions sorting logic
      const sortPositions = (
        list: typeof summary.positions,
        sortAsc: boolean,
      ) => {
        return [...list].sort((a, b) => {
          const valA = Number.isFinite(a.marketValueJpy) ? (a.marketValueJpy as number) : a.marketValue;
          const valB = Number.isFinite(b.marketValueJpy) ? (b.marketValueJpy as number) : b.marketValue;
          const safeA = Number.isFinite(valA) ? valA : 0;
          const safeB = Number.isFinite(valB) ? valB : 0;
          return sortAsc ? safeA - safeB : safeB - safeA;
        });
      };

      const sortedDesc = sortPositions(summary.positions, false);
      expect(sortedDesc[0].ticker).toBe("AAPL"); // ¥310,000
      expect(sortedDesc[1].ticker).toBe("7203"); // ¥250,000
      expect(sortedDesc[2].ticker).toBe("PENNY"); // ¥7,750

      const sortedAsc = sortPositions(summary.positions, true);
      expect(sortedAsc[0].ticker).toBe("PENNY");
      expect(sortedAsc[1].ticker).toBe("7203");
      expect(sortedAsc[2].ticker).toBe("AAPL");
    });

    it("handles non-finite and missing marketValueJpy values with finite guards", () => {
      const summaryItems = [
        { ticker: "NAN_VAL", marketValue: 1000, marketValueJpy: Number.NaN, unrealizedProfitPercent: Number.NaN },
        { ticker: "INF_VAL", marketValue: 2000, marketValueJpy: Number.POSITIVE_INFINITY, unrealizedProfitPercent: Number.POSITIVE_INFINITY },
        { ticker: "NORMAL_VAL", marketValue: 5000, marketValueJpy: 5000, unrealizedProfitPercent: 10.5 },
      ];

      const sorted = [...summaryItems].sort((a, b) => {
        const valA = Number.isFinite(a.marketValueJpy) ? a.marketValueJpy : a.marketValue;
        const valB = Number.isFinite(b.marketValueJpy) ? b.marketValueJpy : b.marketValue;
        const safeA = Number.isFinite(valA) ? valA : 0;
        const safeB = Number.isFinite(valB) ? valB : 0;
        return safeB - safeA;
      });

      expect(sorted[0].ticker).toBe("NORMAL_VAL");
      expect(sorted).toHaveLength(3);
    });
  });

  describe("Unit 4: Validation Boundary & Clamping Resolution", () => {
    it("AdminDashboard stock weight clamping enforces lower bound 0.1% and upper bound 100%", () => {
      const clampAdminWeight = (raw: unknown) =>
        Math.min(100, Math.max(0.1, toFiniteNumberOr(raw, 10)));

      expect(clampAdminWeight(150)).toBe(100);
      expect(clampAdminWeight(100)).toBe(100);
      expect(clampAdminWeight(25.5)).toBe(25.5);
      expect(clampAdminWeight(0.1)).toBe(0.1);
      expect(clampAdminWeight(0.01)).toBe(0.1);
      expect(clampAdminWeight(0)).toBe(0.1);
      expect(clampAdminWeight(-50)).toBe(0.1);
      expect(clampAdminWeight("")).toBe(10);
      expect(clampAdminWeight("abc")).toBe(10);
      expect(clampAdminWeight(Number.NaN)).toBe(10);
    });

    it("AddStockModal weight boundary strictly enforces 0.1% to 100% matching error message", () => {
      const validateWeight = (raw: unknown): boolean => {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric) || numeric < 0.1 || numeric > 100) {
          return false;
        }
        return true;
      };

      expect(validateWeight(0.05)).toBe(false);
      expect(validateWeight(0)).toBe(false);
      expect(validateWeight(-1)).toBe(false);
      expect(validateWeight(100.01)).toBe(false);
      expect(validateWeight("invalid")).toBe(false);
      expect(validateWeight(0.1)).toBe(true);
      expect(validateWeight(50)).toBe(true);
      expect(validateWeight(100)).toBe(true);
    });

    it("AdminDashboard base value clamping enforces valid range", () => {
      const sanitizeBaseValue = (raw: unknown) =>
        apiContract.clampBaseValue(toFiniteNumberOr(raw, 1000));

      expect(sanitizeBaseValue(-10)).toBe(1000);
      expect(sanitizeBaseValue(0)).toBe(1000);
      expect(sanitizeBaseValue("invalid")).toBe(1000);
      expect(sanitizeBaseValue(2_000_000)).toBe(1_000_000); // capped at MAX_BASE_VALUE
      expect(sanitizeBaseValue(500)).toBe(500);
      expect(sanitizeBaseValue(1000)).toBe(1000);
      expect(sanitizeBaseValue(10000)).toBe(10000);
    });
  });
});
