import { useState, useEffect, useCallback } from "react";
import type { BenchmarkOption, BenchmarkSymbol, Snapshot } from "../types";

const API_BASE = "/api";
const BENCHMARK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    const cached = benchmarkSessionCache.get(initialSymbol);
    return !(cached && Date.now() - cached.timestamp < BENCHMARK_CACHE_TTL);
  });
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }

    fetch(`${API_BASE}/snapshot?symbol=${encodeURIComponent(selectedBenchmark)}`, {
      signal: controller.signal,
      headers,
    })
      .then(async (res) => {
        if (res.status === 304) {
          if (cached) {
            cached.timestamp = Date.now();
            setLastUpdatedAt(cached.timestamp);
            return cached.data;
          }
          // If 304 received without memory cache, refetch fresh data bypassing cache
          const freshRes = await fetch(
            `${API_BASE}/snapshot?symbol=${encodeURIComponent(selectedBenchmark)}`,
            {
              signal: controller.signal,
              cache: "reload",
            },
          );
          if (!freshRes.ok) {
            const errData = await freshRes.json().catch(() => ({}));
            throw new Error(errData.error || `${selectedBenchmark} データの取得に失敗しました`);
          }
          const freshEtag = freshRes.headers.get("etag");
          const freshText = await freshRes.text();
          if (!freshText) {
            throw new Error(`${selectedBenchmark} データの取得に失敗しました（空のレスポンス）`);
          }
          const freshData: BenchmarkData = JSON.parse(freshText);
          benchmarkSessionCache.set(selectedBenchmark, {
            data: freshData,
            timestamp: Date.now(),
            etag: freshEtag,
          });
          setLastUpdatedAt(Date.now());
          return freshData;
        }
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `${selectedBenchmark} データの取得に失敗しました`);
        }
        const etag = res.headers.get("etag");
        const data: BenchmarkData = await res.json();
        benchmarkSessionCache.set(selectedBenchmark, {
          data,
          timestamp: Date.now(),
          etag,
        });
        setLastUpdatedAt(Date.now());
        return data;
      })
      .then((data: BenchmarkData) => {
        if (!controller.signal.aborted) {
          setBenchmarkData(data);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
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
