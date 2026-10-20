// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { generateFallbackBenchmarkSeries, useSimulation } from "./useSimulation";
import type { BasketItem, PricePoint } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASKET: BasketItem[] = [
  { ticker: "7203", name: "Toyota", theme: "Auto", weight: 60 },
  { ticker: "9984", name: "SoftBank", theme: "AI", weight: 40 },
];

/**
 * Every request fails.
 *
 * The snapshot API then has no data for the selected benchmark, so the hook
 * falls back to generateFallbackBenchmarkSeries and must disclose it with
 * `usingDemoBenchmark`.
 */
function stubUnreachableApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Network offline");
    }),
  );
}

/**
 * Regression guard for the benchmark demo-data disclosure fix: when the
 * snapshot API has no data for the selected benchmark, the simulation falls
 * back to generateFallbackBenchmarkSeries. The hook must expose
 * `usingDemoBenchmark` so the preview can disclose that the comparison line
 * and alpha are based on generated demo prices instead of real market data.
 * The flag is part of the production `SimulationResult` contract, so reading
 * it here fails to compile as soon as the field disappears from that type.
 */
describe("useSimulation benchmark demo-data fallback contract", () => {
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

  it("discloses the generated benchmark line when the snapshot API is unavailable", async () => {
    stubUnreachableApi();

    const { result } = renderHook(() => useSimulation(BASKET, 1000));

    await waitFor(() => expect(result.current.usingDemoData).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(result.current.usingDemoBenchmark).toBe(true), { timeout: 5000 });

    // The comparison line is the generated demo series for the very same
    // dates as the custom series - not a live benchmark quote.
    const customDates = result.current.filteredCustomSeries.map((p) => p.date);
    expect(customDates.length).toBeGreaterThan(1);
    expect(result.current.filteredBenchmarkSeries).toEqual(
      generateFallbackBenchmarkSeries("^N225", customDates),
    );
  });
});
