// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins in
 * `src/lib/batch3FixesComprehensiveVerification.test.ts` (audit U-3):
 *
 * - ISSUE-04 (App `handleAddStockToIndex` guard + shared `isAuthModalOpen`):
 *   the guard body is App-internal, but its entire observable effect flows
 *   through the props App passes to `Header` (`isAuthModalOpen`,
 *   `onOpenAuthModal`, `onCloseAuthModal`). These tests drive the real
 *   `Header` + `AuthModal` + `ModalBase` portal and prove the open/close
 *   state path instead of grepping the App source.
 * - ISSUE-05 (`IndexBuilderModal` / `TradingViewChartModal` portal wiring):
 *   `UI-05` moved overlays to `document.fullscreenElement ?? document.body`
 *   via `useOverlayRoot`, so asserting `createPortal` import spellings proves
 *   nothing about where the dialog ends up. These tests assert the rendered
 *   placement (portal into `document.body`, re-targeted into the fullscreen
 *   host on `fullscreenchange`) instead.
 * - ISSUE-11 first case (macro `disabled={isMacro}` / `if (isMacro) return`):
 *   these tests render the real `StockDetailPage` with a macro ticker and
 *   assert the disabled button, its tooltip, the missing add-to-index action,
 *   and the no-call guard — plus the non-macro contrast.
 *
 * The ISSUE-11 basket-filter case (`convertPortfolioToCustomIndexBasket`
 * tickers) is a pure unit test and stays where it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Header } from "./Header";
import { ToastProvider } from "./Toast";
import { IndexBuilderModal } from "./IndexBuilderModal";
import { TradingViewChartModal } from "./TradingViewChartModal";
import { getOverlayRoot } from "./ModalBase";
import { StockDetailPage } from "./StockDetailPage";
import type { StockQuoteFundamentals } from "../lib/marketDataService";

vi.mock("../hooks/useSimulation", () => ({
  useSimulation: () => ({}),
}));

vi.mock("./SimulationPreview", () => ({
  SimulationPreview: () => null,
}));

vi.mock("./StockTechnicalChart", () => ({
  StockTechnicalChart: () => null,
}));

vi.mock("../lib/theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/theme")>();
  return {
    ...actual,
    useTheme: () => ({ theme: "dark" as const, toggleTheme: vi.fn() }),
  };
});

vi.mock("../contexts/FreshnessContext", () => ({
  useRegisterFreshness: vi.fn(),
}));

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return {
    ...actual,
    getCachedStockFundamentals: vi.fn(),
    fetchStockFundamentals: vi.fn(),
  };
});

const { getCachedStockFundamentals, fetchStockFundamentals } = await import(
  "../lib/marketDataService"
);
const getCachedMock = vi.mocked(getCachedStockFundamentals);
const fetchMock = vi.mocked(fetchStockFundamentals);

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Pretend the page is in native fullscreen.
 *
 * jsdom does not implement the Fullscreen API, so `document.fullscreenElement`
 * is shadowed with an own property (same helper as
 * `globalSearchModalOverlay.test.ts`). Removed again by the restore function.
 */
function stubFullscreenElement(element: HTMLElement): () => void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
  return () => {
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  };
}

function makeQuote(ticker: string): StockQuoteFundamentals {
  return {
    ticker,
    name: ticker === "^N225" ? "日経平均株価" : ticker,
    theme: "テスト",
    sector: "テスト",
    market: "PRIME",
    price: 39000,
    change: 100,
    changePercent: 0.5,
    volume: 1000,
    previousClose: 38900,
    dayHigh: 39100,
    dayLow: 38800,
    yearHigh: 42000,
    yearLow: 33000,
    marketCap: 0,
    per: 15,
    pbr: 1.2,
    dividendYield: 2,
    roe: 8,
    equityRatio: 50,
    eps: 100,
    dps: 20,
    sparkline: [38900, 39000],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
  } as StockQuoteFundamentals;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // The Turnstile config request fails here; AuthModal falls back to its
  // default site key (same pattern as `uiHardening.test.tsx`).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in test");
    }),
  );
  getCachedMock.mockImplementation((ticker: string) => makeQuote(ticker));
  fetchMock.mockImplementation(async (ticker: string) => makeQuote(ticker));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("modal overlay portal placement (ISSUE-05 behavior)", () => {
  it("portals IndexBuilderModal outside the React tree into document.body", () => {
    expect(getOverlayRoot()).toBe(document.body);

    const { container } = render(
      <IndexBuilderModal isOpen onClose={() => {}} onSave={async () => ({ ok: true })} />,
    );

    const dialog = document.querySelector<HTMLElement>("[data-modal-dialog]");
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByText("独自指数ビルダー & リアルタイムシミュレーター")).toBeTruthy();
  });

  it("portals TradingViewChartModal outside the React tree into document.body", () => {
    expect(getOverlayRoot()).toBe(document.body);

    const { container } = render(
      <TradingViewChartModal
        symbol={{ proName: "TSE:7203", title: "トヨタ自動車" }}
        onClose={() => {}}
      />,
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("re-targets the overlay into the fullscreen host on fullscreenchange", () => {
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);
    const restore = stubFullscreenElement(fullscreenHost);

    try {
      expect(getOverlayRoot()).toBe(fullscreenHost);

      render(
        <IndexBuilderModal isOpen onClose={() => {}} onSave={async () => ({ ok: true })} />,
      );

      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });

      const movedDialog = fullscreenHost.querySelector("[data-modal-dialog]");
      expect(movedDialog).not.toBeNull();
      // The dialog left the plain document body for the fullscreen subtree,
      // where the browser actually paints it.
      expect(document.body.querySelector(":scope > .modal-overlay")).toBeNull();
    } finally {
      restore();
      fullscreenHost.remove();
    }
  });
});

