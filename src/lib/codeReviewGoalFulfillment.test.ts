// @vitest-environment jsdom
/**
 * Regression suite for the code-review goal fulfillment items.
 *
 * The calendar empty-state reset is asserted on the rendered DOM: the old
 * contract only reset the event-type tab, so the importance / market / search
 * filters survived the reset and the empty state reappeared immediately.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  addPortfolioPosition,
} from "./portfolioStorage";
import { CalendarPage } from "../components/CalendarPage";
import { ToastProvider } from "../components/Toast";

// The jsdom environment externalizes the Node built-ins, so the sources are
// read through Vite's `?raw` suffix instead of `fs`/`path`.
import portfolioTsx from "../components/PortfolioManagerPage.tsx?raw";
import appTsx from "../App.tsx?raw";
import calendarTsx from "../components/CalendarPage.tsx?raw";
import searchModalTsx from "../components/GlobalSearchModal.tsx?raw";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

describe("Code Review Goal Fulfillment & Regression Verification", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("1. Portfolio Storage & addPortfolioPosition", () => {
    it("successfully adds a valid position to existing positions", () => {
      // Seed initial position
      savePortfolioPositions([
        {
          id: "pos-seed",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
        },
      ]);

      const added = addPortfolioPosition({
        ticker: "6758",
        name: "ソニーグループ",
        shares: 50,
        averageCost: 12000,
      });

      expect(added).toBe(true);
      const loaded = loadPortfolioPositions();
      expect(loaded).toHaveLength(2);
      expect(loaded[1].ticker).toBe("6758");
      expect(loaded[1].name).toBe("ソニーグループ");
      expect(loaded[1].shares).toBe(50);
      expect(loaded[1].averageCost).toBe(12000);
      expect(loaded[1].id).toContain("6758");
    });

    it("rejects invalid positions with non-positive shares or cost", () => {
      savePortfolioPositions([]);

      expect(
        addPortfolioPosition({
          ticker: "7203",
          name: "トヨタ自動車",
          shares: -10,
          averageCost: 2500,
        }),
      ).toBe(false);

      expect(
        addPortfolioPosition({
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 0,
        }),
      ).toBe(false);

      expect(
        addPortfolioPosition({
          ticker: "",
          name: "無効",
          shares: 100,
          averageCost: 2500,
        }),
      ).toBe(false);

      expect(loadPortfolioPositions()).toHaveLength(0);
    });
  });

  describe("2. PortfolioManagerPage Auth-Transition Guard", () => {
    it("guards against auth transition wiping stored portfolio with unauthenticated empty arrays", () => {
      // The transition must be handled in an effect, not during render: a
      // render-phase state update could be discarded, leaving the portfolio
      // empty while the transition was already marked as handled.
      expect(portfolioTsx).not.toMatch(/if\s*\(!prevAuthRef\.current\s*&&\s*isAuthenticated\)/);
      expect(portfolioTsx).not.toMatch(/prevAuthRef/);

      const effectIndex = portfolioTsx.indexOf("setPositions(loadPortfolioPositions())");
      expect(effectIndex).toBeGreaterThan(-1);
      const effectStart = portfolioTsx.lastIndexOf("useEffect(", effectIndex);
      const effectEnd = portfolioTsx.indexOf("}, [isAuthenticated]);", effectIndex);
      expect(effectStart).toBeGreaterThan(-1);
      expect(effectEnd).toBeGreaterThan(effectIndex);

      const transitionEffect = portfolioTsx.slice(effectStart, effectEnd);
      // The persisted positions are loaded only while authenticated, and the
      // in-memory lists are cleared when the session ends.
      expect(transitionEffect).toContain("if (isAuthenticated) {");
      expect(transitionEffect).toContain("setPositions(loadPortfolioPositions())");
      expect(transitionEffect).toContain("setWatchlist(loadWatchlist())");
      expect(transitionEffect).toContain("setPositions([])");
      expect(transitionEffect).toContain("setWatchlist([])");
      // The auto-save effects must not run for the state that is about to be
      // replaced by the persisted positions.
      expect(transitionEffect).toContain("isAuthTransitionRef.current = true;");
    });

    it("preserves the storage gating contract of the portfolio page", () => {
      expect(portfolioTsx).toContain("setPositions(loadPortfolioPositions())");
      expect(portfolioTsx).toContain("setWatchlist(loadWatchlist())");
      // Data persistence must only trigger when authenticated (and, since the
      // preset list is preview-only, only after the user has persisted data).
      expect(portfolioTsx).toMatch(
        /if\s*\(isAuthenticated\s*&&\s*positionsPersistedRef\.current\)\s*\{/,
      );
      expect(portfolioTsx).toMatch(
        /if\s*\(isAuthenticated\s*&&\s*watchlistPersistedRef\.current\)\s*\{/,
      );
      expect(portfolioTsx).toContain("savePortfolioPositions(positions);");
      expect(portfolioTsx).toContain("saveWatchlist(watchlist);");
    });
  });

  describe("3. StockDetailPage & App.tsx Portfolio Action Wiring", () => {
    it("wires handleAddToPortfolio to StockDetailPage in App.tsx", () => {
      expect(appTsx).toContain("onAddToPortfolio={handleAddToPortfolio}");
      expect(appTsx).toContain("const { isAdmin, isAuthenticated } = useAuth();");
      expect(appTsx).toContain("addPortfolioPosition({");
    });

    it("checks authentication before adding position and navigates to portfolio", () => {
      expect(appTsx).toMatch(
        /if\s*\(!isAuthenticated\)\s*\{\s*toastInfo\("ポートフォリオ登録にはログインが必要です"\);\s*navigateTo\("portfolio"\);\s*return;\s*\}/,
      );
    });
  });

  describe("4. CalendarPage Empty State & Accessibility", () => {
    it("renders role='status' and aria-live='polite' empty state container when filteredEvents is empty", () => {
      expect(calendarTsx).toContain("filteredEvents.length === 0 ?");
      expect(calendarTsx).toContain('role="status"');
      expect(calendarTsx).toContain('aria-live="polite"');
      expect(calendarTsx).toContain("該当するイベントが見つかりませんでした");
    });

    it("provides accessible reset filter button in CalendarPage empty state", () => {
      expect(calendarTsx).toContain("onClick={resetAllFilters}");
      expect(calendarTsx).toContain("すべてのイベントを表示");
      // The reset helper must clear every filter, not only the event type.
      expect(calendarTsx).toContain('setActiveFilter("ALL")');
      expect(calendarTsx).toContain('setImportanceFilter("ALL")');
      expect(calendarTsx).toContain('setMarketFilter("ALL")');
      expect(calendarTsx).toContain('setSearchQuery("")');
    });

    it("clears all four filters when the empty-state reset button is pressed", () => {
      // The calendar endpoint is unreachable in the test environment: the page
      // falls back to its generated (reference) events, which is enough to
      // exercise the filters.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network disabled in test");
        }),
      );

      render(
        createElement(
          ToastProvider,
          null,
          createElement(CalendarPage, {
            onNavigate: vi.fn(),
            onOpenStockDetail: vi.fn(),
          }),
        ),
      );

      const searchInput = screen.getByLabelText("イベント・銘柄名検索") as HTMLInputElement;
      const importanceSelect = screen.getByLabelText(
        "重要度フィルター",
      ) as HTMLSelectElement;
      const marketSelect = screen.getByLabelText("市場・地域フィルター") as HTMLSelectElement;
      const allTypesTab = screen.getByRole("button", { name: "全イベント" });

      // Apply all four filters.
      fireEvent.click(screen.getByRole("button", { name: "主要企業決算" }));
      fireEvent.change(importanceSelect, { target: { value: "LOW" } });
      fireEvent.change(marketSelect, { target: { value: "US" } });
      fireEvent.change(searchInput, { target: { value: "存在しない銘柄ZZZZ" } });

      expect(screen.getByText("該当するイベントが見つかりませんでした")).toBeTruthy();
      expect(allTypesTab.getAttribute("aria-pressed")).toBe("false");

      // The empty state offers the reset.
      fireEvent.click(screen.getByRole("button", { name: "すべてのイベントを表示" }));

      // Every filter is back to its default, not only the event type.
      expect(searchInput.value).toBe("");
      expect(importanceSelect.value).toBe("ALL");
      expect(marketSelect.value).toBe("ALL");
      expect(allTypesTab.getAttribute("aria-pressed")).toBe("true");

      // ...and the events are visible again.
      expect(screen.queryByText("該当するイベントが見つかりませんでした")).toBeNull();
    });
  });

  describe("5. GlobalSearchModal Non-Preset Ticker Recognition", () => {
    it("detects valid ticker patterns and generates synthetic direct stock result", () => {
      expect(searchModalTsx).toContain("isTickerPattern");
      expect(searchModalTsx).toContain("customStockResult");
      expect(searchModalTsx).toContain("/^[A-Z0-9.]{2,8}$/.test(upperQuery)");
      expect(searchModalTsx).toContain("個別銘柄の分析・詳細を表示");
    });

    it("avoids duplicate entries when search query matches preset ticker exactly", () => {
      expect(searchModalTsx).toContain(
        "const hasExactTicker = matchedStocks.some((s) => s.id.toUpperCase() === upperQuery);",
      );
      expect(searchModalTsx).toContain("isTickerPattern && !hasExactTicker");
    });
  });
});
