import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Loader2, AlertTriangle, RefreshCw, BarChart2 } from "lucide-react";
import { Card, ButtonGroup } from "./ui";
import { EmptyState } from "./EmptyState";
import type { Timeframe } from "../types";
import { calculateSMA } from "../lib/analytics";
import { filterByTimeframe } from "../lib/timeframe";
import { downsampleLTTB } from "../lib/chartData";
import { changeTone, formatSignedPercent } from "./changeTone";

const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Detects whether the user/system prefers reduced motion.
 * Safely guards for SSR and environments lacking window.matchMedia.
 */
export function getSystemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function ChartLegendIndicator({
  color,
  dashed = false,
  dashArray,
  lineWidth = 2.5,
  label,
}: {
  color: string;
  dashed?: boolean;
  dashArray?: string;
  lineWidth?: number;
  label: React.ReactNode;
}) {
  return (
    <span
      className="chart-legend-item"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginRight: 12,
      }}
    >
      <svg
        width="20"
        height="10"
        viewBox="0 0 20 10"
        aria-hidden="true"
        style={{ flexShrink: 0, verticalAlign: "middle" }}
      >
        <line
          x1="0"
          y1="5"
          x2="20"
          y2="5"
          stroke={color}
          strokeWidth={lineWidth}
          strokeDasharray={dashArray || (dashed ? "4 3" : undefined)}
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export interface ChartPoint {
  date: string;
  value: number;
  nikkei: number;
}

export interface PerformanceChartProps {
  data: ChartPoint[];
  loading: boolean;
  syncing: boolean;
  syncProgress: number;
  syncWarnings?: string[];
  baseValue?: number;
  benchmarkLabel?: string;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  isReloadSuppressed?: boolean;
}

type ViewMode = "value" | "percent" | "spread";

