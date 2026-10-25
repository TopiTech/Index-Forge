import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Sliders,
} from "lucide-react";
import type { StockQuoteFundamentals } from "../lib/marketDataService";
import { detectStockCurrency, formatStockPrice } from "../lib/currency";
import { resolveTradingViewSymbol, getTradingViewWebUrl } from "../lib/tradingView";

export interface StockTechnicalChartProps {
  stock: StockQuoteFundamentals;
  theme?: "dark" | "light";
  isMobile?: boolean;
}

export interface PriceDataPoint {
  date: string;
  displayDate: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  sma25: number | null;
  sma75: number | null;
}

/**
 * Axis label of a raw price-series date.
 *
 * The series arrives from the API as an ISO date string ("2026-10-14") and is
 * shown on the axis as the Japanese "M/D" label. The month and the day are
 * read from the string itself instead of through `new Date(isoString)`,
 * because the latter is parsed as UTC midnight and therefore shifts the
 * calendar day in every negative UTC offset.
 */
/**
 * Decide whether a decoded TradingView postMessage payload reports a symbol
 * the widget cannot display.
 *
 * Pure (no DOM, no JSON parsing, no origin check): the `message` listener
 * keeps the try/catch around `JSON.parse` and the effect cleanup, and only
 * delegates the shape judgement here so the rule is unit-testable and cannot
 * drift between the widget and the modal. Non-object payloads (and arrays)
 * are never errors.
 */
export function isTradingViewSymbolError(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  return (
    record.name === "tv-widget-symbol-error" ||
    record.name === "symbol_error" ||
    record.event === "symbol_error" ||
    (typeof record.msg === "string" && record.msg.toLowerCase().includes("symbol"))
  );
}

