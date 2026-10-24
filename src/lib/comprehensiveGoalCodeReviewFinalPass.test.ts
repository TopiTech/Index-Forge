import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculatePortfolioSummary,
  addPortfolioPosition,
  loadPortfolioPositions,
  PortfolioPosition,
} from "./portfolioStorage";
import fs from "fs";
import path from "path";

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

describe("Comprehensive Goal Code Review Final Pass - Regressions & Invariants", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. Currency Precision in Portfolio Calculations", () => {
    it("maintains cent precision (2 decimals) for USD stocks instead of rounding to whole dollars", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-aapl",
          ticker: "AAPL",
          name: "Apple Inc.",
          shares: 10,
          averageCost: 150.25,
        },
      ];

      const liveQuotes = new Map([
        ["AAPL", { price: 155.75, change: 2.5, dps: 0.96 }],
      ]);

      const summary = calculatePortfolioSummary(positions, liveQuotes, 150);

      const pos = summary.positions[0];
      expect(pos).toBeDefined();
      // 10 shares * $155.75 = $1557.50
      expect(pos.marketValue).toBe(1557.5);
      // 10 shares * $150.25 = $1502.50
      expect(pos.totalCost).toBe(1502.5);
      // $1557.50 - $1502.50 = $55.00
      expect(pos.unrealizedProfit).toBe(55);
      // 10 shares * $2.50 = $25.00
      expect(pos.dailyChange).toBe(25);
      // 10 shares * $0.96 = $9.60
      expect(pos.annualDividend).toBe(9.6);
    });

    it("rounds JPY stocks to whole yen as customary in Japanese equities", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-7203",
          ticker: "7203",
          name: "トヨタ自動車",
          shares: 100,
          averageCost: 2500,
        },
      ];

      const liveQuotes = new Map([
        ["7203", { price: 2600.4, change: 15.6, dps: 45 }],
      ]);

      const summary = calculatePortfolioSummary(positions, liveQuotes, 150);

      const pos = summary.positions[0];
      expect(pos).toBeDefined();
      // 100 * 2600.4 = 260040 (Math.round)
      expect(pos.marketValue).toBe(260040);
      expect(pos.totalCost).toBe(250000);
      expect(pos.dailyChange).toBe(1560);
      expect(pos.annualDividend).toBe(4500);
    });
  });

  describe("2. Portfolio Storage Persistence Isolation", () => {
    it("does not leak demo preset stocks into persistence when adding the first position", () => {
      // Initially, store is empty
      expect(store.get("indexforge_user_portfolio_positions")).toBeUndefined();

      // Adding the first position
      const added = addPortfolioPosition({
        ticker: "6758",
        name: "ソニーグループ",
        shares: 100,
        averageCost: 2800,
      });

      expect(added).toBe(true);

      const stored = loadPortfolioPositions();
      // Stored list must contain only the added stock, not the 4 demo presets
      expect(stored.length).toBe(1);
      expect(stored[0].ticker).toBe("6758");
    });

    it("rejects invalid non-finite shares or averageCost", () => {
      const invalidShares = addPortfolioPosition({
        ticker: "7203",
        name: "トヨタ",
        shares: -10,
        averageCost: 2000,
      });
      expect(invalidShares).toBe(false);

      const invalidCost = addPortfolioPosition({
        ticker: "7203",
        name: "トヨタ",
        shares: 10,
        averageCost: NaN,
      });
      expect(invalidCost).toBe(false);
    });
  });

  describe("3. Code Architecture & Component Contracts", () => {
    it("verifies PortfolioManagerPage contains unmount guard and a11y region label", () => {
      const filePath = path.resolve(__dirname, "../components/PortfolioManagerPage.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("if (!mountedRef.current) return;");
      expect(content).toContain('aria-label="保有銘柄一覧テーブル"');
      expect(content).toContain('role="region"');
      expect(content).toContain("isFirstPersist ? [newPos] : [...prev, newPos]");
    });

    it("verifies StockTechnicalChart cleans up the TradingView widget without a lint suppression", () => {
      const filePath = path.resolve(__dirname, "../components/StockTechnicalChart.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("resizeTimers.forEach(clearTimeout);");
      expect(content).toContain("container.innerHTML = \"\";");
      // The mount effect now declares every value it reads, so the
      // exhaustive-deps rule no longer has to be silenced for it.
      expect(content).not.toContain("eslint-disable-next-line react-hooks/exhaustive-deps");
      // It still must not depend on activeIsMobile: the widget is not
      // re-mounted when the mobile breakpoint toggles.
      const mountEffectDeps = content.match(/\}, \[[^\]]*effectiveMode[^\]]*\]\);/);
      expect(mountEffectDeps).not.toBeNull();
      expect(mountEffectDeps?.[0]).not.toContain("activeIsMobile");
    });

    it("verifies App.tsx validates position prices and guards unauthenticated additions", () => {
      const filePath = path.resolve(__dirname, "../App.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).toContain("if (!isAuthenticated) {");
      expect(content).toContain("toastInfo(\"ポートフォリオ登録にはログインが必要です\");");
      expect(content).toContain("Number.isFinite(currentPrice) && currentPrice > 0");
    });
  });
});
