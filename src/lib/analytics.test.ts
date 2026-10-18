import { describe, it, expect } from "vitest";
import { calculateSMA, calculateRiskMetrics, calculateStockDetails } from "./analytics";
import type { BasketItem, PricePoint, StockSeries } from "../types";

describe("analytics library", () => {
  describe("calculateSMA", () => {
    it("correctly calculates 3-period SMA", () => {
      const data = [10, 20, 30, 40, 50];
      const sma = calculateSMA(data, 3);
      expect(sma).toEqual([null, null, 20, 30, 40]);
    });

    it("handles window larger than data length", () => {
      const data = [10, 20];
      const sma = calculateSMA(data, 5);
      expect(sma).toEqual([null, null]);
    });

    it("handles invalid window <= 0 or empty array", () => {
      expect(calculateSMA([10, 20], 0)).toEqual([null, null]);
      expect(calculateSMA([], 5)).toEqual([]);
    });

    it("returns null for windows containing NaN (does not propagate NaN)", () => {
      const data = [10, 20, NaN, 40, 50, 60];
      const sma = calculateSMA(data, 3);
      // Windows containing NaN should be null, not NaN
      expect(sma).toEqual([null, null, null, null, null, 50]);
    });

    it("returns null for windows containing Infinity", () => {
      const data = [10, 20, Infinity, 40, 50, 60];
      const sma = calculateSMA(data, 3);
      expect(sma).toEqual([null, null, null, null, null, 50]);
    });

    it("recovers after NaN passes out of window", () => {
      const data = [10, 20, 30, NaN, 50, 60, 70];
      const sma = calculateSMA(data, 3);
      // First valid window is [10,20,30] = 20
      // Then windows with NaN are null
      // After NaN passes: [50,60,70] = 60
      expect(sma).toEqual([null, null, 20, null, null, null, 60]);
    });
  });

  describe("calculateRiskMetrics", () => {
    it("computes risk metrics correctly for sample series", () => {
      const custom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1020, value: 1020 },
        { date: "2026-01-03", close: 1010, value: 1010 },
        { date: "2026-01-04", close: 1050, value: 1050 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38380 },
        { date: "2026-01-03", close: 38000 },
        { date: "2026-01-04", close: 38760 },
      ];

      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(metrics.winRate).toBeGreaterThan(0);
      expect(typeof metrics.beta).toBe("number");
      expect(typeof metrics.annualVolatility).toBe("number");
    });

    it("returns safe default metrics for empty or single-point series", () => {
      const metrics = calculateRiskMetrics([], []);
      expect(metrics.annualReturn).toBe(0);
      expect(metrics.annualVolatility).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.beta).toBeNull();
    });

    it("handles negative returns and down markets correctly", () => {
      const custom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 900, value: 900 },
        { date: "2026-01-03", close: 800, value: 800 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 36000 },
        { date: "2026-01-03", close: 34000 },
      ];
      const metrics = calculateRiskMetrics(custom, bench);
      expect(metrics.annualReturn).toBeLessThan(0);
      expect(metrics.maxDrawdown).toBe(20);
      expect(metrics.winRate).toBe(0);
      expect(metrics.worstDay).toBeLessThan(0);
    });

    it("ignores corrupted non-positive points and prevents false 100% MDD", () => {
      const customWithZero: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 0, value: 0 }, // corrupted point
        { date: "2026-01-03", close: 950, value: 950 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38000 },
        { date: "2026-01-03", close: 38000 },
      ];
      const metrics = calculateRiskMetrics(customWithZero, bench);
      // MDD should be based on valid positive points (1000 to 950 = 5%), not 100% from 0
      expect(metrics.maxDrawdown).toBe(5);
      expect(metrics.beta).toBeNull();
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
    });

    it("ensures all returned metrics are finite numbers for flat series", () => {
      const flatCustom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1000, value: 1000 },
        { date: "2026-01-03", close: 1000, value: 1000 },
      ];
      const flatBench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38000 },
        { date: "2026-01-03", close: 38000 },
      ];
      const metrics = calculateRiskMetrics(flatCustom, flatBench);
      expect(Number.isFinite(metrics.annualReturn)).toBe(true);
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
      expect(Number.isFinite(metrics.maxDrawdown)).toBe(true);
      expect(metrics.beta).toBeNull();
      expect(Number.isFinite(metrics.winRate)).toBe(true);
      expect(Number.isFinite(metrics.bestDay)).toBe(true);
      expect(Number.isFinite(metrics.worstDay)).toBe(true);
    });

    it("does not propagate NaN from corrupted data points into risk metrics", () => {
      const corruptedCustom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: NaN, value: NaN }, // corrupted point
        { date: "2026-01-03", close: 1050, value: 1050 },
        { date: "2026-01-04", close: 1100, value: 1100 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38000 },
        { date: "2026-01-03", close: 38000 },
        { date: "2026-01-04", close: 38000 },
      ];
      const metrics = calculateRiskMetrics(corruptedCustom, bench);
      // All metrics must be finite, not NaN
      expect(Number.isFinite(metrics.annualReturn)).toBe(true);
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
      expect(Number.isFinite(metrics.maxDrawdown)).toBe(true);
      expect(metrics.beta).toBeNull();
    });

    it("safely handles total wipeout scenarios (totalReturn <= -100%) without NaN", () => {
      const wipeoutCustom: PricePoint[] = [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 0.01, value: 0.01 },
      ];
      const bench: PricePoint[] = [
        { date: "2026-01-01", close: 38000 },
        { date: "2026-01-02", close: 38000 },
      ];
      const metrics = calculateRiskMetrics(wipeoutCustom, bench);
      expect(metrics.annualReturn).toBeLessThanOrEqual(-99);
      expect(Number.isFinite(metrics.annualReturn)).toBe(true);
      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(99.9);
    });

    it("sorts dates and ignores invalid points before calculating metrics", () => {
      const metrics = calculateRiskMetrics(
        [
          { date: "2026-01-03", close: 120, value: 120 },
          { date: "2026-01-02", close: 0, value: 0 },
          { date: "2026-01-01", close: 100, value: 100 },
          { date: "2026-01-01", close: 105, value: 105 },
        ],
        [
          { date: "2026-01-03", close: 39000 },
          { date: "2026-01-01", close: 38000 },
          { date: "2026-01-02", close: Number.NaN },
        ],
      );

      expect(metrics.annualReturn).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.annualVolatility)).toBe(true);
      expect(metrics.beta).toBeNull();
    });
  });

  describe("calculateStockDetails", () => {
    it("computes stock changes, contributions, and sparklines", () => {
      const basket: BasketItem[] = [
        { ticker: "7203", name: "トヨタ", weight: 50, theme: "自動車" },
        { ticker: "9984", name: "ソフトバンクG", weight: 50, theme: "AI" },
      ];
      const universe: StockSeries[] = [
        {
          ticker: "7203",
          name: "トヨタ",
          theme: "自動車",
          sector: "Auto",
          latestPrice: 2800,
          series: [
            { date: "2026-01-01", close: 2700 },
            { date: "2026-01-02", close: 2800 },
          ],
        },
        {
          ticker: "9984",
          name: "ソフトバンクG",
          theme: "AI",
          sector: "Tech",
          latestPrice: 8500,
          series: [
            { date: "2026-01-01", close: 8600 },
            { date: "2026-01-02", close: 8500 },
          ],
        },
      ];

      const details = calculateStockDetails(basket, universe, 1000, [
        { date: "2026-01-01", close: 1000, value: 1000 },
        { date: "2026-01-02", close: 1010, value: 1010 },
      ]);

      expect(details).toHaveLength(2);
      const toyota = details.find((d) => d.ticker === "7203")!;
      expect(toyota.change).toBe(100);
      expect(toyota.changePct).toBeCloseTo(3.7, 1);
      expect(toyota.contributionPt).toBeGreaterThan(0);
      expect(toyota.sparkline).toEqual([2700, 2800]);
    });

    it("uses the latest chronological valid stock prices", () => {
      const details = calculateStockDetails(
        [{ ticker: "7203", name: "トヨタ", weight: 100, theme: "自動車" }],
        [
          {
            ticker: "7203",
            name: "トヨタ",
            theme: "自動車",
            sector: "Auto",
            latestPrice: 0,
            series: [
              { date: "2026-01-02", close: 110 },
              { date: "2026-01-03", close: 0 },
              { date: "2026-01-01", close: 100 },
            ],
          },
        ],
        1000,
        [
          { date: "2026-01-02", close: 1100, value: 1100 },
          { date: "2026-01-01", close: 1000, value: 1000 },
        ],
      );

      expect(details[0].currentPrice).toBe(110);
      expect(details[0].previousPrice).toBe(100);
      expect(details[0].change).toBe(10);
      expect(details[0].contributionPt).toBe(100);
      expect(details[0].sparkline).toEqual([100, 110]);
    });

    it("matches stock details case-insensitively for legacy basket tickers", () => {
      const details = calculateStockDetails(
        [{ ticker: "aapl", name: "Apple", weight: 100, theme: "Tech" }],
        [
          {
            ticker: "AAPL",
            name: "Apple",
            theme: "Tech",
            sector: "Technology",
            latestPrice: 110,
            series: [
              { date: "2026-01-01", close: 100 },
              { date: "2026-01-02", close: 110 },
            ],
          },
        ],
        1000,
        [
          { date: "2026-01-01", close: 1000, value: 1000 },
          { date: "2026-01-02", close: 1100, value: 1100 },
        ],
      );

      expect(details[0].currentPrice).toBe(110);
      expect(details[0].changePct).toBe(10);
      expect(details[0].sparkline).toEqual([100, 110]);
    });

    it("propagates isDemoData for unanchored tickers and explicit stock.isDemoData", () => {
      const details = calculateStockDetails(
        [
          { ticker: "7203", name: "トヨタ", weight: 30, theme: "自動車" },
          { ticker: "UNKNOWN_TICKER_999", name: "Unknown Co", weight: 35, theme: "Tech" },
          { ticker: "CUSTOM_DEMO", name: "Demo Co", weight: 35, theme: "AI" },
        ],
        [
          {
            ticker: "7203",
            name: "トヨタ",
            theme: "自動車",
            sector: "Auto",
            latestPrice: 2800,
            series: [
              { date: "2026-01-01", close: 2700 },
              { date: "2026-01-02", close: 2800 },
            ],
          },
          {
            ticker: "CUSTOM_DEMO",
            name: "Demo Co",
            theme: "AI",
            sector: "Tech",
            latestPrice: 500,
            series: [
              { date: "2026-01-01", close: 490 },
              { date: "2026-01-02", close: 500 },
            ],
            isDemoData: true,
          },
        ],
      );

      const toyota = details.find((d) => d.ticker === "7203");
      const unknown = details.find((d) => d.ticker === "UNKNOWN_TICKER_999");
      const demo = details.find((d) => d.ticker === "CUSTOM_DEMO");

      expect(toyota?.isDemoData).toBeUndefined();
      expect(unknown?.isDemoData).toBe(true);
      expect(demo?.isDemoData).toBe(true);
    });
  });
});
