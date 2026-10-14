import { describe, it, expect } from "vitest";
import { ALL_UNIVERSE_STOCKS, searchStockUniverse } from "../data/stockUniverse";
import { POPULAR_STOCKS, PRESET_STOCKS, searchPopularStocks } from "../data/popularStocks";
import { POPULAR_STOCKS as DATA_POPULAR_STOCKS } from "../data/popularStocksData";

describe("Stock Universe & Popular Stocks Decoupling & Initialization", () => {
  it("exports POPULAR_STOCKS matching popularStocksData", () => {
    expect(POPULAR_STOCKS).toBe(DATA_POPULAR_STOCKS);
    expect(POPULAR_STOCKS.length).toBeGreaterThan(50);
    expect(PRESET_STOCKS.length).toBeGreaterThan(10);
  });

  it("evaluates ALL_UNIVERSE_STOCKS with valid isPopular flags without TDZ ReferenceErrors", () => {
    expect(ALL_UNIVERSE_STOCKS).toBeDefined();
    expect(ALL_UNIVERSE_STOCKS.length).toBeGreaterThan(4000);

    // Verify popular stocks have isPopular = true
    const toyota = ALL_UNIVERSE_STOCKS.find((s) => s.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota?.isPopular).toBe(true);

    const sony = ALL_UNIVERSE_STOCKS.find((s) => s.ticker === "6758");
    expect(sony).toBeDefined();
    expect(sony?.isPopular).toBe(true);

    // Non-curated stock should have isPopular = false
    const kyokuyo = ALL_UNIVERSE_STOCKS.find((s) => s.ticker === "1301");
    expect(kyokuyo).toBeDefined();
    expect(kyokuyo?.isPopular).toBe(false);
  });

  it("prioritizes isPopular stocks in search results", () => {
    const results = searchStockUniverse("7203");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].ticker).toBe("7203");
    expect(results[0].isPopular).toBe(true);

    const popularResults = searchPopularStocks("トヨタ");
    expect(popularResults.length).toBeGreaterThan(0);
    expect(popularResults[0].ticker).toBe("7203");
  });
});
