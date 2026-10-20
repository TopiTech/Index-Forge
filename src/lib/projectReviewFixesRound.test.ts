// @vitest-environment jsdom
/**
 * Regression guards for defects fixed in the full-project code review.
 *
 * 1. App.handleAddToPortfolio used to fall back to a fabricated price of 100
 *    when neither the live quote nor fundamentals had a valid price, silently
 *    corrupting the user's cost basis (and therefore every P/L figure).
 * 2. useIndices falls back to DEFAULT_INDICES on failure, so App's
 *    `indicesError && indices.length === 0` branch was unreachable and an
 *    unreachable server left users looking at built-in indices with no
 *    indication anything was wrong.
 * 3. useBenchmark publishes the snapshot of the request that is still current.
 *    A superseded (replaced by another symbol) or aborted (unmounted) request
 *    must publish neither state nor the shared session cache, otherwise stale
 *    "last updated" metadata and a stale payload are served for the whole
 *    cache TTL. The guard is behavioural now: the hook is rendered, a late
 *    response is delivered and the published state is inspected.
 * 4. buildDashboardQuery compared update fields against `null` while the type
 *    only allowed `undefined`, so the parameter-delete branches were dead
 *    code and a stale `index=` survived deselection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { buildDashboardQuery, parseDashboardParams } from "./navigation";
import { useBenchmark } from "../hooks/useBenchmark";

// The jsdom environment externalizes the Node built-ins, so the source is
// read through Vite's `?raw` suffix instead of `fs`/`path`.
import appSource from "../App.tsx?raw";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleAddToPortfolio refuses a fabricated cost basis", () => {
  it("never falls back to a hard-coded price", () => {
    // The pre-fix shape: `: 100` as the final branch of the safePrice chain.
    expect(appSource).not.toMatch(/Number\.isFinite\(fund\.price\) && fund\.price > 0\s*\?\s*fund\.price\s*:\s*100/);
  });

  it("aborts the add with an error toast when no valid price exists", () => {
    expect(appSource).toContain("const safePrice =");
    expect(appSource).toContain("if (safePrice === null) {");
    expect(appSource).toMatch(
      /if \(safePrice === null\) \{[\s\S]{0,400}?toastError\(/,
    );
    // The refusal must not reach addPortfolioPosition.
    const refusalBlock = appSource.slice(
      appSource.indexOf("if (safePrice === null) {"),
      appSource.indexOf("addPortfolioPosition({"),
    );
    expect(refusalBlock).toContain("return;");
  });
});

describe("indices list failure is surfaced to the user", () => {
  it("shows a warning toast when the indices fetch fails", () => {
    expect(appSource).toContain("if (indicesError) {");
    expect(appSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(indicesError\) \{\s*toastWarning\(/,
    );
  });

  it("keeps the error state wired from useIndices", () => {
    expect(appSource).toContain("error: indicesError,");
  });
});

/** A `/api/snapshot` payload the hook accepts. */
function snapshotPayload(symbol: string, current: number) {
  return {
    snapshot: {
      symbol,
      label: symbol,
      current,
      change: 1,
      changePct: 0.5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      description: "",
    },
    series: [{ date: "2026-01-01", close: current }],
  };
}

