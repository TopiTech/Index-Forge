import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiveMacroEventsFromApiAsync,
  fetchLiveMarketCalendarAsync,
  resetLastKnownCalendarEvents,
  resetYahooCrumbCache,
} from "../../worker/internal";
import { MACRO_METRICS_DEFAULTS } from "../data/macroSchedule";

/**
 * Regression contract for the biquote/MQL5 macro calendar boundary.
 *
 * The provider sends `unit`, `multiplier`, `digits` and a separate `actual`
 * value. Treating every number as a percentage produced a 10x error for
 * payrolls (162 thousand -> "162万人"), hid the published result, and let a
 * FOMC press-conference row become a second policy-rate event.
 */

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubCalendar(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("biquote.io/api/calendar")) {
        return jsonResponse(payload);
      }
      return new Response("Not found", { status: 404 });
    }),
  );
}

const REF_DATE = new Date("2026-10-30T12:00:00Z");

describe("live macro calendar provider contract", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    resetLastKnownCalendarEvents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("formats values from unit/multiplier metadata and keeps actual separate from forecast", async () => {
    stubCalendar([
      {
        time: "2026-10-02T12:30:00Z",
        countryCode: "US",
        name: "Nonfarm Payrolls",
        unit: "job",
        multiplier: "thousands",
        digits: 0,
        actual: 29,
        forecast: 52,
        previous: 162,
      },
      {
        time: "2026-10-14T12:30:00Z",
        countryCode: "US",
        name: "CPI y/y",
        unit: "percent",
        multiplier: "none",
        digits: 1,
        actual: 3.7,
        forecast: 3.5,
        previous: 3.4,
      },
      {
        time: "2026-10-28T18:00:00Z",
        countryCode: "US",
        name: "Fed Interest Rate Decision",
        unit: "percent",
        multiplier: "none",
        digits: 2,
        actual: 4,
        forecast: null,
        previous: 4,
      },
      {
        time: "2026-10-28T18:30:00Z",
        countryCode: "US",
        name: "FOMC Press Conference",
        unit: "none",
        multiplier: "none",
        digits: 0,
        actual: null,
        forecast: null,
        previous: null,
      },
      {
        time: "2026-10-30T03:02:00Z",
        countryCode: "JP",
        name: "BoJ Interest Rate Decision",
        unit: "percent",
        multiplier: "none",
        digits: 1,
        actual: 1.25,
        forecast: null,
        previous: 1.25,
      },
    ]);

    const events = await fetchLiveMacroEventsFromApiAsync(REF_DATE);

    const jobs = events.find((event) => event.title.includes("雇用統計"));
    expect(jobs).toBeDefined();
    expect(jobs?.previous).toBe("16.2万人");
    expect(jobs?.forecast).toBe("5.2万人");
    expect(jobs?.actual).toBe("2.9万人");
    expect(jobs?.fieldProvenance).toBeUndefined();

    const cpi = events.find((event) => event.title.includes("消費者物価指数"));
    expect(cpi?.previous).toBe("3.4%");
    expect(cpi?.forecast).toBe("3.5%");
    expect(cpi?.actual).toBe("3.7%");

    // The press-conference row must not become a second decision event.
    const fomc = events.filter((event) => event.title.includes("FOMC"));
    expect(fomc).toHaveLength(1);
    expect(fomc[0].previous).toBe("4%");
    expect(fomc[0].actual).toBe("4%");
    // A missing forecast falls back to the static reference value; it must
    // never reuse the published actual as if it were the consensus.
    expect(fomc[0].forecast).toBe(MACRO_METRICS_DEFAULTS.fomc.forecast);
    expect(fomc[0].forecast).not.toBe("4%");
    expect(fomc[0].fieldProvenance?.forecast).toBe("reference");
    expect(fomc[0].fieldProvenance?.actual).toBeUndefined();

    const boj = events.find((event) => event.title.includes("日銀"));
    expect(boj?.previous).toBe("1.25%");
    expect(boj?.actual).toBe("1.25%");
    // Provider digits=1 would round 1.25 to 1.3; the value's own precision wins.
    expect(boj?.actual).not.toBe("1.3%");
  });

  it("skips malformed provider rows without discarding the valid ones", async () => {
    stubCalendar([
      null,
      "not-an-item",
      { time: "2026-11-06T13:30:00Z", countryCode: "US" },
      {
        time: "2026-11-06T13:30:00Z",
        countryCode: "US",
        name: "Nonfarm Payrolls",
        unit: "job",
        multiplier: "thousands",
        digits: 0,
        actual: null,
        forecast: 55,
        previous: 162,
      },
    ]);

    const events = await fetchLiveMacroEventsFromApiAsync(REF_DATE);
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("雇用統計");
    expect(events[0].previous).toBe("16.2万人");
    expect(events[0].forecast).toBe("5.5万人");
  });

  it("does not overwrite a provider-supplied FOMC result with the ^IRX proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("biquote.io/api/calendar")) {
          return jsonResponse([
            {
              time: "2026-10-28T18:00:00Z",
              countryCode: "US",
              name: "Fed Interest Rate Decision",
              unit: "percent",
              multiplier: "none",
              digits: 2,
              actual: 4,
              forecast: null,
              previous: 4,
            },
          ]);
        }
        if (url.includes("fc.yahoo.com")) {
          return new Response("", {
            status: 200,
            headers: { "set-cookie": "A1=test-cookie; Path=/; Domain=.yahoo.com" },
          });
        }
        if (url.includes("getcrumb")) {
          return new Response("test-crumb", { status: 200 });
        }
        if (url.includes("/v7/finance/quote")) {
          return jsonResponse({
            quoteResponse: {
              result: [
                { symbol: "^IRX", regularMarketPrice: 4.35 },
                { symbol: "^TNX", regularMarketPrice: 4.45 },
                {
                  symbol: "7203.T",
                  shortName: "トヨタ自動車",
                  earningsTimestamp: Math.floor(REF_DATE.getTime() / 1000) + 86400 * 10,
                },
              ],
            },
          });
        }
        return new Response("Not found", { status: 404 });
      }),
    );

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE);
    const fomc = events.filter((event) => event.title.includes("FOMC"));
    expect(fomc).toHaveLength(1);
    expect(fomc[0].previous).toBe("4%");
    expect(fomc[0].previous).not.toContain("参考推計");
    expect(fomc[0].actual).toBe("4%");
    expect(fomc[0].fieldProvenance?.previous).toBeUndefined();
  });
});
