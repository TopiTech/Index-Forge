import { motion } from "framer-motion";
import { Gauge, TrendingUp, Layers, Activity } from "lucide-react";
import { StatCard } from "./ui";
import type { Snapshot } from "../types";
import type { Timeframe } from "../types";
import type { CustomIndex } from "../data/indices";
import { TIMEFRAME_LABELS } from "../lib/timeframe";
import { changeTone, formatSignedAmount, formatSignedPercent } from "./changeTone";

const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });

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
  const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

  const hasCustom =
    !loading &&
    isFiniteNumber(latestCustomValue) &&
    latestCustomValue > 0 &&
    selectedIndex !== null;
  const hasPeriodMetrics =
    typeof periodCustomReturnPct === "number" &&
    Number.isFinite(periodCustomReturnPct) &&
    typeof periodBenchmarkReturnPct === "number" &&
    Number.isFinite(periodBenchmarkReturnPct);
  // Period metrics are undefined when the filtered range has <2 points (e.g.
  // an early-January YTD). Show "---" with the period label instead of
  // silently substituting a since-inception return under that label.
  const customReturnPct = periodCustomReturnPct;
  const benchmarkReturnPct = periodBenchmarkReturnPct;
  const hasBenchmark =
    typeof periodBenchmarkReturnPct === "number"
      ? !benchmarkLoading && Number.isFinite(periodBenchmarkReturnPct)
      : isFiniteNumber(benchmarkNormalizedValue) && benchmarkNormalizedValue > 0 && !loading;
  const safeAlphaPct = isFiniteNumber(periodAlphaPct) ? periodAlphaPct : undefined;
  const hasAlpha =
    hasBenchmark &&
    hasCustom &&
    hasPeriodMetrics &&
    (safeAlphaPct !== undefined ||
      (isFiniteNumber(customReturnPct) && isFiniteNumber(benchmarkReturnPct)));
  const fallbackBenchmarkDiff =
    isFiniteNumber(customReturnPct) && isFiniteNumber(benchmarkReturnPct)
      ? customReturnPct - benchmarkReturnPct
      : 0;
  const rawBenchmarkDiff = hasAlpha ? (safeAlphaPct ?? fallbackBenchmarkDiff) : 0;
  const isRawDiffFinite = isFiniteNumber(rawBenchmarkDiff);
  const normalizedBenchmarkDiff = Math.abs(rawBenchmarkDiff) < 0.005 ? 0 : rawBenchmarkDiff;
  const benchmarkDiff = isRawDiffFinite ? normalizedBenchmarkDiff : 0;
  const alphaTone = changeTone(benchmarkDiff, 2);
  const safeCustomReturnPct =
    isFiniteNumber(customReturnPct) && Math.abs(customReturnPct) >= 0.005 ? customReturnPct : 0;
  const safeBenchmarkReturnPct =
    isFiniteNumber(benchmarkReturnPct) && Math.abs(benchmarkReturnPct) >= 0.005
      ? benchmarkReturnPct
      : 0;
  const periodLabel = TIMEFRAME_LABELS[timeframe];

  // Distinct themes
  const uniqueThemes = new Set(selectedIndex?.basket.map((b) => b.theme) || []);

  const items = [
    {
      label: selectedIndex ? `${selectedIndex.name}（${periodLabel}）` : "選択中指数",
      value:
        loading
          ? "計算中..."
          : isFiniteNumber(latestCustomValue) && latestCustomValue > 0
            ? fmt.format(latestCustomValue)
            : "---",
      trend:
        !hasCustom || typeof customReturnPct !== "number" || !Number.isFinite(customReturnPct)
          ? undefined
          : {
              text: formatSignedPercent(safeCustomReturnPct, 2),
              type: changeTone(safeCustomReturnPct, 2),
            },
      sub:
        selectedIndex && isFiniteNumber(baseValue)
          ? `基準値 ${fmt.format(baseValue)}`
          : undefined,
      icon: <Activity size={16} />,
      active: true,
    },
    {
      label: `${benchmarkLabel}（${periodLabel}）`,
      value:
        benchmarkLoading
          ? "読込中..."
          : benchmarkData && isFiniteNumber(benchmarkData.snapshot.current)
            ? fmt.format(benchmarkData.snapshot.current)
            : "---",
      trend:
        hasBenchmark && typeof benchmarkReturnPct === "number" && Number.isFinite(benchmarkReturnPct)
          ? {
              text: formatSignedPercent(safeBenchmarkReturnPct, 2),
              type: changeTone(safeBenchmarkReturnPct, 2),
            }
          : undefined,
      sub:
        benchmarkData && isFiniteNumber(benchmarkData.snapshot.change)
          ? `前日比 ${formatSignedAmount(benchmarkData.snapshot.change, (n) => fmt.format(n))}${isFiniteNumber(benchmarkData.snapshot.changePct) ? ` (${formatSignedPercent(benchmarkData.snapshot.changePct, 2)})` : ""}`
          : undefined,
      icon: <Gauge size={16} />,
    },
    {
      label: `対${benchmarkLabel} α（${periodLabel}）`,
      value: loading
        ? "計算中..."
        : benchmarkLoading
          ? "読込中..."
          : hasAlpha && isRawDiffFinite
            ? formatSignedPercent(benchmarkDiff, 2)
            : "---",
      trend:
        hasAlpha && isRawDiffFinite
          ? {
              text: alphaTone === "positive" ? "OUTPERFORM" : alphaTone === "negative" ? "UNDERPERFORM" : "NEUTRAL",
              type: alphaTone,
            }
          : undefined,
      sub:
        hasAlpha && isRawDiffFinite
          ? alphaTone === "positive"
            ? `${benchmarkLabel}をアウトパフォーム`
            : alphaTone === "negative"
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
            text: `BASE ${isFiniteNumber(selectedIndex.baseValue) ? selectedIndex.baseValue : "---"}`,
            type: "neutral" as const,
          }
        : undefined,
      icon: <Layers size={16} />,
    },
  ];

  return (
    <div
      className="grid grid-4 stats-grid"
      role="group"
      aria-label="指数サマリー統計"
    >
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
