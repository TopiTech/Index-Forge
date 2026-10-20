import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  BasketItem,
  PricePoint,
  StockSeries,
  BenchmarkSymbol,
  RiskMetrics,
  Timeframe,
} from "../types";
import {
  calculateCustomIndex,
  normalizeWeights,
  normalizeTicker,
  sanitizeBasketForRequest,
} from "../lib/indexEngine";
import { calculateRiskMetrics } from "../lib/analytics";
import { filterByTimeframe } from "../lib/timeframe";
import { isPriceCacheFresh } from "../lib/marketCache";
import { mergeSyncCache, readSyncCache, removeFromSyncCache } from "../lib/syncCache";
import { getAuthHeaders } from "../lib/auth";
// The "sync prices → calculate" contract (batch size, auth headers, warning
// texts, abort policy) is owned by src/lib/priceSync so the builder preview
// and the dashboard cannot drift apart again.
import { syncPricesInBatches } from "../lib/priceSync";
import { useBenchmark, isBenchmarkDataForSymbol } from "./useBenchmark";
import { getMissingPriceDataTickers } from "./useCalculation";

export interface ConstituentPerformance {
  ticker: string;
  name: string;
  theme: string;
  weight: number;
  startPrice: number;
  latestPrice: number;
  periodReturnPct: number;
  contributionPct: number;
}

export interface SimulationResult {
  customSeries: PricePoint[];
  filteredCustomSeries: PricePoint[];
  filteredBenchmarkSeries: PricePoint[];
  stockUniverse: StockSeries[];
  metrics: RiskMetrics;
  periodCustomReturnPct: number;
  periodBenchmarkReturnPct: number;
  alphaPct: number;
  constituentsPerformance: ConstituentPerformance[];
  loading: boolean;
  benchmarkLoading: boolean;
  error: string | null;
  /** Non-fatal problems encountered while preparing the data (e.g. sync failures). */
  syncWarnings: string[];
  /** True when the preview shows generated demo prices instead of API data. */
  usingDemoData: boolean;
  /** True when the benchmark comparison line/alpha is based on generated demo data. */
  usingDemoBenchmark: boolean;
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  selectedBenchmark: BenchmarkSymbol;
  setSelectedBenchmark: (bm: BenchmarkSymbol) => void;
  runSimulation: (force?: boolean) => Promise<void>;
}

const API_BASE = "/api";
// The browser sync cache is owned by src/lib/syncCache so the dashboard and
// the builder share one read-modify-write implementation instead of two that
// overwrite each other's entries.

/**
 * Split tickers into sync batches no larger than the Worker's request limit.
 *
 * The batching itself is implemented by src/lib/priceSync (the single owner
 * of the sync contract); it is re-exported here because existing callers
 * import it from this hook.
 */
export { buildSyncBatches } from "../lib/priceSync";

/**
 * What the simulation effect must do when the basket or its ticker set changes.
 *
 * - "clear": the basket is empty.
 * - "recompute": data was already fetched for this exact ticker set, so the
 *   index can be recomputed in client memory (weights changed, or the server
 *   has no price rows for one of the tickers — re-fetching cannot add data).
 * - "idle": already fetched for this ticker set but no series are available;
 *   fetching again would loop without ever satisfying the completeness check.
 * - "fetch": the ticker set changed; fetch the missing data (debounced).
 */
export type SimulationEffectAction = "clear" | "recompute" | "idle" | "fetch";

export function decideSimulationEffectAction(
  basketLength: number,
  knownTickersKey: string,
  currentTickersKey: string,
  stockUniverseSize: number,
): SimulationEffectAction {
  if (basketLength === 0) return "clear";
  if (knownTickersKey !== currentTickersKey) return "fetch";
  return stockUniverseSize > 0 ? "recompute" : "idle";
}

/**
 * Identity-preserving clear.
 *
 * React only skips a re-render when a state updater returns the previous
 * reference. The simulation effect depends on `stockUniverse`, so writing a
 * fresh `[]` on every run made each run schedule another one: clearing an
 * already-empty basket produced an unbounded "Maximum update depth exceeded"
 * loop. Returning the previous reference keeps the transition idempotent, so
 * the effect can never re-arm itself.
 */
export function clearIfEmpty<T>(previous: T[]): T[] {
  return previous.length === 0 ? previous : [];
}

