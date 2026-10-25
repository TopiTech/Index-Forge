import { describe, expect, it } from "vitest";
import { SYNC_BATCH_SIZE, buildSyncBatches, determineSyncForce } from "./priceSync";

describe("priceSync: determineSyncForce", () => {
  it("forces only when the caller asked and the session carries a password", () => {
    expect(determineSyncForce(true, { password: "valid-password" })).toBe(true);
  });

  it("never forces for guests — the Worker answers a forced sync with 401", () => {
    expect(determineSyncForce(true, null)).toBe(false);
    expect(determineSyncForce(true, undefined)).toBe(false);
    expect(determineSyncForce(true, {})).toBe(false);
    expect(determineSyncForce(true, { password: "" })).toBe(false);
  });

  it("does not force when the caller did not ask", () => {
    expect(determineSyncForce(false, { password: "valid-password" })).toBe(false);
    expect(determineSyncForce(false, null)).toBe(false);
  });
});

describe("priceSync: buildSyncBatches", () => {
  it("never produces a batch larger than the Worker's 12-ticker cap", () => {
    const tickers = Array.from({ length: 29 }, (_, i) => `T${i}`);
    expect(buildSyncBatches(tickers).map((batch) => batch.length)).toEqual([12, 12, 5]);
  });

  it("returns no batches for an empty ticker set", () => {
    expect(buildSyncBatches([])).toEqual([]);
  });

  it("keeps the documented batch size at the Worker's cap", () => {
    expect(SYNC_BATCH_SIZE).toBe(12);
  });
});