import { describe, it, expect, afterEach, vi } from "vitest";
import {
  addPortfolioPosition,
  addWatchlistTicker,
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  hasPersistedPortfolio,
  hasPersistedWatchlist,
  loadPortfolioPositions,
  loadWatchlist,
  sanitizeWatchlist,
  savePortfolioPositions,
  saveWatchlist,
  type PortfolioPosition,
} from "./portfolioStorage";

const PORTFOLIO_KEY = "indexforge_user_portfolio_positions";
const WATCHLIST_KEY = "indexforge_user_watchlist";

/** Installs a minimal in-memory localStorage so persistence can be asserted. */
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PortfolioStorage & Engine", () => {
  const samplePositions: PortfolioPosition[] = [
    {
      id: "p1",
      ticker: "7203",
      name: "トヨタ自動車",
      shares: 100,
      averageCost: 2000,
    },
    {
      id: "p2",
      ticker: "8035",
      name: "東京エレクトロン",
      shares: 10,
      averageCost: 20000,
    },
  ];

  it("calculates summary totals correctly", () => {
    const summary = calculatePortfolioSummary(samplePositions);
    expect(summary.totalCost).toBe(400000); // 100*2000 + 10*20000 = 400,000
    expect(summary.totalMarketValue).toBeGreaterThan(0);
    expect(summary.positions.length).toBe(2);

    // Sum of weights should be approximately 100%
    const totalWeight = summary.positions.reduce((sum, p) => sum + p.weightPercent, 0);
    expect(totalWeight).toBeGreaterThanOrEqual(99.0);
    expect(totalWeight).toBeLessThanOrEqual(101.0);
  });

  it("converts portfolio to custom index basket with proportional weights", () => {
    const basket = convertPortfolioToCustomIndexBasket(samplePositions);
    expect(basket.length).toBe(2);
    expect(basket[0].ticker).toBe("7203");
    expect(basket[1].ticker).toBe("8035");
    expect(basket[0].weight).toBeGreaterThan(0);
    expect(basket[1].weight).toBeGreaterThan(0);
  });

  it("handles empty positions gracefully", () => {
    const summary = calculatePortfolioSummary([]);
    expect(summary.totalMarketValue).toBe(0);
    expect(summary.positions.length).toBe(0);

    const basket = convertPortfolioToCustomIndexBasket([]);
    expect(basket.length).toBe(0);
  });

  it("converts a larger portfolio with weights summing to exactly 100", () => {
    const positions: PortfolioPosition[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      ticker: `${7000 + i}`,
      name: `銘柄${i}`,
      shares: 100 * (i + 1),
      averageCost: 1000 + i,
    }));
    const basket = convertPortfolioToCustomIndexBasket(positions);
    expect(basket.length).toBe(7);
    const total = basket.reduce((sum, item) => sum + item.weight, 0);
    expect(total).toBe(100);
    expect(basket.every((item) => item.weight >= 1)).toBe(true);
  });

  it("aggregates multiple lots/positions of the same ticker to prevent duplicate basket items", () => {
    const multiLotPositions: PortfolioPosition[] = [
      { id: "lot-1", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2400 },
      { id: "lot-2", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2600 },
      { id: "lot-3", ticker: "8035", name: "東京エレクトロン", shares: 10, averageCost: 25000 },
    ];
    const basket = convertPortfolioToCustomIndexBasket(multiLotPositions);
    // Even though there are 3 positions, there are only 2 distinct tickers
    expect(basket).toHaveLength(2);
    const tickers = basket.map((b) => b.ticker);
    expect(tickers).toEqual(["7203", "8035"]);
    // Unique tickers guarantee no duplicate constituent errors downstream
    expect(new Set(tickers).size).toBe(2);
    const totalWeight = basket.reduce((sum, item) => sum + item.weight, 0);
    expect(totalWeight).toBe(100);
  });

  describe("storage hardening", () => {
    it("round-trips saved positions", () => {
      stubLocalStorage();
      savePortfolioPositions(samplePositions);
      expect(loadPortfolioPositions()).toEqual(samplePositions);
    });

    it("drops malformed entries instead of crashing the page", () => {
      const store = stubLocalStorage();
      store.set(
        PORTFOLIO_KEY,
        JSON.stringify([
          null,
          "garbage",
          { id: "bad", ticker: "", shares: 10, averageCost: 100 },
          { id: "bad2", ticker: "7203", shares: "abc", averageCost: 100 },
          { id: "bad3", ticker: "7203", shares: 10, averageCost: -5 },
          { id: "bad4", ticker: "7203", shares: 0, averageCost: 100 },
          { id: "good", ticker: "8058", name: "三菱商事", shares: 300, averageCost: 2680 },
        ]),
      );
      const positions = loadPortfolioPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].ticker).toBe("8058");
      expect(positions[0].shares).toBe(300);
    });

    it("falls back to presets when every stored entry is corrupt", () => {
      const store = stubLocalStorage();
      store.set(PORTFOLIO_KEY, JSON.stringify([{ shares: 10 }]));
      const positions = loadPortfolioPositions();
      expect(positions.length).toBeGreaterThan(0);
      // Preset fallback keeps a valid shape
      positions.forEach((position) => {
        expect(position.ticker).toBeTruthy();
        expect(position.shares).toBeGreaterThan(0);
        expect(position.averageCost).toBeGreaterThan(0);
      });
    });

    it("normalizes a watchlist to unique uppercase strings", () => {
      expect(sanitizeWatchlist([" nvda ", "NVDA", "", 42, null, "7203"])).toEqual(["NVDA", "7203"]);
      expect(sanitizeWatchlist("not-an-array")).toEqual([]);
    });

    it("persists watchlist additions and reports duplicates", () => {
      const store = stubLocalStorage();
      store.set(WATCHLIST_KEY, JSON.stringify(["6857"]));

      expect(addWatchlistTicker("nvda")).toBe(true);
      expect(loadWatchlist()).toEqual(["6857", "NVDA"]);
      expect(addWatchlistTicker("NVDA")).toBe(false);
      expect(loadWatchlist()).toEqual(["6857", "NVDA"]);
      expect(addWatchlistTicker("   ")).toBe(false);
    });

    it("round-trips a saved watchlist through the loader", () => {
      stubLocalStorage();
      saveWatchlist(["AAPL", "aapl", "6920"]);
      expect(loadWatchlist()).toEqual(["AAPL", "6920"]);
    });

    it("persists deliberate empty positions when user clears all positions", () => {
      stubLocalStorage();
      savePortfolioPositions([]);
      expect(loadPortfolioPositions()).toEqual([]);
    });

    it("persists deliberate empty watchlist when user clears watchlist", () => {
      stubLocalStorage();
      saveWatchlist([]);
      expect(loadWatchlist()).toEqual([]);
    });
  });

  describe("preset preview must not leak into persisted state", () => {
    it("addPortfolioPosition does not persist the demo preset positions", () => {
      const store = stubLocalStorage();

      // No stored portfolio yet: loadPortfolioPositions() shows the preview,
      // but the first real addition must store only that position.
      expect(loadPortfolioPositions().length).toBeGreaterThan(1);
      expect(hasPersistedPortfolio()).toBe(false);

      const ok = addPortfolioPosition({
        ticker: "NVDA",
        name: "NVIDIA",
        shares: 10,
        averageCost: 150,
      });
      expect(ok).toBe(true);

      const stored = JSON.parse(store.get(PORTFOLIO_KEY) ?? "[]") as PortfolioPosition[];
      expect(stored).toHaveLength(1);
      expect(stored[0].ticker).toBe("NVDA");
      expect(hasPersistedPortfolio()).toBe(true);
      // The persisted list is now the source of truth (no preset fallback).
      expect(loadPortfolioPositions().map((p) => p.ticker)).toEqual(["NVDA"]);
    });

    it("addPortfolioPosition keeps previously stored positions", () => {
      const store = stubLocalStorage();
      savePortfolioPositions([
        { id: "p1", ticker: "7203", name: "トヨタ自動車", shares: 100, averageCost: 2000 },
      ]);

      expect(
        addPortfolioPosition({ ticker: "AAPL", name: "Apple", shares: 5, averageCost: 200 }),
      ).toBe(true);

      const stored = JSON.parse(store.get(PORTFOLIO_KEY) ?? "[]") as PortfolioPosition[];
      expect(stored.map((p) => p.ticker)).toEqual(["7203", "AAPL"]);
    });

    it("addWatchlistTicker does not persist the demo preset watchlist", () => {
      const store = stubLocalStorage();
      expect(loadWatchlist().length).toBeGreaterThan(1);
      expect(hasPersistedWatchlist()).toBe(false);

      expect(addWatchlistTicker("NVDA")).toBe(true);

      expect(JSON.parse(store.get(WATCHLIST_KEY) ?? "[]")).toEqual(["NVDA"]);
      expect(hasPersistedWatchlist()).toBe(true);
      expect(loadWatchlist()).toEqual(["NVDA"]);
    });

    it("reports persistence for deliberate empty lists", () => {
      stubLocalStorage();
      savePortfolioPositions([]);
      saveWatchlist([]);
      expect(hasPersistedPortfolio()).toBe(true);
      expect(hasPersistedWatchlist()).toBe(true);
    });

    it("uses a live USD/JPY rate from the quotes map instead of the fallback constant", () => {
      const usdPosition: PortfolioPosition = {
        id: "usd-1",
        ticker: "NVDA",
        name: "NVIDIA",
        shares: 10,
        averageCost: 100,
      };
      const quotes = new Map([
        ["NVDA", { price: 200, change: 1, dps: 1, name: "NVIDIA" }],
        ["USDJPY=X", { price: 100, change: 0, dps: null, name: "USD/JPY" }],
      ]);

      const summary = calculatePortfolioSummary([usdPosition], quotes);
      expect(summary.positions[0].fxRate).toBe(100);
      expect(summary.totalMarketValue).toBe(10 * 200 * 100);
    });

    it("lets an explicit rate override both the map and the fallback constant", () => {
      const usdPosition: PortfolioPosition = {
        id: "usd-2",
        ticker: "NVDA",
        name: "NVIDIA",
        shares: 10,
        averageCost: 100,
      };
      const quotes = new Map([
        ["NVDA", { price: 200, change: 1, dps: 1, name: "NVIDIA" }],
        ["USDJPY=X", { price: 100, change: 0, dps: null, name: "USD/JPY" }],
      ]);

      const summary = calculatePortfolioSummary([usdPosition], quotes, 155.5);
      expect(summary.positions[0].fxRate).toBe(155.5);
      expect(summary.totalMarketValue).toBe(Math.round(10 * 200 * 155.5));
    });

    it("enforces zero dividend when live quote explicitly specifies dividendYield: 0", () => {
      const position: PortfolioPosition = {
        id: "p-zero-div",
        ticker: "7203",
        name: "トヨタ自動車",
        shares: 100,
        averageCost: 2000,
      };
      // 7203 baseline has positive dps, but live quote says dividendYield is 0
      const quotes = new Map([
        ["7203", { price: 2500, change: 10, dps: null, dividendYield: 0, name: "トヨタ" }],
      ]);

      const summary = calculatePortfolioSummary([position], quotes);
      expect(summary.positions[0].annualDividend).toBe(0);
      expect(summary.totalAnnualDividend).toBe(0);
    });
  });
});
