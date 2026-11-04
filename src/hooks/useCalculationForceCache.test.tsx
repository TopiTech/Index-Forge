// @vitest-environment jsdom
/**
 * A forced recalculation must bypass the client calculation cache completely.
 *
 * The cache hit was only *suppressed* after being read, so `setLoading(true)`
 * never ran: the hook cleared the old series and then showed neither data nor
 * a loading state until the network request finished. A forced refresh is
 * exactly the case where the user needs that feedback.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomIndex } from "../data/indices";
import { clearClientCalcCache, setClientCalcCache, useCalculation } from "./useCalculation";

vi.mock("./useAuth", () => ({
  useAuth: () => ({ session: null }),
}));

const INDEX: CustomIndex = {
  id: "force-cache-test",
  name: "Force cache test",
  description: "",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

const BASKET_KEY = JSON.stringify({
  id: INDEX.id,
  baseValue: INDEX.baseValue,
  basket: INDEX.basket.map(({ ticker, name, theme, weight }) => ({
    ticker,
    name,
    theme,
    weight,
  })),
});

beforeEach(() => {
  clearClientCalcCache();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("forced recalculation cache semantics", () => {
  it("ignores a fresh cache hit so the refresh exposes a loading state", () => {
    setClientCalcCache(BASKET_KEY, {
      series: [{ date: "2026-01-01", close: 123 }],
      stockUniverse: [],
      timestamp: Date.now(),
    });
    // The forced run reaches the sync step first; it never settles here.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const { result } = renderHook(() => useCalculation(INDEX, false));
    act(() => {
      void result.current.recalculate(true);
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.customSeries).toEqual([]);
  });
});
