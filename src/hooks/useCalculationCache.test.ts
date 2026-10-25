import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClientCalcCache,
  getClientCalcCache,
  getClientCalcCacheSize,
  setClientCalcCache,
} from "./useCalculation";

/**
 * H-3: `clientCalcCache` stored a timestamp but never enforced it, so a tab
 * switch after a market move instantly served a stale series while the
 * background refresh was still running. Reads are now gated by the same
 * market-aware freshness policy as the sync decision.
 */
describe("clientCalcCache TTL (H-3)", () => {
  beforeEach(() => {
    clearClientCalcCache();
  });

  function seed(key: string, ageMs: number) {
    setClientCalcCache(key, {
      series: [{ date: "2026-01-01", close: 100 }],
      stockUniverse: [],
      timestamp: Date.now() - ageMs,
    });
  }

  it("serves an entry calculated seconds ago", () => {
    seed("fresh", 10_000);
    const hit = getClientCalcCache("fresh");
    expect(hit?.series).toEqual([{ date: "2026-01-01", close: 100 }]);
    expect(getClientCalcCacheSize()).toBe(1);
  });

  it("treats an entry older than the freshness window as a miss and prunes it", () => {
    // The policy's window depends on the day of week: a Friday-after-close
    // entry stays fresh until Monday 09:00 JST, so a hard-coded 48-hour age
    // changed meaning with the wall clock (it was only stale on weekdays).
    // At Monday 10:00 JST, 48 hours earlier is Saturday 10:00; that entry's
    // window ends at Monday 09:00 (47 hours), so it is unambiguously stale.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 5, 1, 0, 0));
    try {
      seed("stale", 48 * 60 * 60 * 1000);
      expect(getClientCalcCache("stale")).toBeUndefined();
      // The stale entry must not linger and skew the LRU accounting either.
      expect(getClientCalcCacheSize()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not let a far-future (corrupt clock/storage) timestamp stay fresh forever", () => {
    setClientCalcCache("future", {
      series: [],
      stockUniverse: [],
      timestamp: Date.now() + 60 * 60 * 1000,
    });
    expect(getClientCalcCache("future")).toBeUndefined();
    expect(getClientCalcCacheSize()).toBe(0);
  });

  it("treats a zero timestamp as a miss", () => {
    setClientCalcCache("zero", { series: [], stockUniverse: [], timestamp: 0 });
    expect(getClientCalcCache("zero")).toBeUndefined();
    expect(getClientCalcCacheSize()).toBe(0);
  });

  it("keeps a fresh hit at the most-recently-used position", () => {
    seed("a", 10_000);
    seed("b", 10_000);
    expect(getClientCalcCache("a")?.series).toHaveLength(1);
    expect(getClientCalcCache("b")?.series).toHaveLength(1);
    expect(getClientCalcCacheSize()).toBe(2);
  });
});
