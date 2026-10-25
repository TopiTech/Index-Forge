import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { CustomIndex } from "../data/indices";
import type { BasketItem, PricePoint, StockDetail, StockSeries } from "../types";
import { calculateStockDetails } from "../lib/analytics";
import { readJsonBody } from "../lib/apiContract";
import { sanitizeBasketForRequest } from "../lib/indexEngine";
import { getAuthHeaders } from "../lib/auth";
import { isPriceCacheFresh } from "../lib/marketCache";
// The "sync prices → calculate" contract (batch size, auth headers, warning
// texts, abort policy) is owned by src/lib/priceSync so the dashboard and the
// builder preview cannot drift apart again.
import { determineSyncForce, syncPricesInBatches } from "../lib/priceSync";
// The shared sync cache lives in src/lib/syncCache so the dashboard and the
// builder cannot overwrite each other's entries. The re-exports keep the
// historical import surface (`../hooks/useCalculation`) working for existing
// callers and tests.
import {
  SYNC_STORAGE_KEY,
  mergeSyncCache,
  parseLocalSyncCache,
  pruneSyncCacheMap,
  readSyncCache,
  removeFromSyncCache,
  type SyncCacheUpdateEntry,
} from "../lib/syncCache";
import { useAuth } from "./useAuth";

const API_BASE = "/api";

// The force-sync policy moved to src/lib/priceSync (the single owner of the
// sync contract); the re-export keeps the historical import surface working
// for existing callers and tests.
export { SYNC_STORAGE_KEY, determineSyncForce, parseLocalSyncCache, type SyncCacheUpdateEntry };

/**
 * Merge freshly synced tickers into the shared browser sync cache.
 *
 * Kept as a named export because callers outside this hook rely on it.
 */
export function updateLocalSyncCache(entries: (string | SyncCacheUpdateEntry)[]): void {
  mergeSyncCache(entries);
}

// In-memory cache for calculated index results across tab clicks (bounded to 50 entries)
const MAX_CLIENT_CALC_CACHE_SIZE = 50;

/** One cached calculation result. */
export interface ClientCalcCacheEntry {
  series: PricePoint[];
  stockUniverse: StockSeries[];
  timestamp: number;
}

const clientCalcCache = new Map<string, ClientCalcCacheEntry>();

export function setClientCalcCache(key: string, entry: ClientCalcCacheEntry): void {
  // Delete first: overwriting an existing key must not evict an unrelated
  // entry. The freed slot is reused by the new value, so the cache keeps its
  // 50-entry bound without dropping a still-useful calculation.
  clientCalcCache.delete(key);
  if (clientCalcCache.size >= MAX_CLIENT_CALC_CACHE_SIZE) {
    const oldestKey = clientCalcCache.keys().next().value;
    if (oldestKey) clientCalcCache.delete(oldestKey);
  }
  clientCalcCache.set(key, entry);
}

/**
 * Read a cached calculation and mark it as the most recently used entry.
 *
 * The cache is a true LRU: a hit moves the entry to the end of the insertion
 * order, so the entry evicted first is the one that has not been used for the
 * longest time. Without the refresh the cache behaved like a FIFO and threw
 * away the index the user keeps coming back to.
 */
export function getClientCalcCache(key: string): ClientCalcCacheEntry | undefined {
  const entry = clientCalcCache.get(key);
  if (!entry) return undefined;
  clientCalcCache.delete(key);
  clientCalcCache.set(key, entry);
  return entry;
}

export function getClientCalcCacheSize(): number {
  return clientCalcCache.size;
}

