import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRICE_DATE_PATTERN,
  sanitizeIndexSeries,
  sanitizePriceSeries,
  sanitizeStockUniverse,
} from "./apiContract";
import { normalizeBenchmarkData } from "../hooks/useBenchmark";
import { parseCsv } from "./csv";
import { deserializeBasketFromCsv } from "./indexSerialization";
import {
  addWatchlistTicker,
  addWatchlistTickerDetailed,
  STORAGE_KEY_WATCHLIST,
} from "./portfolioStorage";
import { DEFAULT_TURNSTILE_SITE_KEY, getTurnstileConfig } from "./auth";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createMemoryStorage(options: { failWrites?: boolean } = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      if (options.failWrites) throw new Error("QuotaExceededError");
      data.set(key, String(value));
    },
  };
}

const validBenchmark = {
  snapshot: {
    symbol: "^N225",
    label: "日経225",
    current: 38000,
    change: 120,
    changePct: 0.32,
    updatedAt: "2026-11-05T00:00:00.000Z",
    description: "Nikkei 225",
  },
  series: [
    { date: "2026-11-01", close: 37800 },
    { date: "2026-11-02", close: 38000 },
  ],
};

describe("shared price-series validation", () => {
  it("drops malformed points, deduplicates dates and sorts ascending", () => {
    expect(PRICE_DATE_PATTERN.test("2026-11-05")).toBe(true);
    expect(PRICE_DATE_PATTERN.test("2026-1-5")).toBe(false);

    const sanitized = sanitizePriceSeries([
      { date: "2026-01-03", close: 100, volume: 5 },
      { date: "2026-01-01", close: 90 },
      { date: "2026-01-03", close: 101, volume: 6 },
      { date: "2026-01-02", close: Number.NaN },
      { date: "not-a-date", close: 100 },
      { date: "2026-01-04", close: -1 },
      { date: "2026-01-05", close: 100, volume: -2 },
      null,
      "2026-01-06",
    ]);

    expect(sanitized).toEqual([
      { date: "2026-01-01", close: 90 },
      { date: "2026-01-03", close: 101, volume: 6 },
    ]);
  });

  it("accepts calculated index points that carry value or close", () => {
    const sanitized = sanitizeIndexSeries([
      { date: "2026-01-02", value: 1010 },
      { date: "2026-01-01", close: 1000 },
      { date: "2026-01-03", value: Number.NaN, close: 1002 },
      { date: "2026-01-04" },
      { date: "bad", close: 1000 },
      null,
    ]);

    expect(sanitized).toEqual([
      { date: "2026-01-01", close: 1000 },
      { date: "2026-01-02", close: 1010, value: 1010 },
      { date: "2026-01-03", close: 1002 },
    ]);
  });

  it("drops non-object universe entries instead of letting them crash a render", () => {
    const sanitized = sanitizeStockUniverse([
      {
        ticker: " 7203 ",
        name: "トヨタ自動車",
        theme: "自動車",
        sector: "Consumer",
        latestPrice: 2500,
        series: [{ date: "2026-01-01", close: 2400 }],
      },
      null,
      { ticker: "", series: [] },
      {
        ticker: "nvda",
        name: "NVIDIA",
        theme: "半導体",
        sector: "Technology",
        series: [{ date: "2026-01-01", close: 120 }],
      },
    ]);

    expect(sanitized).toHaveLength(2);
    expect(sanitized[0]).toMatchObject({
      ticker: "7203",
      name: "トヨタ自動車",
      latestPrice: 2500,
      series: [{ date: "2026-01-01", close: 2400 }],
    });
    // A missing latestPrice is derived from the validated series rather than
    // being left undefined.
    expect(sanitized[1]).toMatchObject({ ticker: "NVDA", latestPrice: 120 });
    expect(sanitized[1].series).toEqual([{ date: "2026-01-01", close: 120 }]);
  });
});

describe("CSV import boundary", () => {
  it("rejects an unterminated quoted field instead of importing truncated data", () => {
    expect(() => parseCsv('ticker,name\n"7203,Toyota')).toThrow(
      "CSVの引用符が閉じられていません",
    );
    expect(
      deserializeBasketFromCsv('ticker,name,weight\n"7203,Toyota,10'),
    ).toMatchObject({ ok: false, error: "CSVの引用符が閉じられていません" });
  });
});

describe("benchmark payload validation", () => {
  it("rejects a zero or negative benchmark level", () => {
    expect(normalizeBenchmarkData(validBenchmark)).not.toBeNull();
    expect(
      normalizeBenchmarkData({
        ...validBenchmark,
        snapshot: { ...validBenchmark.snapshot, current: 0 },
      }),
    ).toBeNull();
    expect(
      normalizeBenchmarkData({
        ...validBenchmark,
        snapshot: { ...validBenchmark.snapshot, current: -1 },
      }),
    ).toBeNull();
  });

  it("drops non-positive closes and invalid dates from the chart series", () => {
    const sanitized = normalizeBenchmarkData({
      ...validBenchmark,
      series: [
        { date: "2026-11-01", close: 0 },
        { date: "not-a-date", close: 100 },
        { date: "2026-11-03", close: 38100 },
      ],
    });

    expect(sanitized?.series).toEqual([{ date: "2026-11-03", close: 38100 }]);
    expect(
      normalizeBenchmarkData({
        ...validBenchmark,
        series: [{ date: "2026-11-01", close: 0 }],
      }),
    ).toBeNull();
  });
});

describe("watchlist add outcomes", () => {
  it("distinguishes a duplicate from an invalid ticker", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);

    expect(addWatchlistTickerDetailed("nvda")).toEqual({ ok: true, ticker: "NVDA" });
    expect(storage.getItem(STORAGE_KEY_WATCHLIST)).toBe(JSON.stringify(["NVDA"]));
    expect(addWatchlistTickerDetailed("NVDA")).toEqual({ ok: false, reason: "exists" });
    expect(addWatchlistTicker("NVDA")).toBe(false);
    expect(addWatchlistTickerDetailed("  ")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a storage write failure as failed, not as a duplicate", () => {
    const storage = createMemoryStorage({ failWrites: true });
    vi.stubGlobal("localStorage", storage);

    expect(addWatchlistTickerDetailed("6758")).toEqual({ ok: false, reason: "failed" });
    expect(addWatchlistTicker("6758")).toBe(false);
    expect(storage.getItem(STORAGE_KEY_WATCHLIST)).toBeNull();
  });
});

describe("Turnstile configuration request", () => {
  it("uses a deadline and falls back to the default site key", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const configPromise = getTurnstileConfig();
    await vi.advanceTimersByTimeAsync(8000);

    await expect(configPromise).resolves.toEqual({ siteKey: DEFAULT_TURNSTILE_SITE_KEY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
