// @vitest-environment jsdom
/**
 * Remaining gap of the benchmark session cache (round-2 ledger, TEST-03 →
 * R8).
 *
 * `src/lib/projectReviewFixesRound.test.ts` already covers the two halves of
 * the R8 contract behaviourally:
 *
 *  - "ignores the response of a request that has been replaced" — a
 *    superseded response publishes neither state nor an error;
 *  - "never publishes an aborted response to the shared benchmark session
 *    cache" — an aborted request leaves the module cache untouched.
 *
 * The combination that is still missing is the cache side of a *superseded*
 * request: the module cache feeds the next render, so a stale response that
 * reached it would be served for the whole cache TTL even though the state
 * was correctly not published. This test closes that gap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBenchmark } from "./useBenchmark";

function snapshotResponse(symbol: string, current: number): Response {
  return new Response(
    JSON.stringify({
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
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function deferredResponse() {
  let resolveWith!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    resolveWith = resolve;
  });
  return { promise, resolveWith };
}

async function flushAsyncChain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useBenchmark session cache (R8, remaining gap)", () => {
  it("does not write a superseded response to the shared benchmark session cache", async () => {
    const superseded = deferredResponse();
    const current = deferredResponse();
    const fetchMock = vi.fn(
      (): Promise<Response> =>
        new Promise<Response>(() => {
          // Requests that are not explicitly deferred never settle.
        }),
    );
    fetchMock.mockImplementationOnce(() => superseded.promise);
    fetchMock.mockImplementationOnce(() => current.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBenchmark("^N225", true));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The user switches to another benchmark: the first request is superseded.
    act(() => {
      result.current.setSelectedBenchmark("^GSPC");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The superseded response arrives late.
    await act(async () => {
      superseded.resolveWith(snapshotResponse("^N225", 100));
      await flushAsyncChain();
    });

    // The state was not published ...
    expect(result.current.benchmarkData).toBeNull();
    expect(result.current.lastUpdatedAt).toBeNull();

    // ... and the module cache was not written either: a new consumer of the
    // same symbol must not be served the stale payload.
    const next = renderHook(() => useBenchmark("^N225", true));
    expect(next.result.current.benchmarkData).toBeNull();
    expect(next.result.current.loading).toBe(true);
  });
});
