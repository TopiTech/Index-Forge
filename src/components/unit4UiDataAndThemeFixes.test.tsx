// @vitest-environment jsdom
/**
 * Behavioral regression tests for Unit 4B & 4C UI data, theme, and precision fixes.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStockQuote } from "../test-helpers/quote";
import { FreshnessProvider, useActiveFreshness } from "../contexts/FreshnessContext";
import { DataFreshness } from "./DataFreshness";
import { ToastProvider } from "./Toast";
import { STORAGE_KEY_PORTFOLIO, STORAGE_KEY_WATCHLIST } from "../lib/portfolioStorage";
import type { MarketOverviewData, CalendarEvent } from "../lib/marketDataService";

const {
  authState,
  themeState,
  getTurnstileConfigMock,
  fetchMarketOverviewMock,
  fetchUpcomingEventsMock,
  fetchScreenerStocksMock,
  fetchStockFundamentalsMock,
} = vi.hoisted(() => ({
  authState: {
    isAuthenticated: false,
    isAdmin: false,
    login: vi.fn(async () => ({ ok: true as const })),
    adminLogin: vi.fn(async () => ({ ok: true as const })),
    logout: vi.fn(),
  },
  themeState: {
    theme: "light" as "light" | "dark",
  },
  getTurnstileConfigMock: vi.fn(async () => ({
    siteKey: "test-site-key",
    lockout: { locked: false, remainingSeconds: 0, remainingAttempts: 5 },
  })),
  fetchMarketOverviewMock: vi.fn<() => Promise<MarketOverviewData>>(),
  fetchUpcomingEventsMock: vi.fn<() => Promise<CalendarEvent[]>>(),
  fetchScreenerStocksMock: vi.fn(),
  fetchStockFundamentalsMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated
      ? {
          id: "u1",
          name: "tester",
          role: authState.isAdmin ? ("admin" as const) : ("user" as const),
          password: "pw",
          adminToken: authState.isAdmin ? "tok-1" : undefined,
        }
      : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: authState.isAdmin,
    isUser: authState.isAuthenticated && !authState.isAdmin,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: authState.login,
    adminLogin: authState.adminLogin,
    logout: authState.logout,
    getHeaders: () => ({}),
    getAdminHeaders: () => (authState.isAdmin ? { "x-admin-session": "tok-1" } : {}),
  }),
}));

vi.mock("../lib/theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/theme")>();
  return {
    ...actual,
    useTheme: () => ({
      theme: themeState.theme,
      accent: "cyan" as const,
      setTheme: vi.fn(),
      setAccent: vi.fn(),
      toggleTheme: vi.fn(),
    }),
  };
});

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    getTurnstileConfig: getTurnstileConfigMock,
  };
});

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return {
    ...actual,
    fetchMarketOverview: fetchMarketOverviewMock,
    fetchUpcomingEvents: fetchUpcomingEventsMock,
    fetchScreenerStocks: fetchScreenerStocksMock,
    fetchStockFundamentals: fetchStockFundamentalsMock,
  };
});

vi.mock("./StockTechnicalChart", () => ({
  StockTechnicalChart: () => null,
}));

import { AuthModal } from "./AuthModal";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { AdminDashboard } from "./AdminDashboard";
import { MarketOverviewPage } from "./MarketOverviewPage";
import { CalendarPage } from "./CalendarPage";
import { ConstituentsTable } from "./ConstituentsTable";
import { ScreenerPage } from "./ScreenerPage";
import { StockAnalysisPage } from "./StockAnalysisPage";
import { RiskMetricsCard } from "./RiskMetricsCard";
import { SimulationPreview } from "./SimulationPreview";
import { StockDetailPage } from "./StockDetailPage";
import { Tutorial3DScene } from "./Tutorial3DScene";

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubTurnstile() {
  let latestCallback: ((token: string) => void) | undefined;
  const renderFn = vi.fn(
    (
      _container: HTMLElement | string,
      params: { theme?: string; callback?: (token: string) => void },
    ) => {
      latestCallback = params.callback;
      return "w-1";
    },
  );
  const resetFn = vi.fn();
  const removeFn = vi.fn();
  window.turnstile = { render: renderFn, reset: resetFn, remove: removeFn };
  return { renderFn, resetFn, removeFn, emitToken: (t: string) => latestCallback?.(t) };
}

afterEach(() => {
  cleanup();
  authState.isAuthenticated = false;
  authState.isAdmin = false;
  themeState.theme = "light";
  localStorage.clear();
  delete window.turnstile;
  delete window.onloadTurnstileCallback;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Unit 4B & 4C UI, Theme, and Numeric Safety Fixes", () => {
  it("skips forceContextLoss in Tutorial3DScene.destroy when forceContextLoss=false or context already lost", () => {
    const dispose = vi.fn();
    const forceContextLoss = vi.fn();
    const clear = vi.fn();
    const fakeInstance: {
      isDestroyed: boolean;
      animationFrameId: number | null;
      scene: { traverse: (cb: (child: unknown) => void) => void };
      renderer: {
        dispose: () => void;
        forceContextLoss: () => void;
        getContext: () => { isContextLost: () => boolean };
      };
      stepGroups: { clear: () => void };
    } = {
      isDestroyed: false,
      animationFrameId: null,
      scene: { traverse: () => {} },
      renderer: {
        dispose,
        forceContextLoss,
        getContext: () => ({ isContextLost: () => false }),
      },
      stepGroups: { clear },
    };

    // Context-loss teardown keeps context restorable.
    Tutorial3DScene.prototype.destroy.call(fakeInstance, false);
    expect(forceContextLoss).not.toHaveBeenCalled();

    // Already-lost GL context also avoids redundant forceContextLoss().
    fakeInstance.renderer.getContext = () => ({ isContextLost: () => true });
    Tutorial3DScene.prototype.destroy.call(fakeInstance, true);
    expect(forceContextLoss).not.toHaveBeenCalled();

    // Active context on unmount forces release so WebGL slots do not leak.
    fakeInstance.renderer.getContext = () => ({ isContextLost: () => false });
    Tutorial3DScene.prototype.destroy.call(fakeInstance, true);
    expect(forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("forwards active theme to TurnstileWidget and clears stale token on AuthModal mode switch", async () => {
    themeState.theme = "light";
    const ts = stubTurnstile();

    render(
      <ToastProvider>
        <AuthModal isOpen={true} onClose={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => expect(ts.renderFn).toHaveBeenCalled());
    expect(ts.renderFn.mock.calls[0][1].theme).toBe("light");

    // Verify Turnstile in admin mode, switch to user mode, then switch back.
    act(() => ts.emitToken("solved-token"));
    fireEvent.click(screen.getByRole("button", { name: "一般ユーザー" }));
    fireEvent.click(screen.getByRole("button", { name: "管理者ログイン" }));

    // Fill admin credentials WITHOUT re-solving Turnstile -> must reject due to reset token.
    fireEvent.change(screen.getByPlaceholderText("管理者パスワード"), {
      target: { value: "admin-pass" },
    });
    fireEvent.change(screen.getByPlaceholderText("ひらがな・カタカナ・英数字・記号で入力"), {
      target: { value: "ひみつ" },
    });
    const submitBtn = document.querySelector('form#auth-modal-form button[type="submit"]') as HTMLButtonElement | null;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.disabled).toBe(true);
  });

  it("keeps PortfolioManagerPage quote loading stable on duplicate-ticker position add and formats watchlist prices", async () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    authState.isAuthenticated = true;
    localStorage.setItem(
      STORAGE_KEY_PORTFOLIO,
      JSON.stringify([{ id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2800 }]),
    );
    localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(["AAPL", "7203"]));

    fetchStockFundamentalsMock.mockImplementation(async (ticker: string) =>
      createStockQuote({
        ticker,
        name: ticker === "AAPL" ? "Apple" : "トヨタ自動車",
        market: ticker === "AAPL" ? "US" : "PRIME",
        price: ticker === "AAPL" ? 182.5 : ticker === "USDJPY=X" ? 150.25 : 2850,
      }),
    );

    render(
      <FreshnessProvider>
        <ToastProvider>
          <PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
        </ToastProvider>
      </FreshnessProvider>,
    );

    await waitFor(() => expect(fetchStockFundamentalsMock).toHaveBeenCalledTimes(3));

    // Switch to watchlist and verify currency-formatted price ($182.50, not $182.5).
    fireEvent.click(screen.getByRole("button", { name: /監視中ウォッチリスト/ }));
    expect(await screen.findByText("$182.50")).toBeTruthy();

    // Add a second lot of already-held ticker 7203 -> quote set unchanged -> no refetch!
    fireEvent.click(screen.getByRole("button", { name: /保有銘柄を追加/ }));
    fireEvent.change(screen.getByLabelText("銘柄コード (ティッカー)"), { target: { value: "7203" } });
    fireEvent.change(screen.getByLabelText("保有株数"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/平均取得単価/), { target: { value: "2800" } });
    fireEvent.click(screen.getByRole("button", { name: "登録する" }));

    fireEvent.click(screen.getByRole("button", { name: /保有株式一覧/ }));
    await waitFor(() => {
      expect(screen.getAllByText(/25株/).length).toBeGreaterThan(0);
    });
    expect(fetchStockFundamentalsMock).toHaveBeenCalledTimes(3);
  });

  it("renders valid color-mix badge styles and clamps sentiment scores in MarketOverviewPage", async () => {
    fetchMarketOverviewMock.mockResolvedValue({
      dataSource: "live",
      dataAsOf: "2026-10-24T06:00:00.000Z",
      indices: [],
      forex: [],
      commodities: [],
      crypto: [],
      sectors: [],
      marketBreadth: { gainers: 1000, losers: 200, unchanged: 50, sentimentScore: 150 },
      news: [],
    });

    const { container } = render(
      <FreshnessProvider>
        <MarketOverviewPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
      </FreshnessProvider>,
    );

    expect(await screen.findByText("100")).toBeTruthy();
    const badge = screen.getByText(/EXTREME GREED/);
    expect(badge.getAttribute("style") ?? "").toContain("color-mix(");
    expect(badge.getAttribute("style") ?? "").not.toContain("var(--neon-green)1a");

    const progressBar = container.querySelector('div[style*="width: 100%"]');
    expect(progressBar).not.toBeNull();
  });

  it("clears LIVE timestamp in CalendarPage when reloading degrades to fallback and colors negative actuals red", async () => {
    const liveEvent: CalendarEvent = {
      id: "ev-live",
      date: "11/14",
      fullDate: "2026-11-14",
      type: "MACRO",
      title: "実質GDP速報",
      importance: "HIGH",
      time: "08:50 JST",
      market: "TSE",
      previous: "+0.5%",
      forecast: "+0.2%",
      actual: "-1.2%",
      source: "yahoo",
    };
    const fallbackEvent: CalendarEvent = { ...liveEvent, id: "ev-fb", source: "fallback" };

    fetchUpcomingEventsMock.mockResolvedValueOnce([liveEvent]).mockResolvedValueOnce([fallbackEvent]);

    function CalendarFreshnessHarness() {
      const freshness = useActiveFreshness("calendar");
      return (
        <>
          <DataFreshness {...freshness} />
          <CalendarPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
        </>
      );
    }

    render(
      <FreshnessProvider>
        <ToastProvider>
          <CalendarFreshnessHarness />
        </ToastProvider>
      </FreshnessProvider>,
    );

    await screen.findByText("実質GDP速報");
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0].textContent).toContain("LIVE");
    });

    // Open event modal via its detail button and check negative actual uses --color-negative.
    fireEvent.click(screen.getByRole("button", { name: "実質GDP速報のイベント詳細を表示" }));
    const dialog = screen.getByRole("dialog");
    const actualNode = within(dialog).getByText("-1.2%");
    expect((actualNode as HTMLElement).style.color).toBe("var(--color-negative)");

    fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(fetchUpcomingEventsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const statusText = screen.getAllByRole("status")[0].textContent ?? "";
      expect(statusText).not.toContain("LIVE");
      expect(statusText).toContain("決算・マクロ日程");
    });
  });

  it("renders neutral sparklines as --text-muted and normalizes -0 / NaN across UI views", async () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    // 1. ConstituentsTable neutral sparkline
    const { container: cTable } = render(
      <ToastProvider>
        <ConstituentsTable
          basket={[{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }]}
          stockDetails={[
            {
              ticker: "7203",
              name: "トヨタ",
              theme: "自動車",
              weight: 100,
              currentPrice: 2850,
              previousPrice: 2850,
              change: 0,
              changePct: 0,
              contributionPt: 0,
              contributionPct: 0,
              sparkline: [2850, 2850, 2850],
            },
          ]}
          selectedTheme={null}
        />
      </ToastProvider>,
    );
    const polyline = cTable.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("var(--text-muted)");

    // 2. RiskMetricsCard & SimulationPreview near-zero sharpe / winRate normalization
    const flatSeries = [
      { date: "2026-01-01", close: 1000, value: 1000 },
      { date: "2026-01-02", close: 1000, value: 1000 },
    ];
    render(<RiskMetricsCard customSeries={flatSeries} benchmarkSeries={flatSeries} />);
    expect(screen.queryByText("-0.00")).toBeNull();
    expect(screen.queryByText("-0.0%")).toBeNull();

    render(
      <SimulationPreview
        baseValue={1000}
        simulation={{
          customSeries: flatSeries,
          filteredCustomSeries: flatSeries,
          filteredBenchmarkSeries: flatSeries,
          stockUniverse: [],
          metrics: {
            annualReturn: 0,
            annualVolatility: -0.001,
            sharpeRatio: -0.001,
            maxDrawdown: -0.001,
            beta: -0.001,
            winRate: -0.001,
            bestDay: 0,
            worstDay: 0,
          },
          periodCustomReturnPct: 0,
          periodBenchmarkReturnPct: 0,
          alphaPct: 0,
          constituentsPerformance: [],
          loading: false,
          benchmarkLoading: false,
          error: null,
          syncWarnings: [],
          usingDemoData: false,
          usingDemoBenchmark: false,
          timeframe: "1M",
          setTimeframe: () => {},
          selectedBenchmark: "^N225",
          setSelectedBenchmark: () => {},
          runSimulation: async () => {},
        }}
      />,
    );
    expect(screen.queryByText("-0.00")).toBeNull();
    expect(screen.queryByText("-0.0%")).toBeNull();

    // 3. ScreenerPage NaN & -0.001 yield/roe normalization (fetchScreenerStocks returns an array!)
    const screenerStock = createStockQuote({
      ticker: "9999",
      name: "検証銘柄",
      market: "PRIME",
      price: 1200,
      change: 0,
      changePercent: 0,
      dividendYield: -0.001,
      roe: Number.NaN,
      per: 12.5,
      pbr: 1.2,
      sparkline: [1200, 1200, 1200],
    });
    fetchScreenerStocksMock.mockResolvedValue([screenerStock]);
    render(
      <FreshnessProvider>
        <ToastProvider>
          <ScreenerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
        </ToastProvider>
      </FreshnessProvider>,
    );
    expect((await screen.findAllByText("検証銘柄")).length).toBeGreaterThan(0);
    expect(screen.queryByText("-0.00%")).toBeNull();
    cleanup();

    // 4. StockAnalysisPage neutral sparkline
    const { container: cAnalysis } = render(
      <FreshnessProvider>
        <ToastProvider>
          <StockAnalysisPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
        </ToastProvider>
      </FreshnessProvider>,
    );
    expect((await screen.findAllByText("検証銘柄")).length).toBeGreaterThan(0);
    expect(cAnalysis.querySelector('polyline[stroke="var(--text-muted)"]')).not.toBeNull();
    cleanup();

    // 5. StockDetailPage -0.001 operating margin / -0 EPS
    fetchStockFundamentalsMock.mockResolvedValue(
      createStockQuote({
        ticker: "7203",
        historicalFinances: [
          {
            fiscalYear: "2026",
            revenue: 100000,
            operatingIncome: -0.1,
            netIncome: 100,
            eps: -0.001,
            dps: 0,
          },
        ],
      }),
    );
    render(
      <FreshnessProvider>
        <StockDetailPage ticker="7203" onNavigate={() => {}} />
      </FreshnessProvider>,
    );
    await waitFor(() => expect(fetchStockFundamentalsMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: /業績・財務ハイライト/ }));
    await screen.findByText("2026");
    expect(screen.queryByText("-0.0%")).toBeNull();
    expect(screen.queryByText("-0.0円")).toBeNull();
  });

  it("handles AdminDashboard invalid created_at timestamps and theme-safe lockout text", async () => {
    themeState.theme = "light";
    authState.isAuthenticated = true;
    authState.isAdmin = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/passwords")) {
          return new Response(
            JSON.stringify([
              {
                id: "u1",
                name: "境界タイムスタンプ0",
                role: "user",
                max_stocks: 10,
                max_indices: 5,
                is_active: 1,
                created_at: 0,
              },
              {
                id: "u2",
                name: "境界タイムスタンプ過大",
                role: "user",
                max_stocks: 10,
                max_indices: 5,
                is_active: 1,
                created_at: 1e14,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            dbStatus: "OK",
            indicesCount: 1,
            totalConstituents: 5,
            userPasswordsCount: 2,
            activeUsersCount: 2,
            adminUsersCount: 0,
            cacheStats: { hits: 0, misses: 0, hitRatio: "0%" },
            serverTime: "2026-11-14T00:00:00Z",
            version: "1.0.0",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    render(
      <ToastProvider>
        <AdminDashboard
          indices={[]}
          onBackToApp={() => {}}
          onRefreshIndices={async () => {}}
          saveCustomIndex={async () => ({ ok: true })}
          deleteCustomIndex={async () => ({ ok: true })}
        />
      </ToastProvider>,
    );

    expect(await screen.findByText("境界タイムスタンプ0")).toBeTruthy();
    expect(await screen.findByText("境界タイムスタンプ過大")).toBeTruthy();
    expect(screen.queryByText("Invalid Date")).toBeNull();
    expect(screen.queryByText("1970/1/1")).toBeNull();

    // Also test lockout countdown color when unauthenticated.
    cleanup();
    authState.isAuthenticated = false;
    authState.isAdmin = false;
    stubTurnstile();
    getTurnstileConfigMock.mockResolvedValue({
      siteKey: "test-site-key",
      lockout: { locked: true, remainingSeconds: 120, remainingAttempts: 0 },
    });

    render(
      <ToastProvider>
        <AdminDashboard
          indices={[]}
          onBackToApp={() => {}}
          onRefreshIndices={async () => {}}
          saveCustomIndex={async () => ({ ok: true })}
          deleteCustomIndex={async () => ({ ok: true })}
        />
      </ToastProvider>,
    );

    const countdownText = await screen.findByText(/解除まで残り:/);
    const parentRow = countdownText.parentElement;
    expect(parentRow?.style.color).toBe("var(--text-primary)");
  });
});
