/**
 * `/api/sync-prices` performs up to 12 upstream price fetches per batch. It had
 * no client deadline at all, so a stalled batch left the caller in `syncing`
 * forever and the subsequent calculation never ran. The batch is now bounded;
 * a timeout is a warning and the caller continues with stored prices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_REQUEST_TIMEOUT_MS,
  SYNC_TIMEOUT_WARNING,
  syncPricesInBatches,
} from "./priceSync";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncPricesInBatches deadline", () => {
  it("stops a stalled batch at the deadline and reports a timeout warning", async () => {
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

    const request = syncPricesInBatches({
      tickers: ["7203", "6758"],
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);
    const result = await request;

    expect(result.aborted).toBe(false);
    expect(result.warnings).toContain(SYNC_TIMEOUT_WARNING);
    expect(result.synced).toEqual([]);
  });
});
