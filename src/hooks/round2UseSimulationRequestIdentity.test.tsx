// @vitest-environment jsdom
/**
 * Behavioural regression tests for the simulation hook's request identity and
 * its sync-warning contract.
 *
 * Round-2 remediation ledger, TEST-03 → R46 and R33:
 *
 *  - R46: every publish path of `useSimulation` checked the request identity
 *    except the error path, which only looked at the abort signal. A request
 *    that had been superseded could therefore publish demo prices and a
 *    "server unreachable" error for a basket that no longer existed. The
 *    second half of the finding: the sync warnings of a failed run stayed on
 *    screen after the data had already been recomputed locally, so the
 *    warning no longer described what was displayed.
 *
 *  - R33: a failing `/api/sync-prices` batch was swallowed. The preview
 *    blocked on the batch and no warning ever reached the caller, while the
 *    sibling hook (`useCalculation`) surfaced the same failure.
 *
 * The tests drive the real hook: deferred promises, `act`, and the request
 * identity of the hook's own controller (see `src/hooks/useSimulation.loopGuard.test.tsx`
 * for the same technique).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useSimulation } from "./useSimulation";
import { formatSyncBatchFailureWarning } from "../lib/priceSync";
import type { BasketItem } from "../types";

const BASKET_A: BasketItem[] = [
  { ticker: "7203", name: "7203", theme: "テスト", weight: 100 },
];
const BASKET_B: BasketItem[] = [
  { ticker: "9984", name: "9984", theme: "テスト", weight: 100 },
];
/** The same ticker set as BASKET_A, but with a different weight. */
const BASKET_A_REWEIGHTED: BasketItem[] = [
  { ticker: "7203", name: "7203", theme: "テスト", weight: 60 },
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function snapshotResponse(): Response {
  return jsonResponse({
    snapshot: {
      symbol: "^N225",
      label: "日経225",
      current: 38000,
      change: 100,
      changePct: 0.3,
      updatedAt: "2026-01-02T00:00:00.000Z",
      description: "",
    },
    series: [
      { date: "2026-01-02", close: 38000 },
      { date: "2026-01-03", close: 38100 },
    ],
  });
}

/** A `/api/calculate` payload for the given ticker. */
function calculateResponse(ticker: string, close: number): Response {
  const series = [
    { date: "2026-01-02", close, value: close },
    { date: "2026-01-03", close: close * 1.1, value: close * 1.1 },
  ];
  return jsonResponse({
    ok: true,
    baseValue: 1000,
    basket: [],
    series,
    stockUniverse: [
      {
        ticker,
        name: ticker,
        theme: "テスト",
        sector: "Unknown",
        latestPrice: close * 1.1,
        series: [
          { date: "2026-01-02", close },
          { date: "2026-01-03", close: close * 1.1 },
        ],
      },
    ],
    latest: null,
    syncStatus: { total: 1, found: 1 },
  });
}

/** The state the consumer of the hook observes. */
interface SimulationView {
  error: string | null;
  usingDemoData: boolean;
  syncWarnings: string[];
  customSeriesLength: number;
  stockUniverseLength: number;
}

let view: SimulationView;
/** The hook's latest `runSimulation` instance (re-created on every render). */
let runSimulation: (force?: boolean) => Promise<void>;

function Harness({ items }: { items: BasketItem[] }) {
  const simulation = useSimulation(items, 1000);
  view = {
    error: simulation.error,
    usingDemoData: simulation.usingDemoData,
    syncWarnings: simulation.syncWarnings,
    customSeriesLength: simulation.customSeries.length,
    stockUniverseLength: simulation.stockUniverse.length,
  };
  runSimulation = simulation.runSimulation;
  return (
    <span data-testid="warnings">{simulation.syncWarnings.join(" | ")}</span>
  );
}

/** Let the pending microtask chain of the hook settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  // The shared sync cache lives in localStorage: a leftover entry would mark
  // the tickers as "already synced" and skip the /api/sync-prices request.
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSimulation request identity (R46)", () => {
  it("does not publish demo data or an error when a superseded request fails", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let calculateCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/calculate")) {
          calculateCalls += 1;
          return calculateCalls === 1 ? first.promise : second.promise;
        }
        if (url.includes("/api/sync-prices")) return jsonResponse({ ok: true, results: [] });
        if (url.includes("/api/snapshot")) return snapshotResponse();
        return jsonResponse({});
      }),
    );

    vi.useFakeTimers();
    const { rerender } = render(<Harness items={BASKET_A} />);

    // Let the debounced request for the first basket start.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(calculateCalls).toBe(1);

    // The basket changes while the first request is still in flight: the
    // request is superseded and must never publish anything.
    await act(async () => {
      rerender(<Harness items={BASKET_B} />);
    });

    // Let the debounced request for the new basket start.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(calculateCalls).toBe(2);

    const beforeFailure = { ...view };

    // The superseded request fails with a plain network error (not an
    // AbortError), which is the branch the request identity has to guard.
    await act(async () => {
      first.reject(new Error("network down"));
      await flush();
    });

    expect(view.error).toBe(beforeFailure.error);
    expect(view.error).toBeNull();
    expect(view.usingDemoData).toBe(false);
    expect(view.customSeriesLength).toBe(0);
    expect(view.stockUniverseLength).toBe(0);
    expect(view.syncWarnings).toEqual(beforeFailure.syncWarnings);

    // The current basket's own response is applied normally afterwards.
    await act(async () => {
      second.resolve(calculateResponse("9984", 200));
      await flush();
    });

    expect(view.customSeriesLength).toBe(2);
    expect(view.stockUniverseLength).toBe(1);
    expect(view.error).toBeNull();
    expect(view.usingDemoData).toBe(false);
  });

  it("clears the stale sync warnings when the basket is recomputed locally", async () => {
    // The first run syncs successfully and publishes the universe, so the
    // effect knows this ticker set and recomputes locally from then on.
    const forcedCalculate = deferred<Response>();
    let syncCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/sync-prices")) {
          syncCalls += 1;
          // The forced refresh below fails to sync the prices.
          if (syncCalls === 1) return jsonResponse({ ok: true, results: [] });
          return jsonResponse({ error: "sync failed" }, { status: 500 });
        }
        if (url.includes("/api/calculate")) {
          if (syncCalls === 1) return calculateResponse("7203", 100);
          return forcedCalculate.promise;
        }
        if (url.includes("/api/snapshot")) return snapshotResponse();
        return jsonResponse({});
      }),
    );

    vi.useFakeTimers();
    const { rerender } = render(<Harness items={BASKET_A} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flush();
    });

    expect(view.customSeriesLength).toBe(2);
    expect(view.syncWarnings).toEqual([]);

    // A forced refresh now fails to sync the prices: the warning must be
    // visible to the caller while the calculation is still running.
    await act(async () => {
      void runSimulation(true);
      await flush();
    });

    expect(view.syncWarnings).toContain(formatSyncBatchFailureWarning(1));

    // The weights change: the ticker set is unchanged, so the data is
    // recomputed locally and the stale warning has to disappear.
    await act(async () => {
      rerender(<Harness items={BASKET_A_REWEIGHTED} />);
      await flush();
    });

    expect(view.syncWarnings).toEqual([]);
    expect(view.customSeriesLength).toBe(2);

    // The pending forced calculation resolves late: it must not corrupt the
    // locally recomputed state.
    await act(async () => {
      forcedCalculate.resolve(calculateResponse("7203", 100));
      await flush();
    });

    expect(view.customSeriesLength).toBe(2);
    expect(view.stockUniverseLength).toBe(1);
    expect(view.error).toBeNull();
    expect(view.usingDemoData).toBe(false);
  });
});

describe("useSimulation sync warnings (R33)", () => {
  it("reports a failed sync batch and still requests the calculation", async () => {
    const calculate = deferred<Response>();
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/api/sync-prices")) {
          return jsonResponse({ error: "sync failed" }, { status: 500 });
        }
        if (url.includes("/api/calculate")) return calculate.promise;
        if (url.includes("/api/snapshot")) return snapshotResponse();
        return jsonResponse({});
      }),
    );

    vi.useFakeTimers();
    render(<Harness items={BASKET_A} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flush();
    });

    // The failing batch was requested and the calculation was requested too:
    // a sync problem must not block the preview.
    expect(requestedUrls.some((url) => url.includes("/api/sync-prices"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/calculate"))).toBe(true);

    // The failure reached the caller as a warning.
    expect(view.syncWarnings).toContain(formatSyncBatchFailureWarning(1));
    expect(view.syncWarnings.length).toBeGreaterThan(0);

    // The calculation still completes and the preview shows its result.
    await act(async () => {
      calculate.resolve(calculateResponse("7203", 100));
      await flush();
    });

    expect(view.customSeriesLength).toBe(2);
    expect(view.stockUniverseLength).toBe(1);
    expect(view.error).toBeNull();
    expect(view.usingDemoData).toBe(false);
  });
});
