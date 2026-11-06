// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIndices, INDICES_REQUEST_TIMEOUT_MS } from "./useIndices";
import * as apiContract from "../lib/apiContract";
import type { CustomIndex } from "../data/indices";

const TEST_INDEX: CustomIndex = {
  id: "test-idx-1",
  name: "Test Index",
  description: "Description",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useIndices mutations timeout and lifecycle guards", () => {
  it("passes INDICES_REQUEST_TIMEOUT_MS to fetch options on all mutating actions", async () => {
    const fetchWithNetworkMarkSpy = vi.spyOn(apiContract, "fetchWithNetworkMark");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/indices") && (!init || init.method === "GET")) {
          return new Response(JSON.stringify([TEST_INDEX]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (init?.method === "POST" && url.endsWith("/indices")) {
          return new Response(JSON.stringify({ id: "test-idx-1", ownerToken: "token-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { result } = renderHook(() => useIndices());

    // 1. saveCustomIndex
    await act(async () => {
      const res = await result.current.saveCustomIndex(TEST_INDEX);
      expect(res.ok).toBe(true);
    });

    const saveCall = fetchWithNetworkMarkSpy.mock.calls.find(
      ([url, init]) => String(url).endsWith("/indices") && init?.method === "POST",
    );
    expect(saveCall).toBeDefined();
    expect(saveCall?.[1]?.timeoutMs).toBe(INDICES_REQUEST_TIMEOUT_MS);

    // 2. deleteCustomIndex
    await act(async () => {
      const res = await result.current.deleteCustomIndex("test-idx-1");
      expect(res.ok).toBe(true);
    });

    const deleteCall = fetchWithNetworkMarkSpy.mock.calls.find(
      ([url, init]) => String(url).includes("/indices?") && init?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]?.timeoutMs).toBe(INDICES_REQUEST_TIMEOUT_MS);

    // 3. addStockToIndex
    await act(async () => {
      const res = await result.current.addStockToIndex("test-idx-1", {
        ticker: "6758",
        name: "Sony",
        theme: "Tech",
        weight: 50,
      });
      expect(res.ok).toBe(true);
    });

    const addStockCall = fetchWithNetworkMarkSpy.mock.calls.find(
      ([url, init]) => String(url).endsWith("/indices/stock") && init?.method === "POST",
    );
    expect(addStockCall).toBeDefined();
    expect(addStockCall?.[1]?.timeoutMs).toBe(INDICES_REQUEST_TIMEOUT_MS);

    // 4. removeStockFromIndex
    await act(async () => {
      const res = await result.current.removeStockFromIndex("test-idx-1", "6758");
      expect(res.ok).toBe(true);
    });

    const removeStockCall = fetchWithNetworkMarkSpy.mock.calls.find(
      ([url, init]) => String(url).includes("/indices/stock?") && init?.method === "DELETE",
    );
    expect(removeStockCall).toBeDefined();
    expect(removeStockCall?.[1]?.timeoutMs).toBe(INDICES_REQUEST_TIMEOUT_MS);
  });

  it("safely handles unmount during in-flight saveCustomIndex without unmounted state errors", async () => {
    let resolveSave: ((res: Response) => void) | null = null;
    const savePromise = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return savePromise;
        }
        return new Response(JSON.stringify([TEST_INDEX]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { result, unmount } = renderHook(() => useIndices());

    let saveResultPromise: Promise<{ ok: boolean }> | null = null;
    act(() => {
      saveResultPromise = result.current.saveCustomIndex(TEST_INDEX);
    });

    // Unmount while save is in flight
    unmount();

    // Now complete the server save response
    await act(async () => {
      resolveSave!(
        new Response(JSON.stringify({ id: "test-idx-1", ownerToken: "echo" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const res = await saveResultPromise;
      expect(res?.ok).toBe(true);
    });
  });
});
