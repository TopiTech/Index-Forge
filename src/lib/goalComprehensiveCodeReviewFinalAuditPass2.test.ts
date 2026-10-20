// @vitest-environment jsdom
/**
 * Edge-case and regression tests for the "Goal Comprehensive Review Pass 2" round.
 *
 * The screener's selection logic is not a standalone helper: it lives inside
 * `src/components/ScreenerPage.tsx`. These tests therefore drive the real
 * component (with the universe served through the production `/api/stocks/screener`
 * request) and assert the basket it hands to `onBatchCreateCustomIndex`.
 * Re-implementing the selection inside this file would keep passing even when
 * the component breaks.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { ScreenerPage } from "../components/ScreenerPage";
import { ToastProvider } from "../components/Toast";
import { getEventDayOfWeek } from "../components/CalendarPage";
import { allocateEvenWeights } from "./weights";
import { getCurrencyMeta, formatStockPrice } from "./currency";
import { clearScreenerUniverseClientCache } from "./marketDataService";
import type { StockQuoteFundamentals } from "./marketDataService";
import calendarPageSource from "../components/CalendarPage.tsx?raw";

/**
 * The universe the Worker would serve from `/api/stocks/screener`.
 * The order after the default sort (`changePercent`, descending) is
 * AAPL, 7203, MSFT, 6758.
 */
const FIXTURE_UNIVERSE: StockQuoteFundamentals[] = [
  {
    ticker: "AAPL",
    name: "Apple",
    theme: "Tech",
    sector: "Technology",
    market: "US",
    price: 229.28,
    change: 2.72,
    changePercent: 1.2,
    volume: 51_000_000,
    previousClose: 226.56,
    dayHigh: 230.1,
    dayLow: 225.9,
    yearHigh: 260,
    yearLow: 160,
    marketCap: 3_400_000,
    per: 34.5,
    pbr: 8.1,
    dividendYield: 0.5,
    roe: 150.2,
    equityRatio: 30,
    eps: 6.6,
    dps: 0.25,
    technicalSignal: "BUY",
    historicalFinances: [],
  },
  {
    ticker: "7203",
    name: "トヨタ自動車",
    theme: "自動車",
    sector: "自動車",
    market: "PRIME",
    price: 2850,
    change: 10,
    changePercent: 0.35,
    volume: 12_000_000,
    previousClose: 2840,
    dayHigh: 2860,
    dayLow: 2830,
    yearHigh: 3200,
    yearLow: 2400,
    marketCap: 400_000,
    per: 10.5,
    pbr: 1.1,
    dividendYield: 2.5,
    roe: 9.1,
    equityRatio: 45,
    eps: 270,
    dps: 90,
    technicalSignal: "BUY",
    historicalFinances: [],
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    theme: "Tech",
    sector: "Technology",
    market: "US",
    price: 430,
    change: -0.9,
    changePercent: -0.2,
    volume: 18_000_000,
    previousClose: 430.9,
    dayHigh: 432,
    dayLow: 428,
    yearHigh: 480,
    yearLow: 300,
    marketCap: 3_200_000,
    per: 36.2,
    pbr: 11.4,
    dividendYield: 0.8,
    roe: 35.4,
    equityRatio: 28,
    eps: 11.9,
    dps: 0.83,
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
  },
  {
    ticker: "6758",
    name: "ソニーグループ",
    theme: "エレクトロニクス",
    sector: "エレクトロニクス",
    market: "PRIME",
    price: 13000,
    change: -50,
    changePercent: -0.38,
    volume: 5_000_000,
    previousClose: 13050,
    dayHigh: 13120,
    dayLow: 12900,
    yearHigh: 15000,
    yearLow: 9000,
    marketCap: 130_000,
    per: 25.4,
    pbr: 3.6,
    dividendYield: 1.1,
    roe: 12.5,
    equityRatio: 30,
    eps: 512,
    dps: 45,
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
  },
];

interface BatchBasketItem {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
}

/** Minimal `Response`-like payload for the stubbed `/api/stocks/screener` call. */
function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
  };
}

