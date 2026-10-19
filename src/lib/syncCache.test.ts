/**
 * Regression tests for the shared browser sync cache.
 *
 * The cache used to be implemented twice (once per hook). Each implementation
 * parsed the whole entry, mutated its own subset and wrote the whole object
 * back, so whichever wrote last silently dropped the other hook's entries.
 * It also read `localStorage` without guarding against a blocked-storage
 * SecurityError, which surfaced as a misdiagnosed "server unreachable".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_CACHE_MAX_AGE_MS,
  SYNC_STORAGE_KEY,
  mergeSyncCache,
  parseLocalSyncCache,
  pruneSyncCacheMap,
  readSyncCache,
  removeFromSyncCache,
} from "./syncCache";

let store: Record<string, string> = {};

function installMockStorage(): void {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  });
}

/** Replace localStorage with a getter that throws, as blocked storage does. */
function installThrowingStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is blocked");
    },
  });
}

beforeEach(() => {
  store = {};
  installMockStorage();
  // A frozen clock keeps the timestamp assertions exact: the cache stamps its
  // own entries with `Date.now()`, which would otherwise drift by a
  // millisecond between the expectation and the write.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("parseLocalSyncCache", () => {
  it("keeps only well-formed ticker/timestamp pairs", () => {
    const parsed = parseLocalSyncCache(
      JSON.stringify({
        AAPL: 1_700_000_000_000,
        aapl: 1_600_000_000_000,
        INVALID_TEXT: "fresh",
        ZERO: 0,
        NAN: null,
        NEGATIVE: -1,
      }),
    );
    expect(parsed).toEqual({ AAPL: 1_700_000_000_000 });
  });

  it("returns an empty cache for non-object JSON values", () => {
    expect(parseLocalSyncCache("[]")).toEqual({});
    expect(parseLocalSyncCache("not-json")).toEqual({});
  });
});

describe("readSyncCache", () => {
  it("returns an empty cache instead of throwing when storage is blocked", () => {
    installThrowingStorage();
    expect(() => readSyncCache()).not.toThrow();
    expect(readSyncCache()).toEqual({});
  });

  it("returns an empty cache when the entry is corrupt", () => {
    store[SYNC_STORAGE_KEY] = "{not json";
    expect(readSyncCache()).toEqual({});
  });
});

describe("mergeSyncCache", () => {
  it("merges into the existing entry instead of replacing it", () => {
    const now = Date.now();
    mergeSyncCache([{ ticker: "7203", lastSynced: now }]);
    mergeSyncCache([{ ticker: "9984", lastSynced: now + 1 }]);

    const stored = JSON.parse(store[SYNC_STORAGE_KEY]);
    expect(stored["7203"]).toBe(now);
    expect(stored["9984"]).toBe(now + 1);
  });

  it("normalizes second-based timestamps to milliseconds", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mergeSyncCache([{ ticker: "7203.T", lastSynced: nowSec }]);
    expect(JSON.parse(store[SYNC_STORAGE_KEY])["7203.T"]).toBe(nowSec * 1000);
  });

  it("defaults to now when the timestamp is missing or invalid", () => {
    const now = Date.now();
    mergeSyncCache([{ ticker: "6758.T" }, { ticker: "8035.T", lastSynced: 0 }]);
    const stored = JSON.parse(store[SYNC_STORAGE_KEY]);
    expect(stored["6758.T"]).toBe(now);
    expect(stored["8035.T"]).toBe(now);
  });

  it("prunes entries older than the retention window", () => {
    const now = Date.now();
    store[SYNC_STORAGE_KEY] = JSON.stringify({
      "OLD.T": now - (SYNC_CACHE_MAX_AGE_MS + 1000),
      "FRESH.T": now - 1000,
    });

    mergeSyncCache(["NEW.T"]);

    const stored = JSON.parse(store[SYNC_STORAGE_KEY]);
    expect(stored["OLD.T"]).toBeUndefined();
    expect(stored["FRESH.T"]).toBe(now - 1000);
    expect(stored["NEW.T"]).toBe(now);
  });

  it("does not throw when storage is blocked", () => {
    installThrowingStorage();
    expect(() => mergeSyncCache([{ ticker: "7203" }])).not.toThrow();
  });
});

describe("removeFromSyncCache", () => {
  it("removes only the requested tickers", () => {
    mergeSyncCache([{ ticker: "7203" }, { ticker: "9984" }]);
    removeFromSyncCache(["7203"]);

    const stored = JSON.parse(store[SYNC_STORAGE_KEY]);
    expect(stored["7203"]).toBeUndefined();
    expect(stored["9984"]).toBeDefined();
  });

  it("leaves the entry untouched when nothing matches", () => {
    mergeSyncCache([{ ticker: "7203" }]);
    const before = store[SYNC_STORAGE_KEY];
    removeFromSyncCache(["NOPE"]);
    expect(store[SYNC_STORAGE_KEY]).toBe(before);
  });
});

describe("pruneSyncCacheMap", () => {
  it("drops entries that fell out of the retention window", () => {
    const now = Date.now();
    const entries = new Map<string, number>([
      ["OLD", now - (SYNC_CACHE_MAX_AGE_MS + 1)],
      ["FRESH", now - 1000],
    ]);

    pruneSyncCacheMap(entries, now);

    expect(entries.has("OLD")).toBe(false);
    expect(entries.has("FRESH")).toBe(true);
  });

  it("drops entries with a non-finite timestamp", () => {
    const entries = new Map<string, number>([["BROKEN", Number.NaN]]);
    pruneSyncCacheMap(entries, Date.now());
    expect(entries.size).toBe(0);
  });
});