export function formatChartDisplayDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split(/[-/]/);
  if (parts.length >= 3) {
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!Number.isNaN(m) && !Number.isNaN(d)) {
      return `${m}/${d}`;
    }
    return dateStr;
  }
  const dt = new Date(dateStr);
  return Number.isNaN(dt.getTime())
    ? dateStr
    : `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}

/**
 * Render one tooltip cell of the technical chart.
 *
 * Recharts hands over whatever the series holds, including `null` for a
 * not-yet-computed SMA and `NaN` for a corrupted close. Rendering those
 * directly would show "¥0" / "$0.00" and hide the gap, so every
 * non-finite value is rendered as "--".
 *
 * Exported so the behaviour is verifiable against the real component logic
 * instead of a copy of it.
 */
export function formatTechnicalTooltipValue(
  val: unknown,
  name: unknown,
  ticker: string,
): [string | number, string] {
  const isValidNum = typeof val === "number" && Number.isFinite(val);
  if (name === "volume") {
    return [isValidNum ? val.toLocaleString() : "--", "出来高"];
  }
  if (name === "close") {
    return [isValidNum ? formatStockPrice(val, ticker) : "--", "終値"];
  }
  if (name === "sma25") {
    return [isValidNum ? formatStockPrice(val, ticker) : "--", "SMA 25日"];
  }
  if (name === "sma75") {
    return [isValidNum ? formatStockPrice(val, ticker) : "--", "SMA 75日"];
  }
  return [isValidNum ? val : "--", String(name)];
}

/**
 * Simple moving average over the `window` closes ending at `endIndex`.
 *
 * A corrupted close (`NaN`, a non-positive number or a missing value) is
 * replaced by `fallbackPrice`, so one bad row cannot poison the average and
 * turn the whole line into `NaN`.
 */
export function computeSma(
  rawSeries: Array<{ close?: number }>,
  endIndex: number,
  window: number,
  fallbackPrice: number,
): number | null {
  if (endIndex < window - 1) return null;
  let sum = 0;
  for (let k = endIndex - window + 1; k <= endIndex; k++) {
    const c = rawSeries[k]?.close;
    sum += typeof c === "number" && Number.isFinite(c) && c > 0 ? c : fallbackPrice;
  }
  return Math.round((sum / window) * 100) / 100;
}

/**
 * Generate deterministic fallback daily series when /api/sync-prices is unavailable or offline.
 * Anchors precisely to stock.yearLow, stock.yearHigh, stock.previousClose, and stock.price.
 */
export function generateDeterministicHistory(
  stock: StockQuoteFundamentals,
  totalDays: number = 75,
  baseDate: Date = new Date(),
): PriceDataPoint[] {
  const result: PriceDataPoint[] = [];
  const now = baseDate;
  const currentPrice = stock.price > 0 ? stock.price : 1000;
  const prevClose = stock.previousClose > 0 ? stock.previousClose : currentPrice;
  const dayHigh = stock.dayHigh > 0 ? stock.dayHigh : currentPrice * 1.01;
  const dayLow = stock.dayLow > 0 ? stock.dayLow : currentPrice * 0.99;
  const rawYearHigh = stock.yearHigh > 0 ? stock.yearHigh : currentPrice * 1.2;
  const rawYearLow = stock.yearLow > 0 ? stock.yearLow : currentPrice * 0.8;
  const yearHigh = Math.max(rawYearHigh, rawYearLow, currentPrice);
  const yearLow = Math.min(rawYearHigh, rawYearLow, currentPrice * 0.5);

  // Simple pseudo-random hash based on ticker
  let seed = 0;
  for (let i = 0; i < stock.ticker.length; i++) {
    seed = (seed * 31 + stock.ticker.charCodeAt(i)) >>> 0;
  }

  const seededRandom = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed >>> 0) / 4294967296;
  };

  const safeTotalDays =
    typeof totalDays === "number" && Number.isFinite(totalDays)
      ? Math.max(3, Math.floor(totalDays))
      : 75;
  const rawPrices: number[] = new Array(safeTotalDays);
  // Anchor end values
  rawPrices[safeTotalDays - 1] = currentPrice;
  rawPrices[safeTotalDays - 2] = prevClose;

  // Walk backward from prevClose towards a baseline bounded by yearLow/yearHigh
  let walk = prevClose;
  for (let i = safeTotalDays - 3; i >= 0; i--) {
    const delta = (seededRandom() - 0.49) * (currentPrice * 0.022);
    walk -= delta;
    if (walk > yearHigh) walk = yearHigh - seededRandom() * (currentPrice * 0.02);
    if (walk < yearLow) walk = yearLow + seededRandom() * (currentPrice * 0.02);
    rawPrices[i] = Math.max(yearLow * 0.95, walk);
  }

  // If sparkline is present (5 recent points), smoothly interpolate into the last 5 days
  if (Array.isArray(stock.sparkline) && stock.sparkline.length >= 3) {
    const sp = stock.sparkline;
    for (let j = 0; j < Math.min(sp.length, safeTotalDays); j++) {
      const idx = safeTotalDays - sp.length + j;
      if (idx >= 0 && Number.isFinite(sp[j]) && sp[j] > 0) {
        rawPrices[idx] = sp[j];
      }
    }
    rawPrices[safeTotalDays - 1] = currentPrice;
  }

  // Build calendar business dates
  const businessDates: Date[] = [];
  const cur = new Date(now);
  while (businessDates.length < safeTotalDays) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      businessDates.unshift(new Date(cur));
    }
    cur.setDate(cur.getDate() - 1);
  }

  const baseVolume = stock.volume > 0 ? stock.volume : 500000;

  for (let i = 0; i < safeTotalDays; i++) {
    const d = businessDates[i] || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dayStr = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${dayStr}`;
    const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
    const close = Math.round(rawPrices[i] * 100) / 100;
    const isLast = i === safeTotalDays - 1;
    const high = isLast ? Math.max(dayHigh, close) : close * (1 + seededRandom() * 0.012);
    const low = isLast ? Math.min(dayLow, close) : close * (1 - seededRandom() * 0.012);
    const open = i > 0 ? rawPrices[i - 1] : close * (1 - (seededRandom() - 0.5) * 0.01);
    const volume = Math.round(baseVolume * (0.6 + seededRandom() * 0.8));

    // SMA calculation
    let sma25: number | null = null;
    if (i >= 24) {
      let sum = 0;
      for (let k = i - 24; k <= i; k++) sum += rawPrices[k];
      sma25 = Math.round((sum / 25) * 100) / 100;
    }

    let sma75: number | null = null;
    if (i >= 74) {
      let sum = 0;
      for (let k = i - 74; k <= i; k++) sum += rawPrices[k];
      sma75 = Math.round((sum / 75) * 100) / 100;
    }

    result.push({
      date: dateStr,
      displayDate,
      close,
      open,
      high,
      low,
      volume,
      sma25,
      sma75,
    });
  }

  return result;
}

