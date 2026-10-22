import { useMemo } from "react";
import { motion } from "framer-motion";
import { Card, Tag } from "./ui";
import { PieChart as PieIcon, Filter } from "lucide-react";
import type { BasketItem } from "../types";
import { normalizeWeights } from "../lib/indexEngine";

const THEME_COLORS = [
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#3b82f6", // blue
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
];

interface ThemeBreakdownProps {
  basket: BasketItem[];
  selectedTheme: string | null;
  onSelectTheme: (theme: string | null) => void;
}

export function ThemeBreakdown({
  basket,
  selectedTheme,
  onSelectTheme,
}: ThemeBreakdownProps) {
  const themeData = useMemo(() => {
    if (basket.length === 0) return [];

    const normalized = normalizeWeights(basket);
    const map = new Map<string, { weight: number; count: number; theme: string }>();

    for (const item of normalized) {
      const t = item.theme || "その他";
      const existing = map.get(t) || { weight: 0, count: 0, theme: t };
      existing.weight += item.weight;
      existing.count += 1;
      map.set(t, existing);
    }

    return Array.from(map.values())
      .sort((a, b) => b.weight - a.weight)
      .map((item, idx) => ({
        ...item,
        color: THEME_COLORS[idx % THEME_COLORS.length],
      }));
  }, [basket]);

  if (themeData.length === 0) return null;

  return (
    <Card className="section">
      <div className="row space-between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <PieIcon size={16} style={{ color: "var(--accent-text)" }} />
          <h2 style={{ fontSize: 15, margin: 0 }}>テーマ別構成比率</h2>
        </div>
        {selectedTheme && (
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => onSelectTheme(null)}
            style={{ fontSize: 11, padding: "2px 8px" }}
          >
            <Filter size={11} /> フィルター解除 ({selectedTheme})
          </button>
        )}
      </div>

      {/* Visual Stacked Bar */}
      <div className="theme-bar-container" role="img" aria-label="テーマ別構成比率グラフ">
        {themeData.map((t) => (
          <div
            key={t.theme}
            className="theme-bar-segment"
            style={{
              width: `${t.weight}%`,
              backgroundColor: t.color,
              opacity: selectedTheme && selectedTheme !== t.theme ? 0.3 : 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: t.weight > 0 ? 2 : 0,
            }}
            title={`${t.theme}: ${t.weight.toFixed(1)}% (${t.count}銘柄)`}
          />
        ))}
      </div>

      {/* Interactive Legend Chips */}
      <div className="theme-legend">
        {themeData.map((t) => {
          const isSelected = selectedTheme === t.theme;
          return (
            <motion.button
              key={t.theme}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`theme-chip ${isSelected ? "active" : ""}`}
              onClick={() => onSelectTheme(isSelected ? null : t.theme)}
              aria-pressed={isSelected}
              aria-label={`テーマ ${t.theme} 構成比率 ${t.weight.toFixed(1)}%`}
              style={{
                borderColor: isSelected ? t.color : undefined,
                color: "var(--text-primary)",
              }}
            >
              <span className="theme-dot" style={{ backgroundColor: t.color }} />
              <span style={{ fontWeight: isSelected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{t.theme}</span>
              <span className="mono tiny" style={{ color: "var(--text-secondary)", flexShrink: 0 }}>
                {t.weight.toFixed(1)}%
              </span>
              <Tag variant="muted" className="tiny" style={{ padding: "0 4px", fontSize: 10 }}>
                {t.count}
              </Tag>
            </motion.button>
          );
        })}
      </div>
    </Card>
  );
}
