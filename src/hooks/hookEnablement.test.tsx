// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBenchmark } from "./useBenchmark";
import { useCalculation } from "./useCalculation";
import { DEFAULT_INDICES } from "../data/indices";

/**
 * Market data work is gated on the dashboard being the active view.
 *
 * Both hooks take an `enabled` flag from `App.tsx`; while it is false they must
 * not issue a request at all. This used to be asserted by grepping
 * `if (!enabled)` out of the hook sources, which stayed green even when the
 * early return was moved after the fetch.
 */
function installFetchSpy() {
  const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("market data hooks stay idle while disabled", () => {
  it("does not request a benchmark snapshot when disabled", async () => {
    const fetchSpy = installFetchSpy();

    const { result } = renderHook(() => useBenchmark("^N225", false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("requests the snapshot once enabled", async () => {
    const fetchSpy = installFetchSpy();

    renderHook(() => useBenchmark("^N225", true));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/snapshot");
  });

  it("does not calculate an index while disabled", async () => {
    const fetchSpy = installFetchSpy();

    const { result } = renderHook(() => useCalculation(DEFAULT_INDICES[0], false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.customSeries).toEqual([]);
  });

  it("starts the calculation pipeline once enabled", async () => {
    const fetchSpy = installFetchSpy();

    renderHook(() => useCalculation(DEFAULT_INDICES[0], true));

    // The pipeline syncs prices first and then calculates.
    await waitFor(() => {
      const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("/api/calculate"))).toBe(true);
    });
  });
});
