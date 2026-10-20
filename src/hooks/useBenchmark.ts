import { useState, useEffect, useCallback, useRef } from "react";
import type { BenchmarkOption, BenchmarkSymbol, Snapshot } from "../types";

const API_BASE = "/api";
const BENCHMARK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/**
 * Abort the snapshot request after this many milliseconds.
 *
 * Without a deadline a hanging request left the preview spinning forever.
 */
const BENCHMARK_REQUEST_TIMEOUT_MS = 12_000;

interface CachedBenchmark {
  data: BenchmarkData;
  timestamp: number;
  etag?: string | null;
}
const benchmarkSessionCache = new Map<string, CachedBenchmark>();

export const AVAILABLE_BENCHMARKS: BenchmarkOption[] = [
  { symbol: "^N225", label: "日経225", shortLabel: "日経225", currency: "円" },
  { symbol: "^GSPC", label: "S&P 500 (米国)", shortLabel: "S&P500", currency: "USD" },
  { symbol: "USDJPY=X", label: "米ドル/円 (為替)", shortLabel: "USD/JPY", currency: "円" },
  { symbol: "BTC-USD", label: "ビットコイン (BTC/USD)", shortLabel: "BTC", currency: "USD" },
];

export type BenchmarkData = {
  snapshot: Snapshot;
  series: { date: string; close: number }[];
  /** True when the Worker had to serve an older cached snapshot. */
  stale?: boolean;
};

export function isBenchmarkDataForSymbol(
  data: BenchmarkData | null,
  symbol: BenchmarkSymbol,
): boolean {
  return Boolean(data && data.snapshot.symbol === symbol);
}

/**
 * Validate a `/api/snapshot` payload.
 *
 * The response used to be accepted with a bare type assertion, so a malformed
 * body (`null`, an error page, a snapshot without a symbol or a series with
 * non-numeric closes) reached the chart and the metrics, which then read
 * `data.snapshot.current` or `point.close` as if they were numbers. The
 * payload is now checked field by field: an unusable response is rejected
 * (null) and the caller falls back to the empty/error state.
 */
export function normalizeBenchmarkData(raw: unknown): BenchmarkData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const rawSnapshot = record.snapshot;
  if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) return null;
  const snapshotRecord = rawSnapshot as Record<string, unknown>;

  const symbol = typeof snapshotRecord.symbol === "string" ? snapshotRecord.symbol.trim() : "";
  if (!symbol) return null;

  const current = snapshotRecord.current;
  const change = snapshotRecord.change;
  const changePct = snapshotRecord.changePct;
  if (typeof current !== "number" || !Number.isFinite(current)) return null;
  if (typeof change !== "number" || !Number.isFinite(change)) return null;
  if (typeof changePct !== "number" || !Number.isFinite(changePct)) return null;

  const rawSeries = record.series;
  if (!Array.isArray(rawSeries)) return null;
  const series: { date: string; close: number }[] = [];
  for (const point of rawSeries) {
    if (!point || typeof point !== "object" || Array.isArray(point)) continue;
    const entry = point as Record<string, unknown>;
    if (typeof entry.date !== "string" || !entry.date.trim()) continue;
    if (typeof entry.close !== "number" || !Number.isFinite(entry.close)) continue;
    series.push({ date: entry.date, close: entry.close });
  }
  if (series.length === 0) return null;

  const snapshot: Snapshot = {
    symbol,
    label: typeof snapshotRecord.label === "string" ? snapshotRecord.label : "",
    current,
    change,
    changePct,
    updatedAt: typeof snapshotRecord.updatedAt === "string" ? snapshotRecord.updatedAt : "",
    description: typeof snapshotRecord.description === "string" ? snapshotRecord.description : "",
  };

  const data: BenchmarkData = { snapshot, series };
  if (typeof record.stale === "boolean") {
    data.stale = record.stale;
  }
  return data;
}

/** Parse a JSON body without throwing on a non-JSON error page. */
function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Read the `error` field of an API error body. */
function readErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return "";
}

