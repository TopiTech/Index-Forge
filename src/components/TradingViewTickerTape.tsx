import React, { useState, useRef, useCallback, useEffect } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { TradingViewChartModal, type PopupSymbolInfo } from "./TradingViewChartModal";

export interface TickerSymbolItem {
  proName: string;
  title: string;
  category: string;
  defaultPrice: string;
  defaultChange: string;
  defaultChangePercent: string;
  isPositive: boolean;
  emoji: string;
}

export const TICKER_SYMBOLS: TickerSymbolItem[] = [
  {
    proName: "INDEX:NKY",
    title: "日経平均",
    category: "INDEX",
    defaultPrice: "38,980.50",
    defaultChange: "+145.20",
    defaultChangePercent: "+0.37%",
    isPositive: true,
    emoji: "🇯🇵",
  },
  {
    proName: "FOREXCOM:DJI",
    title: "NYダウ",
    category: "INDEX",
    defaultPrice: "43,825.10",
    defaultChange: "+210.40",
    defaultChangePercent: "+0.48%",
    isPositive: true,
    emoji: "🇺🇸",
  },
  {
    proName: "FOREXCOM:SPXUSD",
    title: "S&P 500",
    category: "INDEX",
    defaultPrice: "5,860.25",
    defaultChange: "+18.90",
    defaultChangePercent: "+0.32%",
    isPositive: true,
    emoji: "🇺🇸",
  },
  {
    proName: "FOREXCOM:NSXUSD",
    title: "NASDAQ 100",
    category: "INDEX",
    defaultPrice: "20,410.80",
    defaultChange: "+95.30",
    defaultChangePercent: "+0.47%",
    isPositive: true,
    emoji: "💻",
  },
  {
    proName: "FX_IDC:USDJPY",
    title: "米ドル/円",
    category: "FX",
    defaultPrice: "155.20",
    defaultChange: "+0.15",
    defaultChangePercent: "+0.10%",
    isPositive: true,
    emoji: "💵",
  },
  {
    proName: "FX_IDC:XAUUSD",
    title: "金 (Gold)",
    category: "COMMODITY",
    defaultPrice: "2,680.50",
    defaultChange: "-8.40",
    defaultChangePercent: "-0.31%",
    isPositive: false,
    emoji: "🪙",
  },
  {
    proName: "TVC:USOIL",
    title: "WTI原油",
    category: "COMMODITY",
    defaultPrice: "71.45",
    defaultChange: "-0.65",
    defaultChangePercent: "-0.90%",
    isPositive: false,
    emoji: "🛢️",
  },
  {
    proName: "BITSTAMP:BTCUSD",
    title: "ビットコイン",
    category: "CRYPTO",
    defaultPrice: "91,240.00",
    defaultChange: "+1,250.00",
    defaultChangePercent: "+1.39%",
    isPositive: true,
    emoji: "₿",
  },
  {
    proName: "BITSTAMP:ETHUSD",
    title: "イーサリアム",
    category: "CRYPTO",
    defaultPrice: "3,340.50",
    defaultChange: "+45.20",
    defaultChangePercent: "+1.37%",
    isPositive: true,
    emoji: "Ξ",
  },
];

const HOVER_TRIGGER_DELAY_MS = 1800; // ~1.8 seconds delay before popup triggers

export function TradingViewTickerTape() {
  const [activePopupSymbol, setActivePopupSymbol] = useState<PopupSymbolInfo | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = useCallback((item: TickerSymbolItem) => {
    setHoveredSymbol(item.proName);

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }

    hoverTimerRef.current = setTimeout(() => {
      setActivePopupSymbol({
        proName: item.proName,
        title: item.title,
        price: item.defaultPrice,
        change: item.defaultChange,
        changePercent: item.defaultChangePercent,
        isPositive: item.isPositive,
      });
    }, HOVER_TRIGGER_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback((item: TickerSymbolItem) => {
    if (hoveredSymbol === item.proName) {
      setHoveredSymbol(null);
    }
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, [hoveredSymbol]);

  const handleCloseModal = useCallback(() => {
    setActivePopupSymbol(null);
  }, []);

  // Double list to create seamless looping ticker
  const displayItems = [...TICKER_SYMBOLS, ...TICKER_SYMBOLS];

  return (
    <>
      <div
        className="tradingview-ticker-bar"
        aria-label="主要指数マーケットティッカー（ホバーでTradingViewチャートプレビュー）"
      >
        <div className="tv-interactive-ticker-wrapper">
          <div
            className={`tv-ticker-track ${hoveredSymbol ? "paused" : ""}`}
            role="region"
            aria-live="off"
          >
            {displayItems.map((item, index) => {
              const isItemHovered = hoveredSymbol === item.proName;
              return (
                <div
                  key={`${item.proName}-${index}`}
                  className={`tv-ticker-item ${isItemHovered ? "is-hovered" : ""}`}
                  onMouseEnter={() => handleMouseEnter(item)}
                  onMouseLeave={() => handleMouseLeave(item)}
                  onClick={() =>
                    setActivePopupSymbol({
                      proName: item.proName,
                      title: item.title,
                      price: item.defaultPrice,
                      change: item.defaultChange,
                      changePercent: item.defaultChangePercent,
                      isPositive: item.isPositive,
                    })
                  }
                  title={`${item.title} (${item.proName}) - 数秒ホバーまたはクリックでチャート表示`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActivePopupSymbol({
                        proName: item.proName,
                        title: item.title,
                        price: item.defaultPrice,
                        change: item.defaultChange,
                        changePercent: item.defaultChangePercent,
                        isPositive: item.isPositive,
                      });
                    }
                  }}
                >
                  <span className="tv-ticker-emoji" aria-hidden="true" style={{ fontSize: 13 }}>
                    {item.emoji}
                  </span>
                  <span className="tv-ticker-symbol-title">{item.title}</span>
                  <span className="tv-ticker-price mono">{item.defaultPrice}</span>
                  <span
                    className={`tv-ticker-change mono ${item.isPositive ? "positive" : "negative"}`}
                  >
                    {item.isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {item.defaultChangePercent}
                  </span>

                  {/* Subtle hover progress indicator countdown */}
                  <div
                    className="tv-ticker-hover-progress"
                    style={{
                      width: isItemHovered ? "100%" : "0%",
                      transitionDuration: isItemHovered ? `${HOVER_TRIGGER_DELAY_MS}ms` : "0s",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Right edge: Official TradingView indicator / credit */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              background: "linear-gradient(90deg, transparent, rgba(10, 15, 25, 0.95) 40%)",
              display: "flex",
              alignItems: "center",
              padding: "0 12px 0 24px",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <a
              href="https://jp.tradingview.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                pointerEvents: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                textDecoration: "none",
                fontSize: 10,
                color: "var(--text-secondary)",
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--border-subtle)",
              }}
              title="TradingView Charts & Market Data"
            >
              <span style={{ fontWeight: 700, color: "var(--accent-text)", letterSpacing: 0.5 }}>
                TV
              </span>
              <span className="tiny mono" style={{ fontSize: 9 }}>Charts</span>
            </a>
          </div>
        </div>
      </div>

      {/* Chart Popover Modal */}
      <TradingViewChartModal
        symbol={activePopupSymbol}
        onClose={handleCloseModal}
      />
    </>
  );
}