export function clearClientCalcCache(): void {
  clientCalcCache.clear();
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
      // (a hit refreshes the LRU order, so the entry survives longer)
      const cachedResult = getClientCalcCache(basketKey);
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

      // POST /api/calculate は1件の不正エントリで全体を400にする。レガシー行の
      // weight NULL(GET /api/indices が 0 と返す)や全角ティッカーが混ざると
      // ダッシュボードがエラーのまま永久に空になるため、送信前に修復する。
      const sanitizedBasket = sanitizeBasketForRequest(selectedIndex.basket);
      const requestBasket = sanitizedBasket.basket;
      if (requestBasket.length === 0) {
        setCustomSeries([]);
        setStockUniverse([]);
        setLastUpdatedAt(null);
        setError("構成銘柄に有効なティッカーが含まれていないため計算できません。銘柄を編集してください。");
        setLoading(false);
        setSyncing(false);
        return;
      }
      if (sanitizedBasket.dropped.length > 0) {
        setSyncWarnings((prev) =>
          Array.from(
            new Set([
              ...prev,
              `無効な構成銘柄を除外しました: ${sanitizedBasket.dropped.join(", ")}`,
            ]),
          ),
        );
      }
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
          const allTickers = requestBasket.map((b) => b.ticker);
          const localSyncCache = readSyncCache();
          const nowMs = Date.now();
          pruneSyncCacheMap(syncedTickersRef.current, nowMs);

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
            const syncForce = determineSyncForce(force, session);
            // The Worker caps one sync request at 12 tickers and rejects a
            // larger batch with 400, so the batching, the auth headers, the
            // warning texts and the abort policy all live in
            // src/lib/priceSync (shared with the builder preview).
            const { synced, warnings } = await syncPricesInBatches({
              tickers: tickersToSync,
              signal: controller.signal,
              force: syncForce,
              // Guests send no auth header at all.
              authHeaders: getAuthHeaders(session),
              isSuperseded: () => activeCalculationKeyRef.current !== basketKey,
              onProgress: (completed, total) => {
                setSyncProgress(Math.round((completed / total) * 100));
              },
            });
            // An aborted sync (unmount, a newer index or a superseded
            // request) must not publish any state.
            if (controller.signal.aborted || activeCalculationKeyRef.current !== basketKey) {
              return;
            }

            if (synced.length > 0) {
              for (const entry of synced) {
                syncedTickersRef.current.set(entry.ticker, entry.lastSynced);
              }
              updateLocalSyncCache(synced);
            }

            setSyncing(false);
            if (warnings.length > 0) {
              // 機能的更新に変更: 直前に追加した「除外した銘柄」の警告を
              // 上書きせず、同期警告と合わせて提示するため（重複排除を実施）。
              setSyncWarnings((prev) => Array.from(new Set([...prev, ...warnings])));
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
            basket: requestBasket,
            baseValue: selectedIndex.baseValue,
          }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "指数の計算に失敗しました");
        }
        // HTTP 200 でも JSON でない本文(プロキシのHTMLエラー画面等)は、
        // 生の SyntaxError として利用者に見えていたため、契約モジュールの
        // ヘルパーで一括して「応答なし」に落とす。
        const data = await readJsonBody<{ series?: unknown; stockUniverse?: unknown }>(res);
        if (controller.signal.aborted) return;
        if (!data) {
          throw new Error("サーバーから無効な応答が返されました");
        }
        const calculatedSeries = Array.isArray(data.series) ? data.series : [];
        setCustomSeries(calculatedSeries);
        const universe = Array.isArray(data.stockUniverse) ? data.stockUniverse : [];
        setStockUniverse(universe);

        if (requestBasket.length > 0) {
          const missingTickers = getMissingPriceDataTickers(requestBasket, universe);
          if (missingTickers.length > 0) {
            for (const mt of missingTickers) {
              syncedTickersRef.current.delete(mt.trim().toUpperCase());
            }
            removeFromSyncCache(missingTickers);
            setSyncWarnings((prev) =>
              Array.from(
                new Set([
                  ...prev,
                  `一部銘柄の価格データが取得できませんでした: ${missingTickers.join(", ")}`,
                ]),
              ),
            );
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
