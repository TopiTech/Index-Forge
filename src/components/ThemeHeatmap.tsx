import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Card, Tag } from "./ui";
import { LayoutGrid, TrendingUp, TrendingDown, Layers, Grid } from "lucide-react";
import type { StockDetail } from "../types";
import { createTreemapLayout, type TreemapLayout } from "../lib/treemap";
import { formatStockPrice, formatStockChange } from "../lib/currency";

interface ThemeHeatmapProps {
  stockDetails: StockDetail[];
  selectedTheme: string | null;
  onSelectTheme: (theme: string | null) => void;
}

type HeatmapViewMode = "grid" | "themeGroups";

export function ThemeHeatmap({ stockDetails, selectedTheme, onSelectTheme }: ThemeHeatmapProps) {
  const [viewMode, setViewMode] = useState<HeatmapViewMode>("grid");
  const [hoveredStock, setHoveredStock] = useState<{
    stock: StockDetail;
    x: number;
    y: number;
  } | null>(null);

  const filteredStocks = useMemo(() => {
    return [...stockDetails].sort((a, b) => b.weight - a.weight);
  }, [stockDetails]);

  // Group stocks by theme for the "By Theme" view
  const stocksByTheme = useMemo(() => {
    const map = new Map<string, StockDetail[]>();
    for (const stock of filteredStocks) {
      const theme = stock.theme || "その他";
      if (!map.has(theme)) map.set(theme, []);
      map.get(theme)!.push(stock);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const weightA = a[1].reduce((sum, s) => sum + s.weight, 0);
      const weightB = b[1].reduce((sum, s) => sum + s.weight, 0);
      return weightB - weightA;
    });
  }, [filteredStocks]);

  const isManyStocks = filteredStocks.length > 28;
  const heatmapHeight = Math.max(240, Math.min(480, 150 + Math.sqrt(filteredStocks.length) * 24));

  const treemapLayouts = useMemo(() => {
    const layouts = createTreemapLayout(
      filteredStocks.map((stock) => ({ key: stock.ticker, value: stock.weight })),
    );
    return new Map(layouts.map((layout) => [layout.key, layout]));
  }, [filteredStocks]);

  const themeTreemapLayouts = useMemo(() => {
    const layoutsByTheme = new Map<string, Map<string, TreemapLayout>>();

    for (const [theme, stocks] of stocksByTheme) {
      const layouts = createTreemapLayout(
        stocks.map((stock) => ({ key: stock.ticker, value: stock.weight })),
      );
      layoutsByTheme.set(theme, new Map(layouts.map((layout) => [layout.key, layout])));
    }

    return layoutsByTheme;
  }, [stocksByTheme]);

  if (filteredStocks.length === 0) return null;

  const getBackgroundColor = (pct: number) => {
    if (pct >= 4) return "rgba(16, 185, 129, 0.42)";
    if (pct >= 2) return "rgba(16, 185, 129, 0.28)";
    if (pct >= 0.5) return "rgba(16, 185, 129, 0.18)";
    if (pct > 0) return "rgba(16, 185, 129, 0.10)";
    if (pct <= -4) return "rgba(244, 63, 94, 0.42)";
    if (pct <= -2) return "rgba(244, 63, 94, 0.28)";
    if (pct <= -0.5) return "rgba(244, 63, 94, 0.18)";
    if (pct < 0) return "rgba(244, 63, 94, 0.10)";
    return "rgba(255, 255, 255, 0.03)";
  };

  const getBorderColor = (pct: number) => {
    if (pct >= 2) return "rgba(16, 185, 129, 0.55)";
    if (pct > 0) return "rgba(16, 185, 129, 0.3)";
    if (pct <= -2) return "rgba(244, 63, 94, 0.55)";
    if (pct < 0) return "rgba(244, 63, 94, 0.3)";
    return "rgba(255, 255, 255, 0.08)";
  };

  const handleMouseMove = (e: React.MouseEvent, stock: StockDetail) => {
    // Keep tooltip positioned near cursor but within viewport bounds
    const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 248));
    const y = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - 206));
    setHoveredStock({ stock, x, y });
  };

  const getTooltipId = (stock: StockDetail) =>
    `heatmap-tooltip-${stock.ticker.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  const renderStockTile = (stock: StockDetail, layout: TreemapLayout, compact = false) => {
    const stockTheme = stock.theme || "その他";
    const tooltipId = getTooltipId(stock);
    const isSelectedTheme = selectedTheme ? stockTheme === selectedTheme : true;
    const isUp = stock.changePct > 0;
    const isDown = stock.changePct < 0;
    const tileArea = layout.width * layout.height;
    const sizeClass = tileArea >= 0.06 ? "is-large" : tileArea >= 0.018 ? "is-medium" : "is-small";

    return (
      <div
        key={stock.ticker}
        className={`heatmap-tile ${compact ? "is-compact" : ""} ${sizeClass}`}
        role="button"
        tabIndex={0}
        aria-pressed={selectedTheme === stockTheme}
        aria-describedby={hoveredStock?.stock.ticker === stock.ticker ? tooltipId : undefined}
        aria-label={`${stock.name} (${stock.ticker}) 騰落率: ${stock.changePct >= 0 ? "+" : ""}${stock.changePct.toFixed(1)}%、構成比: ${stock.weight.toFixed(1)}%`}
        onClick={() => onSelectTheme(selectedTheme === stockTheme ? null : stockTheme)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectTheme(selectedTheme === stockTheme ? null : stockTheme);
          }
        }}
        onMouseEnter={(e) => handleMouseMove(e, stock)}
        onMouseMove={(e) => handleMouseMove(e, stock)}
        onMouseLeave={() => setHoveredStock(null)}
        onFocus={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 248));
          const y = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 206));
          setHoveredStock({ stock, x, y });
        }}
        onBlur={() => setHoveredStock(null)}
        style={{
          left: `${layout.x * 100}%`,
          top: `${layout.y * 100}%`,
          width: `${layout.width * 100}%`,
          height: `${layout.height * 100}%`,
          background: getBackgroundColor(stock.changePct),
          border: `1px solid ${getBorderColor(stock.changePct)}`,
          opacity: isSelectedTheme ? 1 : 0.28,
        }}
      >
        <div className="row space-between heatmap-tile-header" style={{ gap: 2 }}>
          <span className="heatmap-tile-code">{stock.ticker}</span>
          <span className="heatmap-tile-weight">{stock.weight.toFixed(1)}%</span>
        </div>

        {!compact && !isManyStocks && <div className="heatmap-tile-name">{stock.name}</div>}

        <div className="row space-between" style={{ marginTop: "auto" }}>
          {!compact && !isManyStocks && (
            <span className="mono tiny" style={{ fontSize: 10, opacity: 0.85 }}>
              {formatStockPrice(stock.currentPrice, stock.ticker)}
            </span>
          )}
          <span
            className="heatmap-tile-change"
            style={{
              color: isUp
                ? "var(--neon-green)"
                : isDown
                  ? "var(--neon-red)"
                  : "var(--text-secondary)",
              marginLeft: compact || isManyStocks ? "auto" : undefined,
            }}
          >
            {isUp && <TrendingUp size={10} />}
            {isDown && <TrendingDown size={10} />}
            {stock.changePct >= 0 ? "+" : ""}
            {stock.changePct.toFixed(1)}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card className="section">
      <div className="row space-between flex-wrap" style={{ marginBottom: 14, gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <LayoutGrid size={16} style={{ color: "var(--accent-text)" }} />
          <h2 style={{ fontSize: 15, margin: 0 }}>構成銘柄ヒートマップ（騰落率 × 構成比）</h2>
          <Tag variant="cyan" className="mono tiny">
            {filteredStocks.length} 銘柄
          </Tag>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {/* View Mode Switcher */}
          <div className="btn-group" role="group" aria-label="ヒートマップ表示切替">
            <button
              type="button"
              className={`btn-group-item ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              title="全銘柄グリッド表示"
            >
              <Grid
                size={12}
                style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}
              />
              全銘柄
            </button>
            <button
              type="button"
              className={`btn-group-item ${viewMode === "themeGroups" ? "active" : ""}`}
              onClick={() => setViewMode("themeGroups")}
              aria-pressed={viewMode === "themeGroups"}
              title="テーマ別グループ表示"
            >
              <Layers
                size={12}
                style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }}
              />
              テーマ別
            </button>
          </div>

          {selectedTheme && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => onSelectTheme(null)}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderColor: "var(--accent-border)",
                color: "var(--accent-text)",
              }}
              title="テーマ絞り込みを解除"
            >
              ✕ テーマ解除 ({selectedTheme})
            </button>
          )}
        </div>
      </div>

      <div className="heatmap-legend" aria-label="ヒートマップの凡例">
        <span className="heatmap-legend-item">
          <span className="heatmap-swatch heatmap-swatch-positive" aria-hidden="true" />
          上昇
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-swatch heatmap-swatch-negative" aria-hidden="true" />
          下落
        </span>
        <span className="heatmap-legend-note" style={{ color: "var(--accent-text)" }}>
          ※ タイルをクリックしてテーマ絞り込み / ホバーで詳細情報
        </span>
      </div>

      {viewMode === "grid" ? (
        <div
          className={`theme-heatmap-grid ${isManyStocks ? "density-compact" : ""}`}
          style={{ height: heatmapHeight }}
        >
          {filteredStocks.map((stock) => {
            const layout = treemapLayouts.get(stock.ticker);
            return layout ? renderStockTile(stock, layout, isManyStocks) : null;
          })}
        </div>
      ) : (
        <div className="heatmap-groups-container">
          {stocksByTheme.map(([theme, stocks]) => {
            const themeWeight = stocks.reduce((sum, s) => sum + s.weight, 0);
            const isCurrentTheme = selectedTheme === theme;

            return (
              <div
                key={theme}
                className="heatmap-group-section"
                style={{
                  borderColor: isCurrentTheme ? "var(--accent-border)" : undefined,
                  background: isCurrentTheme ? "var(--accent-subtle)" : undefined,
                }}
              >
                <div className="heatmap-group-header">
                  <div className="heatmap-group-title">
                    <span>{theme}</span>
                    <span className="tag tag-theme" style={{ fontSize: 9, padding: "1px 5px" }}>
                      {stocks.length}銘柄 ({themeWeight.toFixed(1)}%)
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => onSelectTheme(isCurrentTheme ? null : theme)}
                    style={{ fontSize: 10, padding: "2px 8px" }}
                  >
                    {isCurrentTheme ? "選択中" : "絞り込み"}
                  </button>
                </div>
                <div
                  className="theme-heatmap-grid heatmap-group-grid"
                  style={{
                    height: Math.max(96, Math.min(300, 84 + Math.sqrt(stocks.length) * 36)),
                  }}
                >
                  {stocks.map((stock) => {
                    const layout = themeTreemapLayouts.get(theme)?.get(stock.ticker);
                    return layout ? renderStockTile(stock, layout, true) : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Precision Tooltip */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {hoveredStock && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="heatmap-tooltip-portal"
                id={getTooltipId(hoveredStock.stock)}
                role="tooltip"
                style={{
                  top: hoveredStock.y,
                  left: hoveredStock.x,
                }}
              >
                <div className="row space-between" style={{ marginBottom: 4, gap: 8 }}>
                  <strong style={{ color: "var(--text-heading)", fontSize: 13 }}>
                    {hoveredStock.stock.name}
                  </strong>
                  <span className="mono bold" style={{ color: "var(--accent-text)", fontSize: 12 }}>
                    {hoveredStock.stock.ticker}
                  </span>
                </div>

                <div style={{ marginBottom: 6 }}>
                  <span className="tag tag-theme" style={{ fontSize: 9 }}>
                    {hoveredStock.stock.theme || "その他"}
                  </span>
                </div>

                <div className="tooltip-row">
                  <span className="muted" style={{ fontSize: 10 }}>
                    株価
                  </span>
                  <strong style={{ fontSize: 12 }}>
                    {formatStockPrice(hoveredStock.stock.currentPrice, hoveredStock.stock.ticker)}
                  </strong>
                </div>

                <div className="tooltip-row">
                  <span className="muted" style={{ fontSize: 10 }}>
                    前日比
                  </span>
                  <strong
                    style={{
                      fontSize: 12,
                      color:
                        hoveredStock.stock.changePct > 0
                          ? "var(--neon-green)"
                          : hoveredStock.stock.changePct < 0
                            ? "var(--neon-red)"
                            : "inherit",
                    }}
                  >
                    {hoveredStock.stock.changePct >= 0 ? "+" : ""}
                    {hoveredStock.stock.changePct.toFixed(2)}%
                    {hoveredStock.stock.change !== 0 && (
                      <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>
                        ({formatStockChange(hoveredStock.stock.change, hoveredStock.stock.ticker)})
                      </span>
                    )}
                  </strong>
                </div>

                <div className="tooltip-row">
                  <span className="muted" style={{ fontSize: 10 }}>
                    構成比率
                  </span>
                  <span style={{ fontSize: 11 }}>{hoveredStock.stock.weight.toFixed(2)}%</span>
                </div>

                <div className="tooltip-row">
                  <span className="muted" style={{ fontSize: 10 }}>
                    指数寄与度
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color:
                        hoveredStock.stock.contributionPt >= 0.005
                          ? "var(--neon-green)"
                          : hoveredStock.stock.contributionPt <= -0.005
                            ? "var(--neon-red)"
                            : "inherit",
                    }}
                  >
                    {hoveredStock.stock.contributionPt >= 0.005 ? "+" : ""}
                    {Math.abs(hoveredStock.stock.contributionPt) < 0.005
                      ? "0.00"
                      : hoveredStock.stock.contributionPt.toFixed(2)}{" "}
                    pt
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </Card>
  );
}
