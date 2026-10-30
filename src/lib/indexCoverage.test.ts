import { describe, expect, it } from "vitest";
import type { BasketItem, StockSeries } from "../types";
import {
  calculateCustomIndex,
  computeIndexCoverage,
  getIndexCoverageWarnings,
} from "./indexEngine";

function makeBasket(): BasketItem[] {
  return [
    { ticker: "A", name: "Stock A", theme: "t", weight: 50 },
    { ticker: "B", name: "Stock B", theme: "t", weight: 50 },
  ];
}

function makeSeries(ticker: string, points: Array<[string, number]>): StockSeries {
  return {
    ticker,
    name: ticker,
    theme: "t",
    sector: "Test",
    latestPrice: points.length > 0 ? points[points.length - 1][1] : 0,
    series: points.map(([date, close]) => ({ date, close })),
  };
}

describe("computeIndexCoverage (H-4)", () => {
  it("reports no fills when every price is real", () => {
    const universe = [
      makeSeries("A", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
        ["2026-04-03", 120],
      ]),
      makeSeries("B", [
        ["2026-04-01", 200],
        ["2026-04-02", 210],
        ["2026-04-03", 220],
      ]),
    ];
    const coverage = computeIndexCoverage(makeBasket(), universe);
    expect(coverage.latestDate).toBe("2026-04-03");
    expect(coverage.trailingFilledTickers).toEqual([]);
    expect(coverage.gapFilledTickers).toEqual([]);
    expect(coverage.filledCellRatio).toBe(0);
    expect(coverage.points).toHaveLength(3);
    expect(coverage.points.every((p) => p.available === 2 && p.filledTickers.length === 0)).toBe(
      true,
    );
    expect(getIndexCoverageWarnings(makeBasket(), universe)).toEqual([]);
  });

  it("flags a mid-series gap without changing the calculated values and identifies affected tickers", () => {
    const basket = makeBasket();
    const universe = [
      makeSeries("A", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
        ["2026-04-03", 120],
      ]),
      makeSeries("B", [
        ["2026-04-01", 200],
        ["2026-04-03", 220],
      ]),
    ];
    // Values keep the historical forward-fill (parity with calculateCustomIndex).
    const series = calculateCustomIndex(basket, universe, 1000);
    expect(series[1].value).toBe(1050);

    const coverage = computeIndexCoverage(basket, universe);
    const gapDay = coverage.points.find((p) => p.date === "2026-04-02");
    expect(gapDay?.available).toBe(1);
    expect(gapDay?.filledTickers).toEqual(["B"]);
    expect(coverage.trailingFilledTickers).toEqual([]);
    expect(coverage.gapFilledTickers).toEqual(["B"]);
    // One filled cell out of 2 tickers x 3 days.
    expect(coverage.filledCellRatio).toBeCloseTo(1 / 6, 10);

    const warnings = getIndexCoverageWarnings(basket, universe);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("期間中に価格の欠測を補完した日が1日あります");
    expect(warnings[0]).toContain("対象銘柄（B (Stock B)）");
  });

  it("flags a delisted constituent frozen at its last print on the latest date", () => {
    const basket = makeBasket();
    const universe = [
      makeSeries("A", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
        ["2026-04-03", 120],
      ]),
      makeSeries("B", [
        ["2026-04-01", 200],
        ["2026-04-02", 210],
      ]),
    ];
    const coverage = computeIndexCoverage(basket, universe);
    expect(coverage.trailingFilledTickers).toEqual(["B"]);

    const warnings = getIndexCoverageWarnings(basket, universe);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("最新日（2026-04-03）");
    expect(warnings[0]).toContain("B");
  });

  it("does not count pre-start base-price anchoring as missing data", () => {
    const basket = makeBasket();
    const universe = [
      makeSeries("A", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
        ["2026-04-03", 120],
      ]),
      // B lists later; pre-start dates are anchored at its base price by design.
      makeSeries("B", [["2026-04-03", 200]]),
    ];
    const coverage = computeIndexCoverage(basket, universe);
    expect(coverage.filledCellRatio).toBe(0);
    expect(coverage.trailingFilledTickers).toEqual([]);
    expect(coverage.gapFilledTickers).toEqual([]);
    expect(getIndexCoverageWarnings(basket, universe)).toEqual([]);
  });

  it("returns empty coverage for an empty basket or universe", () => {
    expect(computeIndexCoverage([], [])).toEqual({
      points: [],
      latestDate: "",
      filledCellRatio: 0,
      trailingFilledTickers: [],
      gapFilledTickers: [],
    });
    expect(getIndexCoverageWarnings([], [])).toEqual([]);
  });

  it("ignores a constituent with no usable prices (handled by the missing-ticker path)", () => {
    const basket = makeBasket();
    const universe = [
      makeSeries("A", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
      ]),
      makeSeries("B", [
        ["2026-04-01", 0],
        ["2026-04-02", 0],
      ]),
    ];
    const coverage = computeIndexCoverage(basket, universe);
    expect(coverage.points.every((p) => p.total === 1)).toBe(true);
    expect(getIndexCoverageWarnings(basket, universe)).toEqual([]);
  });

  it("compacts long trailing ticker lists in the warning", () => {
    const basket = Array.from({ length: 7 }, (_, i) => ({
      ticker: `T${i}`,
      name: `T${i}`,
      theme: "t",
      weight: 10,
    }));
    const universe = [
      makeSeries("T0", [
        ["2026-04-01", 100],
        ["2026-04-02", 110],
      ]),
      ...Array.from({ length: 6 }, (_, i) => makeSeries(`T${i + 1}`, [["2026-04-01", 100]])),
    ];
    const warnings = getIndexCoverageWarnings(basket, universe);
    expect(warnings[0]).toContain("他");
    expect(warnings[0]).not.toContain("T6");
  });
});