/**
 * True when two price series are equivalent.
 *
 * The effect recomputes the series locally whenever the basket changes, and
 * it depends on the basket array. A parent that recreates an equal basket
 * array on every render would therefore re-run the effect on every render;
 * writing the freshly computed array each time would turn that into an
 * unbounded render loop. Returning the previous reference when the recomputed
 * series is unchanged keeps the write idempotent.
 */
export function sameSeries(a: PricePoint[], b: PricePoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].date !== b[i].date ||
      a[i].close !== b[i].close ||
      a[i].value !== b[i].value ||
      a[i].volume !== b[i].volume
    ) {
      return false;
    }
  }
  return true;
}

export function useSimulation(
  basket: BasketItem[],
  baseValue: number = 1000,
  initialBenchmark: BenchmarkSymbol = "^N225",
  initialTimeframe: Timeframe = "1M",
): SimulationResult {
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkSymbol>(initialBenchmark);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [stockUniverse, setStockUniverse] = useState<StockSeries[]>([]);
  const [customSeries, setCustomSeries] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True when the displayed series comes from generated demo prices, not the API. */
  const [usingDemoData, setUsingDemoData] = useState(false);
  /** Non-fatal problems (e.g. a price-sync batch that failed). */
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);

  const { benchmarkData, loading: benchmarkLoading } = useBenchmark(selectedBenchmark);

  const abortRef = useRef<AbortController | null>(null);
  const knownTickersRef = useRef<string>("");
  /**
   * Monotonic id of the newest simulation request.
   *
   * The AbortController alone is not enough: the effect's branches can decide
   * that a request is obsolete *before* the replacement request starts (the
   * replacement is debounced), so the obsolete response could still land in
   * that window and overwrite the current basket's data. Every request
   * captures the id it was started with and refuses to publish state when a
   * newer request has superseded it.
   */
  const requestIdRef = useRef(0);

  /** Cancel the in-flight request and invalidate any response still in flight. */
  const abortInFlight = useCallback(() => {
    requestIdRef.current += 1;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // Check if all tickers in current basket are already present in stockUniverse
  const currentTickersKey = useMemo(() => {
    return basket
      .map((b) => normalizeTicker(b.ticker))
      .sort()
      .join(",");
  }, [basket]);

  const hasAllStockData = useMemo(() => {
    if (basket.length === 0) return false;
    if (stockUniverse.length === 0) return false;
    const universeTickers = new Set(
      stockUniverse
        .filter((s) => Array.isArray(s.series) && s.series.length > 0)
        .map((s) => normalizeTicker(s.ticker)),
    );
    return basket.every((b) => universeTickers.has(normalizeTicker(b.ticker)));
  }, [basket, stockUniverse]);

  // Run simulation / fetch stock data
  const runSimulation = useCallback(
    async (force = false) => {
      if (basket.length === 0) {
        abortInFlight();
        setCustomSeries((prev) => clearIfEmpty(prev));
        setStockUniverse((prev) => clearIfEmpty(prev));
        setError(null);
        setUsingDemoData(false);
        setSyncWarnings((prev) => clearIfEmpty(prev));
        setLoading(false);
        return;
      }

      // If we already have stockUniverse for all basket items and not forcing,
      // compute customSeries purely in client memory (0ms latency)!
      if (!force && hasAllStockData && stockUniverse.length > 0) {
        // Any request still in flight was started for a superseded basket, so
        // it must not be allowed to publish its (different) universe later.
        abortInFlight();
        const computed = calculateCustomIndex(basket, stockUniverse, baseValue);
        setCustomSeries((prev) => (sameSeries(prev, computed) ? prev : computed));
        // The data was computed locally from the cached universe, so a warning
        // about an earlier failed sync no longer describes what is displayed.
        setSyncWarnings((prev) => clearIfEmpty(prev));
        // The fetched data already covers this ticker set; record it so the
        // effect recomputes in memory instead of re-arming a fetch.
        knownTickersRef.current = currentTickersKey;
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      /** True when a newer request has superseded this one. */
      const isSuperseded = () => requestId !== requestIdRef.current;

      setLoading(true);
      setError(null);
      setUsingDemoData(false);
      setSyncWarnings((prev) => clearIfEmpty(prev));

      // POST /api/calculate は1件の不正エントリで全体を400にする。レガシー行の
      // weight 0 や全角ティッカーをそのまま送ると、原因表示もなくデモデータへ
      // フォールバックし続けるため、送信前に Worker 契約へ揃える。
      const sanitizedBasket = sanitizeBasketForRequest(basket);
      const requestBasket = sanitizedBasket.basket;
      if (requestBasket.length === 0) {
        setCustomSeries((prev) => clearIfEmpty(prev));
        setStockUniverse((prev) => clearIfEmpty(prev));
        setError("構成銘柄に有効なティッカーが含まれていないため計算できません。銘柄を編集してください。");
        setUsingDemoData(false);
        setLoading(false);
        return;
      }

      try {
        const allTickers = requestBasket.map((b) => normalizeTicker(b.ticker));
        // Blocked storage must not be reported as a network failure, so the
        // cache is read through the exception-safe shared helper.
        const localSyncCache = readSyncCache();
        const nowSec = Math.floor(Date.now() / 1000);

        const tickersToSync = force
          ? allTickers
          : allTickers.filter((t) => {
              const lastSynced = localSyncCache[t];
              if (lastSynced && isPriceCacheFresh(nowSec, Math.floor(lastSynced / 1000))) {
                return false;
              }
              return true;
            });

        // 1. Sync stale prices before calculating (only for missing/stale tickers).
        // The Worker refreshes its D1 price cache; the calculation below then
        // reads the refreshed rows.
        if (tickersToSync.length > 0) {
          // The Worker caps one sync request at 12 tickers and rejects a
          // larger batch with 400, so the batching, the auth headers, the
          // warning texts and the abort policy all live in
          // src/lib/priceSync (shared with the dashboard).
          const { synced, warnings } = await syncPricesInBatches({
            tickers: tickersToSync,
            signal: controller.signal,
            force: Boolean(force),
            // Guests send no auth header at all.
            authHeaders: getAuthHeaders(),
            isSuperseded,
          });
          // An aborted sync (unmount or a superseded basket) must not publish
          // any state.
          if (controller.signal.aborted || isSuperseded()) return;

          if (synced.length > 0) {
            // The freshness lookup is keyed by the normalized ticker, so the
            // shared cache must be written with the same normalization.
            mergeSyncCache(
              synced.map((entry) => ({
                ticker: normalizeTicker(entry.ticker),
                lastSynced: entry.lastSynced,
              })),
            );
          }
          if (warnings.length > 0) {
            setSyncWarnings(Array.from(new Set(warnings)));
          }
        }

        if (controller.signal.aborted || isSuperseded()) return;

        const bypassServerCalculationCache = Boolean(force || tickersToSync.length > 0);

        // 2. Fetch calculated index and stockUniverse from /api/calculate
        const calcRes = await fetch(`${API_BASE}/calculate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(bypassServerCalculationCache ? { "Cache-Control": "no-cache" } : {}),
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            basket: requestBasket.map(({ ticker, name, theme, weight }) => ({
              ticker,
              name,
              theme,
              weight,
            })),
            baseValue,
          }),
          signal: controller.signal,
        });

        let universe: StockSeries[] = [];
        let series: PricePoint[] = [];
        let serverErrorMessage: string | null = null;

        if (calcRes.ok) {
          const data = await calcRes.json();
          // The response body is read asynchronously: a superseded request must
          // not publish its universe/series for a basket that no longer exists.
          if (controller.signal.aborted || isSuperseded()) return;
          universe = Array.isArray(data.stockUniverse) ? data.stockUniverse : [];
          series = Array.isArray(data.series) ? data.series : [];

          if (requestBasket.length > 0 && universe.length > 0) {
            const missingTickers = getMissingPriceDataTickers(requestBasket, universe);
            if (missingTickers.length > 0) {
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
        } else {
          // 非2xx応答でもプレビューは動かしつつ、理由を捨てない。バリデーション
          // エラー(400)やレート制限(429)を黙ってデモ表示に置き換えていたため、
          // 利用者は「なぜ数値が違うのか」を知らされなかった。
          const errBody = (await calcRes.json().catch(() => ({}))) as Record<string, unknown>;
          if (controller.signal.aborted || isSuperseded()) return;
          serverErrorMessage =
            typeof errBody.error === "string" && errBody.error.trim()
              ? errBody.error.trim()
              : `指数の計算に失敗しました (HTTP ${calcRes.status})`;
        }

        // If server failed or returned empty universe, use robust client fallback calculation
        const isFallback = universe.length === 0 || series.length === 0;
        if (isFallback) {
          universe = generateFallbackStockUniverse(requestBasket);
          series = calculateCustomIndex(requestBasket, universe, baseValue);
        }

        if (controller.signal.aborted || isSuperseded()) return;
        setStockUniverse(universe);
        setCustomSeries(series);
        knownTickersRef.current = currentTickersKey;
        // サーバーが明示的なエラーを返した場合のみ理由を提示する(データ欠如による
        // 静かなフォールバックは従来どおりバッジのみ)。
        setError(
          isFallback && serverErrorMessage
            ? `${serverErrorMessage} — デモデータで表示しているため数値は参考値です`
            : null,
        );
        // The simulated preview must never present generated demo prices as if
        // they were real market data: surface an explicit warning whenever the
        // displayed series did not come from the calculation API.
        setUsingDemoData(isFallback);
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          isSuperseded() ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          // A superseded request must not publish demo data for a basket that
          // no longer exists.
          return;
        }
        // Even on fetch error, generate client-side simulation so guest users always see results
        const fallbackUniverse = generateFallbackStockUniverse(requestBasket);
        const fallbackSeries = calculateCustomIndex(requestBasket, fallbackUniverse, baseValue);
        setStockUniverse(fallbackUniverse);
        setCustomSeries(fallbackSeries);
        knownTickersRef.current = currentTickersKey;
        // A network/API failure silently swapped in pseudo-random demo prices
        // before; keep the preview usable but flag it as demo data instead of
        // hiding the failure behind setError(null).
        setError("サーバーに接続できないため、デモデータで表示しています。数値は参考値です");
        setUsingDemoData(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [basket, baseValue, currentTickersKey, hasAllStockData, stockUniverse, abortInFlight],
  );

  // When basket tickers change or initial mount, trigger simulation fetch
  useEffect(() => {
    const action = decideSimulationEffectAction(
      basket.length,
      knownTickersRef.current,
      currentTickersKey,
      stockUniverse.length,
    );

    if (action === "clear") {
      // Forget the fetched ticker set: re-adding the same tickers must fetch
      // again instead of assuming the cleared universe still covers them.
      knownTickersRef.current = "";
      // A request for the previous basket must not resurrect the cleared
      // state when its response arrives.
      abortInFlight();
      // The writes are identity-preserving: this effect depends on
      // `stockUniverse` and on the basket array, so writing fresh arrays on
      // every run would make the effect re-arm itself forever.
      setCustomSeries((prev) => clearIfEmpty(prev));
      setStockUniverse((prev) => clearIfEmpty(prev));
      setSyncWarnings((prev) => clearIfEmpty(prev));
      setLoading(false);
      return;
    }

    if (action === "recompute") {
      // Weights changed, or the server returned no price rows for one of the
      // tickers: recompute from the data we already have. Re-fetching cannot
      // add missing data and previously looped forever at ~4 requests/second
      // (each response replaced stockUniverse, re-triggering this effect).
      setCustomSeries((prev) => {
        const next = calculateCustomIndex(basket, stockUniverse, baseValue);
        return sameSeries(prev, next) ? prev : next;
      });
      // The data was computed locally from the cached universe, so a warning
      // about an earlier failed sync no longer describes what is displayed.
      setSyncWarnings((prev) => clearIfEmpty(prev));
      return;
    }

    if (action === "idle") {
      // Already fetched for this ticker set but no series are available;
      // re-fetching would loop without ever satisfying the completeness check.
      return;
    }

    // The ticker set changed: the in-flight request (if any) was started for
    // the previous basket, so it is invalidated immediately. The replacement
    // request is debounced below; without invalidating here the obsolete
    // response could land in that window and overwrite the new basket's data.
    abortInFlight();

    // Debounce server fetch when tickers are added/removed
    const timer = setTimeout(() => {
      runSimulation();
    }, 250);

    return () => clearTimeout(timer);
  }, [currentTickersKey, basket, baseValue, stockUniverse, runSimulation, abortInFlight]);

  // Cancel inflight simulation requests when component unmounts
  useEffect(() => {
    return () => {
      abortInFlight();
    };
  }, [abortInFlight]);

  // Filter series according to timeframe
  const filteredCustomSeries = useMemo(() => {
    if (customSeries.length === 0) return [];
    return filterByTimeframe(customSeries, timeframe);
  }, [customSeries, timeframe]);

  const activeBenchmarkData = isBenchmarkDataForSymbol(benchmarkData, selectedBenchmark)
    ? benchmarkData
    : null;

  const filteredBenchmarkSeries = useMemo(() => {
    if (activeBenchmarkData && activeBenchmarkData.series.length > 0) {
      return filterByTimeframe(activeBenchmarkData.series, timeframe);
    }
    if (filteredCustomSeries.length > 0) {
      const dates = filteredCustomSeries.map((p) => p.date);
      return generateFallbackBenchmarkSeries(selectedBenchmark, dates);
    }
    return [];
  }, [activeBenchmarkData, filteredCustomSeries, selectedBenchmark, timeframe]);

  // The benchmark line and the alpha metric must never read as real market
  // data when the snapshot API is unavailable: disclose the generated fallback
  // the same way the custom series does. A single-point series cannot yield a
  // return (it is 0% by construction), so alpha would silently equal the whole
  // custom return — that applies to the Worker's baseline placeholder as well
  // as to a comparison window that the timeframe filter collapsed to one point.
  const usingDemoBenchmark = useMemo(() => {
    if (benchmarkLoading || filteredBenchmarkSeries.length === 0) return false;
    return (
      !activeBenchmarkData ||
      activeBenchmarkData.series.length < 2 ||
      filteredBenchmarkSeries.length < 2
    );
  }, [benchmarkLoading, activeBenchmarkData, filteredBenchmarkSeries]);

  // Calculate quantitative risk metrics
  const metrics = useMemo<RiskMetrics>(() => {
    if (filteredCustomSeries.length < 2) {
      return {
        annualReturn: 0,
        annualVolatility: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        beta: null,
        winRate: 0,
        bestDay: 0,
        worstDay: 0,
      };
    }
    return calculateRiskMetrics(filteredCustomSeries, filteredBenchmarkSeries);
  }, [filteredCustomSeries, filteredBenchmarkSeries]);

  // Calculate period returns and alpha
  const { periodCustomReturnPct, periodBenchmarkReturnPct, alphaPct } = useMemo(() => {
    return calculatePeriodReturns(filteredCustomSeries, filteredBenchmarkSeries);
  }, [filteredCustomSeries, filteredBenchmarkSeries]);

  // Calculate constituent performance & contribution
  const constituentsPerformance = useMemo<ConstituentPerformance[]>(() => {
    return calculateConstituentPerformance(basket, stockUniverse, timeframe);
  }, [basket, stockUniverse, timeframe]);

  return {
    customSeries,
    filteredCustomSeries,
    filteredBenchmarkSeries,
    stockUniverse,
    metrics,
    periodCustomReturnPct,
    periodBenchmarkReturnPct,
    alphaPct,
    constituentsPerformance,
    loading,
    benchmarkLoading,
    error,
    syncWarnings,
    /** True when the preview shows generated demo prices instead of API data. */
    usingDemoData,
    /** True when the benchmark comparison is generated demo data. */
    usingDemoBenchmark,
    timeframe,
    setTimeframe,
    selectedBenchmark,
    setSelectedBenchmark,
    runSimulation,
  };
}

function sanitizeMetricPct(val: number): number {
  // 非有限値 (NaN/Infinity) は 0 に落とす。Number(NaN.toFixed(2)) は NaN の
  // ままなので、ここで止めないと表示系へ NaN が漏れる。
  if (!Number.isFinite(val)) return 0;
  return Math.abs(val) < 0.005 || Object.is(val, -0) ? 0 : Number(val.toFixed(2));
}

/** Last point whose date is on or before `date` (series are ISO-dated and ordered). */
function lastPointOnOrBefore(series: PricePoint[], date: string): PricePoint | undefined {
  let match: PricePoint | undefined;
  for (const p of series) {
    if (p.date <= date) {
      match = p;
    } else if (p.date > date) {
      break;
    }
  }
  return match;
}

export function calculatePeriodReturns(
  filteredCustomSeries: PricePoint[],
  filteredBenchmarkSeries: PricePoint[],
): {
  periodCustomReturnPct: number;
  periodBenchmarkReturnPct: number;
  alphaPct: number;
} {
  let customReturn = 0;
  if (filteredCustomSeries.length >= 2) {
    const start = filteredCustomSeries[0].value ?? filteredCustomSeries[0].close;
    const end =
      filteredCustomSeries[filteredCustomSeries.length - 1].value ??
      filteredCustomSeries[filteredCustomSeries.length - 1].close;
    // end が null/欠損だと (end - start) が 0 扱いで -100% と表示されるため、
    // 両端が有限正値のときだけリターンを計算する。
    if (start > 0 && Number.isFinite(start) && Number.isFinite(end)) {
      customReturn = sanitizeMetricPct(((end - start) / start) * 100);
    }
  }

  let benchmarkReturn = 0;
  if (filteredBenchmarkSeries.length >= 1 && filteredCustomSeries.length >= 2) {
    const customStartDate = filteredCustomSeries[0].date;
    const customEndDate = filteredCustomSeries[filteredCustomSeries.length - 1].date;

    // Find the benchmark baseline price corresponding to custom start date.
    let startPoint: PricePoint | undefined;
    for (const p of filteredBenchmarkSeries) {
      if (p.date <= customStartDate && p.close > 0) {
        startPoint = p;
      } else if (p.date > customStartDate) {
        break;
      }
    }
    if (!startPoint && filteredBenchmarkSeries.length > 0) {
      startPoint = filteredBenchmarkSeries.find((p) => p.close > 0);
    }

    // Find the benchmark ending price corresponding to custom end date.
    let endPoint: PricePoint | undefined;
    for (const p of filteredBenchmarkSeries) {
      if (p.date <= customEndDate && p.close > 0) {
        endPoint = p;
      } else if (p.date > customEndDate) {
        break;
      }
    }
    if (!endPoint && filteredBenchmarkSeries.length > 0) {
      endPoint = filteredBenchmarkSeries[filteredBenchmarkSeries.length - 1];
    }

    if (
      startPoint &&
      endPoint &&
      startPoint.close > 0 &&
      endPoint.close > 0 &&
      startPoint !== endPoint &&
      startPoint.date !== endPoint.date
    ) {
      benchmarkReturn = sanitizeMetricPct(
        ((endPoint.close - startPoint.close) / startPoint.close) * 100,
      );

      // The benchmark is capped at 1y of history while a basket can keep a
      // longer legacy history (and a benchmark may simply lack the custom
      // series' holidays). Whenever the chosen benchmark baseline/end lies
      // outside the custom window, the two returns would cover different
      // spans and alpha would silently absorb the uncovered gap, so the
      // custom return is rebased onto exactly the benchmark's window.
      if (startPoint.date > customStartDate || endPoint.date < customEndDate) {
        const alignedStart =
          lastPointOnOrBefore(filteredCustomSeries, startPoint.date) ?? filteredCustomSeries[0];
        const alignedEnd =
          lastPointOnOrBefore(filteredCustomSeries, endPoint.date) ??
          filteredCustomSeries[filteredCustomSeries.length - 1];
        const startValue = alignedStart.value ?? alignedStart.close;
        const endValue = alignedEnd.value ?? alignedEnd.close;
        if (alignedStart === alignedEnd) {
          // No custom observation inside the shared window: report no change
          // rather than a return measured outside the comparison period.
          customReturn = 0;
        } else if (startValue > 0 && Number.isFinite(startValue) && Number.isFinite(endValue)) {
          customReturn = sanitizeMetricPct(((endValue - startValue) / startValue) * 100);
        }
      }
    } else if (
      startPoint &&
      endPoint &&
      startPoint.close > 0 &&
      endPoint.close > 0 &&
      (startPoint === endPoint || startPoint.date === endPoint.date)
    ) {
      // A single usable benchmark point cannot express a return (0% by
      // construction). Keep the custom window so the index's own return stays
      // accurate; `usingDemoBenchmark` discloses that alpha is not comparable.
      benchmarkReturn = 0;
    }
  }
  // 自己系列が1点以下のときはリターン自体が測定不能なので、ベンチマークのみの
  // リターンは計算しない (alpha が -benchmark と誤表示になるのを防ぐ)。
  // 旧実装の「ベンチマークだけ >= 2 点」分岐はこの意図を欠いており、削除した。

  const alpha = sanitizeMetricPct(customReturn - benchmarkReturn);
  return {
    periodCustomReturnPct: customReturn,
    periodBenchmarkReturnPct: benchmarkReturn,
    alphaPct: alpha,
  };
}

export function calculateConstituentPerformance(
  basket: BasketItem[],
  stockUniverse: StockSeries[],
  timeframe: Timeframe,
): ConstituentPerformance[] {
  if (basket.length === 0 || stockUniverse.length === 0) return [];

  const normBasket = normalizeWeights(basket);
  const universeMap = new Map(stockUniverse.map((s) => [normalizeTicker(s.ticker), s]));

  return normBasket.map((item) => {
    const normItemTicker = normalizeTicker(item.ticker);
    const stock = universeMap.get(normItemTicker);
    if (!stock || !Array.isArray(stock.series) || stock.series.length === 0) {
      return {
        ticker: normItemTicker,
        name: item.name,
        theme: item.theme,
        weight: item.weight,
        startPrice: 0,
        latestPrice: 0,
        periodReturnPct: 0,
        contributionPct: 0,
      };
    }

    // Filter stock series to current timeframe
    const filteredStockSeries = filterByTimeframe(stock.series, timeframe);
    const start =
      filteredStockSeries.length > 0 ? filteredStockSeries[0].close : stock.series[0].close;
    const latest =
      filteredStockSeries.length > 0
        ? filteredStockSeries[filteredStockSeries.length - 1].close
        : stock.series[stock.series.length - 1].close;

    // 欠損・非有限の終値は (latest - start) が 0 扱いで -100%/NaN になるため、
    // 両端が有限正値のときだけリターンを計算する。
    const retPct =
      start > 0 && Number.isFinite(start) && Number.isFinite(latest)
        ? ((latest - start) / start) * 100
        : 0;
    const safeRetPct = sanitizeMetricPct(retPct);
    const contribution = sanitizeMetricPct((item.weight / 100) * safeRetPct);

    return {
      ticker: normItemTicker,
      name: item.name,
      theme: item.theme,
      weight: item.weight,
      startPrice: start,
      latestPrice: latest,
      periodReturnPct: safeRetPct,
      contributionPct: contribution,
    };
  });
}
export function getTickerBasePrice(ticker: string): number {
  const KNOWN_PRICES: Record<string, number> = {
    "7203": 2850,
    "9984": 9150,
    "8035": 25800,
    "6857": 8450,
    "6758": 3220,
    "9983": 44800,
    "8306": 1650,
    "8058": 3320,
    "7974": 8620,
    "6861": 68500,
    "3778": 4850,
    "6501": 3950,
    "9432": 162,
    "5803": 5420,
    "6920": 21500,
  };
  const cleanTicker = normalizeTicker(ticker).replace(/\.T$/, "");
  if (KNOWN_PRICES[cleanTicker]) return KNOWN_PRICES[cleanTicker];
  let hash = 0;
  for (let i = 0; i < cleanTicker.length; i++)
    hash = (hash * 31 + cleanTicker.charCodeAt(i)) & 0xffff;
  return 1000 + (hash % 4000);
}

export function generateFallbackStockUniverse(basket: BasketItem[], days = 180): StockSeries[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  return basket.map((item) => {
    const normTicker = normalizeTicker(item.ticker);
    const base = getTickerBasePrice(normTicker);
    let current = base;
    let seed = 0;
    for (let i = 0; i < normTicker.length; i++) seed += normTicker.charCodeAt(i);

    const series: PricePoint[] = dates.map((date, idx) => {
      const pseudoRand = Math.sin(seed * (idx + 1) * 0.73) * 0.5 + 0.5;
      const trend = (idx / dates.length) * 0.06;
      const dailyChange = (pseudoRand - 0.48) * 0.035 + trend * 0.008;
      current = Math.max(1, current * (1 + dailyChange));
      return { date, close: Number(current.toFixed(1)) };
    });

    return {
      ticker: item.ticker,
      name: item.name,
      theme: item.theme,
      sector: item.theme,
      latestPrice: series[series.length - 1]?.close ?? base,
      series,
      isDemoData: true,
    };
  });
}

export function generateFallbackBenchmarkSeries(
  symbol: BenchmarkSymbol,
  dates: string[],
): PricePoint[] {
  let basePrice = 38000;
  if (symbol === "^GSPC") basePrice = 5500;
  if (symbol === "USDJPY=X") basePrice = 150;
  if (symbol === "BTC-USD") basePrice = 65000;

  let current = basePrice;
  return dates.map((date, idx) => {
    const pseudoRand = Math.sin((idx + 3) * 0.51) * 0.5 + 0.5;
    const dailyChange = (pseudoRand - 0.49) * 0.02 + 0.0003;
    current = Math.max(1, current * (1 + dailyChange));
    return { date, close: Number(current.toFixed(1)) };
  });
}
