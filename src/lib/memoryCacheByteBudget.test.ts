/**
 * Regression tests for the in-memory cache byte budgets.
 *
 * The caches used to cap the *number* of entries only. One
 * POST /api/calculate response embeds the full price series of every
 * constituent (up to 500 × ~250 points), so an unauthenticated client that
 * varies the basket fingerprint could fill 100 entries with multi-MB payloads
 * and push the 128 MB isolate over its memory limit — the runtime then kills
 * the isolate mid-request (HTTP 500 for every user in that colo).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CALC_CACHE_BYTES,
  MAX_CALC_CACHE_SIZE,
  MAX_GENERAL_CACHE_BYTES,
  MAX_MEMORY_CACHE_ENTRY_BYTES,
  approxMemoryCacheBytes,
  clearMemoryCache,
  getMemoryCache,
  getMemoryCacheStats,
  setAllowMemoryCacheInTest,
  setMemoryCache,
} from "../../worker/internal";

/** A payload that stays just below the per-entry cap. */
function nearCapPayload(): { blob: string } {
  return { blob: "x".repeat(MAX_MEMORY_CACHE_ENTRY_BYTES - 1000) };
}

beforeEach(() => {
  clearMemoryCache();
  setAllowMemoryCacheInTest(true);
});

afterEach(() => {
  clearMemoryCache();
  setAllowMemoryCacheInTest(false);
});

describe("approxMemoryCacheBytes", () => {
  it("measures the serialized payload", () => {
    expect(approxMemoryCacheBytes({ a: "b" })).toBe(JSON.stringify({ a: "b" }).length);
  });

  it("reports Infinity for payloads that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(approxMemoryCacheBytes(circular)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("memory cache entry budget", () => {
  it("refuses to cache a payload larger than MAX_MEMORY_CACHE_ENTRY_BYTES", () => {
    const tooBig = { blob: "x".repeat(MAX_MEMORY_CACHE_ENTRY_BYTES) };

    setMemoryCache("stock:oversized", tooBig, 300);

    expect(getMemoryCache("stock:oversized")).toBeNull();
    expect(getMemoryCacheStats().entries).toBe(0);
  });

  it("keeps an unserializable payload out of the cache instead of throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => setMemoryCache("stock:circular", circular, 300)).not.toThrow();
    expect(getMemoryCache("stock:circular")).toBeNull();
  });

  it("stores and serves ordinary payloads unchanged", () => {
    setMemoryCache("stock:7203", { price: 2910.5 }, 300);

    expect(getMemoryCache("stock:7203")).toEqual({ price: 2910.5 });
    expect(getMemoryCacheStats().bytes).toBe(JSON.stringify({ price: 2910.5 }).length);
  });
});

describe("memory cache total byte budget", () => {
  it("evicts the oldest entries once the general cache exceeds its byte budget", () => {
    setMemoryCache("general:one", nearCapPayload(), 300);
    setMemoryCache("general:two", nearCapPayload(), 300);
    expect(getMemoryCache("general:one")).not.toBeNull();
    expect(getMemoryCache("general:two")).not.toBeNull();

    setMemoryCache("general:three", nearCapPayload(), 300);

    // Two near-cap entries already fill the budget, so admitting a third
    // must evict the least recently used one instead of growing past the cap.
    expect(getMemoryCache("general:one")).toBeNull();
    expect(getMemoryCache("general:two")).not.toBeNull();
    expect(getMemoryCache("general:three")).not.toBeNull();
    expect(getMemoryCacheStats().bytes).toBeLessThanOrEqual(MAX_GENERAL_CACHE_BYTES);
  });

  it("updates access order on getMemoryCache so hot entries are preserved (LRU)", () => {
    setMemoryCache("general:first", nearCapPayload(), 300);
    setMemoryCache("general:second", nearCapPayload(), 300);

    // Access the first entry so it becomes more recently used than the second
    expect(getMemoryCache("general:first")).not.toBeNull();

    // Adding a third entry should evict "general:second" (least recently used) instead of "general:first"
    setMemoryCache("general:third", nearCapPayload(), 300);

    expect(getMemoryCache("general:first")).not.toBeNull();
    expect(getMemoryCache("general:second")).toBeNull();
    expect(getMemoryCache("general:third")).not.toBeNull();
  });

  it("applies a separate byte budget to the calculation cache", () => {
    // Four near-cap entries still fit inside the calc budget; the fifth must
    // evict the oldest one instead of growing past it.
    for (let i = 0; i < 5; i++) {
      setMemoryCache(`calc:${i}`, nearCapPayload(), 300);
    }

    const stats = getMemoryCacheStats("calc:");
    expect(stats.bytes).toBeLessThanOrEqual(MAX_CALC_CACHE_BYTES);
    expect(getMemoryCache("calc:0")).toBeNull();
    expect(getMemoryCache("calc:4")).not.toBeNull();
  });

  it("still honours the entry-count cap for small payloads", () => {
    for (let i = 0; i < MAX_CALC_CACHE_SIZE + 10; i++) {
      setMemoryCache(`calc:small-${i}`, { i }, 300);
    }

    const stats = getMemoryCacheStats("calc:");
    expect(stats.entries).toBeLessThanOrEqual(MAX_CALC_CACHE_SIZE);
    expect(getMemoryCache("calc:small-0")).toBeNull();
  });

  it("frees the byte occupancy of expired entries on the next write", () => {
    setMemoryCache("general:stale", nearCapPayload(), -1);
    expect(getMemoryCacheStats().bytes).toBeGreaterThan(0);

    setMemoryCache("general:fresh", { ok: true }, 300);

    expect(getMemoryCache("general:stale")).toBeNull();
    expect(getMemoryCacheStats("general:").bytes).toBe(JSON.stringify({ ok: true }).length);
  });
});
