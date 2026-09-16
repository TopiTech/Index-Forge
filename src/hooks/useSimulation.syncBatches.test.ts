import { describe, expect, it } from "vitest";
import { buildSyncBatches } from "./useSimulation";

describe("buildSyncBatches", () => {
  it("returns a single batch of up to 30 tickers, the Worker's request limit", () => {
    const tickers = Array.from({ length: 30 }, (_, i) => `T${i}`);
    expect(buildSyncBatches(tickers)).toEqual([tickers]);
  });

  it("splits more than 30 tickers so every ticker is included in a request", () => {
    // Regression: the builder previously sliced to 30 and sent one request.
    // The Worker rejects oversized requests with 400 instead of silently
    // truncating (see sync-prices guardrail test), so a 31+ ticker simulation
    // silently skipped price synchronization entirely.
    const tickers = Array.from({ length: 75 }, (_, i) => `T${i}`);
    const batches = buildSyncBatches(tickers);

    expect(batches.map((b) => b.length)).toEqual([30, 30, 15]);
    expect(batches.flat()).toEqual(tickers);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(30);
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
