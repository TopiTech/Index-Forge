import { describe, it, expect } from "vitest";
import {
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "./portfolioStorage";

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
});
