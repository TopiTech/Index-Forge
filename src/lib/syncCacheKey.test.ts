/**
 * Regression test: the dashboard and the builder must use ONE sync cache.
 *
 * A previous bug wrote the cleanup to a stale "custom_index_sync_cache_v2"
 * key, so the missing-ticker cleanup silently failed and stale sync state
 * accumulated. The cache is now owned by `src/lib/syncCache.ts`; this test
 * asserts that the re-exported surface of `useCalculation` still points at
 * that same key, so the two hooks cannot drift apart again.
 *
 * It deliberately exercises the production module instead of a local copy of
 * the read-modify-write: a copy would only prove that the copy agrees with
 * itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SYNC_STORAGE_KEY, updateLocalSyncCache } from "../hooks/useCalculation";
import {
  SYNC_STORAGE_KEY as SHARED_SYNC_STORAGE_KEY,
  mergeSyncCache,
  readSyncCache,
  removeFromSyncCache,
} from "./syncCache";

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync cache key consistency", () => {
  it("exposes the same key from the hook surface and the shared module", () => {
    expect(SYNC_STORAGE_KEY).toBe(SHARED_SYNC_STORAGE_KEY);
    expect(SYNC_STORAGE_KEY).toBe("osi_stock_sync_cache");
  });

  it("writes to the same key the shared reader reads from", () => {
    updateLocalSyncCache(["7203", "9984"]);

    const cache = readSyncCache();
    expect(cache["7203"]).toBeDefined();
    expect(cache["9984"]).toBeDefined();
    expect(store[SYNC_STORAGE_KEY]).toBeDefined();
  });

  it("removes a ticker from the same key it was written to", () => {
    mergeSyncCache([{ ticker: "7203" }, { ticker: "9984" }, { ticker: "6758" }]);
    expect(Object.keys(readSyncCache()).length).toBe(3);

    removeFromSyncCache(["9984"]);

    const cache = readSyncCache();
    expect(cache["7203"]).toBeDefined();
    expect(cache["9984"]).toBeUndefined();
    expect(cache["6758"]).toBeDefined();
  });

  it("does not leave stale data in legacy keys", () => {
    updateLocalSyncCache(["7203"]);

    expect(store["custom_index_sync_cache_v2"]).toBeUndefined();
    expect(store[SYNC_STORAGE_KEY]).toBeDefined();
  });
});
