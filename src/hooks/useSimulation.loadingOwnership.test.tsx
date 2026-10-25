// @vitest-environment jsdom
/**
 * Regression test for S2 (loading ownership).
 *
 * A refresh is in flight (`runSimulation(true)`). Adding a constituent makes
 * the effect abort that refresh and debounce a replacement; removing the
 * constituent before the debounce fires cancels the replacement and recomputes
 * locally. The aborted refresh used to leave `loading` true, so the refresh
 * control stayed disabled forever. This test drives the real hook and fails on
 * the pre-fix code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useSimulation } from "./useSimulation";
import type { BasketItem } from "../types";

const BASKET_A: BasketItem[] = [
  { ticker: "7203", name: "7203", theme: "テスト", weight: 100 },
];
const BASKET_A_AND_B: BasketItem[] = [
  { ticker: "7203", name: "7203", theme: "テスト", weight: 50 },
  { ticker: "9984", name: "9984", theme: "テスト", weight: 50 },
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
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

function calculateResponse(ticker: string, close: number): Response {
  return jsonResponse({
    ok: true,
    baseValue: 1000,
    basket: [],
    series: [
      { date: "2026-01-02", close, value: close },
      { date: "2026-01-03", close: close * 1.1, value: close * 1.1 },
    ],
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

function Harness({ items }: { items: BasketItem[] }) {
  const simulation = useSimulation(items, 1000);
  loading = simulation.loading;
  runSimulation = simulation.runSimulation;
  return <span data-testid="loading">{String(simulation.loading)}</span>;
}

let loading: boolean;
let runSimulation: (force?: boolean) => Promise<void>;

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSimulation loading ownership (S2)", () => {
  it("releases loading when an in-flight refresh is aborted by add-then-remove", async () => {
    const forcedCalculation = deferred<Response>();
    let calculateCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/sync-prices")) return jsonResponse({ ok: true, results: [] });
        if (url.includes("/api/calculate")) {
          calculateCalls += 1;
          if (calculateCalls === 1) return calculateResponse("7203", 100);
          return forcedCalculation.promise;
        }
        if (url.includes("/api/snapshot")) return snapshotResponse();
        return jsonResponse({});
      }),
    );

    vi.useFakeTimers();
    const { rerender } = render(<Harness items={BASKET_A} />);

    // The initial calculation completes and the universe covers 7203.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flush();
    });
    expect(calculateCalls).toBe(1);
    expect(loading).toBe(false);

    // A manual refresh starts and stays pending.
    await act(async () => {
      void runSimulation(true);
      await flush();
    });
    expect(calculateCalls).toBe(2);
    expect(loading).toBe(true);

    // Add a constituent (aborts the refresh) and remove it before the
    // debounced replacement starts. The effect then recomputes locally.
    await act(async () => {
      rerender(<Harness items={BASKET_A_AND_B} />);
    });
    await act(async () => {
      rerender(<Harness items={BASKET_A} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flush();
    });

    // The replacement never started: the local recompute is the exit path and
    // it must release the loading flag owned by the aborted refresh.
    expect(calculateCalls).toBe(2);
    expect(loading).toBe(false);

    // The never-resolving refresh must not resurrect the spinner.
    await act(async () => {
      await flush();
    });
    expect(loading).toBe(false);
  });
});
