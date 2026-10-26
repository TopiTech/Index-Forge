// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins that lived in
 * `src/components/demoDataBadgeEnhancements.test.ts` (deleted alongside this
 * file).
 *
 * The old suite grepped `ConstituentsTable.tsx` / `PortfolioManagerPage.tsx`
 * for badge markup spellings (`item.isDemoData`, `参考値`, tooltip copy), so
 * it passed when the markup was typed anywhere and failed on refactors. These
 * drive the real components instead: a demo quote must surface a visible
 * 参考値 badge with its explanatory tooltip, and a live quote must not.
 *
 * The `calculatePortfolioSummary` propagation check is a pure unit test and
 * stays as-is (same as the batch3 tickers case).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { calculatePortfolioSummary, type PortfolioPosition } from "../lib/portfolioStorage";
import { STORAGE_KEY_PORTFOLIO } from "../lib/portfolioStorage";
import { ConstituentsTable } from "./ConstituentsTable";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import type { BasketItem, StockDetail } from "../types";

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated ? { id: "user-1", password: "pw", role: "user" } : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: false,
    isUser: authState.isAuthenticated,
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
  return {
    ...actual,
    getCachedStockFundamentals: vi.fn(),
    fetchStockFundamentals: vi.fn(),
  };
});

const { fetchStockFundamentals } = await import("../lib/marketDataService");
const fetchMock = vi.mocked(fetchStockFundamentals);

type DemoQuote = Awaited<ReturnType<typeof fetchStockFundamentals>>;

function demoQuote(ticker: string, isDemoData: boolean): DemoQuote {
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
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  authState.isAuthenticated = true;
  fetchMock.mockImplementation(async (ticker: string) => demoQuote(ticker, true));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Demo Data Badge Enhancements (Phase 3)", () => {
  it("calculatePortfolioSummary propagates isDemoData flag from live quotes or fallback", () => {
    const mockPositions: PortfolioPosition[] = [
      {
        id: "p1",
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2000,
      },
      {
        id: "p2",
        ticker: "999999", // Unknown ticker
        name: "仮想デモ銘柄",
        shares: 50,
        averageCost: 1000,
      },
    ];

    const liveQuotesMap = new Map([
      [
        "7203",
        {
          price: 2500,
          change: 50,
          dps: 60,
          name: "トヨタ自動車",
          isDemoData: false,
        },
      ],
      [
        "999999",
        {
          price: 1200,
          change: 10,
          dps: 20,
          name: "仮想デモ銘柄",
          isDemoData: true,
        },
      ],
    ]);

    const summary = calculatePortfolioSummary(mockPositions, liveQuotesMap, 150);
    const toyota = summary.positions.find((p) => p.ticker === "7203");
    const demoStock = summary.positions.find((p) => p.ticker === "999999");

    expect(toyota?.isDemoData).toBe(false);
    expect(demoStock?.isDemoData).toBe(true);
  });

  it("shows the 参考値 badge with its tooltip for a demo holding in ConstituentsTable", () => {
    const basket: BasketItem[] = [{ ticker: "7203", name: "トヨタ自動車", theme: "自動車", weight: 100 }];
    const baseDetail: StockDetail = {
      ticker: "7203",
      name: "トヨタ自動車",
      theme: "自動車",
      weight: 100,
      currentPrice: 2500,
      previousPrice: 2480,
      change: 20,
      changePct: 0.8,
      contributionPt: 0,
      contributionPct: 0,
      sparkline: [2480, 2500],
    };
    const { rerender } = render(
      <ConstituentsTable
        basket={basket}
        stockDetails={[{ ...baseDetail, isDemoData: true }]}
        selectedTheme={null}
      />,
    );

    // The table renders desktop and mobile layouts sharing the same badge.
    const badges = screen.getAllByTitle("実データ未取得のため推計デモ値を表示しています");
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect(badge.textContent).toBe("参考値");

    rerender(<ConstituentsTable basket={basket} stockDetails={[baseDetail]} selectedTheme={null} />);
    expect(
      screen.queryByTitle("実データ未取得のため推計デモ値を表示しています"),
    ).toBeNull();
  });

  it("shows the 参考値 badge for a demo position on the portfolio page", async () => {
    localStorage.setItem(
      STORAGE_KEY_PORTFOLIO,
      JSON.stringify([
        { id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2000 },
      ]),
    );
    render(<PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />);

    const badges = await screen.findAllByTitle("実データ未取得のため推計デモ値を表示しています");
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect(badge.textContent).toBe("参考値");
  });

  it("shows no 参考値 badge on the portfolio page for a live position", async () => {
    fetchMock.mockImplementation(async (ticker: string) => demoQuote(ticker, false));
    localStorage.setItem(
      STORAGE_KEY_PORTFOLIO,
      JSON.stringify([
        { id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2000 },
      ]),
    );
    render(<PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />);

    await waitFor(() =>
      expect(screen.queryByText(/保有株式一覧 \(1銘柄\)/)).not.toBeNull(),
    );
    await act(async () => {});
    expect(
      screen.queryByTitle("実データ未取得のため推計デモ値を表示しています"),
    ).toBeNull();
  });
});
