import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Maximize2,
  Minimize2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { useTheme } from "../lib/theme";
import { useModalFocus } from "../hooks/useModalFocus";

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

const STORAGE_KEY_SIZE = "tv_chart_popup_custom_size";

// Default generous dimensions for high-resolution & comfortable analysis
const DEFAULT_SIZE = {
  width: 880,
  height: 560,
};

interface CardDimensions {
  width: number;
  height: number;
}

export function getSavedDimensions(): CardDimensions {
  if (typeof window === "undefined") return DEFAULT_SIZE;
  const isMobile = window.innerWidth <= 640;
  const minW = isMobile ? Math.min(320, Math.floor(window.innerWidth * 0.94)) : 480;
  const minH = isMobile ? Math.min(300, Math.floor(window.innerHeight * 0.80)) : 360;

  try {
    const saved = localStorage.getItem(STORAGE_KEY_SIZE);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.width === "number" &&
        typeof parsed.height === "number" &&
        parsed.width >= minW &&
        parsed.height >= minH
      ) {
        // Clamp to current viewport
        const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.94));
        const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.92));
        return {
          width: Math.min(Math.round(parsed.width), maxW),
          height: Math.min(Math.round(parsed.height), maxH),
        };
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  // Default based on screen width
  const responsiveW = Math.min(DEFAULT_SIZE.width, Math.floor(window.innerWidth * 0.94));
  const responsiveH = Math.min(DEFAULT_SIZE.height, Math.floor(window.innerHeight * 0.88));
  return { width: Math.max(minW, responsiveW), height: Math.max(minH, responsiveH) };
}


