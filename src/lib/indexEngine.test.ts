import { describe, it, expect } from "vitest";
import {
  normalizeWeights,
  equalizeWeightsExact,
  redistributeWeightsExact,
  calculateCustomIndex,
} from "../lib/indexEngine";
import type { BasketItem, StockSeries } from "../types";

describe("normalizeWeights", () => {
  it("normalizes weights to sum to 100", () => {
    const items: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "tech", weight: 30 },
      { ticker: "B", name: "Stock B", theme: "tech", weight: 20 },
    ];
    const result = normalizeWeights(items);
    const total = result.reduce((s, i) => s + i.weight, 0);
    expect(total).toBeCloseTo(100, 2);
    expect(result[0].weight).toBeCloseTo(60, 2);
    expect(result[1].weight).toBeCloseTo(40, 2);
  });

  it("returns items unchanged when total is 0", () => {
    const items: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "tech", weight: 0 },
    ];
    const result = normalizeWeights(items);
    expect(result).toEqual(items);
  });

  it("handles single item", () => {
    const items: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "tech", weight: 50 },
    ];
    const result = normalizeWeights(items);
    expect(result[0].weight).toBeCloseTo(100, 2);
  });

  it("handles negative and NaN weights safely", () => {
    const items: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "tech", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "tech", weight: -10 },
      { ticker: "C", name: "Stock C", theme: "tech", weight: NaN as any },
    ];
    const result = normalizeWeights(items);
    expect(result[0].weight).toBe(100);
    expect(result[1].weight).toBe(0);
    expect(result[2].weight).toBe(0);
  });
});

describe("equalizeWeightsExact", () => {
  it("returns empty array for empty items", () => {
    expect(equalizeWeightsExact([])).toEqual([]);
  });

  it("allocates exactly 100.00 to a single item", () => {
    const items = [{ ticker: "7203", weight: 10 }];
    const res = equalizeWeightsExact(items);
    expect(res[0].weight).toBe(100);
  });

  it("distributes remainder so sum is strictly 100.00 for 3 items", () => {
    const items = [
      { ticker: "7203", weight: 10 },
      { ticker: "6758", weight: 20 },
      { ticker: "9984", weight: 30 },
    ];
    const res = equalizeWeightsExact(items);
    const sum = Number(res.reduce((s, x) => s + x.weight, 0).toFixed(2));
    expect(sum).toBe(100);
    expect(res.map((x) => x.weight)).toEqual([33.34, 33.33, 33.33]);
  });

  it("distributes remainder so sum is strictly 100.00 for 6 and 7 items", () => {
    const items6 = Array.from({ length: 6 }, (_, i) => ({ ticker: `T${i}`, weight: 1 }));
    const res6 = equalizeWeightsExact(items6);
    const sum6 = Number(res6.reduce((s, x) => s + x.weight, 0).toFixed(2));
    expect(sum6).toBe(100);

    const items7 = Array.from({ length: 7 }, (_, i) => ({ ticker: `T${i}`, weight: 1 }));
    const res7 = equalizeWeightsExact(items7);
    const sum7 = Number(res7.reduce((s, x) => s + x.weight, 0).toFixed(2));
    expect(sum7).toBe(100);
  });
});

describe("redistributeWeightsExact", () => {
  it("returns empty array for empty items", () => {
    expect(redistributeWeightsExact([])).toEqual([]);
  });

  it("normalizes proportionally with Largest Remainder Method ensuring exact sum 100.00", () => {
    const items = [
      { ticker: "A", weight: 15 },
      { ticker: "B", weight: 25 },
      { ticker: "C", weight: 35 },
    ];
    const res = redistributeWeightsExact(items);
    const sum = Number(res.reduce((s, x) => s + x.weight, 0).toFixed(2));
    expect(sum).toBe(100);
    expect(res.map((x) => x.weight)).toEqual([20, 33.33, 46.67]);
  });

  it("falls back to equal distribution when total is 0", () => {
    const items = [
      { ticker: "A", weight: 0 },
      { ticker: "B", weight: 0 },
      { ticker: "C", weight: 0 },
    ];
    const res = redistributeWeightsExact(items);
    const sum = Number(res.reduce((s, x) => s + x.weight, 0).toFixed(2));
    expect(sum).toBe(100);
    expect(res.map((x) => x.weight)).toEqual([33.34, 33.33, 33.33]);
  });
});

