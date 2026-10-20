import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveStockTicker } from "./navigation";
import {
  fetchUpcomingEvents,
  type StockQuoteFundamentals,
  type CalendarEvent,
} from "./marketDataService";
import {
  fetchLiveScreenerUniverse,
  resetLastKnownScreenerUniverse,
} from "../../worker/internal";

describe("Comprehensive Project Code Review & Goal Fulfillment Tests", () => {
  beforeEach(() => {
    resetLastKnownScreenerUniverse();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // The fetch stub of a test is removed again, so no test can observe the
    // network double of another test.
    vi.unstubAllGlobals();
  });

  describe("1. URL Navigation and Ticker Normalization Hardening", () => {
    it("resolves ticker symbols containing underscores (e.g. BRK_A)", () => {
      expect(resolveStockTicker("/stock", "?ticker=BRK_A")).toBe("BRK_A");
      expect(resolveStockTicker("/stock/BRK_A", "")).toBe("BRK_A");
      expect(resolveStockTicker("/stock/BF_B", "")).toBe("BF_B");
    });

    it("normalizes lowercase ticker symbols in search query to uppercase", () => {
      expect(resolveStockTicker("/stock", "?ticker=nvda")).toBe("NVDA");
      expect(resolveStockTicker("/stock", "?ticker=aapl")).toBe("AAPL");
      expect(resolveStockTicker("/stock", "?ticker=usdjpy=x")).toBe("USDJPY=X");
    });

    it("normalizes lowercase ticker symbols in path segments to uppercase", () => {
      expect(resolveStockTicker("/stock/nvda", "")).toBe("NVDA");
      expect(resolveStockTicker("/stock/7203", "")).toBe("7203");
      expect(resolveStockTicker("/stock/btc-usd", "")).toBe("BTC-USD");
    });

    it("supports ticker symbols up to 20 characters", () => {
      const longTicker = "12345678901234567890"; // 20 chars
      expect(resolveStockTicker("/stock", `?ticker=${longTicker}`)).toBe(longTicker);
      expect(resolveStockTicker(`/stock/${longTicker}`, "")).toBe(longTicker);

      const tooLongTicker = "123456789012345678901"; // 21 chars
      expect(resolveStockTicker("/stock", `?ticker=${tooLongTicker}`)).toBeUndefined();
    });

    it("correctly rejects invalid ticker symbols", () => {
      expect(resolveStockTicker("/stock", "?ticker=<script>")).toBeUndefined();
      expect(resolveStockTicker("/stock", "?ticker=invalid/slash")).toBeUndefined();
      expect(resolveStockTicker("/stock", "?ticker=drop table")).toBeUndefined();
    });
  });

  describe("2. Screener Universe Fallback & isDemoData Flag Propagation", () => {
    it("propagates isDemoData flag on screener items when live quote is unavailable", async () => {
      // The Worker asks Yahoo for the quotes. The stub below fails every
      // request, so the universe must be built from the local fallbacks -
      // deterministically, without reaching the network.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Network offline");
        }),
      );

      const universe = await fetchLiveScreenerUniverse(null);

      expect(universe.length).toBeGreaterThan(0);
      for (const item of universe) {
        expect(item.ticker).toBeDefined();
        expect(typeof item.price).toBe("number");
        // When live quotes are not fetched, items derived from fallback get isDemoData: true
        expect(item.isDemoData).toBe(true);
      }
    });

    it("preserves isDemoData flag from previous universe when network is down", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Network offline");
        }),
      );

      const mockPrev: StockQuoteFundamentals[] = [
        {
          ticker: "7203",
          name: "トヨタ自動車",
          theme: "自動車",
          sector: "輸送用機器",
          market: "PRIME",
          price: 2800,
          change: 20,
          changePercent: 0.72,
          volume: 5000000,
          previousClose: 2780,
          dayHigh: 2820,
          dayLow: 2770,
          yearHigh: 3900,
          yearLow: 2400,
          marketCap: 450000,
          per: 8.5,
          pbr: 1.1,
          dividendYield: 3.2,
          roe: 14.5,
          equityRatio: 58.0,
          eps: 320,
          dps: 90,
          technicalSignal: "BUY",
          isDemoData: true,
          historicalFinances: [],
        },
      ];

      const result = await fetchLiveScreenerUniverse(mockPrev);
      const toyota = result.find((s) => s.ticker === "7203");
      // The ticker must be part of the universe before its flag is asserted.
      expect(toyota).toBeDefined();
      expect(toyota!.isDemoData).toBe(true);
    });
  });

  describe("3. Client Calendar Data Fetching in Varied Environments", () => {
    it("canFetch condition gracefully fetches and returns calendar events when fetch is mocked", async () => {
      const mockEvents: CalendarEvent[] = [
        {
          id: "test-event-1",
          date: "10/28",
          fullDate: "2026-10-28",
          type: "EARNINGS",
          title: "テスト決算発表",
          ticker: "7203",
          importance: "HIGH",
        },
      ];

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(mockEvents), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      );

      const events = await fetchUpcomingEvents(true);
      expect(events).toBeDefined();
      expect(events.length).toBe(1);
      expect(events[0].id).toBe("test-event-1");
    });

    it("falls back to generated upcoming events when network fetch throws", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Network offline");
        }),
      );

      const events = await fetchUpcomingEvents(true);
      expect(events).toBeDefined();
      expect(events.length).toBeGreaterThan(0);
      // Fallback events have source: fallback
      expect(events.every((e) => e.source === "fallback")).toBe(true);
    });
  });

  describe("4. UI Accessibility and Keyboard Interaction Hardening", () => {
    it("verifies MarketOverviewPage asset cards are interactive with keyboard and navigation support", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const marketOverviewPath = path.resolve(__dirname, "../components/MarketOverviewPage.tsx");
      const code = fs.readFileSync(marketOverviewPath, "utf-8");

      expect(code).toContain('role="button"');
      expect(code).toContain("tabIndex={0}");
      expect(code).toContain("onOpenStockDetail(asset.symbol)");
      expect(code).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?onOpenStockDetail\(asset\.symbol\)/);
      expect(code).toContain("cursor: \"pointer\"");
    });

    it("verifies ScreenerPage displays demo data badge and isolates checkbox keydown events", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const screenerPath = path.resolve(__dirname, "../components/ScreenerPage.tsx");
      const code = fs.readFileSync(screenerPath, "utf-8");

      expect(code).toContain("stock.isDemoData");
      expect(code).toContain("参考値");
      expect(code).toMatch(/onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?e\.stopPropagation\(\)/);
    });
  });
});