export function TradingViewChartModal({ symbol, onClose }: TradingViewChartModalProps) {
  const { theme } = useTheme();
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [dimensions, setDimensions] = useState<CardDimensions>(getSavedDimensions);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [scriptError, setScriptError] = useState(false);

  const preMaximizedSizeRef = useRef<CardDimensions>(getSavedDimensions());
  const isBackdropMouseDownRef = useRef(false);
  const lastResizeTimeRef = useRef(0);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useModalFocus(Boolean(symbol), cardRef, onClose);

  // Trigger smooth transition animation only for button-based sizing (maximize / reset)
  const triggerAnimation = useCallback(() => {
    setIsAnimating(true);
    if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    animTimeoutRef.current = setTimeout(() => {
      setIsAnimating(false);
    }, 250);
  }, []);

  // Save dimensions whenever they change (debounce to localStorage)
  const saveDimensions = useCallback((dims: CardDimensions) => {
    try {
      localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(dims));
    } catch {
      // Ignore
    }
  }, []);

  // Track resize with ResizeObserver (native resize: both or external resize)
  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Persist against the same responsive floors getSavedDimensions()
        // enforces (mobile 320x300) instead of the desktop 460x340 minimum,
        // so resizes on small phones are not silently dropped.
        const minW = window.innerWidth <= 640 ? 300 : 460;
        const minH = window.innerWidth <= 640 ? 280 : 340;
        if (width >= minW && height >= minH && !isMaximized) {
          lastResizeTimeRef.current = Date.now();
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            const newDims = { width: Math.round(width), height: Math.round(height) };
            setDimensions(newDims);
            saveDimensions(newDims);
          }, 300);
        }
      }
    });

    observer.observe(cardEl);
    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isMaximized, saveDimensions]);

  // Toggle maximize with smooth animation
  const handleToggleMaximize = useCallback(() => {
    triggerAnimation();
    if (!isMaximized) {
      preMaximizedSizeRef.current = dimensions;
      const maxW = Math.floor(window.innerWidth * 0.95);
      const maxH = Math.floor(window.innerHeight * 0.92);
      setDimensions({ width: maxW, height: maxH });
      setIsMaximized(true);
    } else {
      setDimensions(preMaximizedSizeRef.current);
      saveDimensions(preMaximizedSizeRef.current);
      setIsMaximized(false);
    }
  }, [isMaximized, dimensions, saveDimensions, triggerAnimation]);

  // Reset to default size with smooth animation
  const handleResetSize = useCallback(() => {
    triggerAnimation();
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
    const minW = isMobile ? Math.min(320, Math.floor(window.innerWidth * 0.94)) : 480;
    const minH = isMobile ? Math.min(300, Math.floor(window.innerHeight * 0.80)) : 380;
    const responsiveW = Math.min(DEFAULT_SIZE.width, window.innerWidth * 0.94);
    const responsiveH = Math.min(DEFAULT_SIZE.height, window.innerHeight * 0.88);
    const newDims = { width: Math.max(minW, responsiveW), height: Math.max(minH, responsiveH) };
    setDimensions(newDims);
    setIsMaximized(false);
    saveDimensions(newDims);
  }, [saveDimensions, triggerAnimation]);

  // Keep modal within viewport when browser window is resized or device rotated
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleWindowResize = () => {
      if (isMaximized) return;
      setDimensions((current) => {
        const maxW = Math.floor(window.innerWidth * 0.96);
        const maxH = Math.floor(window.innerHeight * 0.94);
        if (current.width > maxW || current.height > maxH) {
          const isMobile = window.innerWidth <= 640;
          const minW = isMobile ? Math.min(320, maxW) : Math.min(480, maxW);
          const minH = isMobile ? Math.min(300, maxH) : Math.min(360, maxH);
          const clamped = {
            width: Math.max(minW, Math.min(current.width, maxW)),
            height: Math.max(minH, Math.min(current.height, maxH)),
          };
          saveDimensions(clamped);
          return clamped;
        }
        return current;
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, saveDimensions]);

  // Corner pointer drag resize handlers (robust pointer capture to prevent backdrop clicks)
  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsResizing(true);
    lastResizeTimeRef.current = Date.now();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: cardRef.current?.offsetWidth || dimensions.width,
      h: cardRef.current?.offsetHeight || dimensions.height,
    };
  }, [dimensions, isMaximized]);

  const handleResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStartRef.current) return;
    lastResizeTimeRef.current = Date.now();
    const dx = e.clientX - resizeStartRef.current.x;
    const dy = e.clientY - resizeStartRef.current.y;
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
    const minW = isMobile ? Math.min(320, Math.floor(window.innerWidth * 0.94)) : 480;
    const minH = isMobile ? Math.min(300, Math.floor(window.innerHeight * 0.80)) : 380;
    const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.96));
    const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.94));
    const newW = Math.min(maxW, Math.max(minW, Math.round(resizeStartRef.current.w + dx)));
    const newH = Math.min(maxH, Math.max(minH, Math.round(resizeStartRef.current.h + dy)));
    setDimensions({ width: newW, height: newH });
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStartRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    resizeStartRef.current = null;
    setIsResizing(false);
    lastResizeTimeRef.current = Date.now();
    setDimensions((current) => {
      saveDimensions(current);
      return current;
    });
  }, [saveDimensions]);

  // Safe backdrop click handlers
  const handleBackdropMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    isBackdropMouseDownRef.current = e.target === e.currentTarget;
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Suppress modal close if resize just finished within 400ms
    const timeSinceLastResize = Date.now() - lastResizeTimeRef.current;
    if (timeSinceLastResize < 400) {
      isBackdropMouseDownRef.current = false;
      return;
    }
    // Only close if mousedown was also initiated directly on the backdrop (not dragging from inside)
    if (isBackdropMouseDownRef.current && e.target === e.currentTarget) {
      onClose();
    }
    isBackdropMouseDownRef.current = false;
  }, [onClose]);



  // Load TradingView Symbol Overview widget inside popup
  useEffect(() => {
    if (!symbol) return;
    const container = widgetContainerRef.current;
    if (!container) return;

    setScriptError(false);
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
    script.onload = () => setScriptError(false);
    script.onerror = () => setScriptError(true);
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
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol.title}のTradingViewチャートプレビュー`}
    >
      <div
        ref={cardRef}
        data-modal-dialog="true"
        tabIndex={-1}
        className={`tv-chart-popover-card ${isMaximized ? "is-maximized" : ""} ${isResizing ? "is-resizing" : ""} ${isAnimating ? "is-animating" : ""}`}
        style={{
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tv-chart-popover-header">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: "var(--accent-subtle)",
                border: "1px solid var(--accent-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-text)",
              }}
            >
              <BarChart2 size={15} />
            </div>
            <div>
              <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                <strong style={{ fontSize: 14, color: "var(--text-heading)", fontWeight: 700 }}>
                  {symbol.title}
                </strong>
                <span className="mono tiny muted" style={{ fontSize: 10 }}>
                  {symbol.proName}
                </span>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {symbol.price && (
              <span className="mono bold" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                {symbol.price}
              </span>
            )}
            {symbol.changePercent && (
              <span
                className={`mono tiny ${symbol.isPositive ? "positive" : "negative"}`}
                style={{
                  fontSize: 11,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  color: symbol.isPositive ? "var(--neon-green)" : "var(--neon-red)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: symbol.isPositive ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 51, 102, 0.12)",
                }}
              >
                {symbol.isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {symbol.changePercent}
              </span>
            )}

            {/* Window controls */}
            <div className="row" style={{ gap: 4, marginLeft: 4 }}>
              <button
                type="button"
                onClick={handleResetSize}
                className="tv-window-control-btn"
                title="サイズを初期値に戻す"
                aria-label="サイズを初期値に戻す"
              >
                <RotateCcw size={12} />
              </button>

              <button
                type="button"
                onClick={handleToggleMaximize}
                className="tv-window-control-btn"
                title={isMaximized ? "元のサイズに戻す" : "画面に合わせて最大化"}
                aria-label={isMaximized ? "元のサイズに戻す" : "画面に合わせて最大化"}
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="tv-window-control-btn tv-close-btn"
                title="チャートを閉じる (Esc)"
                aria-label="チャートを閉じる"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* TradingView Chart Container */}
        <div className="tv-chart-popover-body" style={{ position: "relative" }}>
          <div
            ref={widgetContainerRef}
            style={{ width: "100%", height: "100%", display: scriptError ? "none" : "block" }}
            className="tradingview-widget-container"
          />
          {scriptError && (
            <div
              className="column"
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                textAlign: "center",
                gap: 12,
              }}
            >
              <AlertCircle size={32} style={{ color: "var(--neon-amber, #f59e0b)" }} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>チャートウィジェットを読み込めませんでした</div>
              <p className="muted tiny" style={{ maxWidth: 360, margin: 0 }}>
                コンテンツブロッカーやネットワーク環境の影響により、外部ウィジェットスクリプトがブロックされた可能性があります。
              </p>
              <a
                href={tradingViewSymbolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-default"
                style={{ marginTop: 8 }}
              >
                <span>TradingView 公式サイトで開く</span>
                <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tv-chart-popover-footer">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 10 }}>
              TradingView リアルタイム・インタラクティブ分析
            </span>
            <span className="mono tiny muted" style={{ fontSize: 9 }}>
              ※枠右下の角をドラッグして好みの大きさに調整可能（次回以降も記憶）
            </span>
          </div>

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
              marginRight: isMaximized ? 0 : 16,
            }}
          >
            <span>TradingViewで開く</span>
            <ExternalLink size={10} />
          </a>
        </div>

        {/* Corner Resize Grip Handle */}
        {!isMaximized && (
          <div
            className="tv-resize-handle"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            title="ドラッグして表示枠サイズを調整"
            aria-label="枠のサイズを調整"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="10" y1="3" x2="3" y2="10" opacity="0.35" />
              <line x1="10" y1="6.5" x2="6.5" y2="10" opacity="0.65" />
              <line x1="10" y1="10" x2="10" y2="10" opacity="1" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