describe("auth modal shared state path (ISSUE-04 behavior)", () => {
  function renderHeader(props: {
    isAuthModalOpen?: boolean;
    onOpenAuthModal?: () => void;
    onCloseAuthModal?: () => void;
  }) {
    return render(
      <ToastProvider>
        <Header {...props} />
      </ToastProvider>,
    );
  }

  it("opens the shared auth modal through onOpenAuthModal (App guard state path)", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    renderHeader({ isAuthModalOpen: false, onOpenAuthModal: onOpen, onCloseAuthModal: onClose });

    // Logged out: the login entry point is visible and no dialog is mounted.
    expect(
      screen.getByRole("button", { name: "パスワード認証でログイン" }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "パスワード認証でログイン" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // The click only flips the shared state; the dialog itself stays closed.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the login dialog while isAuthModalOpen and closes through onCloseAuthModal", () => {
    const onClose = vi.fn();
    renderHeader({ isAuthModalOpen: true, onOpenAuthModal: () => {}, onCloseAuthModal: onClose });

    const dialog = screen.getByRole("dialog", { name: "ログイン認証" });
    expect(document.body.contains(dialog)).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mounts no dialog once isAuthModalOpen flips back to false", () => {
    const { rerender } = render(
      <ToastProvider>
        <Header isAuthModalOpen onOpenAuthModal={() => {}} onCloseAuthModal={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole("dialog", { name: "ログイン認証" })).toBeTruthy();

    rerender(
      <ToastProvider>
        <Header isAuthModalOpen={false} onOpenAuthModal={() => {}} onCloseAuthModal={() => {}} />
      </ToastProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("macro asset portfolio guard (ISSUE-11 behavior)", () => {
  const noopNavigate = () => {};

  async function renderDetail(ticker: string, handlers: { onAddToPortfolio?: () => void } = {}) {
    render(
      <StockDetailPage
        ticker={ticker}
        onNavigate={noopNavigate}
        onAddToIndex={() => {}}
        onAddToWatchlist={() => {}}
        onAddToPortfolio={
          handlers.onAddToPortfolio ?? ((_t: string, _p: number, _n?: string) => {})
        }
      />,
    );
    await act(async () => {
      await flush();
    });
  }

  it("disables portfolio registration for a macro ticker and never calls through", async () => {
    const onAddToPortfolio = vi.fn();
    await renderDetail("^N225", { onAddToPortfolio });

    const registerButton = screen.getByRole("button", { name: "保有登録" });
    expect((registerButton as HTMLButtonElement).disabled).toBe(true);
    expect(registerButton.getAttribute("title")).toBe(
      "マクロ資産・指数・為替はポートフォリオ登録対象外です",
    );
    // A macro asset has no per-stock add action either.
    expect(screen.queryByRole("button", { name: "指数に追加" })).toBeNull();

    fireEvent.click(registerButton);
    expect(onAddToPortfolio).not.toHaveBeenCalled();
  });

  it("keeps portfolio registration enabled for an ordinary stock", async () => {
    const onAddToPortfolio = vi.fn();
    await renderDetail("7203", { onAddToPortfolio });

    const registerButton = screen.getByRole("button", { name: "保有登録" });
    expect((registerButton as HTMLButtonElement).disabled).toBe(false);
    expect(registerButton.getAttribute("title")).toBeNull();
    expect(screen.getByRole("button", { name: "指数に追加" })).toBeTruthy();

    fireEvent.click(registerButton);
    expect(onAddToPortfolio).toHaveBeenCalledTimes(1);
  });
});
