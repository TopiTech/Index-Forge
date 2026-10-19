// @vitest-environment jsdom
/**
 * Regression tests for the conditional-request handling of the index list.
 *
 * The ETag and the response body form one conditional-request pair. The ETag
 * used to be written before the body was validated and outside the request
 * generation guard, so a failed body parse left the stored ETag paired with
 * the previous body: the next request legitimately answered 304 and the UI
 * silently kept the stale list.
 *
 * The list request also used to survive unmount, writing to state that no
 * longer had a consumer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useIndices } from "./useIndices";

const CACHE_KEY = "osi_indices_cache";
const ETAG_KEY = "osi_indices_etag";

function indexPayload() {
  return [
    {
      id: "custom-1",
      name: "テスト指数",
      description: "",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 100 }],
    },
  ];
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useIndices conditional requests", () => {
  it("does not store an ETag when the response body cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not json", {
            status: 200,
            headers: { "content-type": "application/json", etag: '"fresh-etag"' },
          }),
      ),
    );

    function Harness() {
      const { error } = useIndices();
      return <span data-testid="error">{error ?? ""}</span>;
    }

    const { getByTestId } = render(<Harness />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("error").textContent).not.toBe("");
    // The ETag must not be stored without a matching body, otherwise the next
    // request answers 304 and the UI keeps the stale list.
    expect(window.localStorage.getItem(ETAG_KEY)).toBeNull();
  });

  it("stores the ETag together with the validated body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(indexPayload()), {
            status: 200,
            headers: { "content-type": "application/json", etag: '"fresh-etag"' },
          }),
      ),
    );

    function Harness() {
      const { indices } = useIndices();
      return <span data-testid="count">{indices.length}</span>;
    }

    const { getByTestId } = render(<Harness />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("count").textContent).toBe("1");
    expect(window.localStorage.getItem(ETAG_KEY)).toBe('"fresh-etag"');
    expect(window.localStorage.getItem(CACHE_KEY)).toContain("custom-1");
  });

  it("aborts the in-flight request when the consumer unmounts", async () => {
    let capturedSignal: AbortSignal | null = null;
    // The signal is assigned from inside the fetch mock, so it is read through
    // a getter: a direct read would keep the narrowed `null` type of the
    // initializer.
    const getCapturedSignal = (): AbortSignal | null => capturedSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? null;
        return new Promise<Response>(() => {
          // Never resolves: the request must be cancelled by the unmount.
        });
      }),
    );

    function Harness() {
      useIndices();
      return <span data-testid="mounted">mounted</span>;
    }

    const { unmount } = render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getCapturedSignal()).not.toBeNull();
    expect(getCapturedSignal()?.aborted).toBe(false);

    unmount();

    expect(getCapturedSignal()?.aborted).toBe(true);
  });
});
