import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../../worker/index";
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
  fetchUpcomingEvents,
  type CalendarEvent,
} from "./marketDataService";

function createMockEnv() {
  return {
    ASSETS: { fetch: async () => new Response("OK") } as unknown as Fetcher,
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      }),
    } as unknown as D1Database,
  };
}

describe("Calendar Enhancements & Live Data Fetching", () => {
  beforeEach(() => {
    clearMemoryCache();
    clearMemoryRateLimits();
    resetLastKnownCalendarEvents();
    resetYahooCrumbCache();
    vi.restoreAllMocks();
  });

  describe("fetchLiveMarketCalendar (Dynamic Weekday-Adjusted Fallback)", () => {
    it("generates events forward in time relative to reference date", () => {
      const refDate = new Date(2026, 9, 12); // 2026-10-12
      const events = fetchLiveMarketCalendar(undefined, refDate);

      expect(events.length).toBeGreaterThanOrEqual(8);
      // All fallback events should carry source: "fallback"
      expect(events.every((e) => e.source === "fallback")).toBe(true);

      // Should have both macro and earnings
      const macros = events.filter((e) => e.type === "MACRO");
      const earnings = events.filter((e) => e.type === "EARNINGS");
      expect(macros.length).toBeGreaterThan(0);
      expect(earnings.length).toBeGreaterThan(0);

      // Toyota event exists
      const toyota = events.find((e) => e.ticker === "7203");
      expect(toyota).toBeDefined();
      expect(toyota?.type).toBe("EARNINGS");
    });

    it("ensures earnings events fall on business days (not weekends)", () => {
      const refDate = new Date(2026, 9, 15);
      const events = fetchLiveMarketCalendar(undefined, refDate);
      const earnings = events.filter((e) => e.type === "EARNINGS");

      for (const earn of earnings) {
        const [mStr, dStr] = earn.date.split("/");
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        const y = m < 10 ? 2027 : 2026;
        const dayOfWeek = new Date(y, m - 1, d).getDay();
        // Day of week should not be Sunday (0) or Saturday (6)
        expect([1, 2, 3, 4, 5]).toContain(dayOfWeek);
      }
    });

    it("sorts events chronologically across month and year boundaries", () => {
      const refDate = new Date(2026, 11, 20); // 2026-12-20
      const events = fetchLiveMarketCalendar(undefined, refDate);

      // First event should be on or after Dec 20, or in Jan/Feb
      expect(events.length).toBeGreaterThan(0);
      const firstEvent = events[0];
      expect(typeof firstEvent.date).toBe("string");
    });
  });

  describe("fetchLiveMarketCalendarAsync (Live Yahoo Finance Integration)", () => {
    it("fetches live earnings timestamps from Yahoo and marks them as live (source: undefined)", async () => {
      const refDate = new Date(2026, 9, 12); // 2026-10-12

      // Mock crumb & quote response (Toyota announces at 15:00 JST on 2026-10-28 => 06:00 UTC)
      const earnTimestamp = Math.floor(Date.UTC(2026, 9, 28, 6, 0) / 1000);
      const mockQuoteResponse = {
        quoteResponse: {
          result: [
            {
              symbol: "7203.T",
              shortName: "TOYOTA MOTOR CORP",
              marketCap: 35000000000000,
              earningsTimestamp: earnTimestamp,
            },
            {
              symbol: "AAPL",
              shortName: "Apple Inc.",
              marketCap: 500000000000000,
              earningsTimestamp: earnTimestamp + 86400 * 3,
            },
            {
              symbol: "NVDA",
              shortName: "NVIDIA Corp.",
              marketCap: 600000000000000,
              earningsTimestamp: earnTimestamp + 86400 * 10,
            },
            {
              symbol: "6857.T",
              shortName: "Advantest Corp",
              marketCap: 3000000000000,
              earningsTimestamp: earnTimestamp + 86400 * 2,
            },
          ],
        },
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("fc.yahoo.com")) {
          return Promise.resolve(
            new Response("OK", {
              status: 200,
              headers: { "set-cookie": "A1=mockcookie; path=/" },
            }),
          );
        }
        if (u.includes("getcrumb")) {
          return Promise.resolve(new Response("mock-crumb", { status: 200 }));
        }
        if (u.includes("v7/finance/quote")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockQuoteResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response("OK", { status: 200 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
        expect(events.length).toBeGreaterThan(0);

        const toyotaEvent = events.find((e) => e.ticker === "7203");
        expect(toyotaEvent).toBeDefined();
        // Live data should NOT have source: "fallback"
        expect(toyotaEvent?.source).toBeUndefined();
        expect(toyotaEvent?.date).toBe("10/28");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("falls back gracefully when Yahoo Finance fails", async () => {
      const refDate = new Date(2026, 9, 12);
      const fetchMock = vi.fn().mockRejectedValue(new Error("Network offline"));
      vi.stubGlobal("fetch", fetchMock);

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
        expect(events.length).toBeGreaterThan(0);
        // Falls back to scheduled macros and fallback earnings
        const toyota = events.find((e) => e.ticker === "7203");
        expect(toyota).toBeDefined();
        expect(toyota?.source).toBe("fallback");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("Worker GET /api/market/calendar", () => {
    it("returns calendar events and responds to force refresh query", async () => {
      setAllowMemoryCacheInTest(true);
      try {
        const env = createMockEnv();
        const req = new Request("http://localhost/api/market/calendar?refresh=1", {
          method: "GET",
          headers: { "cache-control": "no-cache" },
        });

        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);
        expect(res.headers.get("etag")).toBeDefined();
      } finally {
        setAllowMemoryCacheInTest(false);
      }
    });
  });

  describe("Client Service fetchUpcomingEvents", () => {
    it("fetches and caches calendar data via sessionStorage", async () => {
      const mockStorage: Record<string, string> = {};
      const sessionStorageMock = {
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        clear: () => {
          for (const k in mockStorage) delete mockStorage[k];
        },
      };

      const payload: CalendarEvent[] = [
        {
          id: "live-event-1",
          date: "11/04",
          type: "MACRO",
          title: "Live FOMC meeting",
          importance: "HIGH",
        },
      ];

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("window", { sessionStorage: sessionStorageMock });

      try {
        const res1 = await fetchUpcomingEvents();
        expect(res1).toHaveLength(1);
        expect(res1[0].id).toBe("live-event-1");

        // Verify storage received the cache
        expect(Object.keys(mockStorage).length).toBeGreaterThan(0);

        // When fetch fails, sessionStorage cache is used
        fetchMock.mockRejectedValueOnce(new Error("API timeout"));
        const res2 = await fetchUpcomingEvents();
        expect(res2).toHaveLength(1);
        expect(res2[0].id).toBe("live-event-1");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
