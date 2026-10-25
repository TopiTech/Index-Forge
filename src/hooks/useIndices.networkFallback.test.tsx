// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useIndices } from "./useIndices";
import { NETWORK_UNREACHABLE_MESSAGE } from "../lib/apiContract";
import { DEFAULT_INDICES, type CustomIndex } from "../data/indices";
import {
  expectConnectionHint,
  installAbortableHangingFetch,
  renderWithFailingFetch,
} from "../test-helpers/networkFailure";

const CACHED_INDEX: CustomIndex = {
  id: "idx-cached",
  name: "Cached Index",
  description: "",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useIndices list fetch: network failure vs HTTP error (M-7 second half)", () => {
  it("reports the connection-check hint (not raw browser text) on a TypeError, keeping the cached list", async () => {
    window.localStorage.setItem("osi_indices_cache", JSON.stringify([CACHED_INDEX]));

    const { result } = renderWithFailingFetch(() => useIndices());
    await waitFor(() => expectConnectionHint(result.current.error));

    expect(result.current.indices).toEqual([CACHED_INDEX]);
    expect(result.current.loading).toBe(false);
  });

  it("falls back to the built-in defaults with the hint when nothing is cached", async () => {
    const { result } = renderWithFailingFetch(() => useIndices(), {
      fetchError: new TypeError("Load failed"),
    });
    await waitFor(() => expectConnectionHint(result.current.error));

    expect(result.current.indices).toEqual(DEFAULT_INDICES);
  });

  it("keeps reporting the server message for HTTP errors, not the connection hint", async () => {
    // HTTP failure (status, no transport problem): answer the mount fetch
    // with a 500 instead of a rejection.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "サーバーでエラーが発生しました。" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { result } = renderHook(() => useIndices());

    await waitFor(() => expect(result.current.error).toBe("指数一覧の取得に失敗しました"));

    expect(result.current.error).not.toBe(NETWORK_UNREACHABLE_MESSAGE);
    expect(result.current.indices).toEqual(DEFAULT_INDICES);
  });

  it("treats any fetch rejection as a transport failure, even a non-Error", async () => {
    // fetch() only ever rejects with Error in practice, but the discriminator
    // is *where* it threw, not *what* threw: anything the transport raises
    // means the server was never reached, so it earns the hint either way.
    const { result } = renderWithFailingFetch(() => useIndices(), { fetchError: "boom" });
    await waitFor(() => expectConnectionHint(result.current.error));
  });

  it("reports the hint (not raw browser text) when saving while offline", async () => {
    const { result } = renderWithFailingFetch(() => useIndices());
    await waitFor(() => expectConnectionHint(result.current.error));

    let outcome: Awaited<ReturnType<typeof result.current.saveCustomIndex>> | undefined;
    await act(async () => {
      outcome = await result.current.saveCustomIndex(CACHED_INDEX);
    });
    expect(outcome?.ok).toBe(false);
    expectConnectionHint(outcome?.error ?? null);
  });

  it("clears a previous connection hint once the server answers again", async () => {
    const { result, rerender, fetchMock } = renderWithFailingFetch(() => useIndices());
    await waitFor(() => expectConnectionHint(result.current.error));

    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify([CACHED_INDEX]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await act(async () => {
      await result.current.refreshIndices();
    });
    rerender();

    expect(result.current.error).toBeNull();
    expect(result.current.indices).toEqual([CACHED_INDEX]);
  });

  it("stays silent when the in-hook timeout aborts the hanging request", async () => {
    vi.useFakeTimers();
    try {
      installAbortableHangingFetch();

      const { result } = renderHook(() => useIndices());
      // The 10s request timer fires while the fetch hangs: it rejects with
      // AbortError, which the hook treats as a cancellation — no error is
      // published and the built-in fallback list simply stays.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.indices).toEqual(DEFAULT_INDICES);
      expect(result.current.loading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
