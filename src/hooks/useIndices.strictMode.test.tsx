// @vitest-environment jsdom
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useIndices } from "./useIndices";
import type { CustomIndex } from "../data/indices";

const SERVER_INDEX: CustomIndex = {
  id: "idx-strict-mode",
  name: "Server Index",
  description: "",
  baseValue: 1000,
  basket: [{ ticker: "7203", name: "Toyota", theme: "Auto", weight: 100 }],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useIndices under StrictMode", () => {
  it("re-issues the initial request after the remount and clears the skeleton", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      // The StrictMode cleanup aborts the first request before it settles.
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(JSON.stringify([SERVER_INDEX]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useIndices(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.indices).toEqual([SERVER_INDEX]);
  });
});
