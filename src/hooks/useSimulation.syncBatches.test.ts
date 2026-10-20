import { describe, expect, it } from "vitest";
import { buildSyncBatches } from "./useSimulation";
import { SYNC_BATCH_SIZE } from "../lib/priceSync";

describe("buildSyncBatches", () => {
  it("returns a single batch of up to 12 tickers, the Worker's request limit", () => {
    // SEC-11/DATA-07: the Worker accepts at most 12 tickers per
    // /api/sync-prices request and rejects a larger batch with HTTP 400, so
    // the shared batching helper (src/lib/priceSync) must use the same cap.
    expect(SYNC_BATCH_SIZE).toBe(12);
    const tickers = Array.from({ length: 12 }, (_, i) => `T${i}`);
    expect(buildSyncBatches(tickers)).toEqual([tickers]);
  });

  it("splits more than 12 tickers so every ticker is included in a request", () => {
    // Regression: the builder previously sliced to 30 and sent one request.
    // The Worker rejects oversized requests with 400 instead of silently
    // truncating (see sync-prices guardrail test), so a 13+ ticker simulation
    // silently skipped price synchronization entirely.
    const tickers = Array.from({ length: 75 }, (_, i) => `T${i}`);
    const batches = buildSyncBatches(tickers);

    expect(batches.map((b) => b.length)).toEqual([12, 12, 12, 12, 12, 12, 3]);
    expect(batches.flat()).toEqual(tickers);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(12);
    }
  });

  it("returns no batches for an empty ticker list", () => {
    expect(buildSyncBatches([])).toEqual([]);
  });

  it("supports a custom batch size for callers with stricter limits", () => {
    const tickers = ["A", "B", "C", "D", "E"];
    expect(buildSyncBatches(tickers, 2)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
  });
});
