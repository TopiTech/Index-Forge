import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { CustomIndex } from "../data/indices";
import type { BasketItem, PricePoint, StockDetail, StockSeries } from "../types";
import { calculateStockDetails } from "../lib/analytics";
import { getAuthHeaders } from "../lib/auth";
import { isPriceCacheFresh } from "../lib/marketCache";
import { useAuth } from "./useAuth";

const API_BASE = "/api";
export const SYNC_STORAGE_KEY = "osi_stock_sync_cache";

/** Parse browser sync metadata without allowing malformed storage to mark a ticker fresh forever. */
export function parseLocalSyncCache(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const cache: Record<string, number> = {};
    for (const [ticker, timestamp] of Object.entries(parsed)) {
      const normalizedTicker = ticker.trim().toUpperCase();
      if (
        /^[A-Z0-9.-]+$/.test(normalizedTicker) &&
        normalizedTicker.length <= 20 &&
        typeof timestamp === "number" &&
        Number.isFinite(timestamp) &&
        timestamp > 0
      ) {
        cache[normalizedTicker] = Math.max(cache[normalizedTicker] || 0, timestamp);
      }
    }
    return cache;
  } catch {
    return {};
  }
}

function getLocalSyncCache(): Record<string, number> {
  try {
    return parseLocalSyncCache(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SYNC_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

export interface SyncCacheUpdateEntry {
  ticker: string;
  lastSynced?: number;
}

export function updateLocalSyncCache(
  entries: (string | SyncCacheUpdateEntry)[],
): void {
  try {
    const cache = getLocalSyncCache();
    const now = Date.now();
    for (const item of entries) {
      if (typeof item === "string") {
        const normalizedTicker = item.trim().toUpperCase();
        if (normalizedTicker) cache[normalizedTicker] = now;
      } else if (item && typeof item.ticker === "string") {
        const normalizedTicker = item.ticker.trim().toUpperCase();
        if (normalizedTicker) {
          cache[normalizedTicker] =
            typeof item.lastSynced === "number" && item.lastSynced > 0
              ? item.lastSynced
              : now;
        }
      }
    }
    // Clean entries older than 7 days
    for (const [k, v] of Object.entries(cache)) {
      if (now - v > 7 * 24 * 60 * 60 * 1000) {
        delete cache[k];
      }
    }
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

// In-memory cache for calculated index results across tab clicks (bounded to 50 entries)
const MAX_CLIENT_CALC_CACHE_SIZE = 50;
const clientCalcCache = new Map<
  string,
  { series: PricePoint[]; stockUniverse: StockSeries[]; timestamp: number }
>();

export function setClientCalcCache(
  key: string,
  entry: { series: PricePoint[]; stockUniverse: StockSeries[]; timestamp: number },
): void {
  if (clientCalcCache.size >= MAX_CLIENT_CALC_CACHE_SIZE) {
    const oldestKey = clientCalcCache.keys().next().value;
    if (oldestKey) clientCalcCache.delete(oldestKey);
  }
  clientCalcCache.set(key, entry);
}

export function getClientCalcCacheSize(): number {
  return clientCalcCache.size;
}

export function clearClientCalcCache(): void {
  clientCalcCache.clear();
}

/**
 * Determine whether a price sync request should force-refresh prices.
 * Force synchronization requires authentication; unauthenticated viewers
 * fall back to normal freshness-checked sync to prevent spurious 401 errors.
 */
export function determineSyncForce(
  force: boolean,
  session: { password?: string } | null | undefined,
): boolean {
  return force && Boolean(session?.password);
}

/**
 * The Worker includes a StockSeries entry for every requested ticker, even
 * when no usable price points were found. Treat an empty/invalid series as
 * missing so the UI can warn the user and retry it on a later calculation.
 */
export function getMissingPriceDataTickers(
  basket: readonly BasketItem[],
  stockUniverse: readonly StockSeries[],
): string[] {
  const tickersWithPriceData = new Set(
    stockUniverse
      .filter(
        (stock) =>
          Array.isArray(stock.series) &&
          stock.series.some(
            (point) =>
              typeof point?.close === "number" && Number.isFinite(point.close) && point.close > 0,
          ),
      )
      .map((stock) => stock.ticker.trim().toUpperCase()),
  );

  const seen = new Set<string>();
  return basket.flatMap((item) => {
    const normalizedTicker = item.ticker.trim().toUpperCase();
    if (
      !normalizedTicker ||
      tickersWithPriceData.has(normalizedTicker) ||
      seen.has(normalizedTicker)
    ) {
      return [];
    }
    seen.add(normalizedTicker);
    return [item.ticker];
  });
}

export function useCalculation(selectedIndex: CustomIndex | null, enabled = true) {
  const { session } = useAuth();
  const [customSeries, setCustomSeries] = useState<PricePoint[]>([]);
  const [stockUniverse, setStockUniverse] = useState<StockSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeCalculationKeyRef = useRef<string | null>(null);
  const syncedTickersRef = useRef<Map<string, number>>(new Map());

  const calculate = useCallback(
    async (force = false) => {
      if (!selectedIndex || selectedIndex.basket.length === 0) {
        activeCalculationKeyRef.current = null;
        setCustomSeries([]);
        setStockUniverse([]);
        setLastUpdatedAt(null);
        setLoading(false);
        setSyncing(false);
        setError(null);
        return;
      }

      const basketKey = JSON.stringify({
        id: selectedIndex.id,
        baseValue: selectedIndex.baseValue,
        basket: selectedIndex.basket.map(({ ticker, name, theme, weight }) => ({
          ticker,
          name,
          theme,
          weight,
        })),
      });

      // Never carry a previous index's values into a new index. A failed
      // request must leave the dashboard empty rather than showing the old
      // series under the new index label.
      if (force || activeCalculationKeyRef.current !== basketKey) {
        setCustomSeries([]);
        setStockUniverse([]);
        setLastUpdatedAt(null);
      }
      activeCalculationKeyRef.current = basketKey;

      // SWR pattern: immediately populate from client memory cache if available
      const cachedResult = clientCalcCache.get(basketKey);
      if (cachedResult && !force) {
        setCustomSeries(cachedResult.series);
        setStockUniverse(cachedResult.stockUniverse);
        setLastUpdatedAt(cachedResult.timestamp);
      }

      // Abort previous request to prevent race conditions
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      if (!cachedResult) {
        setLoading(true);
      }
      setError(null);
      setSyncing(false);
      setSyncProgress(0);
      setSyncWarnings([]);
      // A sync request may be handled by a different warm Worker isolate than
      // the subsequent calculation request. Bypass the Worker calculation cache
      // whenever this run had to contact the sync endpoint (and on an explicit
      // retry) so freshly written D1 prices cannot be hidden by a stale isolate
      // local cache.
      let bypassServerCalculationCache = force;

      try {
        // Worker と同じ市場時間ポリシーで同期済み銘柄を判定する。固定12時間の
        // ブラウザキャッシュでは、場中に開いた画面が引け後の終値を取りこぼす。
        if (selectedIndex.basket.length > 0) {
          const allTickers = selectedIndex.basket.map((b) => b.ticker);
          const localSyncCache = getLocalSyncCache();
          const nowMs = Date.now();

          const tickersToSync = force
            ? allTickers
            : allTickers.filter((t) => {
                const normalizedTicker = t.trim().toUpperCase();
                const lastSynced =
                  syncedTickersRef.current.get(normalizedTicker) ??
                  localSyncCache[normalizedTicker];
                if (
                  lastSynced &&
                  isPriceCacheFresh(Math.floor(nowMs / 1000), Math.floor(lastSynced / 1000))
                ) {
                  syncedTickersRef.current.set(normalizedTicker, lastSynced);
                  return false;
                }
                return true;
              });

          if (tickersToSync.length > 0) {
            bypassServerCalculationCache = true;
            setSyncing(true);
            const BATCH_SIZE = 30;
            const warnings: string[] = [];
            const newlySynced: SyncCacheUpdateEntry[] = [];

            for (let i = 0; i < tickersToSync.length; i += BATCH_SIZE) {
              if (controller.signal.aborted) return;

              const chunk = tickersToSync.slice(i, i + BATCH_SIZE);
              const syncForce = determineSyncForce(force, session);
              try {
                const syncRes = await fetch(`${API_BASE}/sync-prices`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...getAuthHeaders(session),
                  },
                  body: JSON.stringify({ tickers: chunk, force: syncForce }),
                  signal: controller.signal,
                });
                if (controller.signal.aborted) return;

                if (!syncRes.ok) {
                  warnings.push(`同期バッチ ${Math.floor(i / BATCH_SIZE) + 1} が失敗しました`);
                } else {
                  const syncData = await syncRes.json();
                  if (syncData.results) {
                    for (const r of syncData.results) {
                      if (r.status === "synced" || r.status === "cached") {
                        const normalizedTicker =
                          typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
                        if (normalizedTicker) {
                          const syncTimestamp =
                            typeof r.lastSynced === "number" && r.lastSynced > 0
                              ? r.lastSynced * 1000
                              : Date.now();
                          syncedTickersRef.current.set(normalizedTicker, syncTimestamp);
                          newlySynced.push({
                            ticker: normalizedTicker,
                            lastSynced: syncTimestamp,
                          });
                        }
                      }
                    }
                    const failed = syncData.results
                      .filter((r: { status: string }) => r.status === "failed")
                      .map((r: { ticker: string }) => r.ticker);
                    if (failed.length > 0) {
                      warnings.push(`一部銘柄の取得に失敗: ${failed.join(", ")}`);
                    }
                  }
                }
              } catch (err) {
                if (
                  controller.signal.aborted ||
                  (err instanceof DOMException && err.name === "AbortError")
                )
                  return;
                warnings.push(`同期バッチ ${Math.floor(i / BATCH_SIZE) + 1} で通信エラー`);
              }

              if (controller.signal.aborted) return;
              setSyncProgress(Math.round(((i + chunk.length) / tickersToSync.length) * 100));
            }

            if (newlySynced.length > 0) {
              updateLocalSyncCache(newlySynced);
            }

            if (controller.signal.aborted) return;
            setSyncing(false);
            if (warnings.length > 0) {
              setSyncWarnings(warnings);
            }
          }
        }

        if (controller.signal.aborted) return;

        const res = await fetch(`${API_BASE}/calculate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(bypassServerCalculationCache ? { "Cache-Control": "no-cache" } : {}),
            ...getAuthHeaders(session),
          },
          body: JSON.stringify({
            basket: selectedIndex.basket,
            baseValue: selectedIndex.baseValue,
          }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "指数の計算に失敗しました");
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        const calculatedSeries = Array.isArray(data.series) ? data.series : [];
        setCustomSeries(calculatedSeries);
        const universe = Array.isArray(data.stockUniverse) ? data.stockUniverse : [];
        setStockUniverse(universe);

        if (selectedIndex.basket.length > 0) {
          const missingTickers = getMissingPriceDataTickers(selectedIndex.basket, universe);
          if (missingTickers.length > 0) {
            try {
              const cache = getLocalSyncCache();
              let changed = false;
              for (const mt of missingTickers) {
                const normalizedTicker = mt.trim().toUpperCase();
                syncedTickersRef.current.delete(normalizedTicker);
                if (cache[normalizedTicker]) {
                  delete cache[normalizedTicker];
                  changed = true;
                }
              }
              if (changed) {
                localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cache));
              }
            } catch {
              // ignore
            }
            setSyncWarnings((prev) => [
              ...prev,
              `一部銘柄の価格データが取得できませんでした: ${missingTickers.join(", ")}`,
            ]);
          }
        }

        const updatedAt = Date.now();
        setLastUpdatedAt(updatedAt);
        setClientCalcCache(basketKey, {
          series: calculatedSeries,
          stockUniverse: universe,
          timestamp: updatedAt,
        });
      } catch (err: unknown) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError"))
          return;
        const message = err instanceof Error ? err.message : "計算に失敗しました";
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setSyncing(false);
        }
      }
    },
    [selectedIndex, session],
  );

  const stockDetails: StockDetail[] = useMemo(() => {
    if (!selectedIndex || selectedIndex.basket.length === 0) return [];
    return calculateStockDetails(
      selectedIndex.basket,
      stockUniverse,
      selectedIndex.baseValue,
      customSeries,
    );
  }, [selectedIndex, stockUniverse, customSeries]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setSyncing(false);
      return;
    }

    calculate();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [calculate, enabled]);

  return {
    customSeries,
    stockUniverse,
    stockDetails,
    loading,
    error,
    syncing,
    syncProgress,
    syncWarnings,
    lastUpdatedAt,
    recalculate: calculate,
  };
}