export function PerformanceChart({
  data,
  loading,
  syncing,
  syncProgress,
  syncWarnings = [],
  baseValue = 1000,
  benchmarkLabel = "日経225",
  timeframe,
  onTimeframeChange,
  error,
  onRetry,
  emptyTitle = "データがありません",
  emptyDescription = "表示できるデータがまだありません。時間をおいて再取得してください。",
  emptyActionLabel,
  onEmptyAction,
  isReloadSuppressed = false,
}: PerformanceChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("value");
  const [showSMA5, setShowSMA5] = useState(false);
  const [showSMA25, setShowSMA25] = useState(false);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    getSystemPrefersReducedMotion(),
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    try {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
      }
    } catch {
      // Fallback for environments lacking full matchMedia support
    }
  }, []);

  // Filter data by timeframe
  const filteredData = useMemo(() => filterByTimeframe(data, timeframe), [data, timeframe]);

  // Compute full-history SMA for custom index to maintain continuous moving averages across short timeframes
  const fullSma5Map = useMemo(() => {
    if (!showSMA5 || data.length === 0) return new Map<string, number | null>();
    const smaValues = calculateSMA(data.map((d) => d.value), 5);
    return new Map(data.map((d, idx) => [d.date, smaValues[idx]]));
  }, [data, showSMA5]);

  const fullSma25Map = useMemo(() => {
    if (!showSMA25 || data.length === 0) return new Map<string, number | null>();
    const smaValues = calculateSMA(data.map((d) => d.value), 25);
    return new Map(data.map((d, idx) => [d.date, smaValues[idx]]));
  }, [data, showSMA25]);

  // Compute transformed series for % mode vs value mode vs spread mode
  interface DisplayPoint {
    date: string;
    value: number;
    nikkei: number;
    sma5?: number;
    sma25?: number;
    rawCustom?: number;
    rawNikkei?: number;
    spread?: number;
  }

  const displayData = useMemo<DisplayPoint[]>(() => {
    if (filteredData.length === 0) return [];
    if (viewMode === "value") {
      return filteredData.map((d) => {
        const s5 = fullSma5Map.get(d.date);
        const s25 = fullSma25Map.get(d.date);
        return {
          ...d,
          sma5: s5 !== null && s5 !== undefined ? s5 : undefined,
          sma25: s25 !== null && s25 !== undefined ? s25 : undefined,
        };
      });
    }

    // Baseline normalized to first point of timeframe with valid positive numbers
    const safeBase =
      typeof baseValue === "number" && Number.isFinite(baseValue) && baseValue > 0
        ? baseValue
        : 1000;

    const firstPoint = filteredData[0];
    const firstVal =
      typeof firstPoint?.value === "number" && Number.isFinite(firstPoint.value) && firstPoint.value > 0
        ? firstPoint.value
        : safeBase;
    const firstNikkei =
      typeof firstPoint?.nikkei === "number" && Number.isFinite(firstPoint.nikkei) && firstPoint.nikkei > 0
        ? firstPoint.nikkei
        : safeBase;

    if (viewMode === "spread") {
      return filteredData.map((d, idx) => {
        const rawCustom = typeof d.value === "number" && Number.isFinite(d.value) ? d.value : 0;
        const rawNikkei = typeof d.nikkei === "number" && Number.isFinite(d.nikkei) ? d.nikkei : 0;
        const customPct =
          idx === 0
            ? 0
            : firstVal > 0 && rawCustom > 0
              ? ((rawCustom - firstVal) / firstVal) * 100
              : 0;
        const benchPct =
          idx === 0
            ? 0
            : firstNikkei > 0 && rawNikkei > 0
              ? ((rawNikkei - firstNikkei) / firstNikkei) * 100
              : 0;
        const spread = customPct - benchPct;
        return {
          date: d.date,
          value: spread,
          nikkei: 0,
          rawCustom: d.value,
          rawNikkei: d.nikkei,
          spread,
          sma5: undefined,
          sma25: undefined,
        };
      });
    }

    return filteredData.map((d, idx) => {
      const s5 = fullSma5Map.get(d.date);
      const s25 = fullSma25Map.get(d.date);
      const rawCustom = typeof d.value === "number" && Number.isFinite(d.value) ? d.value : 0;
      const rawNikkei = typeof d.nikkei === "number" && Number.isFinite(d.nikkei) ? d.nikkei : 0;
      const customPct =
        idx === 0
          ? 0
          : firstVal > 0 && rawCustom > 0
            ? ((rawCustom - firstVal) / firstVal) * 100
            : 0;
      const benchPct =
        idx === 0
          ? 0
          : firstNikkei > 0 && rawNikkei > 0
            ? ((rawNikkei - firstNikkei) / firstNikkei) * 100
            : 0;
      return {
        date: d.date,
        value: customPct,
        nikkei: benchPct,
        sma5:
          s5 !== null && s5 !== undefined && firstVal > 0
            ? ((s5 - firstVal) / firstVal) * 100
            : undefined,
        sma25:
          s25 !== null && s25 !== undefined && firstVal > 0
            ? ((s25 - firstVal) / firstVal) * 100
            : undefined,
        rawCustom: d.value,
        rawNikkei: d.nikkei,
      };
    });
  }, [filteredData, viewMode, baseValue, fullSma5Map, fullSma25Map]);

  // Downsample chart data points using LTTB if dataset is large, preserving visual accuracy & peak/troughs
  const renderedData = useMemo(() => {
    if (displayData.length <= 250) return displayData;
    return downsampleLTTB(displayData, 250);
  }, [displayData]);

  // Key chart statistics
  const stats = useMemo(() => {
    if (filteredData.length === 0 || displayData.length === 0) return null;
    const rawValues = filteredData.map((d) => d.value).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (rawValues.length === 0) return null;
    const minVal = Math.min(...rawValues);
    const maxVal = Math.max(...rawValues);

    const firstCustomPoint = filteredData.find(
      (d) => typeof d.value === "number" && Number.isFinite(d.value) && d.value > 0,
    );
    const lastCustomPoint = [...filteredData]
      .reverse()
      .find((d) => typeof d.value === "number" && Number.isFinite(d.value) && d.value > 0);
    const startVal = firstCustomPoint?.value ?? 0;
    const endVal = lastCustomPoint?.value ?? 0;
    const periodReturn = startVal > 0 && endVal > 0 ? ((endVal - startVal) / startVal) * 100 : 0;

    const firstNikkeiPoint = filteredData.find(
      (d) => typeof d.nikkei === "number" && Number.isFinite(d.nikkei) && d.nikkei > 0,
    );
    const lastNikkeiPoint = [...filteredData]
      .reverse()
      .find((d) => typeof d.nikkei === "number" && Number.isFinite(d.nikkei) && d.nikkei > 0);
    const startNikkei = firstNikkeiPoint?.nikkei ?? 0;
    const lastNikkei = lastNikkeiPoint?.nikkei ?? 0;
    const nikkeiReturn =
      startNikkei > 0 && lastNikkei > 0 ? ((lastNikkei - startNikkei) / startNikkei) * 100 : 0;
    const alpha = periodReturn - nikkeiReturn;

    const displayValues = displayData.map((d) => d.value).filter((v) => typeof v === "number" && Number.isFinite(v));
    const displayMin = displayValues.length > 0 ? Math.min(...displayValues) : minVal;
    const displayMax = displayValues.length > 0 ? Math.max(...displayValues) : maxVal;

    return {
      min: minVal,
      max: maxVal,
      displayMin,
      displayMax,
      periodReturn,
      alpha,
    };
  }, [filteredData, displayData]);

  return (
    <Card className="section" role="region" aria-label="パフォーマンス分析チャート">
      {/* Header Controls */}
      <div className="chart-header row space-between flex-wrap" style={{ marginBottom: 16, gap: 12 }}>
        <div className="chart-heading">
          <div className="row" style={{ gap: 8 }}>
            <BarChart2 size={18} style={{ color: "var(--accent-color)" }} />
            <h2 style={{ margin: 0, fontSize: 17 }}>パフォーマンス分析チャート</h2>
          </div>
          <div className="muted tiny" style={{ marginTop: 2 }}>
            独自指数 vs {benchmarkLabel}（基準値正規化・比較）
          </div>
        </div>

        <div className="chart-controls">
          <div className="chart-timeframe-row">
            <ButtonGroup<Timeframe>
              className="timeframe-group"
              ariaLabel="チャートの表示期間"
              items={[
                { label: "1W", value: "1W" },
                { label: "1M", value: "1M" },
                { label: "3M", value: "3M" },
                { label: "6M", value: "6M" },
                { label: "YTD", value: "YTD" },
                { label: "1Y", value: "1Y" },
              ]}
              active={timeframe}
              onChange={onTimeframeChange}
            />
          </div>

          <div className="chart-mode-row">
            <ButtonGroup<ViewMode>
              className="view-mode-group"
              ariaLabel="チャートの表示形式"
              items={[
                { label: "指数値", value: "value" },
                { label: "騰落率", value: "percent" },
                { label: "超過リターン", value: "spread" },
              ]}
              active={viewMode}
              onChange={setViewMode}
            />

            {/* Technical overlays */}
            <div className="btn-group technical-group" role="group" aria-label="テクニカル指標">
              <button
                type="button"
                className={`btn-group-item ${showSMA5 ? "active" : ""}`}
                aria-pressed={showSMA5}
                onClick={() => setShowSMA5(!showSMA5)}
                style={{ fontSize: 11, padding: "4px 8px" }}
                title="5日単純移動平均線"
              >
                SMA5
              </button>
              <button
                type="button"
                className={`btn-group-item ${showSMA25 ? "active" : ""}`}
                aria-pressed={showSMA25}
                onClick={() => setShowSMA25(!showSMA25)}
                style={{ fontSize: 11, padding: "4px 8px" }}
                title="25日単純移動平均線"
              >
                SMA25
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sync / Loading Banner */}
      {syncing && (
        <div
          className="row space-between"
          style={{
            padding: "8px 14px",
            background: "var(--accent-subtle)",
            border: "1px solid var(--border-cyan)",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <Loader2 className="animate-spin" size={13} style={{ color: "var(--accent-color)" }} />
            <span className="mono tiny" style={{ color: "var(--accent-text)" }}>
              株価データ同期中... ({syncProgress}%)
            </span>
          </div>
          <div className="weight-progress-bg" style={{ width: 140 }}>
            <motion.div
              className="weight-progress-bar"
              initial={{ width: 0 }}
              animate={{ width: `${syncProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Chart Canvas */}
      <div className="chart-container">
        {error ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              textAlign: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "rgba(255, 51, 102, 0.1)",
                border: "1px solid var(--neon-red)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--neon-red)",
              }}
            >
              <AlertTriangle size={22} />
            </div>
            <div>
              <div style={{ color: "var(--neon-red)", fontWeight: 600, fontSize: 14 }}>
                {error.includes("ベンチマーク") || error.includes("取得") ? "データの取得に失敗しました" : "指数の計算に失敗しました"}
              </div>
              <div className="muted tiny" style={{ marginTop: 2 }}>
                {error}
              </div>
            </div>
            {onRetry && (
              <button type="button" className="btn btn-default btn-sm" onClick={onRetry} style={{ marginTop: 4 }}>
                <RefreshCw size={12} />
                再試行
              </button>
            )}
          </div>
        ) : displayData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
            <ComposedChart data={renderedData} margin={{ top: 12, right: 14, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="cyanGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={0.18} />
                  <stop offset="65%" stopColor="var(--accent-color)" stopOpacity={0.03} />
                  <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="var(--border-subtle)"
                strokeDasharray="3 3"
                vertical={false}
              />

              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: "var(--border-subtle)" }}
                tick={{ fill: "var(--text-secondary)", fontSize: 11, fontFamily: "var(--mono-font)" }}
                tickFormatter={(d: string) => (typeof d === "string" && d.length >= 10 ? d.slice(5) : d)}
                minTickGap={24}
              />

              <YAxis
                tickLine={false}
                axisLine={{ stroke: "var(--border-subtle)" }}
                width={65}
                tick={{ fill: "var(--text-secondary)", fontSize: 11, fontFamily: "var(--mono-font)" }}
                tickFormatter={(v) => {
                  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
                  if (viewMode === "percent") {
                    return formatSignedPercent(v, 1);
                  }
                  if (viewMode === "spread") {
                    const tone = changeTone(v, 1);
                    return tone === "neutral"
                      ? "0.0%pt"
                      : `${tone === "positive" ? "+" : ""}${v.toFixed(1)}%pt`;
                  }
                  return fmt.format(v);
                }}
                domain={["auto", "auto"]}
              />

              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const customItem = payload.find((p) => p.dataKey === "value");
                  const benchItem = payload.find((p) => p.dataKey === "nikkei");
                  const sma5Item = payload.find((p) => p.dataKey === "sma5");
                  const sma25Item = payload.find((p) => p.dataKey === "sma25");

                  const cVal = typeof customItem?.value === "number" && Number.isFinite(customItem.value) ? customItem.value : undefined;
                  const bVal = typeof benchItem?.value === "number" && Number.isFinite(benchItem.value) ? benchItem.value : undefined;
                  const spread = cVal !== undefined && bVal !== undefined ? (viewMode === "spread" ? cVal : cVal - bVal) : null;
                  const spreadTone = spread !== null ? changeTone(spread, 2) : "neutral";
                  const spreadColor =
                    spreadTone === "positive"
                      ? "var(--neon-green)"
                      : spreadTone === "negative"
                        ? "var(--neon-red)"
                        : "var(--text-secondary)";

                  return (
                    <div className="custom-tooltip">
                      <div className="tooltip-date">{label}</div>
                      {viewMode === "spread" ? (
                        <div className="tooltip-row">
                          <span style={{ color: spreadColor }}>
                            市場超過リターン (α):
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: spreadColor,
                            }}
                          >
                            {spread !== null ? `${formatSignedPercent(spread, 2)}pt` : "---"}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="tooltip-row">
                            <span style={{ color: "var(--accent-text)" }}>独自指数:</span>
                            <span style={{ fontWeight: 700 }}>
                              {cVal !== undefined
                                ? viewMode === "percent"
                                  ? formatSignedPercent(cVal, 2)
                                  : fmt.format(cVal)
                                : "---"}
                            </span>
                          </div>
                          <div className="tooltip-row">
                            <span style={{ color: "var(--text-secondary)" }}>{benchmarkLabel}:</span>
                            <span>
                              {bVal !== undefined
                                ? viewMode === "percent"
                                  ? formatSignedPercent(bVal, 2)
                                  : fmt.format(bVal)
                                : "---"}
                            </span>
                          </div>
                        </>
                      )}
                      {showSMA5 &&
                        typeof sma5Item?.value === "number" &&
                        Number.isFinite(sma5Item.value) &&
                        viewMode !== "spread" && (
                          <div className="tooltip-row">
                            <span style={{ color: "var(--neon-yellow)" }}>SMA (5):</span>
                            <span>
                              {viewMode === "percent"
                                ? `${pct.format(sma5Item.value)}%`
                                : fmt.format(sma5Item.value)}
                            </span>
                          </div>
                        )}
                      {showSMA25 &&
                        typeof sma25Item?.value === "number" &&
                        Number.isFinite(sma25Item.value) &&
                        viewMode !== "spread" && (
                          <div className="tooltip-row">
                            <span style={{ color: "var(--neon-magenta)" }}>SMA (25):</span>
                            <span>
                              {viewMode === "percent"
                                ? `${pct.format(sma25Item.value)}%`
                                : fmt.format(sma25Item.value)}
                            </span>
                          </div>
                        )}
                      {spread !== null && viewMode !== "spread" && (
                        <div
                          className="tooltip-row"
                          style={{
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: "1px dashed var(--border-neutral)",
                          }}
                        >
                          <span style={{ color: spreadColor }}>
                            対市場乖離:
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: spreadColor,
                            }}
                          >
                            {viewMode === "percent"
                              ? `${formatSignedPercent(spread, 2)}pt`
                              : `${spreadTone === "positive" ? "+" : ""}${pct.format(spread)}pts`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />

              {viewMode === "value" && (
                <ReferenceLine
                  y={baseValue}
                  stroke="var(--chart-reference)"
                  strokeDasharray="4 4"
                  label={{
                    value: `BASE ${baseValue}`,
                    fill: "var(--text-muted)",
                    fontSize: 10,
                    position: "insideTopLeft",
                  }}
                />
              )}

              {viewMode !== "value" && (
                <ReferenceLine
                  y={0}
                  stroke="var(--chart-reference-strong)"
                  strokeDasharray="3 3"
                  label={
                    viewMode === "spread"
                      ? {
                          value: `±0%pt (${benchmarkLabel}基準)`,
                          fill: "var(--text-muted)",
                          fontSize: 10,
                          position: "insideTopLeft",
                        }
                      : undefined
                  }
                />
              )}

              {/* Benchmark Line */}
              {/* Preserves reload suppression contract (isAnimationActive={!isReloadSuppressed}) while respecting prefers-reduced-motion */}
              <Line
                type="monotone"
                dataKey="nikkei"
                stroke="var(--text-muted)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 4"
                name="nikkei"
                isAnimationActive={!isReloadSuppressed && !prefersReducedMotion}
              />

              {/* SMA 5 Line */}
              {showSMA5 && (
                <Line
                  type="monotone"
                  dataKey="sma5"
                  stroke="var(--neon-yellow)"
                  strokeWidth={1.5}
                  dot={false}
                  name="sma5"
                  isAnimationActive={!isReloadSuppressed && !prefersReducedMotion}
                />
              )}

              {/* SMA 25 Line */}
              {showSMA25 && (
                <Line
                  type="monotone"
                  dataKey="sma25"
                  stroke="var(--neon-magenta)"
                  strokeWidth={1.5}
                  dot={false}
                  name="sma25"
                  isAnimationActive={!isReloadSuppressed && !prefersReducedMotion}
                />
              )}

              {/* Custom Index Area & Line */}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--accent-color)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#cyanGradient)"
                dot={{ r: 0 }}
                activeDot={{
                  r: 4.5,
                  fill: "var(--accent-color)",
                  stroke: "var(--chart-active-dot)",
                  strokeWidth: 2,
                }}
                name="value"
                isAnimationActive={!isReloadSuppressed && !prefersReducedMotion}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {loading ? (
              <div className="muted mono tiny uppercase" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Loader2 className="animate-spin" size={16} /> 指数データを計算中...
              </div>
            ) : (
              <EmptyState
                title={emptyTitle}
                description={emptyDescription}
                actionLabel={emptyActionLabel}
                onAction={onEmptyAction}
                compact
              />
            )}
          </div>
        )}
      </div>

      {/* Chart Stats Summary Bar */}
      {stats && (
        <div className="chart-stats-summary">
          <div className="chart-stat-item">
            <span className="chart-stat-title">
              {viewMode === "percent"
                ? "期間最高騰落率"
                : viewMode === "spread"
                  ? "期間最大超過幅 (α)"
                  : "期間高値 (HIGH)"}
            </span>
            <span
              className="chart-stat-val"
              style={{
                color:
                  viewMode === "value"
                    ? "var(--neon-green)"
                    : changeTone(stats.displayMax, 2) === "positive"
                      ? "var(--neon-green)"
                      : changeTone(stats.displayMax, 2) === "negative"
                        ? "var(--neon-red)"
                        : "inherit",
              }}
            >
              {viewMode === "percent"
                ? formatSignedPercent(stats.displayMax, 2)
                : viewMode === "spread"
                  ? `${formatSignedPercent(stats.displayMax, 2)}pt`
                  : fmt.format(stats.max)}
            </span>
          </div>

          <div className="chart-stat-item">
            <span className="chart-stat-title">
              {viewMode === "percent"
                ? "期間最低騰落率"
                : viewMode === "spread"
                  ? "期間最小超過幅 (α)"
                  : "期間安値 (LOW)"}
            </span>
            <span
              className="chart-stat-val"
              style={{
                color:
                  viewMode === "value"
                    ? "var(--neon-red)"
                    : changeTone(stats.displayMin, 2) === "positive"
                      ? "var(--neon-green)"
                      : changeTone(stats.displayMin, 2) === "negative"
                        ? "var(--neon-red)"
                        : "inherit",
              }}
            >
              {viewMode === "percent"
                ? formatSignedPercent(stats.displayMin, 2)
                : viewMode === "spread"
                  ? `${formatSignedPercent(stats.displayMin, 2)}pt`
                  : fmt.format(stats.min)}
            </span>
          </div>

          <div className="chart-stat-item">
            <span className="chart-stat-title">期間リターン</span>
            <span
              className="chart-stat-val"
              style={{
                color:
                  changeTone(stats.periodReturn, 2) === "positive"
                    ? "var(--neon-green)"
                    : changeTone(stats.periodReturn, 2) === "negative"
                      ? "var(--neon-red)"
                      : "inherit",
              }}
            >
              {formatSignedPercent(stats.periodReturn, 2)}
            </span>
          </div>

          <div className="chart-stat-item">
            <span className="chart-stat-title">対ベンチマーク超過幅 (α)</span>
            <span
              className="chart-stat-val"
              style={{
                color:
                  changeTone(stats.alpha, 2) === "positive"
                    ? "var(--accent-text)"
                    : changeTone(stats.alpha, 2) === "negative"
                      ? "var(--neon-red)"
                      : "inherit",
              }}
            >
              {formatSignedPercent(stats.alpha, 2)}
            </span>
          </div>
        </div>
      )}

      {/* Warnings */}
      {syncWarnings.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderLeft: "3px solid var(--neon-magenta)",
            background: "rgba(224, 64, 251, 0.05)",
            borderRadius: "0 6px 6px 0",
          }}
        >
          {syncWarnings.map((w, i) => (
            <div key={i} className="muted tiny mono">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="chart-legend-footer row space-between flex-wrap" style={{ marginTop: 14, gap: 8 }}>
        <div className="chart-legend muted tiny mono" style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
          {viewMode === "spread" ? (
            <>
              <ChartLegendIndicator
                color="var(--accent-color)"
                label="独自指数 市場超過リターン (α)"
              />
              <ChartLegendIndicator
                color="var(--text-muted)"
                dashed
                dashArray="3 3"
                label={`${benchmarkLabel}基準線 (±0%pt)`}
              />
            </>
          ) : (
            <>
              <ChartLegendIndicator
                color="var(--accent-color)"
                label="独自指数"
              />
              <ChartLegendIndicator
                color="var(--text-muted)"
                dashed
                dashArray="4 4"
                label={`${benchmarkLabel} (Base ${baseValue}正規化)`}
              />
              {showSMA5 && (
                <ChartLegendIndicator
                  color="var(--neon-yellow)"
                  lineWidth={1.5}
                  label="SMA5"
                />
              )}
              {showSMA25 && (
                <ChartLegendIndicator
                  color="var(--neon-magenta)"
                  lineWidth={1.5}
                  label="SMA25"
                />
              )}
            </>
          )}
        </div>
        <div className="chart-source muted tiny mono">ソース: Yahoo Finance API (日足終値)</div>
      </div>
    </Card>
  );
}