describe("calculateCustomIndex", () => {
  const makeStock = (ticker: string, basePrice: number, multipliers: number[]): StockSeries => ({
    ticker,
    name: ticker,
    theme: "test",
    sector: "Test",
    latestPrice: basePrice * multipliers[multipliers.length - 1],
    series: multipliers.map((m, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, "0")}`,
      close: Number((basePrice * m).toFixed(2)),
    })),
  });

  it("returns empty for empty basket", () => {
    const result = calculateCustomIndex([], [], 1000);
    expect(result).toEqual([]);
  });

  it("returns empty when no stock data is available", () => {
    const basket: BasketItem[] = [
      { ticker: "X", name: "X", theme: "t", weight: 100 },
    ];
    const result = calculateCustomIndex(basket, [], 1000);
    expect(result).toEqual([]);
  });

  it("calculates index value correctly for a single stock and includes close property", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 100 },
    ];
    const universe: StockSeries[] = [
      makeStock("A", 1000, [1.0, 1.1, 1.2]),
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result.length).toBe(3);
    // Day 0: base = 1000 * (1000/1000) = 1000
    expect(result[0].value).toBe(1000);
    expect(result[0].close).toBe(1000);
    // Day 1: 1000 * (1100/1000) = 1100
    expect(result[1].value).toBe(1100);
    expect(result[1].close).toBe(1100);
    // Day 2: 1000 * (1200/1000) = 1200
    expect(result[2].value).toBe(1200);
    expect(result[2].close).toBe(1200);
  });

  it("matches basket and price tickers case-insensitively for legacy data", () => {
    const basket: BasketItem[] = [
      { ticker: "aapl", name: "Apple", theme: "tech", weight: 100 },
    ];
    const universe: StockSeries[] = [makeStock("AAPL", 100, [1, 1.1])];

    const result = calculateCustomIndex(basket, universe, 1000);

    expect(result).toHaveLength(2);
    expect(result[1].value).toBe(1100);
  });

  it("calculates weighted index for two stocks", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
    ];
    // A: 1000 → 1100 (10% up), B: 2000 → 2000 (0% change)
    const universe: StockSeries[] = [
      makeStock("A", 1000, [1.0, 1.1]),
      makeStock("B", 2000, [1.0, 1.0]),
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    // Day 0: 1000 * (0.5 * 1.0 + 0.5 * 1.0) = 1000
    expect(result[0].value).toBe(1000);
    // Day 1: 1000 * (0.5 * 1.1 + 0.5 * 1.0) = 1050
    expect(result[1].value).toBe(1050);
  });

  it("skips stocks with no data and re-normalizes weights", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
    ];
    // Only A has data; B is missing from universe
    const universe: StockSeries[] = [
      makeStock("A", 1000, [1.0, 1.2]),
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    // A's weight gets re-normalized to 100%
    expect(result[0].value).toBe(1000);
    expect(result[1].value).toBe(1200);
  });

  it("sorts dates correctly in YYYY-MM-DD format", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 100 },
    ];
    const universe: StockSeries[] = [{
      ticker: "A",
      name: "A",
      theme: "t",
      sector: "Test",
      latestPrice: 1100,
      series: [
        { date: "2026-03-28", close: 900 },
        { date: "2026-04-01", close: 1000 },
        { date: "2026-04-02", close: 1100 },
      ],
    }];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result.length).toBe(3);
    expect(result[0].date).toBe("2026-03-28");
    expect(result[1].date).toBe("2026-04-01");
    expect(result[2].date).toBe("2026-04-02");
  });

  it("handles custom base values and invalid baseValue fallback", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 100 },
    ];
    const universe: StockSeries[] = [
      makeStock("A", 100, [1.0, 1.5]),
    ];
    const result500 = calculateCustomIndex(basket, universe, 500);
    expect(result500[0].value).toBe(500);
    expect(result500[1].value).toBe(750);

    const resultInvalid = calculateCustomIndex(basket, universe, -100 as any);
    expect(resultInvalid[0].value).toBe(1000);
    expect(resultInvalid[1].value).toBe(1500);
  });

  it("forward-fills missing dates correctly across multiple stocks", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
    ];
    const universe: StockSeries[] = [
      {
        ticker: "A",
        name: "Stock A",
        theme: "t",
        sector: "Test",
        latestPrice: 120,
        series: [
          { date: "2026-04-01", close: 100 },
          { date: "2026-04-02", close: 110 },
          { date: "2026-04-03", close: 120 },
        ],
      },
      {
        ticker: "B",
        name: "Stock B",
        theme: "t",
        sector: "Test",
        latestPrice: 200,
        series: [
          { date: "2026-04-01", close: 200 },
          // Day 2 (2026-04-02) is missing for stock B: forward fills 200
          { date: "2026-04-03", close: 220 },
        ],
      },
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result.length).toBe(3);
    // Day 0: 1000 * (0.5 * 1.0 + 0.5 * 1.0) = 1000
    expect(result[0].value).toBe(1000);
    // Day 1: A is 110 (1.10), B is forward-filled 200 (1.00) -> 1000 * (0.55 + 0.50) = 1050
    expect(result[1].value).toBe(1050);
    // Day 2: A is 120 (1.20), B is 220 (1.10) -> 1000 * (0.60 + 0.55) = 1150
    expect(result[2].value).toBe(1150);
  });

  it("handles all zero weights without producing NaN", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 0 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 0 },
    ];
    const universe: StockSeries[] = [
      makeStock("A", 1000, [1.0, 1.1]),
      makeStock("B", 2000, [1.0, 1.0]),
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result.length).toBe(2);
    expect(Number.isNaN(result[0].value)).toBe(false);
    expect(Number.isNaN(result[1].value)).toBe(false);
    expect(result[0].value).toBe(1000);
    // Both stocks weighted equally (50% each): (1.1 * 0.5 + 1.0 * 0.5) * 1000 = 1050
    expect(result[1].value).toBe(1050);
  });

  it("excludes stocks with no valid base price instead of returning empty (resilient to missing data)", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
      { ticker: "C", name: "Stock C", theme: "t", weight: 50 },
    ];
    // Stock B has no valid base price (all zeros/NaN) - should be excluded
    // Stocks A and C have valid data
    const universe: StockSeries[] = [
      {
        ticker: "A",
        name: "Stock A",
        theme: "t",
        sector: "Test",
        latestPrice: 1100,
        series: [
          { date: "2026-04-01", close: 1000 },
          { date: "2026-04-02", close: 1100 },
        ],
      },
      {
        ticker: "B",
        name: "Stock B",
        theme: "t",
        sector: "Test",
        latestPrice: 0,
        series: [
          { date: "2026-04-01", close: 0 }, // invalid base price
          { date: "2026-04-02", close: 0 },
        ],
      },
      {
        ticker: "C",
        name: "Stock C",
        theme: "t",
        sector: "Test",
        latestPrice: 2200,
        series: [
          { date: "2026-04-01", close: 2000 },
          { date: "2026-04-02", close: 2200 },
        ],
      },
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    // Should still compute an index using stocks A and C (re-normalized)
    expect(result.length).toBe(2);
    // Day 0: base values - A=1000, C=2000
    // Weights re-normalized: A=50/(50+50)=50%, C=50%
    // Value: 1000 * (0.5 * 1.0 + 0.5 * 1.0) = 1000
    expect(result[0].value).toBe(1000);
    // Day 1: A=1100 (1.1x), C=2200 (1.1x)
    // Value: 1000 * (0.5 * 1.1 + 0.5 * 1.1) = 1100
    expect(result[1].value).toBe(1100);
  });

  it("returns empty when ALL stocks have invalid base prices", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
    ];
    const universe: StockSeries[] = [
      {
        ticker: "A",
        name: "Stock A",
        theme: "t",
        sector: "Test",
        latestPrice: 0,
        series: [
          { date: "2026-04-01", close: 0 },
          { date: "2026-04-02", close: 0 },
        ],
      },
      {
        ticker: "B",
        name: "Stock B",
        theme: "t",
        sector: "Test",
        latestPrice: 0,
        series: [
          { date: "2026-04-01", close: NaN },
          { date: "2026-04-02", close: NaN },
        ],
      },
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result).toEqual([]);
  });

  it("maintains continuity without artificial cliff drops when a stock has data starting later than others", () => {
    const basket: BasketItem[] = [
      { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
      { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
    ];
    // Stock A has 3 days of data: 1000, 1500, 1500
    // Stock B only starts on Day 3 with initial price 2000
    const universe: StockSeries[] = [
      {
        ticker: "A",
        name: "Stock A",
        theme: "t",
        sector: "Test",
        latestPrice: 1500,
        series: [
          { date: "2026-04-01", close: 1000 },
          { date: "2026-04-02", close: 1500 },
          { date: "2026-04-03", close: 1500 },
        ],
      },
      {
        ticker: "B",
        name: "Stock B",
        theme: "t",
        sector: "Test",
        latestPrice: 2000,
        series: [
          { date: "2026-04-03", close: 2000 },
        ],
      },
    ];
    const result = calculateCustomIndex(basket, universe, 1000);
    expect(result.length).toBe(3);
    // Day 0: 1000
    expect(result[0].value).toBe(1000);
    // Day 1: A gained 50% (weighted 50% = +25%): 1250
    expect(result[1].value).toBe(1250);
    // Day 2: Neither A nor B moved from previous price: must stay 1250 (no cliff drop)
    expect(result[2].value).toBe(1250);
  });
});
