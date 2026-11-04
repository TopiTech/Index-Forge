// @vitest-environment jsdom
/**
 * A stalled `POST /api/calculate` had no client deadline. The dashboard stayed
 * in its loading state forever, with no error and no way to retry. The request
 * is now bounded by the shared calculation budget; the timeout must surface the
 * retryable message and release the loading flag.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALCULATION_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from "../lib/apiContract";
import type { CustomIndex } from "../data/indices";
import { useCalculation } from "./useCalculation";

vi.mock("./useAuth", () => ({
  useAuth: () => ({ session: null }),
}));

const INDEX: CustomIndex = {
  id: "calculation-timeout-test",
  name: "Calculation timeout test",
  description: "",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  // 11:00 JST on a weekday: the price cached below is unambiguously fresh, so
  // the hook goes straight to the calculate request under test.
  vi.setSystemTime(new Date("2026-01-15T02:00:00Z"));
  window.localStorage.setItem("osi_stock_sync_cache", JSON.stringify({ "7203": Date.now() }));
  // Model a real fetch: aborting the deadline signal rejects the pending
  // request. A mock that ignores the signal would only test the mock.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCalculation request deadline", () => {
  it("times out a stalled calculation, reports the reason, and clears loading", async () => {
    const { result } = renderHook(() => useCalculation(INDEX, true));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    // The fresh sync-cache entry must skip /api/sync-prices; otherwise this
    // test would be measuring the sync deadline instead of the calculate one.
    expect(result.current.syncing).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALCULATION_REQUEST_TIMEOUT_MS);
    });

    expect(result.current.error).toBe(REQUEST_TIMEOUT_MESSAGE);
    expect(result.current.loading).toBe(false);
  });
});
