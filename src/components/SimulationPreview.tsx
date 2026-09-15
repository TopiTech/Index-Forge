import React, { useMemo } from "react";
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
import {
  TrendingUp,
  Activity,
  ShieldAlert,
  BarChart3,
  Percent,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import type { Timeframe, BenchmarkSymbol, PricePoint } from "../types";
import { AVAILABLE_BENCHMARKS } from "../hooks/useBenchmark";
import type { SimulationResult } from "../hooks/useSimulation";

interface SimulationPreviewProps {
  simulation: SimulationResult;
  baseValue: number;
  indexName?: string;
}

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1週間", value: "1W" },
  { label: "1ヶ月", value: "1M" },
  { label: "3ヶ月", value: "3M" },
  { label: "6ヶ月", value: "6M" },
  { label: "1年", value: "1Y" },
];

export function SimulationPreview({
  simulation,
  baseValue,
  indexName,
}: SimulationPreviewProps) {
  const {
    filteredCustomSeries,
    filteredBenchmarkSeries,
    metrics,
    periodCustomReturnPct,
    periodBenchmarkReturnPct,
    alphaPct,
    constituentsPerformance,
    loading,
    error,
    timeframe,
    setTimeframe,
    selectedBenchmark,
    setSelectedBenchmark,
    runSimulation,
  } = simulation;

  // Build aligned chart data with relative percentage returns from start of period
  const chartData = useMemo(() => {
    if (filteredCustomSeries.length === 0) return [];

    const customBase =
      filteredCustomSeries[0].value ?? filteredCustomSeries[0].close ?? baseValue;

    // Create a benchmark lookup map by date
    const benchmarkMap = new Map(filteredBenchmarkSeries.map((b) => [b.date, b.close]));
    const benchmarkBase =
      filteredBenchmarkSeries.length > 0 ? filteredBenchmarkSeries[0].close : 0;

    return filteredCustomSeries.map((point) => {
      const customVal = point.value ?? point.close;
      const customReturnPct =
        customBase > 0 ? ((customVal - customBase) / customBase) * 100 : 0;

      const bmVal = benchmarkMap.get(point.date);
      const benchmarkReturnPct =
        bmVal !== undefined && benchmarkBase > 0
          ? ((bmVal - benchmarkBase) / benchmarkBase) * 100
          : null;

      return {
        date: point.date,
        customValue: customVal,
        customReturnPct: Number(customReturnPct.toFixed(2)),
        benchmarkReturnPct:
          benchmarkReturnPct !== null ? Number(benchmarkReturnPct.toFixed(2)) : null,
      };
    });
  }, [filteredCustomSeries, filteredBenchmarkSeries, baseValue]);

  const currentBenchmarkLabel =
    AVAILABLE_BENCHMARKS.find((b) => b.symbol === selectedBenchmark)?.shortLabel || "ベンチマーク";

  return (
    <div
      className="simulation-preview-container"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "var(--surface-neutral)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        padding: 16,
      }}
    >
      {/* Header bar: Title, guest badge, timeframe and benchmark toggles */}
      <div className="row space-between flex-wrap" style={{ gap: 10, alignItems: "center" }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(6, 182, 212, 0.15)",
              color: "var(--accent-text)",
              border: "1px solid var(--accent-border)",
            }}
          >
            <Sparkles size={15} />
          </div>
          <div>
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-heading)" }}>
                リアルタイム・シミュレーション
              </span>
              <span
                className="badge"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "var(--neon-green)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Zap size={10} /> ログイン不要
              </span>
            </div>
            <span className="mono tiny muted" style={{ fontSize: 10 }}>
              {indexName ? `「${indexName}」` : "作成中指数"} の過去バックテスト推移
            </span>
          </div>
        </div>

        {/* Controls: Timeframe and Benchmark */}
        <div className="row flex-wrap" style={{ gap: 6, alignItems: "center" }}>
          {/* Benchmark selector */}
          <select
            aria-label="比較ベンチマーク選択"
            value={selectedBenchmark}
            onChange={(e) => setSelectedBenchmark(e.target.value as BenchmarkSymbol)}
            className="input-search"
            style={{
              padding: "2px 8px",
              height: 28,
              fontSize: 11,
              background: "var(--bg-card)",
              borderRadius: 6,
              width: "auto",
            }}
          >
            {AVAILABLE_BENCHMARKS.map((b) => (
              <option key={b.symbol} value={b.symbol}>
                vs {b.shortLabel}
              </option>
            ))}
          </select>

          {/* Timeframe buttons */}
          <div
            className="row"
            style={{
              background: "var(--surface-control)",
              borderRadius: 6,
              padding: 2,
              gap: 2,
            }}
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => setTimeframe(tf.value)}
                className={`btn btn-sm ${timeframe === tf.value ? "btn-default" : "btn-outline"}`}
                style={{
                  padding: "2px 7px",
                  fontSize: 11,
                  height: 24,
                  border: timeframe === tf.value ? "none" : "1px solid transparent",
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => runSimulation(true)}
            disabled={loading}
            className="btn btn-sm btn-outline"
            style={{ height: 28, padding: "0 8px" }}
            title="最新データを再取得してシミュレーション更新"
            aria-label="シミュレーションを再実行"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Error state alert */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: "rgba(255, 51, 102, 0.15)",
            border: "1px solid var(--neon-red)",
            borderRadius: 6,
            color: "var(--neon-red)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Key Stats Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 8,
        }}
      >
        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            期間リターン
          </div>
          <div
            className="mono bold"
            style={{
              fontSize: 15,
              color: periodCustomReturnPct >= 0 ? "var(--neon-green)" : "var(--neon-red)",
            }}
          >
            {periodCustomReturnPct >= 0 ? "+" : ""}
            {periodCustomReturnPct}%
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            vs {currentBenchmarkLabel} ({periodBenchmarkReturnPct >= 0 ? "+" : ""}
            {periodBenchmarkReturnPct}%)
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            超過リターン (α)
          </div>
          <div
            className="mono bold"
            style={{
              fontSize: 15,
              color: alphaPct >= 0 ? "var(--accent-text)" : "var(--neon-yellow)",
            }}
          >
            {alphaPct >= 0 ? "+" : ""}
            {alphaPct}%
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            対比ベンチマーク差分
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            年率換算リターン
          </div>
          <div
            className="mono bold"
            style={{
              fontSize: 15,
              color: metrics.annualReturn >= 0 ? "var(--neon-green)" : "var(--neon-red)",
            }}
          >
            {metrics.annualReturn >= 0 ? "+" : ""}
            {metrics.annualReturn.toFixed(1)}%
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            CAGR 相当
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            ボラティリティ (年率)
          </div>
          <div className="mono bold" style={{ fontSize: 15, color: "var(--text-primary)" }}>
            {metrics.annualVolatility.toFixed(1)}%
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            価格変動リスク
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            シャープレシオ
          </div>
          <div
            className="mono bold"
            style={{
              fontSize: 15,
              color:
                metrics.sharpeRatio >= 1
                  ? "var(--neon-green)"
                  : metrics.sharpeRatio >= 0
                    ? "var(--accent-text)"
                    : "var(--neon-red)",
            }}
          >
            {metrics.sharpeRatio.toFixed(2)}
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            リスク調整後収益
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
        >
          <div className="tiny muted mono" style={{ fontSize: 10 }}>
            最大ドローダウン
          </div>
          <div className="mono bold" style={{ fontSize: 15, color: "var(--neon-red)" }}>
            -{metrics.maxDrawdown.toFixed(1)}%
          </div>
          <div className="tiny muted mono" style={{ fontSize: 9 }}>
            ピークからの最大下落
          </div>
        </div>
      </div>

      {/* Interactive Performance Chart */}
      <div
        style={{
          background: "var(--bg-dark)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: "12px 14px 4px 6px",
          height: 240,
          position: "relative",
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(9, 13, 22, 0.7)",
              borderRadius: 8,
              zIndex: 10,
              gap: 8,
              color: "var(--accent-text)",
              fontSize: 12,
            }}
          >
            <RefreshCw size={16} className="animate-spin" />
            <span>シミュレーション計算中...</span>
          </div>
        )}

        {chartData.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            <Activity size={24} style={{ opacity: 0.5 }} />
            <span>銘柄を追加するとシミュレーションチャートが表示されます</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="simColorCustom" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-subtle)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                stroke="var(--text-muted)"
                fontSize={10}
                tickLine={false}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis
                stroke="var(--text-muted)"
                fontSize={10}
                tickLine={false}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <ReferenceLine y={0} stroke="rgba(255, 255, 255, 0.2)" strokeDasharray="2 2" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const custom = payload.find((p) => p.dataKey === "customReturnPct");
                  const bm = payload.find((p) => p.dataKey === "benchmarkReturnPct");
                  return (
                    <div
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--accent-border)",
                        borderRadius: 6,
                        padding: "8px 10px",
                        fontSize: 11,
                        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                      }}
                    >
                      <div className="mono tiny muted" style={{ marginBottom: 4 }}>
                        {label}
                      </div>
                      <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                        <span style={{ color: "var(--accent-text)" }}>
                          {indexName || "独自指数"}:
                        </span>
                        <span className="mono bold">
                          {Number(custom?.value) >= 0 ? "+" : ""}
                          {custom?.value}%
                        </span>
                      </div>
                      {bm && bm.value !== null && bm.value !== undefined && (
                        <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                          <span style={{ color: "var(--text-secondary)" }}>
                            {currentBenchmarkLabel}:
                          </span>
                          <span className="mono bold">
                            {Number(bm.value) >= 0 ? "+" : ""}
                            {bm.value}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="customReturnPct"
                stroke="var(--accent-color)"
                strokeWidth={2}
                fill="url(#simColorCustom)"
                isAnimationActive={false}
                name="独自指数"
              />
              <Line
                type="monotone"
                dataKey="benchmarkReturnPct"
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
                name={currentBenchmarkLabel}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Constituent Performance & Contribution Table */}
      {constituentsPerformance.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row space-between" style={{ alignItems: "center" }}>
            <span className="mono tiny bold uppercase" style={{ color: "var(--accent-text)" }}>
              構成銘柄別パフォーマンス内訳 ({constituentsPerformance.length} 銘柄)
            </span>
            <span className="tiny muted mono" style={{ fontSize: 10 }}>
              ※ 寄与度 = 構成比率 × 期間リターン
            </span>
          </div>

          <div
            style={{
              maxHeight: 140,
              overflowY: "auto",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              background: "var(--bg-card)",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: "var(--surface-control)",
                    textAlign: "left",
                    color: "var(--text-muted)",
                  }}
                >
                  <th style={{ padding: "6px 8px" }}>銘柄</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>比率</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>期間リターン</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>寄与度</th>
                </tr>
              </thead>
              <tbody>
                {constituentsPerformance.map((item) => (
                  <tr
                    key={item.ticker}
                    style={{ borderBottom: "1px solid var(--border-row)" }}
                  >
                    <td style={{ padding: "6px 8px" }}>
                      <span className="mono bold" style={{ color: "var(--accent-text)" }}>
                        {item.ticker}
                      </span>{" "}
                      <span style={{ color: "var(--text-primary)" }}>{item.name}</span>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }} className="mono">
                      {item.weight.toFixed(1)}%
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        color: item.periodReturnPct >= 0 ? "var(--neon-green)" : "var(--neon-red)",
                      }}
                      className="mono bold"
                    >
                      {item.periodReturnPct >= 0 ? "+" : ""}
                      {item.periodReturnPct}%
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        color:
                          item.contributionPct >= 0 ? "var(--neon-green)" : "var(--neon-red)",
                      }}
                      className="mono bold"
                    >
                      {item.contributionPct >= 0 ? "+" : ""}
                      {item.contributionPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
