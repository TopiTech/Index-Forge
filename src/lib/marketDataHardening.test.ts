/**
 * Regression tests for the data-layer hardening:
 *
 * - the fundamentals payload is validated field by field instead of being
 *   spread over the typed model (an invalid `change` used to reach the UI as
 *   `NaN`, which silently poisoned the portfolio's daily P&L);
 * - the browser-side caches expire instead of serving stale data for the whole
 *   session;
 * - the calendar cache cannot be kept alive forever by an unreadable
 *   timestamp;
 * - the fallback sparkline of a sub-2 FX quote keeps enough precision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARKET_OVERVIEW,
  STOCK_FUNDAMENTALS_CACHE_TTL_MS,
  clearScreenerUniverseClientCache,
  clearStockFundamentalsClientCache,
  fetchStockFundamentals,
  fetchUpcomingEvents,
  getStockFundamentals,
  sanitizeStockFundamentals,
} from "./marketDataService";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearStockFundamentalsClientCache();
  clearScreenerUniverseClientCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sanitizeStockFundamentals", () => {
  const baseline = getStockFundamentals("7203");

  it("falls back to the baseline for every non-numeric numeric field", () => {
    const sanitized = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 2900,
        change: "not-a-number",
        changePercent: Number.NaN,
        volume: null,
        marketCap: undefined,
      },
      baseline,
      "7203",
    );

    expect(sanitized.price).toBe(2900);
    expect(sanitized.change).toBe(baseline.change);
    expect(sanitized.changePercent).toBe(baseline.changePercent);
    expect(sanitized.volume).toBe(baseline.volume);
    expect(sanitized.marketCap).toBe(baseline.marketCap);
  });

  it("keeps every numeric field finite", () => {
    const sanitized = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: Number.POSITIVE_INFINITY,
        change: Number.NaN,
        dayHigh: "2900",
        dayLow: null,
      },
      baseline,
      "7203",
    );

    for (const value of [
      sanitized.price,
      sanitized.change,
      sanitized.changePercent,
      sanitized.dayHigh,
      sanitized.dayLow,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("drops non-numeric sparkline points instead of casting them", () => {
    const sanitized = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 2900,
        sparkline: [1, "2", null, Number.NaN, 3],
      },
      baseline,
      "7203",
    );

    expect(sanitized.sparkline).toEqual([1, 3]);
  });

  it("rejects an unknown market segment and keeps the baseline one", () => {
    const sanitized = sanitizeStockFundamentals(
      { ticker: "7203", price: 2900, market: "NOT_A_MARKET" },
      baseline,
      "7203",
    );

    expect(sanitized.market).toBe(baseline.market);
  });

  it("falls back to the baseline for blank text fields", () => {
    const sanitized = sanitizeStockFundamentals(
      { ticker: "7203", price: 2900, name: "   ", theme: "" },
      baseline,
      "7203",
    );

    expect(sanitized.name).toBe(baseline.name);
    expect(sanitized.theme).toBe(baseline.theme);
  });

  it("keeps the PER disclosure of an estimated (TTM) multiple", () => {
    const sanitized = sanitizeStockFundamentals(
      {
        ticker: "7203",
        price: 2900,
        per: 10.4,
        isEstimatedPer: true,
        perNote: "会社予想非開示のため直近実績(TTM)より推計",
      },
      baseline,
      "7203",
    );

    // The disclosure must survive the sanitization: a PER that was estimated
    // from the latest results has to be marked as such, otherwise the UI
    // presents it as a company-guided multiple.
    expect(sanitized.isEstimatedPer).toBe(true);
    expect(sanitized.perNote).toBe("会社予想非開示のため直近実績(TTM)より推計");
  });

  it("clears the PER disclosure when the payload does not carry it", () => {
    const sanitized = sanitizeStockFundamentals(
      { ticker: "7203", price: 2900, per: 10.4 },
      { ...baseline, isEstimatedPer: true, perNote: "stale note" },
      "7203",
    );

    expect(sanitized.isEstimatedPer).toBe(false);
    expect(sanitized.perNote).toBeUndefined();
  });
});

describe("browser-side cache expiry", () => {
  it("re-fetches the fundamentals once the cache entry has expired", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ticker: "7203", name: "トヨタ自動車", price: 2900, change: 5 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchStockFundamentals("7203");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Within the TTL the cached quote is served.
    vi.setSystemTime(new Date(Date.now() + STOCK_FUNDAMENTALS_CACHE_TTL_MS - 1000));
    await fetchStockFundamentals("7203");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once it expired the quote must be fetched again.
    vi.setSystemTime(new Date(Date.now() + 2000));
    await fetchStockFundamentals("7203");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("calendar cache", () => {
  it("discards a cache entry whose timestamp cannot be read", async () => {
    const CACHE_KEY = "indexforge:calendar:cache:v1";
    const store: Record<string, string> = {
      [CACHE_KEY]: JSON.stringify({
        timestamp: "not-a-number",
        events: [
          {
            id: "evt-1",
            date: "04/01",
            type: "MACRO",
            title: "テストイベント",
            importance: "HIGH",
          },
        ],
      }),
    };
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const events = await fetchUpcomingEvents();

    // The unreadable timestamp must not resurrect the cached entry.
    expect(events.some((event) => event.id === "evt-1")).toBe(false);
    expect(store[CACHE_KEY]).toBeUndefined();
  });
});

describe("fallback sparkline precision", () => {
  it("keeps four decimals for an FX quote below 2 so the series does not collapse", () => {
    const eurUsd = DEFAULT_MARKET_OVERVIEW.forex.find((quote) => quote.symbol === "EURUSD=X");
    expect(eurUsd).toBeDefined();
    expect(eurUsd!.price).toBeLessThan(2);

    const sparkline = eurUsd!.sparkline;
    expect(sparkline).toBeDefined();
    expect(sparkline!.length).toBeGreaterThan(1);
    // The rounded series must still be monotonic and end on the quoted price.
    expect(sparkline![sparkline!.length - 1]).toBeCloseTo(eurUsd!.price, 4);
    expect(new Set(sparkline!).size).toBeGreaterThan(2);
  });
});
