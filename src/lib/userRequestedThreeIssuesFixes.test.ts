import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BasketItem, StockSeries } from "../types";
import {
  computeIndexCoverage,
  getIndexCoverageWarnings,
} from "./indexEngine";
import {
  fetchLiveMarketCalendarAsync,
  fetchLiveMacroEventsFromApiAsync,
} from "../../worker/internal";

describe("User Requested Fixes: 3 Issues Resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Issue 1: Missing price gap warning shows affected stock tickers and names", () => {
    it("includes affected tickers and company names in the mid-series gap warning", () => {
      const basket: BasketItem[] = [
        { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 50 },
        { ticker: "6954", name: "ファナック", theme: "FAロボット", weight: 50 },
      ];

      // 6954 has a gap on 2026-10-15
      const universe: StockSeries[] = [
        {
          ticker: "7203",
          name: "トヨタ自動車",
          theme: "自動車",
          sector: "輸送用機器",
          latestPrice: 3000,
          series: [
            { date: "2026-10-14", close: 2900 },
            { date: "2026-10-15", close: 2950 },
            { date: "2026-10-16", close: 3000 },
          ],
        },
        {
          ticker: "6954",
          name: "ファナック",
          theme: "FAロボット",
          sector: "電気機器",
          latestPrice: 4200,
          series: [
            { date: "2026-10-14", close: 4000 },
            // 2026-10-15 is missing (gap)
            { date: "2026-10-16", close: 4200 },
          ],
        },
      ];

      const coverage = computeIndexCoverage(basket, universe);
      expect(coverage.gapFilledTickers).toContain("6954");
      expect(coverage.gapFilledTickers).not.toContain("7203");

      const warnings = getIndexCoverageWarnings(basket, universe);
      expect(warnings.length).toBe(1);
      // Verify that the warning clearly discloses which stock caused the gap error
      expect(warnings[0]).toContain("期間中に価格の欠測を補完した日が1日あります");
      expect(warnings[0]).toContain("6954 (ファナック)");
      expect(warnings[0]).toContain("対象銘柄（6954 (ファナック)）はチャート上で直近値のまま推移します");
    });
  });

  describe("Issue 2: Fanuc (6954) earnings data displayed as real data, not fallback reference value", () => {
    it("retains Fanuc earnings as live real data even when announced 7+ days ago (within 45 days)", async () => {
      // refDate is 2026-10-30, Fanuc earnings was on 2026-10-23 (7 days and 6 hours ago)
      const refDate = new Date("2026-10-30T12:00:00Z");
      const fanucEarningsTimestamp = Math.floor(new Date("2026-10-23T06:30:00Z").getTime() / 1000);

      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("fc.yahoo.com")) {
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "A1=mockCookieValue; Path=/; Domain=.yahoo.com;" },
          });
        }
        if (urlStr.includes("getcrumb")) {
          return new Response("mockCrumbValue", { status: 200 });
        }
        if (urlStr.includes("/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "6954.T",
                    displayName: "ファナック",
                    regularMarketPrice: 4250,
                    marketCap: 4100000000000,
                    earningsTimestamp: fanucEarningsTimestamp,
                  },
                  {
                    symbol: "7203.T",
                    displayName: "トヨタ自動車",
                    regularMarketPrice: 3000,
                    marketCap: 35000000000000,
                    earningsTimestamp: Math.floor(new Date("2026-11-05T06:30:00Z").getTime() / 1000),
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Other external calls (biquote etc.) fall back
        return new Response("Not found", { status: 404 });
      });

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);

        const fanuc = events.find((e) => e.ticker === "6954");
        expect(fanuc).toBeDefined();
        // Crucial: source must NOT be "fallback" (which generates the 参考値 badge)
        expect(fanuc?.source).toBeUndefined();
        expect(fanuc?.date).toBe("10/23");
        expect(fanuc?.fullDate).toBe("2026-10-23");
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("uses quoteSummary calendarEvents module fallback if quote API omits earningsTimestamp for Fanuc", async () => {
      const refDate = new Date("2026-10-30T12:00:00Z");
      const fanucEarningsTimestamp = Math.floor(new Date("2026-10-23T06:30:00Z").getTime() / 1000);

      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("fc.yahoo.com")) {
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "A1=mockCookieValue; Path=/; Domain=.yahoo.com;" },
          });
        }
        if (urlStr.includes("getcrumb")) {
          return new Response("mockCrumbValue", { status: 200 });
        }
        if (urlStr.includes("/v7/finance/quote")) {
          // Quote returns Fanuc WITHOUT earningsTimestamp
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "6954.T",
                    displayName: "ファナック",
                    regularMarketPrice: 4250,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.includes("quoteSummary") && urlStr.includes("6954.T")) {
          // quoteSummary calendarEvents provides the real date
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [
                  {
                    calendarEvents: {
                      earnings: {
                        earningsDate: [{ raw: fanucEarningsTimestamp, fmt: "2026-10-23" }],
                      },
                    },
                    price: {
                      shortName: "ファナック",
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);

        const fanuc = events.find((e) => e.ticker === "6954");
        expect(fanuc).toBeDefined();
        expect(fanuc?.source).toBeUndefined();
        expect(fanuc?.date).toBe("10/23");
        expect(fanuc?.fullDate).toBe("2026-10-23");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe("Issue 3: Macro calendar integration with external API for accurate schedules", () => {
    it("fetches and parses real macro economic events from external calendar API with exact dates and consensus", async () => {
      const refDate = new Date("2026-10-30T12:00:00Z");

      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("biquote.io/api/calendar")) {
          return new Response(
            JSON.stringify([
              {
                time: "2026-11-10T13:30:00Z",
                countryCode: "US",
                name: "CPI y/y",
                importance: "high",
                actual: null,
                forecast: 2.5,
                previous: 2.4,
              },
              {
                time: "2026-11-06T13:30:00Z",
                countryCode: "US",
                name: "Nonfarm Payrolls",
                importance: "high",
                actual: null,
                forecast: 15.0,
                previous: 14.2,
              },
              {
                time: "2026-12-09T19:00:00Z",
                countryCode: "US",
                name: "Fed Interest Rate Decision",
                importance: "high",
                actual: null,
                forecast: 4.5,
                previous: 4.75,
              },
              {
                time: "2026-12-18T02:30:00Z",
                countryCode: "JP",
                name: "BoJ Interest Rate Decision",
                importance: "high",
                actual: null,
                forecast: 0.5,
                previous: 0.25,
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const macroEvents = await fetchLiveMacroEventsFromApiAsync(refDate);
        expect(macroEvents.length).toBeGreaterThan(0);

        // US CPI: must show the exact date from API (11/10) rather than pseudo-calculated (12th)
        const cpi = macroEvents.find((e) => e.title.includes("消費者物価指数"));
        expect(cpi).toBeDefined();
        expect(cpi?.fullDate).toBe("2026-11-10");
        expect(cpi?.date).toBe("11/10");
        expect(cpi?.forecast).toBe("2.5%");
        expect(cpi?.previous).toBe("2.4%");
        expect(cpi?.source).toBe("official");
        expect(cpi?.fieldProvenance?.forecast).toBe("official");

        // Nonfarm Payrolls
        const jobs = macroEvents.find((e) => e.title.includes("雇用統計"));
        expect(jobs).toBeDefined();
        expect(jobs?.fullDate).toBe("2026-11-06");
        expect(jobs?.forecast).toBe("15万人");
        expect(jobs?.previous).toBe("14.2万人");

        // BoJ
        const boj = macroEvents.find((e) => e.title.includes("日銀"));
        expect(boj).toBeDefined();
        expect(boj?.fullDate).toBe("2026-12-18");
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("integrates live macro events into fetchLiveMarketCalendarAsync accurately", async () => {
      const refDate = new Date("2026-10-30T12:00:00Z");

      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr.includes("biquote.io/api/calendar")) {
          return new Response(
            JSON.stringify([
              {
                time: "2026-11-10T13:30:00Z",
                countryCode: "US",
                name: "CPI y/y",
                importance: "high",
                actual: null,
                forecast: 2.5,
                previous: 2.4,
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const events = await fetchLiveMarketCalendarAsync(undefined, refDate);
        const cpi = events.find((e) => e.title.includes("消費者物価指数"));
        expect(cpi).toBeDefined();
        expect(cpi?.fullDate).toBe("2026-11-10");
        expect(cpi?.date).toBe("11/10");
        expect(cpi?.source).toBe("official");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