function snapshotResponse(symbol: string, current: number): Response {
  return new Response(JSON.stringify(snapshotPayload(symbol, current)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A response whose delivery is controlled by the test. */
function deferredResponse() {
  let resolveWith!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    resolveWith = resolve;
  });
  return { promise, resolveWith };
}

/** Let every pending microtask of the hook's fetch chain settle. */
async function flushAsyncChain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useBenchmark does not publish a superseded or aborted response", () => {
  it("ignores the response of a request that has been replaced", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.fn(
      (): Promise<Response> =>
        new Promise<Response>(() => {
          // Requests that are not explicitly deferred never settle.
        }),
    );
    fetchMock.mockImplementationOnce(() => first.promise);
    fetchMock.mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBenchmark("^N225", true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The user switches to another benchmark: the first request is superseded.
    act(() => {
      result.current.setSelectedBenchmark("^GSPC");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The superseded response arrives late and must not be published.
    await act(async () => {
      first.resolveWith(snapshotResponse("^N225", 100));
      await flushAsyncChain();
    });

    expect(result.current.benchmarkData).toBeNull();
    expect(result.current.lastUpdatedAt).toBeNull();
    // An aborted request must not report an error for a state that is gone.
    expect(result.current.error).toBeNull();

    // The request that is still current publishes its payload.
    await act(async () => {
      second.resolveWith(snapshotResponse("^GSPC", 200));
      await flushAsyncChain();
    });

    expect(result.current.benchmarkData?.snapshot.symbol).toBe("^GSPC");
    expect(result.current.lastUpdatedAt).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("never publishes an aborted response to the shared benchmark session cache", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn(
      (): Promise<Response> =>
        new Promise<Response>(() => {
          // Never resolves: the request must be dropped by the unmount.
        }),
    );
    fetchMock.mockImplementationOnce(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useBenchmark("BTC-USD", true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The consumer unmounts, so the request is aborted.
    unmount();

    await act(async () => {
      pending.resolveWith(snapshotResponse("BTC-USD", 1));
      await flushAsyncChain();
    });

    // The module cache feeds the next render: an aborted response must not
    // have been written to it, otherwise the stale payload would be served
    // for the whole cache TTL.
    const next = renderHook(() => useBenchmark("BTC-USD", true));
    expect(next.result.current.benchmarkData).toBeNull();
    expect(next.result.current.loading).toBe(true);
  });

  it("publishes a resolved response to the shared benchmark session cache", async () => {
    // Control for the assertion above: a response that is NOT aborted really
    // does reach the module cache, so a missing cache entry after an abort
    // proves that the aborted response was dropped.
    const pending = deferredResponse();
    const fetchMock = vi.fn(
      (): Promise<Response> =>
        new Promise<Response>(() => {
          // Never resolves: the request must be dropped by the unmount.
        }),
    );
    fetchMock.mockImplementationOnce(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBenchmark("^N225", true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      pending.resolveWith(snapshotResponse("^N225", 100));
      await flushAsyncChain();
    });

    expect(result.current.benchmarkData?.snapshot.symbol).toBe("^N225");

    // The next consumer of the same symbol is served from the cache.
    const next = renderHook(() => useBenchmark("^N225", true));
    expect(next.result.current.benchmarkData?.snapshot.symbol).toBe("^N225");
    expect(next.result.current.loading).toBe(false);
  });
});

describe("buildDashboardQuery removes stale params when passed null", () => {
  it("deletes index/bm/tf when the caller explicitly passes null", () => {
    const query = buildDashboardQuery("?index=old&bm=^N225&tf=1M&keep=1", {
      indexId: null,
      benchmark: null,
      timeframe: null,
    });
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    expect(params.has("index")).toBe(false);
    expect(params.has("bm")).toBe(false);
    expect(params.has("tf")).toBe(false);
    // Non-dashboard params survive.
    expect(params.get("keep")).toBe("1");
  });

  it("keeps existing values when a field is undefined and updates when set", () => {
    const kept = buildDashboardQuery("?index=old&tf=1M", {
      indexId: undefined,
      timeframe: "3M",
    });
    const keptParams = new URLSearchParams(kept.slice(1));
    expect(keptParams.get("index")).toBe("old");
    expect(keptParams.get("tf")).toBe("3M");

    const updated = buildDashboardQuery("?index=old", { indexId: "new" });
    expect(new URLSearchParams(updated.slice(1)).get("index")).toBe("new");
  });

  it("round-trips through parseDashboardParams after deletion", () => {
    const query = buildDashboardQuery("?index=old&bm=^N225", { indexId: null });
    expect(parseDashboardParams(query).indexId).toBeUndefined();
  });
});