export function useBenchmark(initialSymbol: BenchmarkSymbol = "^N225", enabled = true) {
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkSymbol>(initialSymbol);
  const [prevInitialSymbol, setPrevInitialSymbol] = useState<BenchmarkSymbol>(initialSymbol);

  if (initialSymbol !== prevInitialSymbol) {
    setPrevInitialSymbol(initialSymbol);
    setSelectedBenchmark(initialSymbol);
  }
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(() => {
    const cached = benchmarkSessionCache.get(initialSymbol);
    return cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL ? cached.data : null;
  });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() => {
    const cached = benchmarkSessionCache.get(initialSymbol);
    return cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL ? cached.timestamp : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled) return false;
    const cached = benchmarkSessionCache.get(initialSymbol);
    return !(cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL);
  });
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  /**
   * Monotonic id of the newest snapshot request.
   *
   * A superseded request must not publish: the abort alone is not enough,
   * because a request can be replaced while its response is still being
   * read.
   */
  const requestIdRef = useRef(0);
  /**
   * True while the consumer is mounted.
   *
   * A request that settles after the unmount must not write to state that no
   * longer has a consumer.
   */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    benchmarkSessionCache.delete(selectedBenchmark);
    setRetryCount((c) => c + 1);
  }, [selectedBenchmark]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }

    const cached = benchmarkSessionCache.get(selectedBenchmark);
    const now = Date.now();
    if (cached && now - cached.timestamp < BENCHMARK_CACHE_TTL) {
      setBenchmarkData(cached.data);
      setLastUpdatedAt(cached.timestamp);
      setLoading(false);
      setError(null);
      return;
    }

    // A changed/expired benchmark must not keep the previous symbol's values
    // while the new request is pending or after it fails.
    setBenchmarkData(null);
    setLastUpdatedAt(null);

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () => requestId === requestIdRef.current && mountedRef.current;
    /** True when this request was aborted by the deadline below. */
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BENCHMARK_REQUEST_TIMEOUT_MS);
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }

    const url = `${API_BASE}/snapshot?symbol=${encodeURIComponent(selectedBenchmark)}`;

    /**
     * Publish a validated payload to the module cache and to the state.
     *
     * The module cache feeds the next render, so a superseded request must not
     * publish to it either: a stale response would otherwise overwrite a
     * newer payload and be served for the full TTL.
     */
    const publish = (data: BenchmarkData, etag: string | null) => {
      if (!isCurrentRequest() || controller.signal.aborted) return;
      const timestamp = Date.now();
      benchmarkSessionCache.set(selectedBenchmark, { data, timestamp, etag });
      setBenchmarkData(data);
      setLastUpdatedAt(timestamp);
    };

    (async () => {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers,
        });
        if (res.status === 304) {
          if (cached) {
            // Re-validating the cached entry extends its lifetime, so it must
            // not happen for a request that has already been superseded.
            if (isCurrentRequest() && !controller.signal.aborted) {
              cached.timestamp = Date.now();
              setLastUpdatedAt(cached.timestamp);
              setBenchmarkData(cached.data);
            }
            return;
          }
          // If 304 received without memory cache, refetch fresh data bypassing cache
          const freshRes = await fetch(url, {
            signal: controller.signal,
            cache: "reload",
          });
          if (!freshRes.ok) {
            const errData: unknown = await freshRes.json().catch(() => null);
            throw new Error(
              readErrorMessage(errData) || `${selectedBenchmark} データの取得に失敗しました`,
            );
          }
          const freshEtag = freshRes.headers.get("etag");
          const freshText = await freshRes.text();
          if (!freshText) {
            throw new Error(`${selectedBenchmark} データの取得に失敗しました（空のレスポンス）`);
          }
          const freshData = normalizeBenchmarkData(parseJsonBody(freshText));
          if (!freshData) {
            throw new Error(`${selectedBenchmark} データの形式が不正です`);
          }
          publish(freshData, freshEtag);
          return;
        }
        if (!res.ok) {
          const errData: unknown = await res.json().catch(() => null);
          throw new Error(readErrorMessage(errData) || `${selectedBenchmark} データの取得に失敗しました`);
        }
        const etag = res.headers.get("etag");
        const raw: unknown = await res.json().catch(() => null);
        const data = normalizeBenchmarkData(raw);
        if (!data) {
          throw new Error(`${selectedBenchmark} データの形式が不正です`);
        }
        publish(data, etag);
      } catch (err) {
        if (timedOut) {
          if (isCurrentRequest()) {
            setError(`${selectedBenchmark} データの取得がタイムアウトしました`);
          }
          return;
        }
        if (controller.signal.aborted) {
          // The request was superseded or the consumer unmounted: it must not
          // publish an error for a state that no longer exists.
          return;
        }
        setError(
          err instanceof Error ? err.message : `${selectedBenchmark} データの取得に失敗しました`,
        );
      } finally {
        clearTimeout(timeout);
        if (isCurrentRequest()) {
          // The loading flag is always released for the current request, also
          // after the deadline aborted it.
          setLoading(false);
        }
      }
    })();

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, selectedBenchmark, retryCount]);

  return {
    selectedBenchmark,
    setSelectedBenchmark,
    benchmarkData,
    lastUpdatedAt,
    loading,
    error,
    availableBenchmarks: AVAILABLE_BENCHMARKS,
    refetch,
  };
}
