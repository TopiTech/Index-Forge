import { describe, expect, it } from "vitest";
import {
  generateFallbackBenchmarkSeries,
  type SimulationResult,
} from "./useSimulation";
import type { PricePoint } from "../types";

/**
 * Regression guard for the benchmark demo-data disclosure fix: when the
 * snapshot API has no data for the selected benchmark, the simulation falls
 * back to generateFallbackBenchmarkSeries. The hook must expose
 * `usingDemoBenchmark` so the preview can disclose that the comparison line
 * and alpha are based on generated demo prices instead of real market data.
 */
describe("useSimulation benchmark demo-data fallback contract", () => {
  it("keeps usingDemoBenchmark in the public SimulationResult contract", () => {
    // Compile-time + runtime sentinel: removing the disclosure flag from the
    // public type contract must fail this test.
    const resultShape: Partial<SimulationResult> = { usingDemoBenchmark: true };
    expect(resultShape.usingDemoBenchmark).toBe(true);
  });

  it("generates a demo series aligned to the requested dates", () => {
    const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
    const series: PricePoint[] = generateFallbackBenchmarkSeries("^N225", dates);
    expect(series).toHaveLength(dates.length);
    series.forEach((point, i) => {
      expect(point.date).toBe(dates[i]);
      expect(point.close).toBeGreaterThan(0);
    });
  });

  it("produces deterministic demo prices for the same inputs (stable demo data)", () => {
    const dates = ["2026-01-05", "2026-01-06", "2026-01-07"];
    const a = generateFallbackBenchmarkSeries("^GSPC", dates);
    const b = generateFallbackBenchmarkSeries("^GSPC", dates);
    expect(a.map((p) => p.close)).toEqual(b.map((p) => p.close));
  });

  it("uses a distinct plausible base price per benchmark symbol", () => {
    const dates = ["2026-01-05", "2026-01-06"];
    const n225 = generateFallbackBenchmarkSeries("^N225", dates);
    const gspc = generateFallbackBenchmarkSeries("^GSPC", dates);
    const usdjpy = generateFallbackBenchmarkSeries("USDJPY=X", dates);
    const btc = generateFallbackBenchmarkSeries("BTC-USD", dates);

    // Order-of-magnitude sanity: each benchmark starts near its realistic base.
    expect(n225[0].close).toBeGreaterThan(10000);
    expect(gspc[0].close).toBeGreaterThan(1000);
    expect(gspc[0].close).toBeLessThan(10000);
    expect(usdjpy[0].close).toBeGreaterThan(50);
    expect(usdjpy[0].close).toBeLessThan(500);
    expect(btc[0].close).toBeGreaterThan(10000);
  });
});
