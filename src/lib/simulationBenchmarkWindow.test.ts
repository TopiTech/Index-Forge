/**
 * Regression tests for the benchmark/alpha window alignment in useSimulation.
 *
 * Two defects are pinned here:
 *
 * 1. When the benchmark history starts after the custom series (the snapshot
 *    is capped at 1y of history while a basket can carry longer legacy
 *    prices), the old code measured the benchmark from its own first point but
 *    the index from the custom start — alpha then absorbed the return of the
 *    uncovered gap.
 * 2. A single usable benchmark point (the Worker's baseline placeholder when
 *    Yahoo fails) makes the benchmark return 0% by construction; the demo
 *    disclosure must cover that case, otherwise alpha silently equals the
 *    whole index return.
 */
import { describe, expect, it } from "vitest";
import { calculatePeriodReturns, isDemoBenchmarkSeries } from "../hooks/useSimulation";
import type { PricePoint } from "../types";

describe("calculatePeriodReturns window alignment", () => {
  it("rebases the index return onto the benchmark window when history starts later", () => {
    const custom: PricePoint[] = [
      { date: "2025-09-01", close: 1000, value: 1000 },
      { date: "2026-07-31", close: 1400, value: 1400 },
      { date: "2026-08-01", close: 1500, value: 1500 },
      { date: "2026-09-01", close: 1575, value: 1575 }, // +5% since 2026-08-01
    ];
    const benchmark: PricePoint[] = [
      { date: "2026-08-01", close: 30000 },
      { date: "2026-09-01", close: 31500 }, // +5%
    ];

    const res = calculatePeriodReturns(custom, benchmark);

    // Measured over the shared window (2026-08-01 → 2026-09-01), both return
    // +5%, so alpha is 0 — not the +52.5% the uncovered gap used to produce.
    expect(res.periodBenchmarkReturnPct).toBe(5);
    expect(res.periodCustomReturnPct).toBe(5);
    expect(res.alphaPct).toBe(0);
  });

  it("rebases the index return onto the benchmark end when the benchmark history ends earlier", () => {
    const custom: PricePoint[] = [
      { date: "2026-08-01", close: 1000, value: 1000 },
      { date: "2026-08-15", close: 1050, value: 1050 }, // +5%
      { date: "2026-09-01", close: 1100, value: 1100 }, // +10% overall
    ];
    const benchmark: PricePoint[] = [
      { date: "2026-08-01", close: 30000 },
      { date: "2026-08-15", close: 31500 }, // +5%, then no more data
    ];

    const res = calculatePeriodReturns(custom, benchmark);

    expect(res.periodBenchmarkReturnPct).toBe(5);
    expect(res.periodCustomReturnPct).toBe(5);
    expect(res.alphaPct).toBe(0);
  });

  it("keeps the index return on its own window for a single benchmark point (demo placeholder)", () => {
    const custom: PricePoint[] = [
      { date: "2026-08-01", close: 1000, value: 1000 },
      { date: "2026-09-01", close: 1100, value: 1100 },
    ];
    const benchmark: PricePoint[] = [{ date: "2026-08-01", close: 30000 }];

    const res = calculatePeriodReturns(custom, benchmark);

    // The index's own return must stay accurate; the benchmark cannot express
    // one at all, and `usingDemoBenchmark` discloses the non-comparable alpha.
    expect(res.periodCustomReturnPct).toBe(10);
    expect(res.periodBenchmarkReturnPct).toBe(0);
    expect(res.alphaPct).toBe(10);
  });

  it("leaves the fully aligned case untouched", () => {
    const custom: PricePoint[] = [
      { date: "2026-09-01", close: 1000, value: 1000 },
      { date: "2026-09-02", close: 1050, value: 1050 },
    ];
    const benchmark: PricePoint[] = [
      { date: "2026-09-01", close: 40000 },
      { date: "2026-09-02", close: 40800 },
    ];

    const res = calculatePeriodReturns(custom, benchmark);
    expect(res.periodCustomReturnPct).toBe(5);
    expect(res.periodBenchmarkReturnPct).toBe(2);
    expect(res.alphaPct).toBe(3);
  });
});

describe("isDemoBenchmarkSeries disclosure predicate (behavioral)", () => {
  const point = (date: string, close: number): PricePoint => ({ date, close });
  const active = (closes: number[]) => ({
    snapshot: {
      symbol: "^N225",
      label: "日経225",
      current: closes[closes.length - 1] ?? 0,
      change: 0,
      changePct: 0,
      updatedAt: "2026-09-01",
      description: "",
    },
    series: closes.map((close, i) => point(`2026-09-0${i + 1}`, close)),
  });

  it("reports no demo while nothing is displayed yet", () => {
    expect(isDemoBenchmarkSeries(null, [])).toBe(false);
    expect(isDemoBenchmarkSeries(active([30000, 31500]), [])).toBe(false);
  });

  it("treats a missing benchmark as demo once a line is displayed", () => {
    const displayed = [point("2026-09-01", 30000), point("2026-09-02", 31500)];
    expect(isDemoBenchmarkSeries(null, displayed)).toBe(true);
  });

  it("treats a single-point benchmark series as demo data", () => {
    const displayed = [point("2026-09-01", 30000), point("2026-09-02", 31500)];
    // The Worker's baseline placeholder when Yahoo fails.
    expect(isDemoBenchmarkSeries(active([30000]), displayed)).toBe(true);
    // A comparison window the timeframe filter collapsed to one point.
    expect(isDemoBenchmarkSeries(active([30000, 31500]), [point("2026-09-01", 30000)])).toBe(true);
  });

  it("reports real data only when both series have at least two points", () => {
    const displayed = [point("2026-09-01", 30000), point("2026-09-02", 31500)];
    expect(isDemoBenchmarkSeries(active([30000, 31500]), displayed)).toBe(false);
  });
});
