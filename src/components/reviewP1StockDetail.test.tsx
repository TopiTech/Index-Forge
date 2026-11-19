// @vitest-environment jsdom
/**
 * UI-1 P1-06: a failed fetch must be announced as such instead of claiming
 * that the displayed cached values are "latest data", and must offer a retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StockQuoteFundamentals } from "../lib/marketDataService";

const { fetchStockFundamentals, getCachedStockFundamentals } = vi.hoisted(() => ({
  fetchStockFundamentals: vi.fn(),
  getCachedStockFundamentals: vi.fn(),
}));

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchStockFundamentals, getCachedStockFundamentals };
});
vi.mock("../lib/theme", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }) }));
vi.mock("../contexts/FreshnessContext", () => ({ useRegisterFreshness: vi.fn() }));
vi.mock("./StockTechnicalChart", () => ({ StockTechnicalChart: () => null }));

import { StockDetailPage } from "./StockDetailPage";

function quote(): StockQuoteFundamentals {
  return {
    ticker: "7203",
    name: "トヨタ",
    theme: "自動車",
    sector: "製造",
    market: "PRIME",
    price: 2800,
    change: 10,
    changePercent: 0.4,
    volume: 1000,
    previousClose: 2790,
    dayHigh: 2820,
    dayLow: 2780,
    yearHigh: 3200,
    yearLow: 2000,
    marketCap: 1000000,
    per: 12,
    pbr: 1,
    dividendYield: 2,
    roe: 8,
    equityRatio: 50,
    eps: 200,
    dps: 40,
    sparkline: [2700, 2800],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
  } as StockQuoteFundamentals;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedStockFundamentals.mockImplementation(() => quote());
});
afterEach(() => cleanup());

describe("StockDetailPage fetch failure (P1-06)", () => {
  it("announces a failed refresh and lets the user retry", async () => {
    fetchStockFundamentals.mockRejectedValueOnce(new Error("offline"));
    fetchStockFundamentals.mockResolvedValue(quote());

    render(<StockDetailPage ticker="7203" onNavigate={vi.fn()} />);
    await waitFor(() => expect(fetchStockFundamentals).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("status").textContent).toContain("取得失敗（前回データを表示中）");
    expect(screen.getByRole("status").textContent).not.toContain("最新データを表示中");
    expect(screen.getByRole("alert").textContent).toContain("最新値を取得できませんでした");

    const retry = screen.getByRole("button", { name: "再試行" });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(fetchStockFundamentals).toHaveBeenCalledTimes(2);
    expect(fetchStockFundamentals.mock.calls[1]?.[1]).toBe(true);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("最新データを表示中"));
  });
});
