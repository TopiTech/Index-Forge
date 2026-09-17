import { useMemo } from "react";
import { motion } from "framer-motion";
import { Card, Tag } from "./ui";
import { ShieldAlert, Activity, Target, ArrowDownRight, Award, Zap } from "lucide-react";
import type { PricePoint } from "../types";
import { calculateRiskMetrics } from "../lib/analytics";

interface RiskMetricsCardProps {
  customSeries: PricePoint[];
  benchmarkSeries: PricePoint[];
  benchmarkName?: string;
  loading?: boolean;
}

const pctFmt = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function RiskMetricsCard({
  customSeries,
  benchmarkSeries,
  benchmarkName = "日経225",
  loading = false,
}: RiskMetricsCardProps) {
  const metrics = useMemo(() => {
    return calculateRiskMetrics(customSeries, benchmarkSeries);
  }, [customSeries, benchmarkSeries]);

  if (loading || customSeries.length < 2) return null;

  const items = [
    {
      label: "シャープレシオ (Sharpe)",
      value: metrics.sharpeRatio.toFixed(2),
      sub:
        metrics.sharpeRatio >= 1
          ? "優秀なリスク対比リターン"
          : metrics.sharpeRatio > 0
            ? "プラスリターン"
            : "リスク見劣り",
      icon: <Target size={15} style={{ color: "var(--accent-text)" }} />,
      color:
        metrics.sharpeRatio >= 1
          ? "var(--neon-green)"
          : metrics.sharpeRatio > 0
            ? "var(--accent-text)"
            : "var(--neon-red)",
    },
    {
      label: "最大ドローダウン (MDD)",
      value: metrics.maxDrawdown > 0 ? `-${pctFmt.format(metrics.maxDrawdown)}%` : "0.00%",
      sub: "期間最高値からの最大下落幅",
      icon: <ArrowDownRight size={15} style={{ color: "var(--neon-red)" }} />,
      color:
        metrics.maxDrawdown < 10
          ? "var(--neon-green)"
          : metrics.maxDrawdown < 20
            ? "var(--neon-amber)"
            : "var(--neon-red)",
    },
    {
      label: "年率ボラティリティ (リスク)",
      value: `${pctFmt.format(metrics.annualVolatility)}%`,
      sub: "日次変動の年率換算標準偏差",
      icon: <Activity size={15} style={{ color: "var(--neon-magenta)" }} />,
      color: "var(--text-primary)",
    },
    {
      label: `ベータ値 (vs ${benchmarkName})`,
      value: metrics.beta === null ? "N/A" : metrics.beta.toFixed(2),
      sub:
        metrics.beta === null
          ? "ベンチマークとの比較に十分なデータがありません"
          : metrics.beta > 1
            ? "市場よりハイボラティリティ"
            : "市場よりマイルドな値動き",
      icon: <Zap size={15} style={{ color: "var(--neon-yellow)" }} />,
      color: metrics.beta === null ? "var(--text-secondary)" : "var(--neon-yellow)",
    },
    {
      label: "日次勝率 (Win Rate)",
      value: `${metrics.winRate.toFixed(1)}%`,
      sub: `最良: ${metrics.bestDay > 0 ? "+" : ""}${metrics.bestDay}% / 最悪: ${metrics.worstDay > 0 ? "+" : ""}${metrics.worstDay}%`,
      icon: <Award size={15} style={{ color: "var(--neon-green)" }} />,
      color: metrics.winRate >= 50 ? "var(--neon-green)" : "var(--neon-red)",
    },
  ];

  return (
    <Card className="section">
      <div className="row space-between" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <ShieldAlert size={16} style={{ color: "var(--accent-text)" }} />
          <h2 style={{ fontSize: 15, margin: 0 }}>
            クオンツ・リスク分析 (Risk & Performance Metrics)
          </h2>
        </div>
        <Tag variant="cyan" className="mono tiny">
          250日換算モデル
        </Tag>
      </div>

      <div className="risk-metrics-grid">
        {items.map((item, idx) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            style={{
              background: "var(--surface-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div className="row space-between">
              <span
                className="mono tiny uppercase muted"
                style={{ fontSize: 10, letterSpacing: 0.8 }}
              >
                {item.label}
              </span>
              {item.icon}
            </div>

            <div
              className="mono bold"
              style={{
                fontSize: 20,
                color: item.color,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.5px",
              }}
            >
              {item.value}
            </div>

            <div
              className="tiny muted"
              style={{ fontSize: 11, marginTop: "auto", lineHeight: 1.3 }}
            >
              {item.sub}
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
