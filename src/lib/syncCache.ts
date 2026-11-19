/**
 * Single owner of the shared browser sync cache (`osi_stock_sync_cache`).
 *
 * Two hooks (the dashboard calculation and the builder preview) both need to
 * know which tickers were synced recently. They used to each parse the whole
 * entry, mutate their own subset and write the whole object back. Whichever
 * wrote last silently dropped the other hook's entries, so the "already
 * synced" decision diverged between the two screens and extra
 * `/api/sync-prices` traffic was generated.
 *
 * This module is the only place that reads or writes the entry. Every access
 * is exception-safe: `typeof localStorage` itself evaluates the
 * `window.localStorage` getter, which throws `SecurityError` when storage is
 * blocked (sandboxed iframe, blocked third-party cookies). An unguarded read
 * turned that into a misdiagnosed "server unreachable" error and demo data.
 */

import { isValidTicker } from "./apiContract";
import { MAX_CACHE_CLOCK_SKEW_SECONDS } from "./marketCache";

/** localStorage key holding the per-ticker "last synced" timestamps. */
export const SYNC_STORAGE_KEY = "osi_stock_sync_cache";

/** Entries older than this are dropped so the cache cannot grow forever. */
export const SYNC_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A timestamp further ahead than this cannot be explained by clock skew. It
 * would otherwise keep a ticker "fresh" forever because retention only looks
 * at `now - timestamp`, which is negative for future values.
 */
export const SYNC_CACHE_MAX_CLOCK_SKEW_MS = MAX_CACHE_CLOCK_SKEW_SECONDS * 1000;

/**
 * Normalize a ticker for the shared cache, or return null when it cannot be a
 * ticker.
 *
 * The read path already rejected malformed keys, but the write path accepted
 * any non-empty string. A caller bug (or a hand-edited value) therefore wrote
 * entries that every later read ignored, wasting localStorage quota and making
 * the cache disagree with itself. Both paths use this one rule so a key that
 * can be written can always be read back.
 */
function normalizeSyncCacheTicker(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return isValidTicker(normalized) ? normalized : null;
}

export interface SyncCacheUpdateEntry {
  ticker: string;
  lastSynced?: number;
}

/**
 * Parse browser sync metadata without allowing malformed storage to mark a
 * ticker fresh forever.
 */
export function parseLocalSyncCache(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const cache: Record<string, number> = {};
    const now = Date.now();
    for (const [ticker, timestamp] of Object.entries(parsed)) {
      const normalizedTicker = normalizeSyncCacheTicker(ticker);
      if (
        normalizedTicker !== null &&
        typeof timestamp === "number" &&
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        const msTimestamp = timestamp < 1e11 ? Math.round(timestamp * 1000) : Math.round(timestamp);
        if (msTimestamp > now + SYNC_CACHE_MAX_CLOCK_SKEW_MS) continue;
        cache[normalizedTicker] = Math.max(cache[normalizedTicker] || 0, msTimestamp);
      }
    }
    return cache;
  } catch {
    return {};
  }
}

/**
 * Read the shared sync cache.
 *
 * Returns an empty cache when storage is unavailable or unreadable instead of
 * throwing: a blocked storage must not be reported as a network failure.
 */
export function readSyncCache(): Record<string, number> {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return {};
    return parseLocalSyncCache(storage.getItem(SYNC_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Normalize a possibly second-based timestamp to milliseconds. */
function toMilliseconds(timestamp: number): number {
  return timestamp < 1e11 ? Math.round(timestamp * 1000) : Math.round(timestamp);
}

/**
 * Merge entries into the shared sync cache and persist the result.
 *
 * The read-modify-write happens in one place so two hooks can no longer
 * overwrite each other's entries, and the retention rule is applied on every
 * write so the entry cannot grow without bound.
 */
export function mergeSyncCache(entries: (string | SyncCacheUpdateEntry)[]): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return;

    const cache = readSyncCache();
    const now = Date.now();
    for (const item of entries) {
      if (typeof item === "string") {
        const normalizedTicker = normalizeSyncCacheTicker(item);
        if (normalizedTicker !== null) cache[normalizedTicker] = now;
      } else if (item && typeof item.ticker === "string") {
        const normalizedTicker = normalizeSyncCacheTicker(item.ticker);
        if (normalizedTicker !== null) {
          const provided =
            typeof item.lastSynced === "number" &&
            Number.isFinite(item.lastSynced) &&
            item.lastSynced > 0
              ? toMilliseconds(item.lastSynced)
              : now;
          cache[normalizedTicker] =
            provided > now + SYNC_CACHE_MAX_CLOCK_SKEW_MS ? now : provided;
        }
      }
    }

    for (const [ticker, timestamp] of Object.entries(cache)) {
      if (now - timestamp > SYNC_CACHE_MAX_AGE_MS) {
        delete cache[ticker];
      }
    }

    storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage can be unavailable or full; the sync itself still succeeded.
  }
}

/**
 * Drop entries older than the retention window from an in-memory mirror of the
 * sync cache.
 *
 * The mirror takes precedence over the persisted copy when deciding whether a
 * ticker is fresh, so an unpruned mirror keeps a ticker "fresh" indefinitely
 * and grows without bound for the lifetime of the hook.
 */
export function pruneSyncCacheMap(
  entries: Map<string, number>,
  nowMs: number = Date.now(),
): void {
  for (const [ticker, timestamp] of entries) {
    if (
      !Number.isFinite(timestamp) ||
      nowMs - timestamp > SYNC_CACHE_MAX_AGE_MS ||
      timestamp > nowMs + SYNC_CACHE_MAX_CLOCK_SKEW_MS
    ) {
      entries.delete(ticker);
    }
  }
}

/**
 * Remove tickers from the shared sync cache (used when the server returned no
 * usable price rows for them, so they must be re-synced).
 */
export function removeFromSyncCache(tickers: readonly string[]): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return;

    const cache = readSyncCache();
    let changed = false;
    for (const ticker of tickers) {
      const normalizedTicker = normalizeSyncCacheTicker(ticker);
      if (normalizedTicker !== null && cache[normalizedTicker] !== undefined) {
        delete cache[normalizedTicker];
        changed = true;
      }
    }
    if (!changed) return;

    storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}
