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
  vi.restoreAllMocks();
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

  it("serves cached data on 304 without extending its TTL (H-10)", async () => {
    // A 304 only confirms the server still serves the same payload. The
    // previous implementation bumped `cached.timestamp` on every
    // revalidation, so an entry fetched once stayed "fresh" (and
    // `lastUpdatedAt` kept looking current) for as long as the tab lived.
    const payload = JSON.stringify({
      snapshot: {
        symbol: "^N225",
        label: "^N225",
        current: 100,
        change: 1,
        changePct: 0.5,
        updatedAt: "2026-01-01T00:00:00.000Z",
        description: "",
      },
      series: [{ date: "2026-01-01", close: 100 }],
    });
    const seenInits: Array<RequestInit | undefined> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        seenInits.push(init);
        if (seenInits.length === 1) {
          return new Response(payload, {
            status: 200,
            headers: { "content-type": "application/json", etag: '"E1"' },
          });
        }
        return new Response(null, { status: 304 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(() => useBenchmark("^N225", true));
    await waitFor(() => expect(first.result.current.benchmarkData).not.toBeNull());
    const fetchedAt = first.result.current.lastUpdatedAt;
    expect(typeof fetchedAt).toBe("number");
    cleanup();

    // Six minutes later the entry is past its TTL: the next consumer must
    // revalidate instead of serving it as fresh.
    const t0 = fetchedAt as number;
    vi.spyOn(Date, "now").mockReturnValue(t0 + 6 * 60 * 1000);

    const next = renderHook(() => useBenchmark("^N225", true));
    await waitFor(() => expect(next.result.current.benchmarkData).not.toBeNull());

    // The revalidation used the stored ETag ...
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const revalidationHeaders = seenInits[1]?.headers as Record<string, string> | undefined;
    expect(revalidationHeaders?.["If-None-Match"]).toBe('"E1"');
    // ... served the validated payload, but the entry age and the displayed
    // update time stay anchored to the original fetch.
    expect(next.result.current.benchmarkData?.snapshot.current).toBe(100);
    expect(next.result.current.lastUpdatedAt).toBe(t0);
  });
});
