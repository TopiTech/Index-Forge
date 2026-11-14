// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateConstituentPerformance, useSimulation } from "./useSimulation";
import type { BasketItem, StockSeries } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSimulation Unit 3 lifecycle and sanitization fixes", () => {
  it("clears stale error and usingDemoData state when the basket becomes empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network error")));

    const initialBasket: BasketItem[] = [
      { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 },
    ];
    const { result, rerender } = renderHook(
      ({ basket }: { basket: BasketItem[] }) => useSimulation(basket, 1000),
      { initialProps: { basket: initialBasket } },
    );

    await waitFor(() => {
      expect(result.current.usingDemoData).toBe(true);
      expect(result.current.error).toBeTruthy();
    });

    rerender({ basket: [] });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.usingDemoData).toBe(false);
      expect(result.current.customSeries).toEqual([]);
    });
  });

  it("resets knownTickersRef when transitioning to an invalid basket so restoring the valid ticker re-fetches", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sync-prices")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/calc")) {
        return new Response(
          JSON.stringify({
            series: [
              { date: "2026-10-13", close: 1000 },
              { date: "2026-10-14", close: 1020 },
            ],
            stockUniverse: [
              {
                ticker: "7203",
                name: "トヨタ",
                theme: "自動車",
                sector: "輸送用機器",
                latestPrice: 3000,
                series: [
                  { date: "2026-10-13", close: 2950 },
                  { date: "2026-10-14", close: 3000 },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const validBasket: BasketItem[] = [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }];
    const invalidBasket: BasketItem[] = [{ ticker: "BAD@!", name: "Invalid", theme: "X", weight: 100 }];

    const { result, rerender } = renderHook(
      ({ basket }: { basket: BasketItem[] }) => useSimulation(basket, 1000),
      { initialProps: { basket: validBasket } },
    );

    await waitFor(() => expect(result.current.customSeries).toHaveLength(2));
    const calcCallsAfterFirst = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/calc")).length;

    rerender({ basket: invalidBasket });
    await waitFor(() => expect(result.current.error).toContain("有効なティッカー"));

    rerender({ basket: [...validBasket] });
    await waitFor(() => expect(result.current.error).toBeNull());
    const calcCallsAfterRestore = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/calc")).length;
    expect(calcCallsAfterRestore).toBeGreaterThan(calcCallsAfterFirst);
    expect(result.current.customSeries).toHaveLength(2);
  });

  it("ignores Error-typed AbortError rejections without publishing demo fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/sync-prices")) {
          const abortErr = new Error("Aborted");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        return new Response("{}", { status: 500 });
      }),
    );

    const { result } = renderHook(() =>
      useSimulation([{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }], 1000),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.usingDemoData).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sanitizes non-finite or non-positive startPrice and latestPrice to 0 in constituent performance", () => {
    const basket: BasketItem[] = [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }];
    const corruptUniverse: StockSeries[] = [
      {
        ticker: "7203",
        name: "トヨタ",
        theme: "自動車",
        sector: "輸送用機器",
        latestPrice: 0,
        series: [
          { date: "2026-10-13", close: Number.NaN },
          { date: "2026-10-14", close: -10 },
        ],
      },
    ];
    const perf = calculateConstituentPerformance(basket, corruptUniverse, "1M");
    expect(perf).toHaveLength(1);
    expect(perf[0].startPrice).toBe(0);
    expect(perf[0].latestPrice).toBe(0);
    expect(perf[0].periodReturnPct).toBe(0);
  });
});
