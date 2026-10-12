import { describe, it, expect } from "vitest";
import {
  allocateMarketCapWeights,
  allocateDividendYieldWeights,
  allocateInverseVolatilityWeights,
  allocateEvenWeights,
} from "./weights";

describe("weightsEnhancement", () => {
  it("allocates weights proportionally to market capitalizations and sums to 100", () => {
    // 3 stocks with market caps: 300, 200, 100
    const weights = allocateMarketCapWeights([300, 200, 100]);
    expect(weights.length).toBe(3);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    // Highest market cap should receive highest weight
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    // Minimum 1% guarantee
    expect(weights.every((w) => w >= 1)).toBe(true);
  });

  it("allocates weights proportionally to dividend yields and sums to 100", () => {
    // 4 stocks with yields: 4.5%, 3.0%, 1.5%, 0.0%
    const weights = allocateDividendYieldWeights([4.5, 3.0, 1.5, 0.0]);
    expect(weights.length).toBe(4);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    // The 0.0% yield stock still gets at least 1%
    expect(weights[3]).toBeGreaterThanOrEqual(1);
  });

  it("allocates weights inversely proportional to volatility (risk parity)", () => {
    // 3 stocks with volatilities: 15% (low), 30% (med), 60% (high)
    const weights = allocateInverseVolatilityWeights([15, 30, 60]);
    expect(weights.length).toBe(3);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    // Lower volatility gets higher weight
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
  });

  it("gracefully handles zero or empty input arrays", () => {
    expect(allocateMarketCapWeights([])).toEqual([]);
    expect(allocateDividendYieldWeights([])).toEqual([]);
    expect(allocateInverseVolatilityWeights([])).toEqual([]);
  });

  it("handles identical values by acting like allocateEvenWeights", () => {
    const capWeights = allocateMarketCapWeights([100, 100, 100, 100]);
    const evenWeights = allocateEvenWeights(4);
    expect(capWeights).toEqual(evenWeights);
    expect(capWeights.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