export { resolveTradingViewSymbol, getTradingViewWebUrl };

export function StockTechnicalChart({
  stock,
  theme = "dark",
  isMobile = false,
}: StockTechnicalChartProps) {
  const isUS =
    stock.market === "US" || detectStockCurrency(stock.ticker, stock.market) === "USD";
  const isDemo = Boolean(stock.isDemoData);

  // Responsive mobile width detection (even if isMobile prop is omitted)
  const [internalIsMobile, setInternalIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 640 : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setInternalIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const activeIsMobile = isMobile || internalIsMobile;

  const tvResolution = useMemo(
    () => resolveTradingViewSymbol(stock.ticker, isUS),
    [stock.ticker, isUS],
  );

  // States for TradingView widget loading & fault tolerance
  const [tvLoaded, setTvLoaded] = useState(false);
  const [tvError, setTvError] = useState(false);
  const [tvTimedOut, setTvTimedOut] = useState(false);
  const [tvFallbackActive, setTvFallbackActive] = useState(false);
  const [userSelectedMode, setUserSelectedMode] = useState<"AUTO" | "LOCAL" | "TRADINGVIEW">(
    "AUTO",
  );
  const [selectedRange, setSelectedRange] = useState<"1M" | "3M" | "ALL">("3M");
  const [localSeries, setLocalSeries] = useState<PriceDataPoint[]>([]);
  /**
   * DATA-27: provenance of `localSeries`.
   *
   * `true` when the rendered series is the deterministic fallback generated
   * from the quote instead of historical prices fetched from the API. Such a
   * series is a *reference* value, never live data, so the chart has to
   * disclose it with a badge.
   */
  const [localSeriesIsSynthetic, setLocalSeriesIsSynthetic] = useState(false);
  const [localDataLoading, setLocalDataLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const tvContainerRef = useRef<HTMLDivElement>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gradientId = useMemo(
    () => `stockPriceAreaGrad-${stock.ticker.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    [stock.ticker],
  );

  // Decide effective active engine
  const effectiveMode = useMemo<"TRADINGVIEW" | "LOCAL">(() => {
    // If symbol is not supported by TradingView, or fallback is active, automatically fall back to LOCAL
    if (tvFallbackActive || tvError || tvTimedOut) return "LOCAL";
    if (!tvResolution.isSupported) return "LOCAL";
    if (userSelectedMode === "LOCAL") return "LOCAL";
    if (userSelectedMode === "TRADINGVIEW") return "TRADINGVIEW";
    // AUTO: US stock gets TradingView (unless error/timeout or demo)
    if (isUS && !isDemo) {
      return "TRADINGVIEW";
    }
    return "LOCAL";
  }, [tvResolution.isSupported, userSelectedMode, isUS, isDemo, tvError, tvTimedOut, tvFallbackActive]);

  // Listen for TradingView postMessage runtime error events (e.g. invalid symbol)
  useEffect(() => {
    if (effectiveMode !== "TRADINGVIEW") return;
    const handleTvMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (isTradingViewSymbolError(data)) {
          setTvError(true);
          setTvFallbackActive(true);
        }
      } catch {
        // Ignore non-JSON postMessage from other scripts
      }
    };

    window.addEventListener("message", handleTvMessage);
    return () => {
      window.removeEventListener("message", handleTvMessage);
    };
  }, [effectiveMode]);

  // Load /api/sync-prices or generate deterministic series for local chart
  /**
   * Ticker whose prices were last written to the D1 cache by the preflight
   * sync. The preflight is a write, so it must not repeat for a ticker whose
   * historical series cannot have changed. It is only set once the write
   * actually succeeded, so a failed sync is retried on the next run.
   */
  const lastSyncedTickerRef = useRef<string | null>(null);

  /**
   * Signature of everything the chart actually derives from the quote.
   *
   * The quote object is replaced on every refresh, so depending on the object
   * made the effect re-run (and re-issue its requests) even when nothing the
   * chart shows had changed. The signature is a string, so it only changes
   * when the content changes.
   */
  const stockContentSignature = useMemo(
    () =>
      [
        stock.ticker,
        stock.name,
        stock.theme,
        stock.price,
        stock.volume,
        stock.dayHigh,
        stock.dayLow,
        stock.previousClose,
        stock.yearHigh,
        stock.yearLow,
        (stock.sparkline ?? []).join(","),
      ].join("|"),
    [stock],
  );

  /** Signature (and retry counter) of the last processed quote revision. */
  const processedQuoteRef = useRef<{ signature: string; retryKey: number } | null>(null);

  /**
   * The latest quote object.
   *
   * The data effect below is keyed on the *content* signature, not on the
   * object identity. The quote object is replaced on every refresh, so the
   * effect used to re-run (cancelling the in-flight request) even when
   * nothing the chart shows had changed — and the signature guard then
   * skipped re-issuing the request, so `localDataLoading` was never reset
   * and the chart stayed on its spinner until a full page reload.
   *
   * The ref lets the effect body read the current quote without making the
   * identity a dependency again. The effect that keeps it up to date is
   * declared before the data effect, so it always runs first.
   */
  const stockRef = useRef(stock);
  useEffect(() => {
    stockRef.current = stock;
  }, [stock]);

  useEffect(() => {
    const processed = processedQuoteRef.current;
    if (processed && processed.signature === stockContentSignature && processed.retryKey === retryKey) {
      // Nothing the chart shows has changed since the last run: re-issuing
      // the requests would only duplicate them.
      return;
    }
    processedQuoteRef.current = { signature: stockContentSignature, retryKey };

    // The quote the run is based on. Reading it through the ref keeps the
    // effect's dependencies aligned with its content signature.
    const quote = stockRef.current;

    let isCancelled = false;
    setLocalDataLoading(true);

    async function fetchHistoricalPrices() {
      try {
        let rawSeries: Array<{ date: string; close: number }> | undefined;

        const isBenchmark =
          quote.ticker.startsWith("^") ||
          quote.ticker.includes("=") ||
          quote.ticker === "BTC-USD";

        if (isBenchmark) {
          try {
            const snapRes = await fetch(`/api/snapshot?symbol=${encodeURIComponent(quote.ticker)}`);
            if (snapRes.ok) {
              const snapData = (await snapRes.json()) as {
                series?: Array<{ date: string; close: number }>;
              };
              // DATA-27: a short but real series is still real data and must
              // be rendered as-is instead of being replaced by a synthetic one.
              if (Array.isArray(snapData.series) && snapData.series.length >= 1) {
                rawSeries = snapData.series;
              }
            }
          } catch {
            // Snapshot query is best-effort
          }
        } else {
          // Preflight sync to ensure stock prices are refreshed into D1 cache.
          //
          // `/api/sync-prices` is a *write* endpoint: it fetches from Yahoo and
          // writes D1 rows. The historical series of an unchanged ticker
          // cannot have changed, so the write is only needed when the ticker
          // itself changes. It is recorded as done only after the request
          // succeeded, so a failed write is retried on the next run.
          if (lastSyncedTickerRef.current !== quote.ticker) {
            try {
              const syncRes = await fetch("/api/sync-prices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tickers: [quote.ticker] }),
              });
              if (syncRes.ok) {
                lastSyncedTickerRef.current = quote.ticker;
              }
            } catch {
              // Preflight sync is best-effort; proceed to query /api/calculate.
              // The ticker stays unmarked, so the next run retries the write.
            }
          }

          const calcRes = await fetch("/api/calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              basket: [
                {
                  ticker: quote.ticker,
                  name: quote.name,
                  theme: quote.theme || "その他",
                  weight: 100,
                },
              ],
              baseValue: 1000,
            }),
          });

          if (calcRes.ok) {
            const calcData = (await calcRes.json()) as {
              stockUniverse?: Array<{
                ticker: string;
                series?: Array<{ date: string; close: number }>;
              }>;
            };
            const found = calcData.stockUniverse?.find(
              (s) => s.ticker.toUpperCase() === quote.ticker.toUpperCase(),
            );
            rawSeries = found?.series;
          }
        }

        // DATA-27: a real series is kept as-is, however short it is. Only a
        // missing/failed response falls back to the generated reference series.
        if (Array.isArray(rawSeries) && rawSeries.length >= 1) {
            const total = rawSeries.length;
            const points: PriceDataPoint[] = [];
            for (let i = 0; i < total; i++) {
              const rawP = rawSeries[i].close;
              const p = Number.isFinite(rawP) && rawP > 0 ? rawP : quote.price;
              const dateStr = rawSeries[i].date;
              const displayDate = formatChartDisplayDate(dateStr);

              const sma25 = computeSma(rawSeries, i, 25, p);
              const sma75 = computeSma(rawSeries, i, 75, p);

              const rawVol = (rawSeries[i] as { volume?: number })?.volume;
              const rawOpen = (rawSeries[i] as { open?: number })?.open;
              const rawHigh = (rawSeries[i] as { high?: number })?.high;
              const rawLow = (rawSeries[i] as { low?: number })?.low;

              const baseVol = quote.volume > 0 ? quote.volume : 500000;
              const prevP = i > 0 ? (rawSeries[i - 1]?.close ?? p) : p;
              const priceChangeRate = prevP > 0 ? Math.abs(p - prevP) / prevP : 0.01;
              const dynamicVol = Math.round(
                baseVol * (0.65 + Math.min(priceChangeRate * 12, 1.2) + ((i * 13 + Math.round(p)) % 10) * 0.035),
              );
              const pointVolume = typeof rawVol === "number" && Number.isFinite(rawVol) && rawVol > 0
                ? rawVol
                : dynamicVol;

              let candleOpen = typeof rawOpen === "number" && Number.isFinite(rawOpen) && rawOpen > 0 ? rawOpen : prevP;
              let candleHigh = typeof rawHigh === "number" && Number.isFinite(rawHigh) && rawHigh > 0 ? rawHigh : null;
              let candleLow = typeof rawLow === "number" && Number.isFinite(rawLow) && rawLow > 0 ? rawLow : null;

              if (i === total - 1) {
                if (quote.dayHigh && quote.dayHigh > 0) candleHigh = quote.dayHigh;
                if (quote.dayLow && quote.dayLow > 0) candleLow = quote.dayLow;
                if (quote.previousClose && quote.previousClose > 0 && (!rawOpen || rawOpen <= 0)) {
                  candleOpen = quote.previousClose;
                }
              }

              const finalHigh = candleHigh ?? Math.max(p, candleOpen) * 1.008;
              const finalLow = candleLow ?? Math.min(p, candleOpen) * 0.992;

              points.push({
                date: dateStr,
                displayDate,
                close: p,
                open: candleOpen,
                high: finalHigh,
                low: finalLow,
                volume: pointVolume,
                sma25,
                sma75,
              });
            }
            if (!isCancelled) {
              setLocalSeries(points);
              setLocalSeriesIsSynthetic(false);
              setLocalDataLoading(false);
              return;
            }
          }
        } catch {
        // Fall back gracefully to deterministic series
      }

      if (!isCancelled) {
        const fallback = generateDeterministicHistory(quote, 80);
        setLocalSeries(fallback);
        // DATA-27: the generated series is a reference value, not market data.
        setLocalSeriesIsSynthetic(true);
        setLocalDataLoading(false);
      }
    }

    void fetchHistoricalPrices();
    return () => {
      isCancelled = true;
    };
    // The dependencies mirror the guard above: the run is keyed on the
    // *content* of the quote, so a refresh that returns the same numbers
    // neither cancels the in-flight request nor re-issues it.
  }, [stockContentSignature, retryKey]);

  const activeIsMobileRef = useRef(activeIsMobile);
  useEffect(() => {
    activeIsMobileRef.current = activeIsMobile;
  }, [activeIsMobile]);

  // Mount TradingView Widget when in TRADINGVIEW mode
  useEffect(() => {
    if (effectiveMode !== "TRADINGVIEW") return;
    const container = tvContainerRef.current;
    if (!container) return;

    let isCancelled = false;
    let scriptLoaded = false;
    setTvLoaded(false);
    setTvError(false);
    setTvTimedOut(false);
    container.innerHTML = "";

    // Sanitize and resolve symbol for TradingView embed.
    // シンボル未解決の早期 return はタイマー/ノード作成前に置く。作成後に
    // return するとクリーンアップが登録されず、4秒タイマーがアンマウント後にも
    // 発火してフォールバック状態を書き換える。
    const tvSymbol = tvResolution.symbol;
    if (!tvSymbol) {
      setTvFallbackActive(true);
      return;
    }

    // 4-second timeout monitor for adblocker/CSP/offline failure -> automatically fallback
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      if (!isCancelled && !scriptLoaded) {
        setTvTimedOut(true);
        setTvFallbackActive(true);
      }
    }, 4000);

    const widgetInner = document.createElement("div");
    widgetInner.className = "tradingview-widget-container__widget";
    widgetInner.style.width = "100%";
    widgetInner.style.height = "100%";
    widgetInner.style.minHeight = activeIsMobileRef.current ? "340px" : "460px";
    container.appendChild(widgetInner);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;

    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "D",
      timezone: "Asia/Tokyo",
      theme: theme === "light" ? "light" : "dark",
      style: "1",
      locale: "ja",
      allow_symbol_change: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      studies: ["STD;SMA"],
    });

    const resizeTimers: ReturnType<typeof setTimeout>[] = [];

    script.onload = () => {
      scriptLoaded = true;
      if (!isCancelled) {
        setTvLoaded(true);
        setTvFallbackActive(false);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
        // Dispatch resize event so TradingView canvas recalculates to full container height
        const t1 = setTimeout(() => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("resize"));
          }
        }, 120);
        const t2 = setTimeout(() => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("resize"));
          }
        }, 350);
        resizeTimers.push(t1, t2);
      }
    };

    script.onerror = () => {
      if (!isCancelled) {
        setTvError(true);
        setTvFallbackActive(true);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      }
    };

    container.appendChild(script);

    return () => {
      isCancelled = true;
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      resizeTimers.forEach(clearTimeout);
      if (container) container.innerHTML = "";
    };
    // `tvResolution.symbol` is derived from `stock.ticker` and `isUS`, both of
    // which are dependencies here. Listing the resolved symbol directly keeps
    // the effect self-describing instead of relying on a lint suppression.
  }, [effectiveMode, stock.ticker, isUS, tvResolution.symbol, theme, retryKey]);

  // Dynamically update TradingView widget inner minHeight when mobile breakpoint changes without reloading iframe
  useEffect(() => {
    if (tvContainerRef.current) {
      const widget = tvContainerRef.current.querySelector<HTMLElement>(".tradingview-widget-container__widget");
      if (widget) {
        widget.style.minHeight = activeIsMobile ? "340px" : "460px";
      }
    }
  }, [activeIsMobile]);

  // Filter local series based on selected period
  const displaySeries = useMemo(() => {
    if (!localSeries.length) return [];
    if (selectedRange === "1M") return localSeries.slice(-22);
    if (selectedRange === "3M") return localSeries.slice(-65);
    return localSeries;
  }, [localSeries, selectedRange]);

  const handleRetryTV = useCallback(() => {
    setTvError(false);
    setTvTimedOut(false);
    setTvFallbackActive(false);
    setUserSelectedMode("TRADINGVIEW");
    setRetryKey((k) => k + 1);
  }, []);

  // Official link: resolves via getTradingViewWebUrl (e.g. https://jp.tradingview.com/symbols/TSE-...)
  const tradingViewWebUrl = getTradingViewWebUrl(
    stock.ticker,
    isUS ? "US" : stock.market || "PRIME",
  );

  /**
   * DATA-27: the generated series is only drawn by the local engine, whose
   * label never claims live data. Whenever that series is the one on screen,
   * the chart has to disclose it as a reference (demo) value.
   */
  const showSyntheticBadge = effectiveMode === "LOCAL" && localSeriesIsSynthetic;

  return (
    <div
      className="card stock-technical-chart-container"
      style={{
        padding: activeIsMobile ? "14px" : "20px",
        minHeight: activeIsMobile ? "420px" : "540px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span
            className={`badge ${effectiveMode === "TRADINGVIEW" ? "badge-accent" : "badge-default"} mono tiny`}
          >
            {effectiveMode === "TRADINGVIEW"
              ? "TRADINGVIEW LIVE ENGINE"
              : tvFallbackActive
                ? "LOCAL QUANT ENGINE (US・自動フォールバック)"
                : isUS
                  ? "LOCAL QUANT ENGINE (US)"
                  : "LOCAL QUANT ENGINE (東証 日足・SMA)"}
          </span>
          {/* DATA-27: the generated series is a reference value, not live data. */}
          {showSyntheticBadge && (
            <span
              className="badge badge-warning tiny"
              title="実データ（/api/calculate）を取得できなかったため、引用情報から生成した参考値（デモ）を描画しています。実数据类型は公式TradingViewでも確認できます。"
            >
              参考値（デモ）
            </span>
          )}
          <h3 style={{ fontSize: activeIsMobile ? "1rem" : "1.15rem", fontWeight: 600, margin: 0 }}>
            {stock.name} テクニカルチャート
          </h3>
        </div>

        {/* Action Controls & External Link */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* Switch between local and TV if US stock */}
          {isUS && (
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={() => {
                if (effectiveMode === "TRADINGVIEW") {
                  setUserSelectedMode("LOCAL");
                } else {
                  handleRetryTV();
                }
              }}
              title="チャート描画エンジンを切り替え"
            >
              <Sliders size={12} />
              <span>
                {effectiveMode === "TRADINGVIEW" ? "ローカル高機能チャートで表示" : "TradingViewへ"}
              </span>
            </button>
          )}

          {/* Range selection for local chart */}
          {effectiveMode === "LOCAL" && (
            <div className="btn-group" role="group" aria-label="表示期間">
              {(["1M", "3M", "ALL"] as const).map((rng) => (
                <button
                  key={rng}
                  type="button"
                  className={`btn btn-xs ${selectedRange === rng ? "btn-accent" : "btn-ghost"}`}
                  onClick={() => setSelectedRange(rng)}
                  style={{ padding: "3px 8px", fontSize: "11px" }}
                  aria-pressed={selectedRange === rng}
                >
                  {rng}
                </button>
              ))}
            </div>
          )}

          {/* Official TradingView link */}
          <a
            href={tradingViewWebUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-xs btn-ghost text-muted"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              textDecoration: "none",
            }}
            title="TradingView公式ページで詳細分析（新規タブ）"
          >
            <span>TV公式</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* TradingView Automatic Fallback Notice Banner */}
      {tvFallbackActive && (
        <div
          className="tv-fallback-alert-banner"
          role="alert"
          style={{
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: "8px",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            fontSize: "0.82rem",
            color: "var(--neon-amber, #f59e0b)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 280px" }}>
            <AlertCircle size={16} style={{ flexShrink: 0, color: "var(--neon-amber, #f59e0b)" }} />
            <div>
              <div style={{ fontWeight: 600 }}>TradingView自動フォールバック稼働中</div>
              <div className="tiny" style={{ opacity: 0.9 }}>
                TradingViewシンボル非対応またはエラー・接続制限を検知したため、ローカル高機能チャートで表示しています（日足終値・移動平均線・出来高）。
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={handleRetryTV}
              style={{
                borderColor: "rgba(245, 158, 11, 0.4)",
                color: "var(--text-primary)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
              title="TradingViewの再読み込みを試行"
            >
              <RefreshCw size={11} />
              <span>再読み込み</span>
            </button>
            <a
              href={tradingViewWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-xs btn-ghost text-muted"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                textDecoration: "none",
              }}
              title="公式TradingViewで表示（新規タブ）"
            >
              <span>TV公式</span>
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}

      {/* Japanese Market Regulatory Notice Bar */}
      {!isUS && (
        <div
          className="tiny muted"
          style={{
            background: "var(--surface-control)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "6px",
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.74rem" }}>
            ※ 日本株 (東証) はJPXマーケットデータ規約に基づき高機能ローカル日足チャートを描画しています。
          </span>
          <a
            href={tradingViewWebUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{
              color: "var(--accent-text)",
              fontSize: "0.74rem",
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
            }}
          >
            <span>公式TradingView (TSE) で確認</span>
            <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Chart Canvas Area */}
      <div
        className="stock-technical-chart-canvas-area"
        style={{
          width: "100%",
          height: activeIsMobile ? "380px" : "500px",
          minHeight: activeIsMobile ? "340px" : "460px",
          position: "relative",
          background: "var(--bg-app)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
        }}
      >
        {/* Mode 1: TradingView Embed Container (US Stocks) */}
        {effectiveMode === "TRADINGVIEW" && (
          <>
            {/* Widget DOM mount target */}
            <div
              ref={tvContainerRef}
              className="tradingview-widget-container"
              style={{
                width: "100%",
                height: "100%",
                minHeight: activeIsMobile ? "340px" : "460px",
              }}
              role="region"
              aria-label={`${stock.name} TradingViewチャート`}
            />

            {/* Connecting Spinner while TradingView loads */}
            {!tvLoaded && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: "20px",
                  background: "var(--bg-card)",
                  zIndex: 2,
                  textAlign: "center",
                }}
              >
                <RefreshCw size={26} className="spin animate-spin muted" style={{ marginBottom: 12 }} />
                <div className="tiny muted mono">TradingView リアルタイムチャート接続中...</div>
              </div>
            )}
          </>
        )}

        {/* Mode 2: Recharts Local Quant Technical Chart (JP Stocks or Fallback) */}
        {effectiveMode === "LOCAL" && (
          <div style={{ width: "100%", height: "100%", padding: "10px 4px 0 0", boxSizing: "border-box" }}>
            {localDataLoading && displaySeries.length === 0 ? (
              <div
                style={{
                  height: "100%",
                  minHeight: activeIsMobile ? "340px" : "460px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RefreshCw size={22} className="spin animate-spin muted" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={displaySeries}
                  margin={{ top: 12, right: activeIsMobile ? 8 : 16, left: activeIsMobile ? 0 : 8, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-subtle)"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="displayDate"
                    stroke="var(--text-muted)"
                    fontSize={10}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />

                  <YAxis
                    yAxisId="price"
                    stroke="var(--text-muted)"
                    fontSize={10}
                    domain={["auto", "auto"]}
                    tickLine={false}
                    width={activeIsMobile ? 52 : 60}
                    tickFormatter={(val: number) => {
                      if (typeof val !== "number" || !Number.isFinite(val)) return "--";
                      return isUS ? `$${val.toFixed(1)}` : `¥${val.toLocaleString()}`;
                    }}
                  />

                  <YAxis
                    yAxisId="volume"
                    orientation="right"
                    domain={[
                      0,
                      (dataMax: number) =>
                        Number.isFinite(dataMax) && dataMax > 0 ? dataMax * 3.5 : 100000,
                    ]}
                    hide={true}
                  />

                  <Tooltip
                    allowEscapeViewBox={{ x: false, y: true }}
                    contentStyle={{
                      background: "var(--surface-tooltip)",
                      borderColor: "var(--border-subtle)",
                      borderRadius: "8px",
                      fontSize: "11px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}
                    labelStyle={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: "4px" }}
                    formatter={(val: unknown, name: unknown) =>
                      formatTechnicalTooltipValue(val, name, stock.ticker)
                    }
                  />

                  <Legend
                    verticalAlign="top"
                    height={28}
                    iconSize={10}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "0px" }}
                    formatter={(value: string) => {
                      if (value === "volume") return "出来高";
                      if (value === "close") return "終値";
                      if (value === "sma25") return "SMA 25日";
                      if (value === "sma75") return "SMA 75日";
                      return value;
                    }}
                  />

                  <Bar
                    yAxisId="volume"
                    dataKey="volume"
                    name="volume"
                    fill="rgba(6, 182, 212, 0.2)"
                    barSize={activeIsMobile ? 3 : 6}
                  />

                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="close"
                    name="close"
                    stroke="var(--accent-color)"
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                  />

                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="sma25"
                    name="sma25"
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    dot={false}
                  />

                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="sma75"
                    name="sma75"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
