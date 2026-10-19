// @vitest-environment jsdom
/**
 * Regression tests for the useSimulation effect loop and stale-response
 * overwrite.
 *
 * Both defects lived in the same effect:
 *
 *  - The "clear" branch wrote fresh array literals into `customSeries` and
 *    `stockUniverse` on every run. The effect depends on `stockUniverse`, so
 *    each write changed the dependency, re-armed the effect and re-ran it:
 *    clearing an already-empty basket produced an unbounded
 *    "Maximum update depth exceeded" loop that took the whole tab down.
 *
 *  - A response for a superseded basket could still land and overwrite the
 *    current basket's series, because the effect's branches did not
 *    invalidate the in-flight request and the response handler did not
 *    re-check the request identity after awaiting the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useSimulation, clearIfEmpty } from "./useSimulation";
import type { BasketItem, PricePoint } from "../types";

const EMPTY_BASKET: BasketItem[] = [];
const BASKET_ITEM: BasketItem = {
  ticker: "7203",
  name: "7203",
  theme: "テスト",
  weight: 100,
};
const BASKET: BasketItem[] = [BASKET_ITEM];
const SECOND_BASKET: BasketItem[] = [
  { ticker: "9984", name: "9984", theme: "テスト", weight: 100 },
];

function seriesFor(ticker: string, close: number): PricePoint[] {
  return [
    { date: "2026-01-02", close, value: close },
    { date: "2026-01-03", close: close * 1.1, value: close * 1.1 },
  ];
}

interface Deferred {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/snapshot")) {
        return jsonResponse({
          snapshot: { symbol: "^N225", label: "日経225", current: 1, change: 0, changePct: 0, updatedAt: "", description: "" },
          series: [],
        });
      }
      if (url.includes("/api/sync-prices")) {
        return jsonResponse({ ok: true, results: [] });
      }
      if (url.includes("/api/calculate")) {
        return jsonResponse({
          ok: true,
          baseValue: 1000,
          basket: [],
          series: [],
          stockUniverse: [],
          latest: null,
          syncStatus: { total: 0, found: 0 },
        });
      }
      return jsonResponse({});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Guard against an unbounded render loop.
 *
 * React only aborts nested updates with "Maximum update depth exceeded"; an
 * effect that re-arms itself keeps scheduling new renders instead, which
 * exhausts the worker heap after minutes. Failing fast with a clear message
 * keeps a regression diagnosable.
 */
function assertRenderCountWithinLimit(renderCount: number, limit: number): void {
  if (renderCount > limit) {
    throw new Error(`unbounded render loop: ${renderCount} renders (limit ${limit})`);
  }
}

describe("clearIfEmpty", () => {
  it("preserves the previous reference for an already-empty collection", () => {
    // React only skips a re-render when a state updater returns the previous
    // reference. Returning a new array here is what made the effect re-arm
    // itself forever.
    const empty: PricePoint[] = [];
    expect(clearIfEmpty(empty)).toBe(empty);

    const filled: PricePoint[] = [{ date: "2026-01-02", close: 1 }];
    const cleared = clearIfEmpty(filled);
    expect(cleared).toEqual([]);
    expect(cleared).not.toBe(filled);
  });
});

