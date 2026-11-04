// @vitest-environment jsdom
/**
 * The benchmark session cache is keyed by the *requested* symbol. A payload
 * whose own `snapshot.symbol` names a different instrument must therefore be
 * rejected before it reaches that cache: storing it would poison every later
 * read for the full TTL, and the UI would silently fall back to the default
 * benchmark while reporting no error at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBenchmark response provenance", () => {
  it("rejects a payload for another symbol instead of caching it under the request key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => snapshotResponse("^GSPC", 5000)),
    );

    const first = renderHook(() => useBenchmark("^N225"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    expect(first.result.current.benchmarkData).toBeNull();
    expect(first.result.current.error).toBe("^N225 データの形式が不正です");

    // The rejected payload must not be served to the next consumer of ^N225:
    // it has to issue a real request instead.
    const fetchMock = vi.fn(async () => snapshotResponse("^N225", 38000));
    vi.stubGlobal("fetch", fetchMock);

    const second = renderHook(() => useBenchmark("^N225"));
    await waitFor(() =>
      expect(second.result.current.benchmarkData?.snapshot.symbol).toBe("^N225"),
    );
    expect(second.result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a payload whose symbol matches the requested benchmark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => snapshotResponse("^GSPC", 5000)),
    );

    const { result } = renderHook(() => useBenchmark("^GSPC"));
    await waitFor(() => expect(result.current.benchmarkData).not.toBeNull());

    expect(result.current.error).toBeNull();
    expect(result.current.benchmarkData?.snapshot.symbol).toBe("^GSPC");
    expect(result.current.benchmarkData?.snapshot.current).toBe(5000);
  });
});
