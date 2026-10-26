// @vitest-environment jsdom
/**
 * Regression test for N-1 (StockDetailPage auto-retry timer ownership).
 *
 * The first load may return demo fallback data, in which case the page
 * schedules one delayed `loadStockData(ticker, true)` after 1200ms. The timer
 * used to have no owner: unmounting or switching tickers within that window
 * left it armed, so it fired after the component was gone (or after the new
 * ticker's own load had started).
 *
 * The fix stores the timer in `autoRetryTimerRef` and clears it on unmount
 * and on ticker change, so a pending retry never outlives its ticker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StockDetailPage } from "./StockDetailPage";
import type { StockQuoteFundamentals } from "../lib/marketDataService";

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return {
    ...actual,
    getCachedStockFundamentals: vi.fn(),
    fetchStockFundamentals: vi.fn(),
  };
});

vi.mock("../lib/theme", () => ({
  useTheme: () => ({ theme: "dark" as const, toggleTheme: vi.fn() }),
}));

vi.mock("../contexts/FreshnessContext", () => ({
  useRegisterFreshness: vi.fn(),
}));

vi.mock("./StockTechnicalChart", () => ({
  StockTechnicalChart: () => null,
}));

// Framer-motion renders plain divs in jsdom; keep the real one.
const { getCachedStockFundamentals, fetchStockFundamentals } = await import(
  "../lib/marketDataService"
);
const getCachedMock = vi.mocked(getCachedStockFundamentals);
const fetchMock = vi.mocked(fetchStockFundamentals);

function makeQuote(ticker: string, isDemoData?: boolean): StockQuoteFundamentals {
  return {
    ticker,
    name: ticker,
    theme: "テスト",
    sector: "テスト",
    market: "PRIME",
    price: 1000,
    change: 10,
    changePercent: 1,
    volume: 1000,
    previousClose: 990,
    dayHigh: 1010,
    dayLow: 990,
    yearHigh: 1200,
    yearLow: 800,
    marketCap: 1000,
    per: 15,
    pbr: 1.2,
    dividendYield: 2,
    roe: 8,
    equityRatio: 50,
    eps: 100,
    dps: 20,
    sparkline: [990, 1000],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
    ...(isDemoData ? { isDemoData: true as const } : {}),
  } as StockQuoteFundamentals;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

const noopNavigate = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  getCachedMock.mockImplementation((ticker: string) => makeQuote(ticker));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("StockDetailPage auto-retry timer ownership (N-1)", () => {
  it("retries once after a demo fallback when still mounted", async () => {
    fetchMock.mockResolvedValueOnce(makeQuote("7203", true));
    fetchMock.mockResolvedValueOnce(makeQuote("7203"));

    render(<StockDetailPage ticker="7203" onNavigate={noopNavigate} />);
    await act(async () => {
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toBe(true);
  });

  it("does not retry after unmount within the delay window", async () => {
    fetchMock.mockResolvedValueOnce(makeQuote("7203", true));
    fetchMock.mockResolvedValueOnce(makeQuote("7203"));

    const { unmount } = render(<StockDetailPage ticker="7203" onNavigate={noopNavigate} />);
    await act(async () => {
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    // The pending retry must be disarmed, not merely guarded: no timer may
    // survive unmount (the old code left one armed that fired harmlessly
    // against the mountedRef guard while retaining its closure).
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending retry when the ticker changes", async () => {
    fetchMock.mockImplementation(async (ticker: string, forceRefresh?: boolean) => {
      if (ticker === "7203" && !forceRefresh) return makeQuote("7203", true);
      return makeQuote(ticker);
    });

    const { rerender } = render(<StockDetailPage ticker="7203" onNavigate={noopNavigate} />);
    await act(async () => {
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<StockDetailPage ticker="9984" onNavigate={noopNavigate} />);
    await act(async () => {
      await flush();
    });
    // The new ticker's own initial load.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The 7203 retry must be disarmed by the ticker switch itself: no stale
    // timer may still be pending (9984 loaded real data, so none is armed).
    expect(vi.getTimerCount()).toBe(0);
    // Advancing past the original 1200ms window must not fire the stale
    // retry for 7203; only 9984's demo retry (if any) may fire. 9984 loaded
    // real data here, so no further fetch is expected.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await flush();
    });
    const staleRetry = fetchMock.mock.calls.filter(
      (call) => call[0] === "7203" && call[1] === true,
    );
    expect(staleRetry).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a retry for real (non-demo) data", async () => {
    fetchMock.mockResolvedValueOnce(makeQuote("7203"));

    render(<StockDetailPage ticker="7203" onNavigate={noopNavigate} />);
    await act(async () => {
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
