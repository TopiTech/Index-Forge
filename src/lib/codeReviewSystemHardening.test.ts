import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../worker/index";
import type { AssetsBinding, D1Database } from "../../worker/internal";
import {
  setAllowMemoryCacheInTest,
  clearMemoryCache,
  clearMemoryRateLimits,
  fetchLiveMarketCalendar,
  fetchLiveMarketCalendarAsync,
  resetLastKnownCalendarEvents,
  resetYahooCrumbCache,
} from "../../worker/internal";
import {
  generateUpcomingEvents,
  type CalendarEvent,
} from "./marketDataService";

function createMockEnv() {
  return {
    ASSETS: { fetch: async () => new Response("OK") } as unknown as AssetsBinding,
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database,
  };
}

describe("System Hardening & Comprehensive Code Review Tests", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    resetLastKnownCalendarEvents();
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  describe("1. CalendarEvent fullDate and Year-Boundary Chronological Accuracy", () => {
    it("generates fullDate on all events in generateUpcomingEvents", () => {
      const refDate = new Date(2026, 9, 12);
      const events = generateUpcomingEvents(refDate);

      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.fullDate).toBeDefined();
        expect(e.fullDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Verify format matches date MM/DD
        const [_y, m, d] = e.fullDate!.split("-");
        expect(e.date).toBe(`${m}/${d}`);
      }
    });

    it("generates fullDate in worker fallback events", () => {
      const refDate = new Date(2026, 9, 12);
      const events = fetchLiveMarketCalendar(undefined, refDate);

      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.fullDate).toBeDefined();
        expect(e.fullDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("sorts events accurately across year boundary when evaluated in December", () => {
      // Evaluating in December 2026: events in Jan 2027 should be placed in 2027, after December
      const refDate = new Date(2026, 11, 20); // 2026-12-20
      const events = fetchLiveMarketCalendar(undefined, refDate);

      // Verify chronological ascending order
      for (let i = 0; i < events.length - 1; i++) {
        const timeA = new Date(events[i].fullDate!).getTime();
        const timeB = new Date(events[i + 1].fullDate!).getTime();
        expect(timeA).toBeLessThanOrEqual(timeB);
      }
    });
  });

  describe("2. US vs JP Market Cap and Importance Determination", () => {
    it("calculates marketCap in million USD for US stocks and 億円 for JP stocks", async () => {
      const refDate = new Date(2026, 9, 12);
      const earnTimestamp = Math.floor(Date.UTC(2026, 9, 28, 6, 0) / 1000);

      // 3.5T USD Apple, 35T JPY Toyota
      const mockQuoteResponse = {
        quoteResponse: {
          result: [
            {
              symbol: "7203.T",
              shortName: "TOYOTA MOTOR CORP",
              marketCap: 35000000000000, // 35兆円
              earningsTimestamp: earnTimestamp,
            },
            {
              symbol: "AAPL",
              shortName: "Apple Inc.",
              marketCap: 3500000000000, // 3.5兆ドル
              earningsTimestamp: earnTimestamp + 86400 * 3,
            },
            {
              symbol: "NVDA",
              shortName: "NVIDIA Corp.",
              marketCap: 3200000000000, // 3.2兆ドル
              earningsTimestamp: earnTimestamp + 86400 * 5,
            },
            {
              symbol: "6954.T",
              shortName: "Fanuc Corp",
              marketCap: 4000000000000, // 4兆円 (< 5兆円)
              earningsTimestamp: earnTimestamp + 86400 * 6,
            },
          ],
        },
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("fc.yahoo.com")) {
          return Promise.resolve(new Response("OK", { status: 200, headers: { "set-cookie": "A1=mock" } }));
        }
        if (u.includes("getcrumb")) {
          return Promise.resolve(new Response("mock-crumb", { status: 200 }));
        }
        if (u.includes("v7/finance/quote")) {
          return Promise.resolve(new Response(JSON.stringify(mockQuoteResponse), { status: 200 }));
        }
        return Promise.resolve(new Response("OK", { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
        const apple = events.find((e) => e.ticker === "AAPL");
        const toyota = events.find((e) => e.ticker === "7203");
        const fanuc = events.find((e) => e.ticker === "6954");

        expect(apple).toBeDefined();
        // US stock market cap should be in millions of USD: 3.5T / 1M = 3,500,000
        expect(apple?.marketCap).toBe(3500000);
        // Mega cap US should be HIGH importance
        expect(apple?.importance).toBe("HIGH");
        expect(apple?.fullDate).toBeDefined();

        expect(toyota).toBeDefined();
        // JP stock market cap should be in 億円: 35兆円 / 1億円 = 350,000
        expect(toyota?.marketCap).toBe(350000);
        // 35兆円 > 5兆円 threshold -> HIGH importance
        expect(toyota?.importance).toBe("HIGH");

        expect(fanuc).toBeDefined();
        // 4兆円 = 40,000 億円 (< 50,000 億円) -> MEDIUM importance
        expect(fanuc?.marketCap).toBe(40000);
        expect(fanuc?.importance).toBe("MEDIUM");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("3. Resilience & Fallback Metadata Consistency", () => {
    it("ensures all events have source: fallback when live quote fetching fails completely", async () => {
      const refDate = new Date(2026, 9, 12);
      const fetchMock = vi.fn().mockRejectedValue(new Error("Yahoo Finance 503 Service Unavailable"));
      vi.stubGlobal("fetch", fetchMock);

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
        expect(events.length).toBeGreaterThan(0);
        // When live fetch produces zero live earnings, all events MUST be marked with source: "fallback"
        expect(events.every((e) => e.source === "fallback")).toBe(true);

        const macros = events.filter((e) => e.type === "MACRO");
        const earnings = events.filter((e) => e.type === "EARNINGS");
        expect(macros.length).toBeGreaterThan(0);
        expect(earnings.length).toBeGreaterThan(0);
        expect(macros.every((m) => m.source === "fallback")).toBe(true);
        expect(earnings.every((e) => e.source === "fallback")).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("serves calendar endpoint with short TTL cache on complete fallback for fast recovery", async () => {
      setAllowMemoryCacheInTest(true);
      const fetchMock = vi.fn().mockRejectedValue(new Error("Timeout"));
      vi.stubGlobal("fetch", fetchMock);

      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/market/calendar", { method: "GET" });
        const res = await worker.fetch(req, env as any);

        expect(res.status).toBe(200);
        const data = (await res.json()) as CalendarEvent[];
        expect(data.every((e) => e.source === "fallback")).toBe(true);
      } finally {
        setAllowMemoryCacheInTest(false);
        vi.unstubAllGlobals();
      }
    });
  });
});
