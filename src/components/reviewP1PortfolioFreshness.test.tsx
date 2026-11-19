// @vitest-environment jsdom
/**
 * UI-1 P1-02: a live FX quote must not make demo-priced holdings look fresh.
 * The freshness timestamp is read through the real context, not by inspecting
 * the implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { StockQuoteFundamentals } from "../lib/marketDataService";

const { fetchStockFundamentals } = vi.hoisted(() => ({ fetchStockFundamentals: vi.fn() }));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdmin: false,
    session: { id: "u1", role: "user" },
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    loading: false,
  }),
}));
vi.mock("../lib/theme", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }) }));
vi.mock("./Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchStockFundamentals };
});
vi.mock("../lib/portfolioStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portfolioStorage")>();
  return {
    ...actual,
    loadPortfolioPositions: () => [
      {
        id: "p1",
        ticker: "AAPL",
        name: "Apple",
        shares: 10,
        averageCost: 100,
        acquiredAt: "2026-01-01",
      },
    ],
    loadWatchlist: () => [],
    savePortfolioPositions: vi.fn(() => true),
    saveWatchlist: vi.fn(() => true),
    hasPersistedPortfolio: () => true,
    hasPersistedWatchlist: () => true,
  };
});

import { FreshnessProvider, useActiveFreshness } from "../contexts/FreshnessContext";
import { PortfolioManagerPage } from "./PortfolioManagerPage";

function quote(ticker: string, price: number, isDemoData: boolean): StockQuoteFundamentals {
  return {
    ticker,
    name: ticker,
    theme: "テスト",
    sector: "テスト",
    market: "US",
    price,
    change: 0,
    changePercent: 0,
    volume: 100,
    previousClose: price,
    dayHigh: price,
    dayLow: price,
    yearHigh: price,
    yearLow: price,
    marketCap: 100,
    per: 10,
    pbr: 1,
    dividendYield: 1,
    roe: 5,
    equityRatio: 50,
    eps: 10,
    dps: 1,
    sparkline: [price, price],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
    ...(isDemoData ? { isDemoData: true as const } : {}),
  } as StockQuoteFundamentals;
}

function FreshnessProbe() {
  const freshness = useActiveFreshness("portfolio");
  return <span data-testid="portfolio-updated-at">{String(freshness.updatedAt)}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchStockFundamentals.mockImplementation((ticker: string) =>
    Promise.resolve(
      ticker === "USDJPY=X" ? quote(ticker, 150, false) : quote(ticker, 180, true),
    ),
  );
});
afterEach(() => cleanup());

describe("PortfolioManagerPage freshness (P1-02)", () => {
  it("does not stamp a refresh time when only the FX row is live", async () => {
    render(
      <FreshnessProvider>
        <PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        <FreshnessProbe />
      </FreshnessProvider>,
    );

    // Wait until the live FX quote has actually been committed, so the
    // assertion is about the post-refresh state rather than the initial one.
    await waitFor(() =>
      expect(screen.getByText("(リアルタイム為替市場レート適用)")).toBeTruthy(),
    );
    expect(screen.getByTestId("portfolio-updated-at").textContent).toBe("null");
  });

  it("stamps a refresh time when a holding itself is live", async () => {
    fetchStockFundamentals.mockImplementation((ticker: string) =>
      Promise.resolve(quote(ticker, ticker === "USDJPY=X" ? 150 : 180, false)),
    );
    render(
      <FreshnessProvider>
        <PortfolioManagerPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        <FreshnessProbe />
      </FreshnessProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("portfolio-updated-at").textContent).not.toBe("null"));
    expect(screen.getByTestId("portfolio-updated-at").textContent).not.toBe("undefined");
  });
});
