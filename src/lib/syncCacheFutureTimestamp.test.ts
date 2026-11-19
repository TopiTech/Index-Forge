import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mergeSyncCache,
  parseLocalSyncCache,
  pruneSyncCacheMap,
  SYNC_STORAGE_KEY,
} from "./syncCache";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sync cache clock-skew safety", () => {
  it("rejects a far-future timestamp from persisted storage", () => {
    const future = Date.now() + DAY_MS;
    expect(parseLocalSyncCache(JSON.stringify({ AAPL: future }))).toEqual({});
  });

  it("still accepts a small, real-world clock skew", () => {
    const slightlyAhead = Date.now() + 60_000;
    expect(parseLocalSyncCache(JSON.stringify({ AAPL: slightlyAhead }))).toEqual({
      AAPL: slightlyAhead,
    });
  });

  it("does not persist a far-future timestamp passed by a caller", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });

    const now = Date.now();
    mergeSyncCache([{ ticker: "AAPL", lastSynced: now + DAY_MS }]);

    const parsed = parseLocalSyncCache(store.get(SYNC_STORAGE_KEY) ?? null);
    expect(parsed.AAPL).toBeLessThanOrEqual(now + 5 * 60 * 1000);
  });

  it("prunes a far-future entry from the in-memory mirror", () => {
    const now = Date.now();
    const mirror = new Map<string, number>([["AAPL", now + DAY_MS]]);
    pruneSyncCacheMap(mirror, now);
    expect(mirror.size).toBe(0);
  });
});
