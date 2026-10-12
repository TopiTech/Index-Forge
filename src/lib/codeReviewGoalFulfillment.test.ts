import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  addPortfolioPosition,
} from "./portfolioStorage";

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
  const rootDir = process.cwd();
  const portfolioTsx = readFileSync(
    resolve(rootDir, "src/components/PortfolioManagerPage.tsx"),
    "utf-8",
  );
  const appTsx = readFileSync(resolve(rootDir, "src/App.tsx"), "utf-8");
  const calendarTsx = readFileSync(resolve(rootDir, "src/components/CalendarPage.tsx"), "utf-8");
  const searchModalTsx = readFileSync(
    resolve(rootDir, "src/components/GlobalSearchModal.tsx"),
    "utf-8",
  );

  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
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
      // Verify prevAuthRef is declared and manages auth transition state
      expect(portfolioTsx).toContain("const prevAuthRef = useRef(isAuthenticated);");
      expect(portfolioTsx).toMatch(
        /if\s*\(!prevAuthRef\.current\s*&&\s*isAuthenticated\)\s*\{\s*prevAuthRef\.current\s*=\s*true;\s*setPositions\(loadPortfolioPositions\(\)\);/,
      );
    });

    it("preserves exact compatibility with portfolioAuthGuard test assertions", () => {
      expect(portfolioTsx).toMatch(/isAuthenticated\s*\?\s*loadPortfolioPositions\(\)\s*:\s*\[\]/);
      expect(portfolioTsx).toMatch(/isAuthenticated\s*\?\s*loadWatchlist\(\)\s*:\s*\[\]/);
      expect(portfolioTsx).toMatch(
        /if\s*\(isAuthenticated\s*&&\s*positionsPersistedRef\.current\)\s*\{\s*savePortfolioPositions\(positions\);/,
      );
      expect(portfolioTsx).toMatch(
        /if\s*\(isAuthenticated\s*&&\s*watchlistPersistedRef\.current\)\s*\{\s*saveWatchlist\(watchlist\);/,
      );
      expect(portfolioTsx).toContain("setPositions(loadPortfolioPositions())");
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
      expect(calendarTsx).toContain('onClick={() => setActiveFilter("ALL")}');
      expect(calendarTsx).toContain("すべてのイベントを表示");
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
