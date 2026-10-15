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
import { SYNC_STORAGE_KEY, parseLocalSyncCache } from "./useCalculation";
import { useBenchmark, isBenchmarkDataForSymbol } from "./useBenchmark";

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
// SYNC_STORAGE_KEY is imported from ./useCalculation so both hooks read and
// write the same localStorage sync cache. Duplicating the literal here risked
// one copy being renamed while the other kept writing the old key.

/**
 * Maximum tickers accepted per /api/sync-prices request. The Worker rejects
 * larger requests with a 400 instead of silently truncating, so callers must
 * batch themselves.
 */
const SYNC_BATCH_SIZE = 30;

/** Split tickers into sync batches no larger than the Worker's request limit. */
export function buildSyncBatches(
  tickers: readonly string[],
  maxBatch = SYNC_BATCH_SIZE,
): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += maxBatch) {
    batches.push(tickers.slice(i, i + maxBatch));
  }
  return batches;
}

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

  const { benchmarkData, loading: benchmarkLoading } = useBenchmark(selectedBenchmark);

  const abortRef = useRef<AbortController | null>(null);
  const knownTickersRef = useRef<string>("");

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
        setCustomSeries([]);
        setStockUniverse([]);
        setError(null);
        setUsingDemoData(false);
        setLoading(false);
        return;
      }

      // If we already have stockUniverse for all basket items and not forcing,
      // compute customSeries purely in client memory (0ms latency)!
      if (!force && hasAllStockData && stockUniverse.length > 0) {
        const computed = calculateCustomIndex(basket, stockUniverse, baseValue);
        setCustomSeries(computed);
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

      setLoading(true);
      setError(null);
      setUsingDemoData(false);

      // POST /api/calculate は1件の不正エントリで全体を400にする。レガシー行の
      // weight 0 や全角ティッカーをそのまま送ると、原因表示もなくデモデータへ
      // フォールバックし続けるため、送信前に Worker 契約へ揃える。
      const sanitizedBasket = sanitizeBasketForRequest(basket);
      const requestBasket = sanitizedBasket.basket;
      if (requestBasket.length === 0) {
        setCustomSeries([]);
        setStockUniverse([]);
        setError("構成銘柄に有効なティッカーが含まれていないため計算できません。銘柄を編集してください。");
        setUsingDemoData(false);
        setLoading(false);
        return;
      }

      try {
        const allTickers = requestBasket.map((b) => normalizeTicker(b.ticker));
        const localSyncCache = parseLocalSyncCache(
          typeof localStorage === "undefined" ? null : localStorage.getItem(SYNC_STORAGE_KEY),
        );
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

        // 1. Sync prices in background (only for tickers that are missing or stale)
        if (tickersToSync.length > 0) {
          try {
            for (const batch of buildSyncBatches(tickersToSync)) {
              const syncRes = await fetch(`${API_BASE}/sync-prices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tickers: batch, force: false }),
                signal: controller.signal,
              });
              if (controller.signal.aborted) return;
              if (syncRes.ok) {
                const syncData = (await syncRes.json().catch(() => ({}))) as {
                  results?: Array<{ ticker?: string; status?: string; lastSynced?: number }>;
                };
                if (Array.isArray(syncData.results)) {
                  const nowMs = Date.now();
                  for (const r of syncData.results) {
                    if (r.status === "synced" || r.status === "cached") {
                      const nt = typeof r.ticker === "string" ? normalizeTicker(r.ticker) : "";
                      if (nt) {
                        localSyncCache[nt] =
                          typeof r.lastSynced === "number" && Number.isFinite(r.lastSynced) && r.lastSynced > 0
                            ? (r.lastSynced < 1e11 ? Math.round(r.lastSynced * 1000) : Math.round(r.lastSynced))
                            : nowMs;
                      }
                    }
                  }
                  // Clean entries older than 7 days
                  for (const [k, v] of Object.entries(localSyncCache)) {
                    if (nowMs - v > 7 * 24 * 60 * 60 * 1000) {
                      delete localSyncCache[k];
                    }
                  }
                  try {
                    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(localSyncCache));
                  } catch {
                    // ignore localStorage quota errors
                  }
                }
              }
            }
          } catch {
            // Ignore network errors in sync preflight
          }
        }

        if (controller.signal.aborted) return;

        // 2. Fetch calculated index and stockUniverse from /api/calculate
        const calcRes = await fetch(`${API_BASE}/calculate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          universe = Array.isArray(data.stockUniverse) ? data.stockUniverse : [];
          series = Array.isArray(data.series) ? data.series : [];
        } else {
          // 非2xx応答でもプレビューは動かしつつ、理由を捨てない。バリデーション
          // エラー(400)やレート制限(429)を黙ってデモ表示に置き換えていたため、
          // 利用者は「なぜ数値が違うのか」を知らされなかった。
          const errBody = (await calcRes.json().catch(() => ({}))) as Record<string, unknown>;
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
          (err instanceof DOMException && err.name === "AbortError")
        ) {
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
    [basket, baseValue, currentTickersKey, hasAllStockData, stockUniverse],
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
      setCustomSeries([]);
      setStockUniverse([]);
      return;
    }

    if (action === "recompute") {
      // Weights changed, or the server returned no price rows for one of the
      // tickers: recompute from the data we already have. Re-fetching cannot
      // add missing data and previously looped forever at ~4 requests/second
      // (each response replaced stockUniverse, re-triggering this effect).
      setCustomSeries(calculateCustomIndex(basket, stockUniverse, baseValue));
      return;
    }

    if (action === "idle") {
      // Already fetched for this ticker set but no series are available;
      // re-fetching would loop without ever satisfying the completeness check.
      return;
    }

    // Debounce server fetch when tickers are added/removed
    const timer = setTimeout(() => {
      runSimulation();
    }, 250);

    return () => clearTimeout(timer);
  }, [currentTickersKey, basket, baseValue, stockUniverse, runSimulation]);

  // Cancel inflight simulation requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

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
    if (start > 0) {
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
  } else if (filteredBenchmarkSeries.length >= 2) {
    const start = filteredBenchmarkSeries[0].close;
    const end = filteredBenchmarkSeries[filteredBenchmarkSeries.length - 1].close;
    if (start > 0) {
      benchmarkReturn = sanitizeMetricPct(((end - start) / start) * 100);
    }
  }

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

    const retPct = start > 0 ? ((latest - start) / start) * 100 : 0;
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
