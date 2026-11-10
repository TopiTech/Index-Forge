// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { generateFallbackStockUniverse, useSimulation } from "./useSimulation";
import type { BasketItem } from "../types";

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
 * The preview must then fall back to the generated demo prices and disclose
 * that it does so. The stub keeps the test hermetic: no request can reach
 * the network, whatever the environment looks like.
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
 * Regression guard for the demo-data disclosure fix: when the calculation API
 * is unreachable, useSimulation falls back to generateFallbackStockUniverse
 * and must surface `usingDemoData` (instead of silently presenting generated
 * prices as real market data). The flag is part of the production
 * `SimulationResult` contract, so reading it here fails to compile as soon as
 * the field disappears from that type.
 */
describe("useSimulation demo-data fallback contract", () => {
  it("generates a usable series for every basket ticker so the preview still renders", () => {
    const universe = generateFallbackStockUniverse(BASKET);
    expect(universe).toHaveLength(BASKET.length);
    for (const stock of universe) {
      expect(stock.series.length).toBeGreaterThan(0);
      expect(stock.series[0].close).toBeGreaterThan(0);
    }
  });

  it("produces deterministic prices for the same ticker (stable demo data)", () => {
    const a = generateFallbackStockUniverse(BASKET);
    const b = generateFallbackStockUniverse(BASKET);
    expect(a.map((s) => s.series.map((p) => p.close))).toEqual(
      b.map((s) => s.series.map((p) => p.close)),
    );
  });

  it("uses the JST calendar for demo dates around UTC midnight", () => {
    // 2026-01-04T15:30Z is 2026-01-05 00:30 JST (a Monday). The UTC date was
    // still Sunday, so toISOString() both labelled the bar with yesterday's
    // date and, on a UTC machine, treated the newest day as a weekend.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-04T15:30:00Z"));
      const universe = generateFallbackStockUniverse(BASKET);
      const dates = universe[0].series.map((point) => point.date);

      expect(dates[dates.length - 1]).toBe("2026-01-05");
      expect(new Set(dates).size).toBe(dates.length);
      for (const date of dates) {
        const [year, month, day] = date.split("-").map(Number);
        const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        expect(weekday).not.toBe(0);
        expect(weekday).not.toBe(6);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks every generated fallback entry as demo data", () => {
    // The fallback universe must not be indistinguishable from API data by
    // shape alone: every entry carries the production `isDemoData` marker.
    const universe = generateFallbackStockUniverse(BASKET);
    expect(universe).toHaveLength(BASKET.length);
    for (const stock of universe) {
      expect(stock.ticker).toBeDefined();
      expect(stock.isDemoData).toBe(true);
      expect(stock.series.length).toBeGreaterThan(0);
    }
  });

  it("flags the preview as demo data when the calculation API is unreachable", async () => {
    stubUnreachableApi();

    const { result } = renderHook(() => useSimulation(BASKET, 1000));

    await waitFor(() => expect(result.current.usingDemoData).toBe(true), { timeout: 5000 });

    // The generated universe is published instead of the API data ...
    expect(result.current.stockUniverse).toHaveLength(BASKET.length);
    expect(result.current.stockUniverse.every((s) => s.isDemoData === true)).toBe(true);
    // ... and the failure is disclosed instead of being hidden behind a
    // silent fallback.
    expect(result.current.error).toContain("デモデータ");
    expect(result.current.loading).toBe(false);
  });
});
