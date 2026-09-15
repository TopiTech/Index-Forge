import { describe, expect, it } from "vitest";
import { isBenchmarkDataForSymbol, type BenchmarkData } from "./useBenchmark";

const sample: BenchmarkData = {
  snapshot: {
    symbol: "^N225",
    label: "日経225",
    current: 38_000,
    change: 100,
    changePct: 0.26,
    updatedAt: "2026/09/11 15:30:00",
    description: "日経平均株価 (日足)",
  },
  series: [{ date: "2026-09-11", close: 38_000 }],
  stale: true,
};

describe("isBenchmarkDataForSymbol", () => {
  it("accepts only data whose response symbol matches the selected benchmark", () => {
    expect(isBenchmarkDataForSymbol(sample, "^N225")).toBe(true);
    expect(isBenchmarkDataForSymbol(sample, "^GSPC")).toBe(false);
    expect(isBenchmarkDataForSymbol(sample, "BTC-USD")).toBe(false);
    expect(isBenchmarkDataForSymbol(null, "^N225")).toBe(false);
  });

  it("includes BTC-USD in AVAILABLE_BENCHMARKS", () => {
    const btc = sample ? { ...sample, snapshot: { ...sample.snapshot, symbol: "BTC-USD" as const } } : null;
    expect(isBenchmarkDataForSymbol(btc, "BTC-USD")).toBe(true);
  });
});

