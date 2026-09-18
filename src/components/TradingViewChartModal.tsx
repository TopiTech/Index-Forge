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
  RefreshCw,
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
  const minW = isMobile
    ? Math.min(320, Math.floor(window.innerWidth * 0.94))
    : Math.min(480, Math.floor(window.innerWidth * 0.94));
  const minH = isMobile
    ? Math.min(300, Math.floor(window.innerHeight * 0.80))
    : Math.min(360, Math.floor(window.innerHeight * 0.88));

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
  const [isLoading, setIsLoading] = useState(true);
  const [scriptError, setScriptError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const preMaximizedSizeRef = useRef<CardDimensions>(getSavedDimensions());
  const isBackdropMouseDownRef = useRef(false);
  const lastResizeTimeRef = useRef(0);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingDimensionsRef = useRef<CardDimensions | null>(null);

  useModalFocus(Boolean(symbol), cardRef, onClose);

  // Dispatch a global resize event to inform TradingView widget to adapt its internal canvas
  const notifyTradingViewResize = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("resize"));
    }
  }, []);

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

  // Track external resize with ResizeObserver (guarded against active pointer resizing, animation, and jitter loops)
  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      // Skip updates when the user is actively dragging the corner handle
      if (isResizingRef.current) return;
      // Skip updates during maximize transitions or while maximized
      if (isAnimating || isMaximized) return;

      for (const entry of entries) {
        // Use borderBoxSize or offsetWidth to prevent content-box border recursive shrinkage
        const borderBoxW = entry.borderBoxSize?.[0]?.inlineSize ?? cardEl.offsetWidth;
        const borderBoxH = entry.borderBoxSize?.[0]?.blockSize ?? cardEl.offsetHeight;

        // Persist against responsive floors (mobile 300x280, desktop 460x340)
        const minW = window.innerWidth <= 640 ? 300 : 460;
        const minH = window.innerWidth <= 640 ? 280 : 340;
        if (
          borderBoxW >= minW &&
          borderBoxH >= minH &&
          !isMaximized &&
          (Math.abs(borderBoxW - dimensions.width) > 4 || Math.abs(borderBoxH - dimensions.height) > 4)
        ) {
          lastResizeTimeRef.current = Date.now();
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            const newDims = { width: Math.round(borderBoxW), height: Math.round(borderBoxH) };
            setDimensions(newDims);
            saveDimensions(newDims);
            notifyTradingViewResize();
          }, 300);
        }
      }
    });

    observer.observe(cardEl);
    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isMaximized, isAnimating, dimensions.width, dimensions.height, saveDimensions, notifyTradingViewResize]);

  // Toggle maximize with smooth animation and auto canvas recalculation
  const handleToggleMaximize = useCallback(() => {
    triggerAnimation();
    if (!isMaximized) {
      preMaximizedSizeRef.current = dimensions;
      const maxW = Math.floor(window.innerWidth * 0.96);
      const maxH = Math.floor(window.innerHeight * 0.94);
      setDimensions({ width: maxW, height: maxH });
      setIsMaximized(true);
      setTimeout(notifyTradingViewResize, 60);
      setTimeout(notifyTradingViewResize, 260);
    } else {
      const isMobile = window.innerWidth <= 640;
      const minW = isMobile ? 300 : 480;
      const minH = isMobile ? 280 : 380;
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.96));
      const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.94));
      const clamped = {
        width: Math.min(maxW, Math.max(minW, preMaximizedSizeRef.current.width)),
        height: Math.min(maxH, Math.max(minH, preMaximizedSizeRef.current.height)),
      };
      setDimensions(clamped);
      saveDimensions(clamped);
      setIsMaximized(false);
      setTimeout(notifyTradingViewResize, 60);
      setTimeout(notifyTradingViewResize, 260);
    }
  }, [isMaximized, dimensions, saveDimensions, triggerAnimation, notifyTradingViewResize]);

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
    setTimeout(notifyTradingViewResize, 60);
    setTimeout(notifyTradingViewResize, 260);
  }, [saveDimensions, triggerAnimation, notifyTradingViewResize]);

  // Keep modal within viewport when browser window is resized or device rotated
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleWindowResize = () => {
      if (isMaximized) {
        notifyTradingViewResize();
        return;
      }
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
          notifyTradingViewResize();
          return clamped;
        }
        return current;
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, saveDimensions, notifyTradingViewResize]);

  // Corner pointer drag resize handlers with requestAnimationFrame throttling and pointer capture
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
    isResizingRef.current = true;
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
    const minW = isMobile
      ? Math.min(320, Math.floor(window.innerWidth * 0.94))
      : Math.min(480, Math.floor(window.innerWidth * 0.94));
    const minH = isMobile
      ? Math.min(300, Math.floor(window.innerHeight * 0.80))
      : Math.min(380, Math.floor(window.innerHeight * 0.88));
    const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.96));
    const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.94));
    const newW = Math.min(maxW, Math.max(minW, Math.round(resizeStartRef.current.w + dx)));
    const newH = Math.min(maxH, Math.max(minH, Math.round(resizeStartRef.current.h + dy)));

    pendingDimensionsRef.current = { width: newW, height: newH };

    // Direct DOM manipulation during drag for zero-latency 60fps tracking
    if (cardRef.current) {
      cardRef.current.style.width = `${newW}px`;
      cardRef.current.style.height = `${newH}px`;
    }

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingDimensionsRef.current) {
          setDimensions(pendingDimensionsRef.current);
        }
      });
    }
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStartRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const finalDims = pendingDimensionsRef.current || dimensions;
    resizeStartRef.current = null;
    pendingDimensionsRef.current = null;
    setIsResizing(false);
    isResizingRef.current = false;
    lastResizeTimeRef.current = Date.now();

    setDimensions(finalDims);
    saveDimensions(finalDims);

    // Notify TradingView widget to recalibrate canvas dimensions
    notifyTradingViewResize();
  }, [dimensions, saveDimensions, notifyTradingViewResize]);

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

  const handleRetry = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  // Load TradingView Symbol Overview widget inside popup
  useEffect(() => {
    if (!symbol) return;
    const container = widgetContainerRef.current;
    if (!container) return;

    let isCancelled = false;
    setIsLoading(true);
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
    script.onload = () => {
      if (!isCancelled) {
        setIsLoading(false);
        setScriptError(false);
        setTimeout(notifyTradingViewResize, 100);
      }
    };
    script.onerror = () => {
      if (!isCancelled) {
        setIsLoading(false);
        setScriptError(true);
      }
    };
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
      isCancelled = true;
      container.innerHTML = "";
    };
  }, [symbol, theme, reloadKey, notifyTradingViewResize]);

  if (!symbol) return null;

  const tradingViewSymbolUrl = `https://jp.tradingview.com/symbols/${symbol.proName.replace(":", "-")}/`;

  return (
    <div
      className="tv-chart-popover-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol.title}のTradingViewチャートプレビュー`}
        data-modal-dialog="true"
        tabIndex={-1}
        className={`tv-chart-popover-card ${isMaximized ? "is-maximized" : ""} ${isResizing ? "is-resizing" : ""} ${isAnimating ? "is-animating" : ""}`}
        style={{
          width: isMaximized ? undefined : `${dimensions.width}px`,
          height: isMaximized ? undefined : `${dimensions.height}px`,
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
          {/* Loading state indicator */}
          {isLoading && !scriptError && (
            <div className="tv-chart-loading-overlay">
              <div className="tv-chart-loading-spinner" />
              <span className="mono tiny muted" style={{ fontSize: 11 }}>
                TradingView チャート読み込み中...
              </span>
            </div>
          )}

          <div
            ref={widgetContainerRef}
            style={{
              width: "100%",
              height: "100%",
              display: scriptError ? "none" : "block",
              opacity: isLoading ? 0.3 : 1,
              transition: "opacity 0.2s ease",
            }}
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
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="btn btn-sm btn-outline"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <RefreshCw size={12} />
                  <span>再読み込み</span>
                </button>
                <a
                  href={tradingViewSymbolUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-default"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>公式サイトで開く</span>
                  <ExternalLink size={12} />
                </a>
              </div>
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
