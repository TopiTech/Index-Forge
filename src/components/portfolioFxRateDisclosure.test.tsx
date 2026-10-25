// @vitest-environment jsdom
/**
 * S9: every FX note on the portfolio page must disclose the same provenance.
 *
 * The page shows the applied USD/JPY rate in three places. When the live quote
 * cannot be fetched it uses `DEFAULT_USD_JPY_RATE`, and the notes used to call
 * that constant "real-time". The rate and its provenance are now derived once;
 * this test drives the page in both states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import type { StockQuoteFundamentals } from "../lib/marketDataService";
import { STORAGE_KEY_PORTFOLIO } from "../lib/portfolioStorage";

const { fetchStockFundamentals } = vi.hoisted(() => ({
  fetchStockFundamentals: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: { id: "user-1", password: "pw", role: "user" },
    isAuthenticated: true,
    isAdmin: false,
    isUser: true,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: () => ({}),
  }),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchStockFundamentals };
});

import { PortfolioManagerPage } from "./PortfolioManagerPage";

function quote(ticker: string, price: number): StockQuoteFundamentals {
  return {
    ticker,
    name: ticker,
    theme: "テスト",
    sector: "Unknown",
    market: "US",
    price,
    change: 0,
    changePercent: 0,
    volume: 0,
    previousClose: price,
    dayHigh: price,
    dayLow: price,
    yearHigh: price,
    yearLow: price,
    marketCap: 0,
    per: null,
    pbr: null,
    dividendYield: null,
    roe: null,
    equityRatio: null,
    eps: null,
    dps: null,
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
  };
}

function seedUsdPosition(): void {
  localStorage.setItem(
    STORAGE_KEY_PORTFOLIO,
    JSON.stringify([
      {
        id: "pos-aapl",
        ticker: "AAPL",
        name: "Apple Inc.",
        shares: 10,
        averageCost: 100,
        currentPrice: 100,
        acquiredAt: "2024-01-01",
      },
    ]),
  );
}

function page() {
  return (
    <PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchStockFundamentals.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortfolioManagerPage FX rate disclosure (S9)", () => {
  it("labels the live quote as real-time in every FX note", async () => {
    fetchStockFundamentals.mockImplementation(async (ticker: string) =>
      ticker.toUpperCase() === "USDJPY=X" ? quote("USDJPY=X", 150.25) : quote(ticker, 100),
    );
    seedUsdPosition();

    render(page());
    await act(async () => {});

    expect(screen.getAllByText(/リアルタイム為替市場レート適用/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/基準参考レート/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /保有銘柄を追加/ }));
    expect(screen.getByText(/為替市場のリアルタイムレート/)).toBeTruthy();
    expect(screen.getByText(/1 USD ≒ 150\.25 円/)).toBeTruthy();
  });

  it("labels the fallback constant as a reference rate, never as real-time", async () => {
    fetchStockFundamentals.mockRejectedValue(new Error("offline"));
    seedUsdPosition();

    render(page());
    await act(async () => {});

    expect(screen.getAllByText(/基準参考レート/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/リアルタイム為替市場レート適用/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /保有銘柄を追加/ }));
    expect(
      screen.getByText(
        new RegExp(`基準参考レート \\(1 USD ≒ ${DEFAULT_USD_JPY_RATE.toFixed(2)} 円\\)`),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/為替市場のリアルタイムレート/)).toBeNull();
  });
});
