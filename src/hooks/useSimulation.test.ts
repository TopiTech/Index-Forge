import { describe, expect, it } from "vitest";
import { calculateConstituentPerformance } from "./useSimulation";
import type { BasketItem, StockSeries } from "../types";

describe("calculateConstituentPerformance", () => {
  const sampleBasket: BasketItem[] = [
    { ticker: "7203", name: "Toyota", theme: "Auto", weight: 60 },
    { ticker: "9984", name: "SoftBank", theme: "AI", weight: 40 },
  ];

  const sampleStockUniverse: StockSeries[] = [
    {
      ticker: "7203",
      name: "Toyota",
      theme: "Auto",
      sector: "Automotive",
      latestPrice: 2200,
      series: [
        { date: "2026-08-01", close: 2000 },
        { date: "2026-08-15", close: 2100 },
        { date: "2026-09-01", close: 2200 },
      ],
    },
    {
      ticker: "9984",
      name: "SoftBank",
      theme: "AI",
      sector: "Tech",
      latestPrice: 9000,
      series: [
        { date: "2026-08-01", close: 10000 },
        { date: "2026-08-15", close: 9500 },
        { date: "2026-09-01", close: 9000 },
      ],
    },
  ];

  it("returns empty array when basket is empty", () => {
    expect(calculateConstituentPerformance([], sampleStockUniverse, "1M")).toEqual([]);
  });

  it("returns empty array when stock universe is empty", () => {
    expect(calculateConstituentPerformance(sampleBasket, [], "1M")).toEqual([]);
  });

  it("correctly calculates constituent return and contribution percentage", () => {
    const perf = calculateConstituentPerformance(sampleBasket, sampleStockUniverse, "1M");
    expect(perf).toHaveLength(2);

    // Toyota: 2000 -> 2200 = +10% return. Weight: 60%. Contribution = 6.0%
    const toyota = perf.find((p) => p.ticker === "7203");
    expect(toyota).toBeDefined();
    expect(toyota?.periodReturnPct).toBe(10);
    expect(toyota?.contributionPct).toBe(6);

    // SoftBank: 10000 -> 9000 = -10% return. Weight: 40%. Contribution = -4.0%
    const softbank = perf.find((p) => p.ticker === "9984");
    expect(softbank).toBeDefined();
    expect(softbank?.periodReturnPct).toBe(-10);
    expect(softbank?.contributionPct).toBe(-4);
  });

  it("handles missing stock data gracefully without failing", () => {
    const incompleteUniverse: StockSeries[] = [
      {
        ticker: "7203",
        name: "Toyota",
        theme: "Auto",
        sector: "Automotive",
        latestPrice: 2000,
        series: [],
      },
    ];

    const perf = calculateConstituentPerformance(sampleBasket, incompleteUniverse, "1M");
    expect(perf).toHaveLength(2);
    expect(perf[0].periodReturnPct).toBe(0);
    expect(perf[1].periodReturnPct).toBe(0);
  });
});