describe("useSimulation effect loop", () => {
  it("settles instead of looping when the basket is empty from the start", () => {
    let renderCount = 0;

    function Harness() {
      renderCount += 1;
      assertRenderCountWithinLimit(renderCount, 50);
      const simulation = useSimulation(EMPTY_BASKET, 1000);
      return <span data-testid="length">{simulation.customSeries.length}</span>;
    }

    // With the unbounded loop this render never settles: React aborts with
    // "Maximum update depth exceeded".
    const { getByTestId } = render(<Harness />);
    expect(getByTestId("length").textContent).toBe("0");
    expect(renderCount).toBeLessThan(5);
  });

  it("settles when the parent recreates an equal basket array on every render", () => {
    // The effect depends on the basket array, so a parent that rebuilds it
    // re-runs the effect on every render. Every write the effect performs must
    // therefore be idempotent, otherwise the effect re-arms itself forever.
    let renderCount = 0;

    function Harness() {
      renderCount += 1;
      assertRenderCountWithinLimit(renderCount, 50);
      // A fresh (but equal) array on every render.
      const simulation = useSimulation([{ ...BASKET_ITEM }], 1000);
      return <span data-testid="length">{simulation.customSeries.length}</span>;
    }

    render(<Harness />);
    expect(renderCount).toBeLessThan(10);
  });

  it("settles when the basket is emptied while a calculation is in flight", async () => {
    let renderCount = 0;

    function Harness({ items }: { items: BasketItem[] }) {
      renderCount += 1;
      assertRenderCountWithinLimit(renderCount, 50);
      const simulation = useSimulation(items, 1000);
      return <span data-testid="length">{simulation.customSeries.length}</span>;
    }

    const pending = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/calculate")) return pending.promise;
        if (url.includes("/api/snapshot")) {
          return jsonResponse({
            snapshot: { symbol: "^N225", label: "日経225", current: 1, change: 0, changePct: 0, updatedAt: "", description: "" },
            series: [],
          });
        }
        if (url.includes("/api/sync-prices")) return jsonResponse({ ok: true, results: [] });
        return jsonResponse({});
      }),
    );

    vi.useFakeTimers();
    const { rerender, getByTestId } = render(<Harness items={BASKET} />);

    // Let the debounced fetch start so the request is genuinely in flight.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Empty the basket while the calculation request is still open.
    await act(async () => {
      rerender(<Harness items={EMPTY_BASKET} />);
    });

    // The late response for the removed basket must be ignored.
    await act(async () => {
      pending.resolve(
        jsonResponse({
          ok: true,
          baseValue: 1000,
          basket: BASKET,
          series: seriesFor("7203", 100),
          stockUniverse: [
            {
              ticker: "7203",
              name: "7203",
              theme: "テスト",
              sector: "Unknown",
              latestPrice: 110,
              series: seriesFor("7203", 100),
            },
          ],
          latest: null,
          syncStatus: { total: 1, found: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(getByTestId("length").textContent).toBe("0");
    expect(renderCount).toBeLessThan(20);
  });
});

describe("useSimulation stale response handling", () => {
  it("does not publish a superseded basket's series", async () => {
    const first = deferred();
    const second = deferred();
    let call = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/calculate")) {
          call += 1;
          return call === 1 ? first.promise : second.promise;
        }
        if (url.includes("/api/snapshot")) {
          return jsonResponse({
            snapshot: { symbol: "^N225", label: "日経225", current: 1, change: 0, changePct: 0, updatedAt: "", description: "" },
            series: [],
          });
        }
        if (url.includes("/api/sync-prices")) return jsonResponse({ ok: true, results: [] });
        return jsonResponse({});
      }),
    );

    let latestLength = -1;
    function Harness({ items }: { items: BasketItem[] }) {
      const simulation = useSimulation(items, 1000);
      latestLength = simulation.customSeries.length;
      return <span data-testid="length">{latestLength}</span>;
    }

    vi.useFakeTimers();
    const { rerender } = render(<Harness items={BASKET} />);

    // Let the debounced fetch for the first basket start.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Switch to a different basket before the first response resolves.
    await act(async () => {
      rerender(<Harness items={SECOND_BASKET} />);
    });

    // Let the debounced fetch for the second basket start.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // The first (superseded) response arrives late and must be ignored.
    await act(async () => {
      first.resolve(
        jsonResponse({
          ok: true,
          baseValue: 1000,
          basket: BASKET,
          series: seriesFor("7203", 100),
          stockUniverse: [
            {
              ticker: "7203",
              name: "7203",
              theme: "テスト",
              sector: "Unknown",
              latestPrice: 110,
              series: seriesFor("7203", 100),
            },
          ],
          latest: null,
          syncStatus: { total: 1, found: 1 },
        }),
      );
      await Promise.resolve();
    });

    // The stale payload must not have been applied.
    expect(latestLength).toBe(0);

    // The current basket's own response is applied normally.
    await act(async () => {
      second.resolve(
        jsonResponse({
          ok: true,
          baseValue: 1000,
          basket: SECOND_BASKET,
          series: seriesFor("9984", 200),
          stockUniverse: [
            {
              ticker: "9984",
              name: "9984",
              theme: "テスト",
              sector: "Unknown",
              latestPrice: 220,
              series: seriesFor("9984", 200),
            },
          ],
          latest: null,
          syncStatus: { total: 1, found: 1 },
        }),
      );
      await Promise.resolve();
    });

    expect(latestLength).toBe(2);
  });
});