function renderScreener() {
  const onBatchCreateCustomIndex = vi.fn<(basket: BatchBasketItem[]) => void>();
  render(
    createElement(
      ToastProvider,
      null,
      createElement(ScreenerPage, {
        onNavigate: vi.fn(),
        onOpenStockDetail: vi.fn(),
        onBatchCreateCustomIndex,
      }),
    ),
  );
  return { onBatchCreateCustomIndex };
}

/** The results table (the mobile card list renders the same controls twice). */
function resultsTable() {
  return within(screen.getByRole("region", { name: "銘柄スクリーナー結果テーブル" }));
}

function selectionToggle(name: string) {
  return resultsTable().getByRole("checkbox", { name: `${name} の選択切り替え` });
}

function selectAllToggle() {
  return resultsTable().getByRole("checkbox", { name: "全銘柄の選択切り替え" });
}

async function waitForResults() {
  await waitFor(() => {
    expect(resultsTable().getAllByRole("checkbox").length).toBeGreaterThan(1);
  });
}

function filterByKeyword(keyword: string) {
  const input = screen.getByPlaceholderText("例: トヨタ, 半導体, 7203");
  fireEvent.change(input, { target: { value: keyword } });
}

beforeEach(() => {
  clearScreenerUniverseClientCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(FIXTURE_UNIVERSE)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Goal Comprehensive Review Pass 2 - Edge Cases & Regression Tests", () => {
  describe("Screener Batch Index Creation & Cross-Filter Selection Logic", () => {
    it("allocates even weights correctly for chosen stocks", () => {
      const weights = allocateEvenWeights(3);
      expect(weights.length).toBe(3);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 2);
    });

    it("prevents empty basket generation when filter changes and selected tickers are not in current results", async () => {
      const { onBatchCreateCustomIndex } = renderScreener();
      await waitForResults();

      // The user selects a TSE Prime stock ...
      fireEvent.click(selectionToggle("トヨタ自動車"));
      expect(selectionToggle("トヨタ自動車").getAttribute("aria-checked")).toBe("true");

      // ... and then narrows the results down to a US stock, so the previous
      // selection is no longer part of the current results.
      filterByKeyword("AAPL");
      await waitFor(() => {
        expect(screen.getByText(/表示中 0 \/ 全体 1 件選択中/)).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: /抽出結果を一括指数化/ }));

      // The basket must not be empty: the component falls back to the current
      // results instead of the (now invisible) selection.
      expect(onBatchCreateCustomIndex).toHaveBeenCalledTimes(1);
      const basket = onBatchCreateCustomIndex.mock.calls[0][0];
      expect(basket).toEqual([
        { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 100 },
      ]);
    });

    it("uses selected tickers when they match current results", async () => {
      const { onBatchCreateCustomIndex } = renderScreener();
      await waitForResults();

      fireEvent.click(selectionToggle("トヨタ自動車"));

      fireEvent.click(screen.getByRole("button", { name: /選択した1銘柄で指数化/ }));

      expect(onBatchCreateCustomIndex).toHaveBeenCalledTimes(1);
      const basket = onBatchCreateCustomIndex.mock.calls[0][0];
      expect(basket).toEqual([
        { ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 },
      ]);
    });

    it("handles select-all toggle across filtered views without wiping out other-view selections", async () => {
      renderScreener();
      await waitForResults();

      // A US ticker is selected in the unfiltered view.
      fireEvent.click(selectionToggle("Apple"));

      // The view is narrowed to the Prime stocks and "select all" is pressed.
      filterByKeyword("7203");
      await waitFor(() => {
        expect(selectionToggle("トヨタ自動車")).toBeTruthy();
      });
      fireEvent.click(selectAllToggle());
      expect(selectionToggle("トヨタ自動車").getAttribute("aria-checked")).toBe("true");
      // Both the visible and the off-screen selection are counted.
      expect(screen.getByText(/表示中 1 \/ 全体 2 件選択中/)).toBeTruthy();

      // Back to the full list: the US selection survived the filter change.
      filterByKeyword("");
      await waitFor(() => {
        expect(selectionToggle("Apple").getAttribute("aria-checked")).toBe("true");
      });
      expect(selectionToggle("トヨタ自動車").getAttribute("aria-checked")).toBe("true");

      // Narrowing down again and unselecting everything visible must only
      // clear the visible tickers.
      filterByKeyword("7203");
      await waitFor(() => {
        expect(selectAllToggle().getAttribute("aria-checked")).toBe("true");
      });
      fireEvent.click(selectAllToggle());
      expect(selectionToggle("トヨタ自動車").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/表示中 0 \/ 全体 1 件選択中/)).toBeTruthy();

      filterByKeyword("");
      await waitFor(() => {
        expect(selectionToggle("Apple").getAttribute("aria-checked")).toBe("true");
      });
      expect(selectionToggle("トヨタ自動車").getAttribute("aria-checked")).toBe("false");
    });
  });

  describe("Stock Price & Currency Display Formatting", () => {
    it("formats Japanese stock prices correctly without redundant .0 for integer prices", () => {
      const jpyMeta = getCurrencyMeta("7203", "PRIME");
      expect(jpyMeta.isJPY).toBe(true);
      expect(jpyMeta.symbol).toBe("¥");
      expect(jpyMeta.code).toBe("JPY");

      const formatted = formatStockPrice(2850, "7203");

      // Japanese stock price of 2850 should be "¥2,850" and NOT "¥2,850.0"
      expect(formatted).toBe("¥2,850");
      expect(formatted).not.toContain(".0");
    });

    it("formats Japanese stock prices with fractional values correctly", () => {
      const jpyMeta = getCurrencyMeta("7203", "PRIME");
      expect(jpyMeta.isJPY).toBe(true);

      const formatted = formatStockPrice(2850.5, "7203");

      expect(formatted).toBe("¥2,850.5");
    });

    it("formats US stock prices with 2 decimal places even for round numbers", () => {
      const usdMeta = getCurrencyMeta("AAPL", "US");
      expect(usdMeta.isUSD).toBe(true);
      expect(usdMeta.symbol).toBe("$");
      expect(usdMeta.code).toBe("USD");

      expect(formatStockPrice(150, "AAPL")).toBe("$150.00");
      expect(formatStockPrice(229.28, "AAPL")).toBe("$229.28");
    });
  });

  describe("Calendar Event Date Matching & Normalization", () => {
    it("matches zero-padded date '04/05' with the April 5th event", () => {
      expect(getEventDayOfWeek("04/05", "2026-04-05")).toBe("日");
    });

    it("matches unpadded date '4/5' with the April 5th event", () => {
      expect(getEventDayOfWeek("4/5", "2026-04-05")).toBe("日");
    });

    it("does not match a different day '4/6' with the April 5th event", () => {
      expect(getEventDayOfWeek("4/6", "2026-04-06")).toBe("月");
      expect(getEventDayOfWeek("4/6", "2026-04-06")).not.toBe(
        getEventDayOfWeek("4/5", "2026-04-05"),
      );
    });

    it("matches a full date that carries a time suffix", () => {
      expect(getEventDayOfWeek("04/05", "2026-04-05T10:00:00Z")).toBe("日");
    });

    it("treats the padded and the unpadded short date identically", () => {
      expect(getEventDayOfWeek("04/05")).toBe(getEventDayOfWeek("4/5"));
      expect(getEventDayOfWeek("04/05")).not.toBe(getEventDayOfWeek("04/06"));
    });

    it("safely handles invalid or empty dates without error", () => {
      expect(getEventDayOfWeek("invalid", "invalid")).toBe("");
      expect(getEventDayOfWeek("")).toBe("");
      expect(getEventDayOfWeek("4/invalid")).toBe("");
    });

    it("assigns an event to the calendar cell that matches its date", () => {
      // The cell assignment itself is inline in CalendarPage.tsx (it is not a
      // standalone helper), so the production implementation is pinned here.
      expect(calendarPageSource).toContain("e.fullDate.startsWith(dateKeyFull)");
      expect(calendarPageSource).toContain(
        "const normalizedShort = `${pad(mNum)}/${pad(dNum)}`;",
      );
      expect(calendarPageSource).toContain("if (normalizedShort !== dateKeyShort) return false;");
      expect(calendarPageSource).toContain("return cellYear === eventYear;");
    });
  });
});
