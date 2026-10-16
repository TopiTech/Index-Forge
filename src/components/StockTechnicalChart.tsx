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

  const rawPrices: number[] = new Array(totalDays);
  // Anchor end values
  rawPrices[totalDays - 1] = currentPrice;
  rawPrices[totalDays - 2] = prevClose;

  // Walk backward from prevClose towards a baseline bounded by yearLow/yearHigh
  let walk = prevClose;
  for (let i = totalDays - 3; i >= 0; i--) {
    const delta = (seededRandom() - 0.49) * (currentPrice * 0.022);
    walk -= delta;
    if (walk > yearHigh) walk = yearHigh - seededRandom() * (currentPrice * 0.02);
    if (walk < yearLow) walk = yearLow + seededRandom() * (currentPrice * 0.02);
    rawPrices[i] = Math.max(yearLow * 0.95, walk);
  }

  // If sparkline is present (5 recent points), smoothly interpolate into the last 5 days
  if (Array.isArray(stock.sparkline) && stock.sparkline.length >= 3) {
    const sp = stock.sparkline;
    for (let j = 0; j < Math.min(sp.length, totalDays); j++) {
      const idx = totalDays - sp.length + j;
      if (idx >= 0 && Number.isFinite(sp[j]) && sp[j] > 0) {
        rawPrices[idx] = sp[j];
      }
    }
    rawPrices[totalDays - 1] = currentPrice;
  }

  // Build calendar business dates
  const businessDates: Date[] = [];
  const cur = new Date(now);
  while (businessDates.length < totalDays) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      businessDates.unshift(new Date(cur));
    }
    cur.setDate(cur.getDate() - 1);
  }

  const baseVolume = stock.volume > 0 ? stock.volume : 500000;

  for (let i = 0; i < totalDays; i++) {
    const d = businessDates[i] || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dayStr = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${dayStr}`;
    const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
    const close = Math.round(rawPrices[i] * 100) / 100;
    const isLast = i === totalDays - 1;
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

import { resolveTradingViewSymbol, getTradingViewWebUrl } from "../lib/tradingView";
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
        if (
          data &&
          (data.name === "tv-widget-symbol-error" ||
            data.name === "symbol_error" ||
            data.event === "symbol_error" ||
            (typeof data.msg === "string" && data.msg.toLowerCase().includes("symbol")))
        ) {
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
  useEffect(() => {
    let isCancelled = false;
    setLocalDataLoading(true);

    async function fetchHistoricalPrices() {
      try {
        let rawSeries: Array<{ date: string; close: number }> | undefined;

        const isBenchmark =
          stock.ticker.startsWith("^") ||
          stock.ticker.includes("=") ||
          stock.ticker === "BTC-USD";

        if (isBenchmark) {
          try {
            const snapRes = await fetch(`/api/snapshot?symbol=${encodeURIComponent(stock.ticker)}`);
            if (snapRes.ok) {
              const snapData = (await snapRes.json()) as {
                series?: Array<{ date: string; close: number }>;
              };
              if (Array.isArray(snapData.series) && snapData.series.length >= 3) {
                rawSeries = snapData.series;
              }
            }
          } catch {
            // Snapshot query is best-effort
          }
        } else {
          // Preflight sync to ensure stock prices are refreshed into D1 cache
          try {
            await fetch("/api/sync-prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tickers: [stock.ticker] }),
            });
          } catch {
            // Preflight sync is best-effort; proceed to query /api/calculate
          }

          const calcRes = await fetch("/api/calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              basket: [
                {
                  ticker: stock.ticker,
                  name: stock.name,
                  theme: stock.theme || "その他",
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
              (s) => s.ticker.toUpperCase() === stock.ticker.toUpperCase(),
            );
            rawSeries = found?.series;
          }
        }

        if (Array.isArray(rawSeries) && rawSeries.length >= 5) {
            const total = rawSeries.length;
            const points: PriceDataPoint[] = [];
            for (let i = 0; i < total; i++) {
              const rawP = rawSeries[i].close;
              const p = Number.isFinite(rawP) && rawP > 0 ? rawP : stock.price;
              const dateStr = rawSeries[i].date;
              let displayDate = dateStr;
              if (dateStr) {
                const parts = dateStr.split(/[-/]/);
                if (parts.length >= 3) {
                  const m = parseInt(parts[1], 10);
                  const d = parseInt(parts[2], 10);
                  if (!Number.isNaN(m) && !Number.isNaN(d)) {
                    displayDate = `${m}/${d}`;
                  }
                } else {
                  const dt = new Date(dateStr);
                  displayDate = Number.isNaN(dt.getTime())
                    ? dateStr
                    : `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
                }
              }

              let sma25: number | null = null;
              if (i >= 24) {
                let sum = 0;
                for (let k = i - 24; k <= i; k++) {
                  const c = rawSeries[k]?.close;
                  sum += typeof c === "number" && Number.isFinite(c) && c > 0 ? c : p;
                }
                sma25 = Math.round((sum / 25) * 100) / 100;
              }

              let sma75: number | null = null;
              if (i >= 74) {
                let sum = 0;
                for (let k = i - 74; k <= i; k++) {
                  const c = rawSeries[k]?.close;
                  sum += typeof c === "number" && Number.isFinite(c) && c > 0 ? c : p;
                }
                sma75 = Math.round((sum / 75) * 100) / 100;
              }

              const rawVol = (rawSeries[i] as { volume?: number })?.volume;
              const rawOpen = (rawSeries[i] as { open?: number })?.open;
              const rawHigh = (rawSeries[i] as { high?: number })?.high;
              const rawLow = (rawSeries[i] as { low?: number })?.low;

              const baseVol = stock.volume > 0 ? stock.volume : 500000;
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
                if (stock.dayHigh && stock.dayHigh > 0) candleHigh = stock.dayHigh;
                if (stock.dayLow && stock.dayLow > 0) candleLow = stock.dayLow;
                if (stock.previousClose && stock.previousClose > 0 && (!rawOpen || rawOpen <= 0)) {
                  candleOpen = stock.previousClose;
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
              setLocalDataLoading(false);
              return;
            }
          }
        } catch {
        // Fall back gracefully to deterministic series
      }

      if (!isCancelled) {
        const fallback = generateDeterministicHistory(stock, 80);
        setLocalSeries(fallback);
        setLocalDataLoading(false);
      }
    }

    void fetchHistoricalPrices();
    return () => {
      isCancelled = true;
    };
  }, [stock, retryKey]);

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

    // Sanitize and resolve symbol for TradingView embed
    const tvSymbol = tvResolution.symbol;
    if (!tvSymbol) {
      setTvFallbackActive(true);
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMode, stock.ticker, isUS, theme, retryKey]);

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
                    tickFormatter={(val: number) =>
                      isUS ? `$${val.toFixed(1)}` : `¥${val.toLocaleString()}`
                    }
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
                    formatter={(val: unknown, name: unknown) => {
                      const isValidNum = typeof val === "number" && Number.isFinite(val);
                      if (name === "volume") {
                        return [isValidNum ? val.toLocaleString() : "--", "出来高"];
                      }
                      if (name === "close") {
                        return [isValidNum ? formatStockPrice(val, stock.ticker) : "--", "終値"];
                      }
                      if (name === "sma25") {
                        return [isValidNum ? formatStockPrice(val, stock.ticker) : "--", "SMA 25日"];
                      }
                      if (name === "sma75") {
                        return [isValidNum ? formatStockPrice(val, stock.ticker) : "--", "SMA 75日"];
                      }
                      return [isValidNum ? val : "--", String(name)];
                    }}
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
