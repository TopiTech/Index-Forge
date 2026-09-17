import { motion } from "framer-motion";
import { Gauge, TrendingUp, Layers, Activity } from "lucide-react";
import { StatCard } from "./ui";
import type { Snapshot } from "../types";
import type { Timeframe } from "../types";
import type { CustomIndex } from "../data/indices";
import { TIMEFRAME_LABELS } from "../lib/timeframe";

const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface StatsGridProps {
  benchmarkData: { snapshot: Snapshot } | null;
  benchmarkLoading: boolean;
  selectedIndex: CustomIndex | null;
  latestCustomValue: number;
  loading: boolean;
  benchmarkNormalizedValue?: number;
  benchmarkLabel?: string;
  timeframe?: Timeframe;
  periodCustomReturnPct?: number;
  periodBenchmarkReturnPct?: number;
  periodAlphaPct?: number;
}

export function StatsGrid({
  benchmarkData,
  benchmarkLoading,
  selectedIndex,
  latestCustomValue,
  loading,
  benchmarkNormalizedValue,
  benchmarkLabel = "日経225",
  timeframe = "1M",
  periodCustomReturnPct,
  periodBenchmarkReturnPct,
  periodAlphaPct,
}: StatsGridProps) {
  const baseValue = selectedIndex?.baseValue ?? 1000;
  const hasCustom = !loading && typeof latestCustomValue === "number" && latestCustomValue > 0 && selectedIndex !== null;
  const hasPeriodMetrics =
    typeof periodCustomReturnPct === "number" && typeof periodBenchmarkReturnPct === "number";
  // Period metrics are undefined when the filtered range has <2 points (e.g.
  // an early-January YTD). Show "---" with the period label instead of
  // silently substituting a since-inception return under that label.
  const customReturnPct = periodCustomReturnPct;
  const benchmarkReturnPct = periodBenchmarkReturnPct;
  const hasBenchmark =
    typeof periodBenchmarkReturnPct === "number"
      ? !benchmarkLoading
      : typeof benchmarkNormalizedValue === "number" && benchmarkNormalizedValue > 0 && !loading;
  const hasAlpha = hasBenchmark && hasCustom && hasPeriodMetrics;
  const rawBenchmarkDiff = hasAlpha ? (periodAlphaPct ?? customReturnPct! - benchmarkReturnPct!) : 0;
  const benchmarkDiff = Math.abs(rawBenchmarkDiff) < 0.005 ? 0 : rawBenchmarkDiff;
  const safeCustomReturnPct =
    typeof customReturnPct === "number" && Math.abs(customReturnPct) >= 0.005 ? customReturnPct : 0;
  const safeBenchmarkReturnPct =
    typeof benchmarkReturnPct === "number" && Math.abs(benchmarkReturnPct) >= 0.005
      ? benchmarkReturnPct
      : 0;
  const periodLabel = TIMEFRAME_LABELS[timeframe];

  // Distinct themes
  const uniqueThemes = new Set(selectedIndex?.basket.map((b) => b.theme) || []);

  const items = [
    {
      label: selectedIndex ? `${selectedIndex.name}（${periodLabel}）` : "選択中指数",
      value: loading ? "計算中..." : latestCustomValue > 0 ? fmt.format(latestCustomValue) : "---",
      trend: !hasCustom || typeof customReturnPct !== "number"
        ? undefined
        : {
            text: `${safeCustomReturnPct > 0 ? "+" : ""}${pct.format(safeCustomReturnPct)}%`,
            type: (safeCustomReturnPct > 0 ? "positive" : safeCustomReturnPct < 0 ? "negative" : "neutral") as "positive" | "negative" | "neutral",
          },
      sub: selectedIndex ? `基準値 ${fmt.format(baseValue)}` : undefined,
      icon: <Activity size={16} />,
      active: true,
    },
    {
      label: `${benchmarkLabel}（${periodLabel}）`,
      value: benchmarkLoading ? "読込中..." : benchmarkData ? fmt.format(benchmarkData.snapshot.current) : "---",
      trend: hasBenchmark && typeof benchmarkReturnPct === "number"
        ? {
            text: `${safeBenchmarkReturnPct > 0 ? "+" : ""}${pct.format(safeBenchmarkReturnPct)}%`,
            type: (safeBenchmarkReturnPct > 0 ? "positive" : safeBenchmarkReturnPct < 0 ? "negative" : "neutral") as "positive" | "negative" | "neutral",
          }
        : undefined,
      sub: benchmarkData ? `前日比 ${benchmarkData.snapshot.change >= 0 ? "+" : ""}${fmt.format(benchmarkData.snapshot.change)}` : undefined,
      icon: <Gauge size={16} />,
    },
    {
      label: `対${benchmarkLabel} α（${periodLabel}）`,
      value: loading
        ? "計算中..."
        : benchmarkLoading
          ? "読込中..."
          : hasAlpha
            ? `${benchmarkDiff > 0 ? "+" : ""}${pct.format(benchmarkDiff)}%`
            : "---",
      trend: hasAlpha
        ? {
            text: benchmarkDiff > 0 ? "OUTPERFORM" : benchmarkDiff < 0 ? "UNDERPERFORM" : "NEUTRAL",
            type: (benchmarkDiff > 0 ? "positive" : benchmarkDiff < 0 ? "negative" : "neutral") as "positive" | "negative" | "neutral",
          }
        : undefined,
      sub: hasAlpha
        ? benchmarkDiff > 0
          ? `${benchmarkLabel}をアウトパフォーム`
          : benchmarkDiff < 0
            ? `${benchmarkLabel}をアンダーパフォーム`
            : `${benchmarkLabel}と同等`
        : undefined,
      icon: <TrendingUp size={16} />,
    },
    {
      label: "構成バスケット概要",
      value: selectedIndex ? `${selectedIndex.basket.length} 銘柄` : "---",
      sub: selectedIndex ? `${uniqueThemes.size} テーマカテゴリ` : undefined,
      trend: selectedIndex
        ? {
            text: `BASE ${selectedIndex.baseValue}`,
            type: "neutral" as const,
          }
        : undefined,
      icon: <Layers size={16} />,
    },
  ];

  return (
    <div className="grid grid-4 stats-grid">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.4 }}
        >
          <StatCard
            label={item.label}
            value={item.value}
            trend={item.trend}
            sub={item.sub}
            icon={item.icon}
            active={item.active}
          />
        </motion.div>
      ))}
    </div>
  );
}
