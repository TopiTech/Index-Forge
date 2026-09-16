import React, { useEffect, useRef } from "react";
import { X, ExternalLink, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { useTheme } from "../lib/theme";

export interface PopupSymbolInfo {
  proName: string;
  title: string;
  price?: string;
  change?: string;
  changePercent?: string;
  isPositive?: boolean;
}

interface TradingViewChartModalProps {
  symbol: PopupSymbolInfo | null;
  onClose: () => void;
}

export function TradingViewChartModal({ symbol, onClose }: TradingViewChartModalProps) {
  const { theme } = useTheme();
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Load TradingView Symbol Overview widget inside popup
  useEffect(() => {
    if (!symbol) return;
    const container = widgetContainerRef.current;
    if (!container) return;

    container.innerHTML = "";

    const widgetInner = document.createElement("div");
    widgetInner.className = "tradingview-widget-container__widget";
    widgetInner.style.width = "100%";
    widgetInner.style.height = "100%";
    container.appendChild(widgetInner);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [
        [symbol.title, `${symbol.proName}|1D`],
      ],
      chartOnly: false,
      width: "100%",
      height: "100%",
      locale: "ja",
      colorTheme: theme === "light" ? "light" : "dark",
      autosize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      maLineColor: "#2962FF",
      maLineWidth: 1,
      maLength: 9,
      headerFontSize: "medium",
      lineWidth: 2,
      lineType: 0,
      dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "all|1M"],
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol, theme]);

  if (!symbol) return null;

  const tradingViewSymbolUrl = `https://jp.tradingview.com/symbols/${symbol.proName.replace(":", "-")}/`;

  return (
    <div
      className="tv-chart-popover-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol.title}のTradingViewチャートプレビュー`}
    >
      <div
        className="tv-chart-popover-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tv-chart-popover-header">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "var(--accent-subtle)",
                border: "1px solid var(--accent-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-text)",
              }}
            >
              <BarChart2 size={14} />
            </div>
            <div>
              <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
                <strong style={{ fontSize: 13, color: "var(--text-heading)" }}>
                  {symbol.title}
                </strong>
                <span className="mono tiny muted" style={{ fontSize: 10 }}>
                  {symbol.proName}
                </span>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            {symbol.price && (
              <span className="mono bold" style={{ fontSize: 12 }}>
                {symbol.price}
              </span>
            )}
            {symbol.changePercent && (
              <span
                className={`mono tiny ${symbol.isPositive ? "positive" : "negative"}`}
                style={{
                  fontSize: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  color: symbol.isPositive ? "var(--neon-green)" : "var(--neon-red)",
                }}
              >
                {symbol.isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {symbol.changePercent}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-sm btn-outline"
              style={{
                padding: "2px 6px",
                marginLeft: 6,
                border: "none",
                background: "rgba(255, 255, 255, 0.06)",
                cursor: "pointer",
                borderRadius: 4,
              }}
              title="チャートを閉じる (Esc)"
              aria-label="チャートを閉じる"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* TradingView Chart Container */}
        <div className="tv-chart-popover-body">
          <div
            ref={widgetContainerRef}
            style={{ width: "100%", height: "100%" }}
            className="tradingview-widget-container"
          />
        </div>

        {/* Footer */}
        <div className="tv-chart-popover-footer">
          <span className="muted" style={{ fontSize: 10 }}>
            TradingView リアルタイム・インタラクティブ分析
          </span>
          <a
            href={tradingViewSymbolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="row"
            style={{
              gap: 4,
              alignItems: "center",
              color: "var(--accent-text)",
              textDecoration: "none",
              fontSize: 10,
            }}
          >
            <span>TradingViewで開く</span>
            <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}
